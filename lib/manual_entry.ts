import { sendWhatsAppButtons, sendWhatsAppList, sendWhatsAppMessage } from "./whatsapp.js";
import { setUserSetupStage } from "./state.js";
import { applyTransaction } from "./ledger.js";
import { getAllAccountsWithTotal, type AccountSummary } from "./accounts.js";
import { formatConfirmationReply, formatCurrency } from "./format.js";
import { parseBalanceInput } from "./onboarding.js";
import type { UserState } from "./types.js";

/**
 * Initiates the guided manual entry flow.
 */
export async function startManualEntryFlow(
  to: string,
  stateId: string
): Promise<void> {
  await setUserSetupStage(stateId, "manual_entry_amount", {
    type: "manual_entry",
  });

  await sendWhatsAppMessage(
    to,
    "📝 *Manual Entry*\nWhat's the amount? (e.g. 247 or 1500)"
  );
}

/**
 * Handles the guided manual entry sequential state machine.
 */
export async function handleManualEntryFlow(
  messageText: string,
  buttonId: string | null,
  state: UserState,
  accounts: AccountSummary[],
  replyTarget: string
): Promise<{ handled: boolean }> {
  const clean = messageText.trim();
  const lower = clean.toLowerCase();
  const stage = state.setup_stage;
  const pending = (state.pending_transaction || {}) as Record<string, any>;

  // ── Step 1: Collect Amount ────────────────────────────────────────────────
  if (stage === "manual_entry_amount") {
    const amount = parseBalanceInput(clean);
    if (amount === null || amount <= 0) {
      await sendWhatsAppMessage(
        replyTarget,
        "Please enter a valid numeric amount (e.g. 247 or 1500):"
      );
      return { handled: true };
    }

    await setUserSetupStage(state.id, "manual_entry_type", {
      ...pending,
      amount,
    });

    const buttons = [
      { id: "manual_type_debit", title: "Debit (Expense)" },
      { id: "manual_type_credit", title: "Credit (Income)" },
    ];

    await sendWhatsAppButtons(
      replyTarget,
      `Amount: *${formatCurrency(amount)}*\nIs this a *Debit* (expense) or *Credit* (income)?`,
      buttons
    );
    return { handled: true };
  }

  // ── Step 2: Collect Type (Debit / Credit) ──────────────────────────────────
  if (stage === "manual_entry_type") {
    let txType: "debit" | "credit" | null = null;

    if (buttonId === "manual_type_debit" || lower.includes("debit") || lower.includes("exp")) {
      txType = "debit";
    } else if (buttonId === "manual_type_credit" || lower.includes("credit") || lower.includes("inc")) {
      txType = "credit";
    }

    if (!txType) {
      const buttons = [
        { id: "manual_type_debit", title: "Debit (Expense)" },
        { id: "manual_type_credit", title: "Credit (Income)" },
      ];
      await sendWhatsAppButtons(
        replyTarget,
        "Please select whether this is a Debit or Credit:",
        buttons
      );
      return { handled: true };
    }

    await setUserSetupStage(state.id, "manual_entry_category", {
      ...pending,
      tx_type: txType,
    });

    await sendWhatsAppMessage(
      replyTarget,
      "What's the category? (e.g. Food, Salary, Cab, or reply *skip*)"
    );
    return { handled: true };
  }

  // ── Step 3: Collect Category ──────────────────────────────────────────────
  if (stage === "manual_entry_category") {
    const isSkipped = lower === "skip" || lower === "none" || lower === "no";
    const category = isSkipped ? null : clean;

    const amount = Number(pending.amount) || 0;
    const txType = (pending.tx_type as "debit" | "credit") || "debit";

    // If multiple accounts exist, ask which account to apply to
    if (accounts.length > 1) {
      await setUserSetupStage(state.id, "manual_entry_account", {
        ...pending,
        category,
      });

      if (accounts.length <= 3) {
        const buttons = accounts.map((acc) => ({
          id: `manual_acc_${acc.id}`,
          title: acc.name.slice(0, 20),
        }));
        await sendWhatsAppButtons(
          replyTarget,
          "Which account should this transaction be applied to?",
          buttons
        );
        return { handled: true };
      }

      const listRows = accounts.map((acc) => ({
        id: `manual_acc_${acc.id}`,
        title: acc.name.slice(0, 24),
        description: `Current balance: ₹${acc.balance.toLocaleString("en-IN")}`,
      }));

      await sendWhatsAppList(
        replyTarget,
        "Which account should this transaction be applied to?",
        "Choose account",
        listRows
      );
      return { handled: true };
    }

    // Single account available -> finalize immediately
    const targetAccount = accounts[0] || { id: "primary", name: "Primary", balance: 0, is_primary: true };
    await completeManualTransaction(
      replyTarget,
      state.id,
      targetAccount,
      amount,
      txType,
      category
    );
    return { handled: true };
  }

  // ── Step 4: Collect Target Account & Finalize ──────────────────────────────
  if (stage === "manual_entry_account") {
    let targetAccount: AccountSummary | undefined;

    if (buttonId && buttonId.startsWith("manual_acc_")) {
      const accountId = buttonId.replace(/^manual_acc_/, "");
      targetAccount = accounts.find((a) => a.id === accountId);
    }

    if (!targetAccount) {
      targetAccount = accounts.find(
        (a) => a.name.toLowerCase() === lower || a.name.toLowerCase().includes(lower)
      );
    }

    if (!targetAccount) {
      targetAccount = accounts.find((a) => a.is_primary) || accounts[0];
    }

    const amount = Number(pending.amount) || 0;
    const txType = (pending.tx_type as "debit" | "credit") || "debit";
    const category = pending.category ?? null;

    await completeManualTransaction(
      replyTarget,
      state.id,
      targetAccount,
      amount,
      txType,
      category
    );
    return { handled: true };
  }

  return { handled: false };
}

/**
 * Commits the manual transaction to the ledger, sends confirmation, and triggers budget warnings.
 */
async function completeManualTransaction(
  replyTarget: string,
  stateId: string,
  targetAccount: AccountSummary,
  amount: number,
  type: "debit" | "credit",
  category: string | null
): Promise<void> {
  const { transaction, updatedBudget } = await applyTransaction(
    targetAccount.id,
    amount,
    type,
    category,
    `Manual entry (${type} ${formatCurrency(amount)})`
  );

  await setUserSetupStage(stateId, null, null);

  const updatedAccountsData = await getAllAccountsWithTotal();

  const replyText = formatConfirmationReply(
    transaction,
    updatedAccountsData.total,
    updatedAccountsData.accounts,
    updatedBudget,
    targetAccount.name
  );

  await sendWhatsAppMessage(replyTarget, replyText);

  // Budget warning buttons if threshold reached
  if (updatedBudget.limit > 0) {
    const budgetButtons = [
      { id: "action_view_budget", title: "View budget" },
      { id: "action_increase_limit", title: "Increase limit" },
    ];

    if (updatedBudget.spent >= updatedBudget.limit) {
      await sendWhatsAppButtons(
        replyTarget,
        "⚠️ *You've exceeded your monthly budget!*",
        budgetButtons
      );
    } else if (updatedBudget.spent >= 0.8 * updatedBudget.limit) {
      await sendWhatsAppButtons(
        replyTarget,
        "⚠️ *You've used 80%+ of your monthly budget.*",
        budgetButtons
      );
    }
  }
}
