import { supabase } from "./supabase.js";

export interface AccountSummary {
  id: string;
  name: string;
  balance: number;
  is_primary: boolean;
}

/**
 * Fetches all accounts from Supabase and calculates the total net balance.
 */
export async function getAllAccountsWithTotal(): Promise<{
  accounts: AccountSummary[];
  total: number;
}> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, balance, is_primary")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[accounts] Error fetching accounts:", error.message);
    return { accounts: [], total: 0 };
  }

  const accounts: AccountSummary[] = (data || []).map((acc: any, index: number) => ({
    id: acc.id,
    name: acc.name || "Primary",
    balance: Number(acc.balance) || 0,
    is_primary: acc.is_primary ?? (index === 0),
  }));

  // Ensure at least one account is marked primary if accounts exist
  if (accounts.length > 0 && !accounts.some((a) => a.is_primary)) {
    accounts[0].is_primary = true;
  }

  const total = accounts.reduce((sum, acc) => sum + acc.balance, 0);

  return { accounts, total };
}

/**
 * Sets a specific account as primary and unsets all others.
 */
export async function setPrimaryAccount(accountId: string): Promise<void> {
  await (supabase.from("accounts") as any)
    .update({ is_primary: false })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  await (supabase.from("accounts") as any)
    .update({ is_primary: true })
    .eq("id", accountId);
}

/**
 * Retrieves the primary/default account or creates one if the table is empty.
 */
export async function getOrCreateDefaultAccount(): Promise<AccountSummary> {
  const { accounts } = await getAllAccountsWithTotal();

  if (accounts.length > 0) {
    return accounts.find((a) => a.is_primary) || accounts[0];
  }

  const { data: created, error: createError } = await (supabase.from("accounts") as any)
    .insert({ name: "Bank", balance: 0, is_primary: true })
    .select("id, name, balance, is_primary")
    .single();

  if (createError || !created) {
    throw new Error(`Failed to initialize default account: ${createError?.message || "Unknown error"}`);
  }

  return {
    id: (created as any).id,
    name: (created as any).name,
    balance: Number((created as any).balance) || 0,
    is_primary: true,
  };
}
