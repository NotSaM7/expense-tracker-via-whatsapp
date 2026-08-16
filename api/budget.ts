import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getOrCreateCurrentBudget, updateMonthlyBudgetLimit } from "../lib/ledger.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // ── GET: Return current month budget status ───────────────────────────────
  if (req.method === "GET") {
    try {
      const budget = await getOrCreateCurrentBudget();
      res.status(200).json(budget);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch budget" });
    }
    return;
  }

  // ── PATCH: Update monthly budget limit ────────────────────────────────────
  if (req.method === "PATCH") {
    try {
      const { monthly_limit } = req.body || {};
      const newLimit = Number(monthly_limit);

      if (isNaN(newLimit) || newLimit <= 0) {
        res.status(400).json({ error: "A valid positive numeric limit is required" });
        return;
      }

      await updateMonthlyBudgetLimit(newLimit);
      const updated = await getOrCreateCurrentBudget();
      res.status(200).json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update budget limit" });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
