import type { Transaction } from "./types.js";
import type { AccountSummary } from "./accounts.js";
import type { UpdatedBudgetSummary } from "./ledger.js";

const inrFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/**
 * Formats a currency number with Indian numbering (e.g., ₹12,340 or ₹1,50,000).
 */
export function formatCurrency(amount: number): string {
  const formatted = inrFormatter.format(Math.abs(amount));
  return amount < 0 ? `-₹${formatted}` : `₹${formatted}`;
}

/**
 * Formats the comprehensive Balance & Budget check report.
 */
export function formatBalanceReport(
  accounts: AccountSummary[],
  totalBalance: number,
  budget: UpdatedBudgetSummary
): string {
  const lines: string[] = [];

  if (accounts.length > 0) {
    accounts.forEach((acc, i) => {
      const emoji = i === 0 ? "💰" : "💵";
      const primaryBadge = acc.is_primary ? " ⭐" : "";
      lines.push(`${emoji} *${acc.name}*${primaryBadge}: ${formatCurrency(acc.balance)}`);
    });
    lines.push("─────────");
    lines.push(`*Total*: ${formatCurrency(totalBalance)}`);
  } else {
    lines.push(`💰 *Total Balance*: ${formatCurrency(totalBalance)}`);
  }

  // Monthly budget
  lines.push(`📊 Budget: ${formatCurrency(budget.spent)} / ${formatCurrency(budget.limit)} spent this month`);

  // Budget warnings
  if (budget.limit > 0) {
    if (budget.spent >= budget.limit) {
      lines.push("⚠️ *Budget limit exceeded!*");
    } else if (budget.spent >= 0.8 * budget.limit) {
      lines.push("⚠️ *80%+ of budget used*");
    }
  }

  return lines.join("\n");
}

/**
 * Formats the rich WhatsApp confirmation message after a transaction is recorded.
 */
export function formatConfirmationReply(
  transaction: Transaction,
  totalBalance: number,
  accountBreakdown: AccountSummary[],
  budget: UpdatedBudgetSummary,
  targetAccountName?: string | null
): string {
  const amountStr = formatCurrency(transaction.amount);
  const typeText = transaction.type === "credit" ? "credited" : "debited";
  const categoryStr = transaction.category
    ? transaction.category.charAt(0).toUpperCase() + transaction.category.slice(1)
    : "Uncategorized";

  // Account suffix: if multiple accounts exist, show which account was targeted
  const accountSuffix =
    accountBreakdown.length > 1 && targetAccountName
      ? ` (→ ${targetAccountName})`
      : "";

  const line1 = `✅ *${amountStr}* ${typeText}${accountSuffix} — ${categoryStr}`;

  let line2: string;
  if (accountBreakdown.length > 1) {
    const parts = accountBreakdown.map(
      (acc) => `${acc.name}: ${formatCurrency(acc.balance)}`
    );
    line2 = `💰 ${parts.join(" | ")} | *Total: ${formatCurrency(totalBalance)}*`;
  } else if (accountBreakdown.length === 1) {
    line2 = `💰 ${accountBreakdown[0].name} Balance: *${formatCurrency(accountBreakdown[0].balance)}*`;
  } else {
    line2 = `💰 Total Balance: *${formatCurrency(totalBalance)}*`;
  }

  const line3 = `📊 Budget: ${formatCurrency(budget.spent)} / ${formatCurrency(budget.limit)} spent this month`;
  const lines = [line1, line2, line3];

  if (budget.limit > 0) {
    if (budget.spent >= budget.limit) {
      lines.push("⚠️ *Budget limit exceeded!*");
    } else if (budget.spent >= 0.8 * budget.limit) {
      lines.push("⚠️ *80%+ of budget used*");
    }
  }

  return lines.join("\n");
}
