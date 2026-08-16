import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../../lib/supabase.js";
import { sendWhatsAppButtons } from "../../lib/whatsapp.js";
import { formatCurrency } from "../../lib/format.js";

/**
 * Monthly Budget Reset Cron Endpoint.
 * Automatically runs at the 1st of every month via Vercel Cron.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // ── 1. Security Check: Protect Cron Endpoint ──────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const querySecret = req.query.secret as string | undefined;

  if (cronSecret) {
    const isAuthorized =
      authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
    if (!isAuthorized) {
      console.warn("[cron] Unauthorized reset-budget invocation attempt");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  try {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // ── 2. Fetch Current Budget Row ──────────────────────────────────────────
    const { data: budgetRows } = await supabase
      .from("budget")
      .select("*")
      .limit(1);

    const currentBudget = budgetRows?.[0] || {
      id: "default",
      spent: 0,
      monthly_limit: 15000,
      current_month: currentMonthStr,
    };

    const outgoingMonth = currentBudget.current_month || currentMonthStr;
    const spentAmount = Number(currentBudget.spent) || 0;
    const monthlyLimit = Number(currentBudget.monthly_limit) || 15000;

    // Next month string (e.g. "2026-09")
    const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const newMonthStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;

    // ── 3. Query Outgoing Month Transactions for Category Aggregation ────────
    const { data: txs } = await supabase
      .from("transactions")
      .select("amount, type, category, created_at")
      .eq("type", "debit");

    const categoryMap: Record<string, number> = {};
    let monthTxCount = 0;

    (txs || []).forEach((t: any) => {
      const txMonth = (t.created_at || "").slice(0, 7);
      if (txMonth === outgoingMonth) {
        monthTxCount++;
        const cat = t.category
          ? t.category.charAt(0).toUpperCase() + t.category.slice(1)
          : "Uncategorized";
        categoryMap[cat] = (categoryMap[cat] || 0) + Number(t.amount);
      }
    });

    // Sort categories by spend descending
    const sortedCategories = Object.entries(categoryMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    const top3 = sortedCategories.slice(0, 3);
    const topCategoriesText =
      top3.length > 0
        ? top3.map((c) => `${c.category} (${formatCurrency(c.amount)})`).join(", ")
        : "None";

    // ── 4. Record in budget_history Table ─────────────────────────────────────
    try {
      await (supabase.from("budget_history") as any).insert({
        month: outgoingMonth,
        spent: spentAmount,
        monthly_limit: monthlyLimit,
        summary_data: {
          top_categories: top3,
          all_categories: categoryMap,
          tx_count: monthTxCount,
        },
      });
    } catch (histErr) {
      console.warn("[cron] Error writing to budget_history:", histErr);
    }

    // ── 5. Reset Budget Row for New Month ─────────────────────────────────────
    if (currentBudget.id && currentBudget.id !== "default") {
      await (supabase.from("budget") as any)
        .update({
          spent: 0,
          current_month: newMonthStr,
          updated_at: new Date().toISOString(),
        })
        .eq("id", currentBudget.id);
    }

    // ── 6. Reset User State ───────────────────────────────────────────────────
    await (supabase.from("user_state") as any)
      .update({
        setup_stage: null,
        pending_transaction: null,
        updated_at: new Date().toISOString(),
      })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    // ── 7. Send Proactive WhatsApp Summary Message ────────────────────────────
    const myNumber = process.env.MY_WHATSAPP_NUMBER || "917428849276";
    const spentFormatted = formatCurrency(spentAmount);
    const limitFormatted = formatCurrency(monthlyLimit);

    const bodyText = `📅 *${outgoingMonth} Summary*\nSpent: ${spentFormatted} / ${limitFormatted}\nTop categories: ${topCategoriesText}\n\nBudget reset for *${newMonthStr}* 🎉`;

    const summaryButtons = [
      { id: "summary_view_full", title: "View summary" },
      { id: "summary_adjust_limit", title: "Adjust limit" },
    ];

    try {
      await sendWhatsAppButtons(myNumber, bodyText, summaryButtons);
      console.log(`[cron] Sent proactive monthly summary to ${myNumber}`);
    } catch (msgErr) {
      console.error("[cron] Error sending WhatsApp summary message:", msgErr);
    }

    res.status(200).json({
      status: "ok",
      reset_month: outgoingMonth,
      new_month: newMonthStr,
      spent: spentAmount,
      monthly_limit: monthlyLimit,
      top_categories: top3,
    });
  } catch (err: any) {
    console.error("[cron] Unhandled error during budget reset cron:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
}
