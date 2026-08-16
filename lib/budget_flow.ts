import { sendWhatsAppButtons, sendWhatsAppMessage } from "./whatsapp.js";
import { setUserSetupStage } from "./state.js";
import { getOrCreateCurrentBudget, updateMonthlyBudgetLimit } from "./ledger.js";
import { formatCurrency } from "./format.js";
import { parseBalanceInput } from "./onboarding.js";
import type { UserState } from "./types.js";

/**
 * Sends interactive buttons prompting the user to keep or change their monthly budget.
 */
export async function sendBudgetConfirmationPrompt(
  to: string,
  stateId: string
): Promise<void> {
  const currentBudget = await getOrCreateCurrentBudget();
  const limit = currentBudget.limit || 15000;

  await setUserSetupStage(stateId, "awaiting_budget_choice", {
    current_limit: limit,
  });

  const limitDisplay =
    limit >= 1000 ? `₹${(limit / 1000).toFixed(0)}k` : `₹${limit}`;
  const keepTitle = `Keep usual (${limitDisplay})`.slice(0, 20);

  const buttons = [
    { id: "budget_keep_usual", title: keepTitle },
    { id: "budget_change_limit", title: "Change budget" },
    { id: "budget_cancel", title: "Cancel" },
  ];

  const body = `📊 *Monthly Budget Setup*\nYour current monthly limit is *${formatCurrency(limit)}*.\n\nWould you like to keep this or set a new limit?`;

  await sendWhatsAppButtons(to, body, buttons);
}

/**
 * Handles the budget interactive prompt and state machine.
 */
export async function handleBudgetFlow(
  messageText: string,
  buttonId: string | null,
  state: UserState,
  replyTarget: string
): Promise<{ handled: boolean }> {
  const clean = messageText.trim();
  const lower = clean.toLowerCase();
  const stage = state.setup_stage;
  const pending = state.pending_transaction || {};
  const currentLimit = Number(pending.current_limit) || 15000;

  // ── 1. Explicit trigger command ────────────────────────────────────────────
  if (
    !stage &&
    (lower === "budget" ||
      lower === "set budget" ||
      lower === "change budget" ||
      lower === "update budget" ||
      lower === "edit budget" ||
      lower === "my budget")
  ) {
    await sendBudgetConfirmationPrompt(replyTarget, state.id);
    return { handled: true };
  }

  // ── 2. Handle awaiting_budget_choice ──────────────────────────────────────
  if (stage === "awaiting_budget_choice") {
    // 2a. Keep Usual Budget
    if (
      buttonId === "budget_keep_usual" ||
      lower === "1" ||
      lower.includes("keep") ||
      lower.includes("usual") ||
      lower.includes("same")
    ) {
      await setUserSetupStage(state.id, null, null);
      await sendWhatsAppMessage(
        replyTarget,
        `✅ Kept your monthly budget at *${formatCurrency(currentLimit)}*.`
      );
      return { handled: true };
    }

    // 2b. Change Budget Limit
    if (
      buttonId === "budget_change_limit" ||
      lower === "2" ||
      lower.includes("change") ||
      lower.includes("new") ||
      lower.includes("edit")
    ) {
      await setUserSetupStage(state.id, "awaiting_new_budget_limit", {
        current_limit: currentLimit,
      });

      await sendWhatsAppMessage(
        replyTarget,
        "What's the new monthly budget limit? (e.g. 20000 or 25000)"
      );
      return { handled: true };
    }

    // 2c. Cancel
    if (
      buttonId === "budget_cancel" ||
      lower === "3" ||
      lower.includes("cancel") ||
      lower.includes("exit")
    ) {
      await setUserSetupStage(state.id, null, null);
      await sendWhatsAppMessage(
        replyTarget,
        `👍 Cancelled. Your budget limit remains *${formatCurrency(currentLimit)}*.`
      );
      return { handled: true };
    }

    // Re-prompt if invalid response during choice
    await sendBudgetConfirmationPrompt(replyTarget, state.id);
    return { handled: true };
  }

  // ── 3. Handle awaiting_new_budget_limit ────────────────────────────────────
  if (stage === "awaiting_new_budget_limit") {
    const newLimit = parseBalanceInput(clean);
    if (newLimit === null || newLimit <= 0) {
      await sendWhatsAppMessage(
        replyTarget,
        "Please enter a valid numeric monthly budget limit (e.g. 20000 or 25000):"
      );
      return { handled: true };
    }

    await updateMonthlyBudgetLimit(newLimit);
    await setUserSetupStage(state.id, null, null);
    await sendWhatsAppMessage(
      replyTarget,
      `✅ Monthly budget updated to *${formatCurrency(newLimit)}*!`
    );
    return { handled: true };
  }

  return { handled: false };
}
