import { supabase } from "./supabase.js";
import type { UserState } from "./types.js";
import { setPrimaryAccount, type AccountSummary } from "./accounts.js";
import { setUserSetupStage } from "./state.js";
import { sendWhatsAppButtons, sendWhatsAppList } from "./whatsapp.js";
import { formatCurrency } from "./format.js";

/**
 * Inserts an account into Supabase safely, whether the is_primary column exists or not.
 */
async function insertAccountSafely(name: string, balance: number, isPrimary: boolean): Promise<void> {
  const { error } = await (supabase.from("accounts") as any).insert({
    name,
    balance,
    is_primary: isPrimary,
  });

  if (error) {
    console.warn("[onboarding] Retrying insert without is_primary column:", error.message);
    const { error: fallbackError } = await (supabase.from("accounts") as any).insert({
      name,
      balance,
    });
    if (fallbackError) {
      console.error("[onboarding] Failed to insert account:", fallbackError.message);
    }
  }
}

/**
 * Extracts a numeric balance from user input like "12000", "rs 12,340", "₹500.50", or "0".
 */
export function parseBalanceInput(text: string): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = parseFloat(match[0]);
  return isNaN(num) ? null : num;
}

/**
 * Sends the balance confirmation buttons for an account before committing.
 */
async function sendBalanceConfirmation(
  replyTarget: string,
  stateId: string,
  pendingData: Record<string, unknown>
): Promise<void> {
  await setUserSetupStage(stateId, "awaiting_balance_confirmation", pendingData);

  const name = (pendingData.name as string) || "Account";
  const balance = Number(pendingData.balance) || 0;
  const balanceFormatted = formatCurrency(balance);

  const buttons = [
    { id: "balance_correct", title: "Correct" },
    { id: "balance_edit", title: "Edit balance" },
  ];

  await sendWhatsAppButtons(
    replyTarget,
    `Add *${name}* with starting balance ${balanceFormatted}?`,
    buttons
  );
}

/**
 * Handles account setup onboarding, "add account", and interactive "set primary account" flows.
 */
