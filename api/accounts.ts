import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase.js";
import { getAllAccountsWithTotal, setPrimaryAccount } from "../lib/accounts.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // ── GET: Return all accounts with balances & primary flag ─────────────────
  if (req.method === "GET") {
    try {
      const data = await getAllAccountsWithTotal();
      res.status(200).json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch accounts" });
    }
    return;
  }

  // ── POST: Create a new account ───────────────────────────────────────────
  if (req.method === "POST") {
    try {
      const { name, balance } = req.body || {};
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Account name is required" });
        return;
      }

      const initialBalance = Number(balance) || 0;
      const cleanName = name.trim();

      const { accounts } = await getAllAccountsWithTotal();
      const shouldBePrimary = accounts.length === 0;

      const { data, error } = await (supabase.from("accounts") as any)
        .insert({
          name: cleanName,
          balance: initialBalance,
          is_primary: shouldBePrimary,
        })
        .select()
        .single();

      if (error) {
        // Fallback without is_primary if not in schema cache
        const { data: fbData, error: fbError } = await (supabase.from("accounts") as any)
          .insert({
            name: cleanName,
            balance: initialBalance,
          })
          .select()
          .single();

        if (fbError) {
          res.status(500).json({ error: fbError.message });
          return;
        }
        res.status(201).json(fbData);
        return;
      }

      res.status(201).json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create account" });
    }
    return;
  }

  // ── PATCH: Update account name or balance directly ────────────────────────
  if (req.method === "PATCH") {
    try {
      const id = (req.query.id as string) || req.body?.id;
      const { name, balance, is_primary } = req.body || {};

      if (!id) {
        res.status(400).json({ error: "Account ID is required" });
        return;
      }

      // If updating primary status
      if (is_primary === true) {
        await setPrimaryAccount(id);
        res.status(200).json({ status: "ok", message: "Account set as primary" });
        return;
      }

      const updates: Record<string, unknown> = {};
      if (name && typeof name === "string") updates.name = name.trim();
      if (balance !== undefined && !isNaN(Number(balance))) updates.balance = Number(balance);

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "No valid fields provided for update" });
        return;
      }

      const { data, error } = await (supabase.from("accounts") as any)
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.status(200).json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update account" });
    }
    return;
  }

  // ── DELETE: Delete account with strict constraint safety ──────────────────
  if (req.method === "DELETE") {
    try {
      const id = (req.query.id as string) || req.body?.id;
      if (!id) {
        res.status(400).json({ error: "Account ID is required" });
        return;
      }

      const { accounts } = await getAllAccountsWithTotal();
      const targetAccount = accounts.find((a) => a.id === id);

      if (!targetAccount) {
        res.status(404).json({ error: "Account not found" });
        return;
      }

      // 1. Check if only 1 account exists
      if (accounts.length <= 1) {
        res.status(400).json({
          error: `Cannot delete "${targetAccount.name}" because it is the only account. You must have at least one account.`,
        });
        return;
      }

      // 2. Check if it is the primary account
      if (targetAccount.is_primary) {
        res.status(400).json({
          error: `Cannot delete "${targetAccount.name}" because it is currently the primary account. Please set another account as primary first.`,
        });
        return;
      }

      // 3. Check if account has any transactions tied to it
      const { count, error: txErr } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("account_id", id);

      if (txErr) {
        res.status(500).json({ error: txErr.message });
        return;
      }

      if (count && count > 0) {
        res.status(400).json({
          error: `Cannot delete "${targetAccount.name}" because it has ${count} transaction(s) recorded. Delete those transactions first to preserve ledger integrity.`,
        });
        return;
      }

      const { error: delErr } = await supabase
        .from("accounts")
        .delete()
        .eq("id", id);

      if (delErr) {
        res.status(500).json({ error: delErr.message });
        return;
      }

      res.status(200).json({
        status: "ok",
        message: `Account "${targetAccount.name}" deleted successfully.`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete account" });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
