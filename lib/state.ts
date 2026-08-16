import { supabase } from "./supabase.js";
import type { UserState } from "./types.js";

export interface PendingOnboardingData {
  account_names?: string[];
  current_index?: number;
  new_account_name?: string;
  _setup_stage?: string | null;
  [key: string]: unknown;
}

/**
 * Retrieves the single user_state row or initializes it if not present.
 */
export async function getUserState(): Promise<UserState> {
  const { data: rows, error } = await supabase
    .from("user_state")
    .select("*")
    .limit(1);

  if (!error && rows && rows.length > 0) {
    const row = rows[0] as any;
    const pending = (row.pending_transaction || {}) as PendingOnboardingData;
    return {
      id: row.id,
      setup_stage: row.setup_stage || pending._setup_stage || null,
      salary_confirmed_month: row.salary_confirmed_month || null,
      pending_transaction: row.pending_transaction || null,
      usual_salary_amount: row.usual_salary_amount ? Number(row.usual_salary_amount) : null,
      updated_at: row.updated_at,
    };
  }

  // Initialize row
  const { data: created, error: createError } = await (supabase.from("user_state") as any)
    .insert({
      salary_confirmed_month: null,
      pending_transaction: null,
    })
    .select("*")
    .single();

  if (createError || !created) {
    console.error("[state] Failed to create initial user_state row:", createError?.message);
    return {
      id: "fallback-state",
      setup_stage: null,
      salary_confirmed_month: null,
      pending_transaction: null,
      usual_salary_amount: null,
      updated_at: new Date().toISOString(),
    };
  }

  return created as unknown as UserState;
}

/**
 * Updates the user's setup_stage and pending onboarding data.
 */
export async function setUserSetupStage(
  stateId: string,
  stage: string | null,
  pendingData: PendingOnboardingData | null = null
): Promise<void> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  const mergedPending = pendingData
    ? { ...pendingData, _setup_stage: stage }
    : stage
    ? { _setup_stage: stage }
    : null;

  payload.pending_transaction = mergedPending;

  // Try updating with setup_stage column first
  const { error } = await (supabase.from("user_state") as any)
    .update({ ...payload, setup_stage: stage })
    .eq("id", stateId);

  // If column doesn't exist, update pending_transaction directly
  if (error) {
    await (supabase.from("user_state") as any)
      .update(payload)
      .eq("id", stateId);
  }
}