export async function handleOnboardingFlow(
  text: string,
  buttonId: string | null,
  state: UserState,
  accounts: AccountSummary[],
  replyTarget: string
): Promise<{ handled: boolean; replyText?: string }> {
  const clean = text.trim();
  const lower = clean.toLowerCase();
  const stage = state.setup_stage;
  const pending = (state.pending_transaction || {}) as Record<string, any>;

  // ── 1. "set primary account" Command Trigger ──────────────────────────────
  const isPrimaryCmd =
    lower === "set primary" ||
    lower === "change primary account" ||
    lower === "set primary account" ||
    lower === "primary account";

  if (isPrimaryCmd && !stage) {
    if (accounts.length <= 1) {
      const name = accounts[0]?.name || "Primary";
      return {
        handled: true,
        replyText: `You only have one account (*${name}*) — nothing to change.`,
      };
    }

    await setUserSetupStage(state.id, "awaiting_primary_selection", {
      account_ids: accounts.map((a) => a.id),
      account_names: accounts.map((a) => a.name),
    });

    if (accounts.length <= 3) {
      const buttons = accounts.map((acc) => ({
        id: `primary_${acc.id}`,
        title: acc.name.slice(0, 20),
      }));
      await sendWhatsAppButtons(
        replyTarget,
        "⭐ *Which account should be your primary account?*",
        buttons
      );
      return { handled: true };
    }

    const listRows = accounts.map((acc) => ({
      id: `primary_${acc.id}`,
      title: acc.name.slice(0, 24),
      description: `Current balance: ₹${acc.balance.toLocaleString("en-IN")}`,
    }));

    await sendWhatsAppList(
      replyTarget,
      "⭐ *Which account should be your primary account?*",
      "Choose account",
      listRows
    );
    return { handled: true };
  }

  // ── 2. Handle Primary Account Selection ────────────────────────────────────
  if (stage === "awaiting_primary_selection") {
    let selectedAccount: AccountSummary | undefined;

    if (buttonId && buttonId.startsWith("primary_")) {
      const accountId = buttonId.replace(/^primary_/, "");
      selectedAccount = accounts.find((a) => a.id === accountId);
    }

    if (!selectedAccount) {
      const targetLower = clean.toLowerCase();
      selectedAccount = accounts.find(
        (a) => a.name.toLowerCase() === targetLower || a.name.toLowerCase().includes(targetLower)
      );

      const num = parseInt(clean, 10);
      if (!selectedAccount && !isNaN(num) && num >= 1 && num <= accounts.length) {
        selectedAccount = accounts[num - 1];
      }
    }

    if (!selectedAccount) {
      return {
        handled: true,
        replyText: "Please tap one of the account options above to set your primary account.",
      };
    }

    await setPrimaryAccount(selectedAccount.id);
    await setUserSetupStage(state.id, null, null);

    return {
      handled: true,
      replyText: `✅ Primary account set to *${selectedAccount.name}*`,
    };
  }

  // ── 3. Manual "add account" trigger ────────────────────────────────────────
  if (lower === "add account" && !stage) {
    await setUserSetupStage(state.id, "add_account_name", {});
    return {
      handled: true,
      replyText: "What's the name of the new account? (e.g. Savings, HDFC, Cash)",
    };
  }

  // ── 4. Handle "add account" name collection ────────────────────────────────
  if (stage === "add_account_name") {
    if (!clean) {
      return {
        handled: true,
        replyText: "Please provide a valid account name (e.g. HDFC, Cash, ICICI):",
      };
    }
    const newName = clean.replace(/,/g, "").trim();
    await setUserSetupStage(state.id, "add_account_balance", {
      type: "account_setup",
      name: newName,
      is_onboarding: false,
    });
    return {
      handled: true,
      replyText: `Got it: *${newName}*.\nWhat's the starting balance for this account? (e.g. 5000 or 0)`,
    };
  }

  // ── 5. Handle "add account" balance collection ➔ ask for confirmation ──────
  if (stage === "add_account_balance") {
    const balance = parseBalanceInput(clean);
    if (balance === null) {
      return {
        handled: true,
        replyText: "Please enter a valid numeric starting balance (e.g. 5000 or 0):",
      };
    }

    const accountName = pending.name || "New Account";
    await sendBalanceConfirmation(replyTarget, state.id, {
      type: "account_setup",
      name: accountName,
      balance,
      is_onboarding: false,
    });
    return { handled: true };
  }

  // ── 6. Trigger Initial Onboarding if accounts table is empty ───────────────
  if (accounts.length === 0 && !stage) {
    await setUserSetupStage(state.id, "awaiting_accounts", {});
    return {
      handled: true,
      replyText:
        "👋 Welcome! Let's set up your accounts.\nReply with your account names separated by commas, e.g.:\n\n*Bank Balance, Cash*",
    };
  }

  // ── 7. Handle Initial Onboarding: Account Names Collection ────────────────
  if (stage === "awaiting_accounts") {
    const names = clean
      .split(/[,;\n]+/)
      .map((n) => n.trim())
      .filter((n) => n.length > 0);

    if (names.length === 0) {
      return {
        handled: true,
        replyText:
          "Please list at least one account name separated by commas, e.g.:\n*Bank Balance, Cash*",
      };
    }

    await setUserSetupStage(state.id, "awaiting_balances", {
      type: "account_setup",
      account_names: names,
      current_index: 0,
      is_onboarding: true,
    });

    return {
      handled: true,
      replyText: `Got it: *${names.join(", ")}*.\nWhat's the starting balance for *${names[0]}*? (e.g. 10000 or 0)`,
    };
  }

  // ── 8. Handle Onboarding: Balance Collection ➔ ask for confirmation ───────
  if (stage === "awaiting_balances") {
    const balance = parseBalanceInput(clean);
    const names: string[] = pending.account_names || [];
    const currentIndex = Number(pending.current_index) || 0;
    const currentName = names[currentIndex] || "Primary";

    if (balance === null) {
      return {
        handled: true,
        replyText: `Please enter a valid numeric starting balance for *${currentName}* (e.g. 5000 or 0):`,
      };
    }

    await sendBalanceConfirmation(replyTarget, state.id, {
      type: "account_setup",
      name: currentName,
      balance,
      account_names: names,
      current_index: currentIndex,
      is_onboarding: true,
    });
    return { handled: true };
  }

  // ── 9. Handle Balance Confirmation (Buttons: "Correct" | "Edit balance") ───
  if (stage === "awaiting_balance_confirmation") {
    const name = pending.name || "Account";
    const balance = Number(pending.balance) || 0;
    const isOnboarding = Boolean(pending.is_onboarding);
    const names: string[] = pending.account_names || [];
    const currentIndex = Number(pending.current_index) || 0;

    // 9a. "Correct" tapped
    if (buttonId === "balance_correct" || lower === "correct" || lower === "yes" || lower === "1") {
      const isPrimary = isOnboarding ? currentIndex === 0 : accounts.length === 0;
      await insertAccountSafely(name, balance, isPrimary);

      const formattedBal = formatCurrency(balance);

      if (isOnboarding) {
        const nextIndex = currentIndex + 1;
        if (nextIndex < names.length) {
          await setUserSetupStage(state.id, "awaiting_balances", {
            type: "account_setup",
            account_names: names,
            current_index: nextIndex,
            is_onboarding: true,
          });

          const nextName = names[nextIndex];
          return {
            handled: true,
            replyText: `Saved *${name}* (${formattedBal}).\n\nWhat's the starting balance for *${nextName}*?`,
          };
        }

        // Onboarding complete!
        await setUserSetupStage(state.id, null, null);
        return {
          handled: true,
          replyText:
            "✅ *Accounts set up!*\nYou can now log transactions, e.g.:\n• `rs 247 debit food`\n• `500 debit coffee cash`",
        };
      }

      // Standalone "add account" complete!
      await setUserSetupStage(state.id, null, null);
      return {
        handled: true,
        replyText: `✅ Added *${name}*: ${formattedBal}`,
      };
    }

    // 9b. "Edit balance" tapped
    if (buttonId === "balance_edit" || lower === "edit balance" || lower === "edit" || lower === "2") {
      await setUserSetupStage(state.id, "awaiting_balance_reentry", {
        ...pending,
        balance: null,
      });

      return {
        handled: true,
        replyText: `What's the correct starting balance for *${name}*?`,
      };
    }

    // Re-send buttons if unrecognized response
    await sendBalanceConfirmation(replyTarget, state.id, pending);
    return { handled: true };
  }

  // ── 10. Handle Balance Re-entry ➔ re-prompt confirmation ───────────────────
  if (stage === "awaiting_balance_reentry") {
    const balance = parseBalanceInput(clean);
    const name = pending.name || "Account";

    if (balance === null) {
      return {
        handled: true,
        replyText: `Please enter a valid numeric starting balance for *${name}* (e.g. 5000 or 0):`,
      };
    }

    await sendBalanceConfirmation(replyTarget, state.id, {
      ...pending,
      balance,
    });
    return { handled: true };
  }

  return { handled: false };
}
