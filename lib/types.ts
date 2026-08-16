// ─── Database Row Types ───────────────────────────────────────────────────────

export interface Account {
  id: string;
  name: string;
  balance: number;
  is_primary: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  account_id: string;
  amount: number;
  type: "debit" | "credit";
  category: string | null;
  message_raw: string;
  created_at: string;
}

export interface Budget {
  id: string;
  monthly_limit: number;
  spent: number;
  reset_day: number;
  current_month: string;
  updated_at: string;
}

export interface BudgetHistory {
  id: string;
  month: string;
  spent: number;
  monthly_limit: number;
  summary_data?: {
    top_categories?: Array<{ category: string; amount: number }>;
    all_categories?: Record<string, number>;
    tx_count?: number;
  };
  created_at: string;
}

export interface UserState {
  id: string;
  setup_stage: string | null;
  salary_confirmed_month: string | null;
  pending_transaction: Record<string, unknown> | null;
  usual_salary_amount: number | null;
  updated_at: string;
}

export interface InboundMessage {
  id: string;
  from_number: string;
  message_text: string;
  whatsapp_message_id: string;
  created_at: string;
}

// ─── Database Schema (for Supabase generics) ─────────────────────────────────

export interface Database {
  public: {
    Tables: {
      accounts: {
        Row: Account;
        Insert: Omit<Account, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Account, "id">>;
      };
      transactions: {
        Row: Transaction;
        Insert: Omit<Transaction, "created_at"> & { created_at?: string };
        Update: Partial<Omit<Transaction, "id">>;
      };
      budget: {
        Row: Budget;
        Insert: Omit<Budget, "updated_at"> & { updated_at?: string };
        Update: Partial<Omit<Budget, "id">>;
      };
      user_state: {
        Row: UserState;
        Insert: Omit<UserState, "updated_at"> & { updated_at?: string };
        Update: Partial<Omit<UserState, "id">>;
      };
      inbound_messages: {
        Row: InboundMessage;
        Insert: Omit<InboundMessage, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<InboundMessage, "id">>;
      };
    };
  };
}
