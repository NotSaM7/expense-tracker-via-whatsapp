import { supabase } from "./supabase.js";
import type { Transaction } from "./types.js";

export interface UpdatedBudgetSummary {
  spent: number;
  limit: number;
}

export interface ApplyTransactionResult {
  transaction: Transaction;
  updatedBalance: number;
  updatedBudget: UpdatedBudgetSummary;
}

/**
 * Gets or initializes the single budget row for the current month.
 */
export async function getOrCreateCurrentBudget(): Promise<{
  id: string;
  spent: number;
  limit: number;
  current_month: string;
}> {
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const { data: budgetRows, error } = await supabase
    .from("budget")
    .select("id, monthly_limit, spent, current_month, reset_day")
    .limit(1);

  if (!error && budgetRows && budgetRows.length > 0) {
    const row = budgetRows[0] as any;
    // If month rolled over, reset spent for the new month
    if (row.current_month !== currentMonthStr) {
      await (supabase.from("budget") as any)
        .update({ spent: 0, current_month: currentMonthStr, updated_at: new Date().toISOString() })
        .eq("id", row.id);

      return {
        id: row.id,
        spent: 0,
        limit: Number(row.monthly_limit) || 15000,
        current_month: currentMonthStr,
      };
    }

    return {
      id: row.id,
      spent: Number(row.spent) || 0,
      limit: Number(row.monthly_limit) || 15000,
      current_month: row.current_month,
    };
  }

  // Initialize default monthly budget of ₹15,000 if table is empty
  const { data: created, error: createError } = await (supabase.from("budget") as any)
    .insert({
      monthly_limit: 15000,
      spent: 0,
      reset_day: 1,
      current_month: currentMonthStr,
    })
    .select("id, monthly_limit, spent, current_month")
    .single();

  if (createError || !created) {
    console.error("[ledger] Failed to create budget row:", createError?.message);
    return {
      id: "fallback-budget",
      spent: 0,
      limit: 15000,
      current_month: currentMonthStr,
    };
  }

  return {
    id: (created as any).id,
    spent: Number((created as any).spent) || 0,
    limit: Number((created as any).monthly_limit) || 15000,
    current_month: (created as any).current_month,
  };
}

/**
 * Public helper to fetch current budget summary for reports.
 */
export async function getCurrentBudgetSummary(): Promise<UpdatedBudgetSummary> {
  const b = await getOrCreateCurrentBudget();
  return { spent: b.spent, limit: b.limit };
}

/**
 * Updates the monthly budget limit.
 */
export async function updateMonthlyBudgetLimit(newLimit: number): Promise<void> {
  const budget = await getOrCreateCurrentBudget();
  if (budget.id && budget.id !== "fallback-budget") {
    await (supabase.from("budget") as any)
      .update({ monthly_limit: newLimit, updated_at: new Date().toISOString() })
      .eq("id", budget.id);
  } else {
    await (supabase.from("budget") as any).insert({
      monthly_limit: newLimit,
      spent: 0,
      reset_day: 1,
      current_month: budget.current_month,
    });
  }
}

/**
 * Executes the complete ledger operation for an incoming transaction:
 * 1. Inserts transaction into `transactions` table.
 * 2. Updates the account balance (+ for credit, - for debit).
 * 3. Updates the monthly budget spent amount (debits only).
 */
export async function applyTransaction(
  accountId: string,
  amount: number,
  type: "debit" | "credit",
  category: string | null,
  messageRaw: string
): Promise<ApplyTransactionResult> {
  // 1. Insert transaction record
  const { data: txData, error: txError } = await (supabase.from("transactions") as any)
    .insert({
      account_id: accountId,
      amount,
      type,
      category,
      message_raw: messageRaw,
    })
    .select()
    .single();

  if (txError || !txData) {
    throw new Error(`Failed to log transaction: ${txError?.message || "Unknown error"}`);
  }

  const transaction = txData as unknown as Transaction;

  // 2. Fetch current account balance & apply balance update
  const { data: accData } = await supabase
    .from("accounts")
    .select("balance")
    .eq("id", accountId)
    .single();

  const currentBalance = Number((accData as any)?.balance) || 0;
  const updatedBalance = type === "credit" ? currentBalance + amount : currentBalance - amount;

  await (supabase.from("accounts") as any)
    .update({ balance: updatedBalance })
    .eq("id", accountId);

  // 3. Fetch & Update Budget
  const budget = await getOrCreateCurrentBudget();
  let updatedSpent = budget.spent;

  if (type === "debit") {
    updatedSpent = budget.spent + amount;
    if (budget.id !== "fallback-budget") {
      await (supabase.from("budget") as any)
        .update({ spent: updatedSpent, updated_at: new Date().toISOString() })
        .eq("id", budget.id);
    }
  }

  return {
    transaction,
    updatedBalance,
    updatedBudget: {
      spent: updatedSpent,
      limit: budget.limit,
    },
  };
}

/**
 * Reverses a transaction and safely deletes it:
 * - If debit: increases account balance, decreases monthly budget spent (if same month)
 * - If credit: decreases account balance
 */
export async function reverseTransaction(transactionId: string): Promise<{
  success: boolean;
  reversedTransaction: Transaction;
}> {
  // 1. Fetch transaction
  const { data: txData, error: txError } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .single();

  if (txError || !txData) {
    throw new Error("Transaction not found");
  }

  const tx = txData as unknown as Transaction;

  // 2. Revert account balance
  const { data: accData } = await supabase
    .from("accounts")
    .select("balance")
    .eq("id", tx.account_id)
    .single();

  if (accData) {
    const currentBalance = Number((accData as any).balance) || 0;
    // Opposite of original operation
    const revertedBalance =
      tx.type === "debit"
        ? currentBalance + Number(tx.amount)
        : currentBalance - Number(tx.amount);

    await (supabase.from("accounts") as any)
      .update({ balance: revertedBalance })
      .eq("id", tx.account_id);
  }

  // 3. Revert budget if debit in current month
  if (tx.type === "debit") {
    const budget = await getOrCreateCurrentBudget();
    const txMonth = (tx.created_at || "").slice(0, 7);
    if (txMonth === budget.current_month && budget.id !== "fallback-budget") {
      const newSpent = Math.max(0, budget.spent - Number(tx.amount));
      await (supabase.from("budget") as any)
        .update({ spent: newSpent, updated_at: new Date().toISOString() })
        .eq("id", budget.id);
    }
  }

  // 4. Delete transaction row
  const { error: delError } = await supabase
    .from("transactions")
    .delete()
    .eq("id", transactionId);

  if (delError) {
    throw new Error(`Failed to delete transaction: ${delError.message}`);
  }

  return { success: true, reversedTransaction: tx };
}
