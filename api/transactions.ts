import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase.js";
import { reverseTransaction } from "../lib/ledger.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // ── GET: Fetch transactions with optional filters & pagination ────────────
  if (req.method === "GET") {
    try {
      const accountId = req.query.account_id as string | undefined;
      const category = req.query.category as string | undefined;
      const type = req.query.type as string | undefined;
      const limit = parseInt((req.query.limit as string) || "100", 10);
      const offset = parseInt((req.query.offset as string) || "0", 10);

      let query = supabase
        .from("transactions")
        .select(`
          id,
          account_id,
          amount,
          type,
          category,
          message_raw,
          created_at,
          accounts (
            id,
            name
          )
        `)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (accountId) {
        query = query.eq("account_id", accountId);
      }
      if (category) {
        query = query.ilike("category", `%${category}%`);
      }
      if (type && (type === "debit" || type === "credit")) {
        query = query.eq("type", type);
      }

      const { data, error, count } = await query;

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      const transactions = (data || []).map((t: any) => ({
        id: t.id,
        account_id: t.account_id,
        account_name: t.accounts?.name || "Unknown Account",
        amount: Number(t.amount),
        type: t.type,
        category: t.category,
        message_raw: t.message_raw,
        created_at: t.created_at,
      }));

      res.status(200).json({
        transactions,
        total: count ?? transactions.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Internal server error" });
    }
    return;
  }

  // ── DELETE: Revert transaction effect & delete record ──────────────────────
  if (req.method === "DELETE") {
    try {
      const id = (req.query.id as string) || (req.body?.id as string);
      if (!id) {
        res.status(400).json({ error: "Transaction ID is required" });
        return;
      }

      const result = await reverseTransaction(id);
      res.status(200).json({
        status: "ok",
        message: "Transaction reversed and deleted successfully",
        reversed: result.reversedTransaction,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete transaction" });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
