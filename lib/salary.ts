import { supabase } from "./supabase.js";
import { sendWhatsAppButtons, sendWhatsAppMessage } from "./whatsapp.js";
import { setUserSetupStage } from "./state.js";
import { applyTransaction, getCurrentBudgetSummary } from "./ledger.js";
import { getAllAccountsWithTotal, type AccountSummary } from "./accounts.js";
import { formatConfirmationReply, formatCurrency } from "./format.js";
import { parseBalanceInput } from "./onboarding.js";
import type { UserState } from "./types.js";

const DEFAULT_USUAL_SALARY = 50000;

/**
 * Generates and sends the monthly summary report with interactive buttons.
 */
export async function sendMonthlySummaryMessage(
  replyTarget: string,
  targetMonthStr?: string
): Promise<void> {
  const now = new Date();
  const currentMonth =
    targetMonthStr ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const budgetSummary = await getCurrentBudgetSummary();

  // Query this month's debit transactions for category aggregation
  const { data: txs } = await supabase
    .from("transactions")
    .select("amount, type, category, created_at")
    .eq("type", "debit");

  const categoryMap: Record<string, number> = {};

  (txs || []).forEach((t: any) => {
    const txMonth = (t.created_at || "").slice(0, 7);
    if (txMonth === currentMonth) {
      const cat = t.category
        ? t.category.charAt(0).toUpperCase() + t.category.slice(1)
        : "Uncategorized";
      categoryMap[cat] = (categoryMap[cat] || 0) + Number(t.amount);
    }
  });

  const sortedCategories = Object.entries(categoryMap)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const top3 = sortedCategories.slice(0, 3);
  const topCategoriesText =
    top3.length > 0
      ? top3.map((c) => `${c.category} (${formatCurrency(c.amount)})`).join(", ")
      : "No expenses yet";

  const spentFormatted = formatCurrency(budgetSummary.spent);
  const limitFormatted = formatCurrency(budgetSummary.limit);

  const bodyText = `📅 *${currentMonth} Spending Summary*\nSpent: ${spentFormatted} / ${limitFormatted}\nTop categories: ${topCategoriesText}\n\n🎉 Salary credited & logged!`;

  const summaryButtons = [
    { id: "summary_view_full", title: "View summary" },
    { id: "summary_adjust_limit", title: "Adjust limit" },
  ];

  try {
    await sendWhatsAppButtons(replyTarget, bodyText, summaryButtons);
    console.log(`[salary] Sent automatic monthly summary after salary credit to ${replyTarget}`);
  } catch (err) {
    console.error("[salary] Error sending monthly summary buttons:", err);
  }
}

/**
 * Sends the interactive WhatsApp salary confirmation buttons.
 */
export async function sendSalaryConfirmationPrompt(
  to: string,
  stateId: string,
  usualAmount: number = DEFAULT_USUAL_SALARY
): Promise<void> {
  await setUserSetupStage(stateId, "awaiting_salary_confirmation", {
    usual_salary: usualAmount,
  });

  const salaryDisplay =
    usualAmount >= 1000 ? `₹${(usualAmount / 1000).toFixed(0)}k` : `₹${usualAmount}`;
  const title1 = `Yes, usual (${salaryDisplay})`.slice(0, 20);

  const buttons = [
    { id: "salary_usual", title: title1 },
    { id: "salary_different", title: "Different amount" },
    { id: "salary_not_yet", title: "Not yet" },
  ];

  await sendWhatsAppButtons(
    to,
    "💰 *Has your salary been credited this month?*",
    buttons
  );
}

/**
 * Handles the interactive salary confirmation and salary amount collection state machine.
 */
export async function handleSalaryFlow(
  messageText: string,
  buttonId: string | null,
  state: UserState,
  accounts: AccountSummary[],
  replyTarget: string
): Promise<{ handled: boolean }> {
  const clean = messageText.trim();
  const lower = clean.toLowerCase();
  const stage = state.setup_stage;
  const pending = state.pending_transaction || {};
  const usualSalary = Number(pending.usual_salary) || DEFAULT_USUAL_SALARY;

  // ── 1. Explicit trigger command ────────────────────────────────────────────
  if (
    !stage &&
    (lower === "salary" ||
      lower === "confirm salary" ||
      lower === "salary prompt" ||
      lower === "check salary")
  ) {
    await sendSalaryConfirmationPrompt(replyTarget, state.id, usualSalary);
    return { handled: true };
  }

  // ── 2. Handle awaiting_salary_confirmation ────────────────────────────────
  if (stage === "awaiting_salary_confirmation") {
    // 2a. Usual Salary
    if (
      buttonId === "salary_usual" ||
      lower === "1" ||
      lower.includes("usual") ||
      lower.includes("yes")
    ) {
      const primary = accounts.find((a) => a.is_primary) || accounts[0];
      const { transaction, updatedBudget } = await applyTransaction(
        primary.id,
        usualSalary,
        "credit",
        "salary",
        `Salary credit (${formatCurrency(usualSalary)})`
      );

      await setUserSetupStage(state.id, null, null);

      const accountsData = await getAllAccountsWithTotal();
      const reply = formatConfirmationReply(
        transaction,
        accountsData.total,
        accountsData.accounts,
        updatedBudget,
        primary.name
      );

      await sendWhatsAppMessage(replyTarget, reply);

      // Automatically send month summary follow-up
      await sendMonthlySummaryMessage(replyTarget);

      return { handled: true };
    }

    // 2b. Different Amount
    if (
      buttonId === "salary_different" ||
      lower === "2" ||
      lower.includes("different") ||
      lower.includes("diff")
    ) {
      await setUserSetupStage(state.id, "awaiting_salary_amount", {
        usual_salary: usualSalary,
      });

      await sendWhatsAppMessage(
        replyTarget,
        "What amount? (e.g. 45000 or 55000)"
      );
      return { handled: true };
    }

    // 2c. Not Yet
    if (
      buttonId === "salary_not_yet" ||
      lower === "3" ||
      lower.includes("not yet") ||
      lower.includes("no")
    ) {
      await setUserSetupStage(state.id, null, null);
      await sendWhatsAppMessage(
        replyTarget,
        "👍 Got it! You can log it anytime by replying e.g. `50000 credit salary`."
      );
      return { handled: true };
    }

    // Unrecognized selection during button prompt — re-prompt
    await sendSalaryConfirmationPrompt(replyTarget, state.id, usualSalary);
    return { handled: true };
  }

  // ── 3. Handle awaiting_salary_amount ──────────────────────────────────────
  if (stage === "awaiting_salary_amount") {
    const amount = parseBalanceInput(clean);
    if (amount === null || amount <= 0) {
      await sendWhatsAppMessage(
        replyTarget,
        "Please enter a valid numeric salary amount (e.g. 45000):"
      );
      return { handled: true };
    }

    const primary = accounts.find((a) => a.is_primary) || accounts[0];
    const { transaction, updatedBudget } = await applyTransaction(
      primary.id,
      amount,
      "credit",
      "salary",
      `Salary credit (${formatCurrency(amount)})`
    );

    await setUserSetupStage(state.id, null, null);

    const accountsData = await getAllAccountsWithTotal();
    const reply = formatConfirmationReply(
      transaction,
      accountsData.total,
      accountsData.accounts,
      updatedBudget,
      primary.name
    );

    await sendWhatsAppMessage(replyTarget, reply);

    // Automatically send month summary follow-up
    await sendMonthlySummaryMessage(replyTarget);

    return { handled: true };
  }

  return { handled: false };
}
