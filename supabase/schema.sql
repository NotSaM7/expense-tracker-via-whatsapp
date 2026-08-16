-- ─── WhatsApp Expense Tracker — Supabase Schema ──────────────────────────────
-- Run this in your Supabase project's SQL editor (Database → SQL editor → New query)

-- Enable pgcrypto if not already enabled (needed for gen_random_uuid on older PG versions)
create extension if not exists "pgcrypto";

-- ─── accounts ────────────────────────────────────────────────────────────────
create table if not exists accounts (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null unique,
  balance     numeric     not null default 0,
  is_primary  boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- ─── transactions ─────────────────────────────────────────────────────────────
create table if not exists transactions (
  id          uuid        primary key default gen_random_uuid(),
  account_id  uuid        not null references accounts(id) on delete cascade,
  amount      numeric     not null,
  type        text        not null check (type in ('debit', 'credit')),
  category    text,
  message_raw text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists transactions_account_id_idx on transactions(account_id);
create index if not exists transactions_created_at_idx on transactions(created_at desc);

-- ─── budget ──────────────────────────────────────────────────────────────────
create table if not exists budget (
  id             uuid        primary key default gen_random_uuid(),
  monthly_limit  numeric     not null,
  spent          numeric     not null default 0,
  reset_day      int         not null default 1,
  current_month  text        not null,  -- format: 'YYYY-MM'
  updated_at     timestamptz not null default now()
);

-- ─── budget_history ──────────────────────────────────────────────────────────
create table if not exists budget_history (
  id            uuid        primary key default gen_random_uuid(),
  month         text        not null,
  spent         numeric     not null default 0,
  monthly_limit numeric     not null default 15000,
  summary_data  jsonb       null,
  created_at    timestamptz not null default now()
);

-- ─── user_state ───────────────────────────────────────────────────────────────
create table if not exists user_state (
  id                      uuid        primary key default gen_random_uuid(),
  setup_stage             text,                    -- e.g. 'awaiting_accounts' | 'awaiting_balances' | 'add_account_name' | 'add_account_balance'
  salary_confirmed_month  text,                    -- format: 'YYYY-MM'
  pending_transaction     jsonb,                   -- stores partial transaction or onboarding state
  usual_salary_amount     numeric,
  updated_at              timestamptz not null default now()
);

-- ─── inbound_messages ─────────────────────────────────────────────────────────
-- Raw log of every verified incoming WhatsApp message, before parsing/business logic.
create table if not exists inbound_messages (
  id                   uuid        primary key default gen_random_uuid(),
  from_number          text        not null,
  message_text         text        not null,
  whatsapp_message_id  text        not null unique,   -- dedup: Meta may deliver duplicates
  created_at           timestamptz not null default now()
);

create index if not exists inbound_messages_created_at_idx on inbound_messages(created_at desc);
