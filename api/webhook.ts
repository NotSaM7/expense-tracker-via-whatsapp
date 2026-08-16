import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { supabase } from "../lib/supabase.js";
import { sendWhatsAppMessage, sendWhatsAppButtons } from "../lib/whatsapp.js";
import { parseMessage } from "../lib/parser.js";
import { parseMessageWithGemini } from "../lib/gemini.js";
import { getAllAccountsWithTotal, getOrCreateDefaultAccount, type AccountSummary } from "../lib/accounts.js";
import { applyTransaction, getCurrentBudgetSummary } from "../lib/ledger.js";
import { formatConfirmationReply, formatBalanceReport, formatCurrency } from "../lib/format.js";
import { getUserState, setUserSetupStage } from "../lib/state.js";
import { handleOnboardingFlow } from "../lib/onboarding.js";
import { handleSalaryFlow } from "../lib/salary.js";
import { handleManualEntryFlow, startManualEntryFlow } from "../lib/manual_entry.js";
import { handleBudgetFlow } from "../lib/budget_flow.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WhatsAppIncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "interactive" | string;
  text?: { body: string };
  interactive?: {
    type: "button_reply" | "list_reply" | string;
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
}

interface WebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        messages?: WhatsAppIncomingMessage[];
        statuses?: unknown[];
      };
      field: string;
    }>;
  }>;
}

// ─── Help / Commands Text ─────────────────────────────────────────────────────

function getAllCommandsHelpText(): string {
  return `📋 *All Available Commands:*

💰 *Finance & Reports*
• \`check balance\` (or \`balance\`) — View all account balances & monthly budget
• \`set budget\` — Keep usual or change your monthly limit
• \`salary\` — Confirm or record your monthly salary credit

⚙️ *Account Management*
• \`set primary\` — Change your default primary account
• \`add account\` — Add a new account (e.g. HDFC, Cash, Savings)
• \`add manually\` — Guided step-by-step transaction wizard

💸 *Quick Transaction Formats*
• \`rs 247 debit food\`
• \`500 debit coffee cash\`
• \`50000 credit salary\`
• \`₹1200 debit dinner idfc\`
• \`rs.99 debit netflix\``;
}

// ─── Signature verification ───────────────────────────────────────────────────

function verifySignature(req: VercelRequest): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const signature = req.headers["x-hub-signature-256"] as string | undefined;

  if (!appSecret) {
    console.warn("[webhook] WHATSAPP_APP_SECRET is not set — bypassing signature check");
    return true;
  }
  if (!signature) {
    console.warn("[webhook] No x-hub-signature-256 header received");
    return true;
  }

  try {
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const expected = "sha256=" + crypto
      .createHmac("sha256", appSecret)
      .update(rawBody, "utf8")
      .digest("hex");

    const matches = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!matches) {
      console.warn("[webhook] Signature mismatch (proceeding for testing)");
    }
    return true;
  } catch (err) {
    console.warn("[webhook] Signature verification error:", err);
    return true;
  }
}

// ─── Resolve Target Account Helper ───────────────────────────────────────────

function resolveTargetAccount(
  parsedAccountName: string | null,
  accounts: AccountSummary[]
): AccountSummary | null {
  if (accounts.length === 0) return null;

  if (parsedAccountName) {
    const targetLower = parsedAccountName.toLowerCase();
    // 1. Exact match
    const exact = accounts.find((a) => a.name.toLowerCase() === targetLower);
    if (exact) return exact;

    // 2. Partial/substring match
    const partial = accounts.find(
      (a) =>
        a.name.toLowerCase().includes(targetLower) ||
        targetLower.includes(a.name.toLowerCase())
    );
    if (partial) return partial;
  }

  // Fallback to the account marked is_primary, or the first account
  const primary = accounts.find((a) => a.is_primary);
  return primary || accounts[0];
}

// ─── Check Balance Command Matcher ───────────────────────────────────────────

function isBalanceCommand(text: string): boolean {
  const clean = text.trim().toLowerCase();
  return clean === "balance" || clean === "check balance" || clean === "my balance";
}

// ─── Help / All Commands Matcher ─────────────────────────────────────────────

function isCommandsCommand(text: string): boolean {
  const clean = text.trim().toLowerCase();
  return (
    clean === "commands" ||
    clean === "all commands" ||
    clean === "help" ||
    clean === "menu" ||
    clean === "options"
  );
}

// ─── GET — webhook verification handshake ────────────────────────────────────

function handleGet(req: VercelRequest, res: VercelResponse): void {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("[webhook] Verification handshake succeeded");
    res.status(200).send(challenge);
    return;
  }

  console.warn("[webhook] Verification failed — token mismatch or wrong mode");
  res.status(403).json({ error: "Forbidden" });
}

// ─── POST — incoming message handler ─────────────────────────────────────────

async function handlePost(req: VercelRequest, res: VercelResponse): Promise<void> {
  console.log("[webhook] Incoming POST payload:", JSON.stringify(req.body));

  verifySignature(req);

  const payload = req.body as WebhookPayload;
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  const messages = value?.messages;

  if (!messages || messages.length === 0) {
    console.log("[webhook] No user messages in payload (delivery receipt/status update)");
    res.status(200).json({ status: "ignored" });
    return;
  }

  const message = messages[0];
  let messageText = "";
  let buttonId: string | null = null;

  if (message.type === "text" && message.text?.body) {
    messageText = message.text.body;
  } else if (
    message.type === "interactive" &&
    message.interactive?.type === "button_reply" &&
    message.interactive.button_reply
  ) {
    buttonId = message.interactive.button_reply.id;
    messageText = message.interactive.button_reply.title || message.interactive.button_reply.id;
    console.log(`[webhook] Received button reply: id="${buttonId}", title="${messageText}"`);
  } else if (
    message.type === "interactive" &&
    message.interactive?.type === "list_reply" &&
    message.interactive.list_reply
  ) {
    buttonId = message.interactive.list_reply.id;
    messageText = message.interactive.list_reply.title || message.interactive.list_reply.id;
    console.log(`[webhook] Received list reply: id="${buttonId}", title="${messageText}"`);
  } else {
    console.log(`[webhook] Ignoring unsupported message type: ${message.type}`);
    res.status(200).json({ status: "ignored_unsupported_type" });
    return;
  }

  const fromNumber = message.from;
  const whatsappMessageId = message.id;

  console.log(`[webhook] Processing message: "${messageText}" (buttonId: ${buttonId}) from ${fromNumber} (ID: ${whatsappMessageId})`);

  // ── Sender guard ───────────────────────────────────────────────────────────
  const myNumber = process.env.MY_WHATSAPP_NUMBER || "917428849276";
  const isTestSender = fromNumber === "16315551181" || fromNumber.includes("5551181");
  const isOwner = fromNumber === myNumber || fromNumber.replace(/\D/g, "") === myNumber.replace(/\D/g, "");

  if (!isOwner && !isTestSender) {
    console.warn(`[webhook] Sender ${fromNumber} does not match MY_WHATSAPP_NUMBER (${myNumber}). Ignoring.`);
    res.status(200).json({ status: "ignored_unauthorized_sender" });
    return;
  }

  // If it's a test trigger from Meta Developer Console, route reply to the user's real phone
  const replyTarget = isTestSender ? myNumber : fromNumber;

  // ── Always log raw message to inbound_messages ─────────────────────────────
  try {
    await supabase
      .from("inbound_messages")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        from_number: fromNumber,
        message_text: messageText,
        whatsapp_message_id: whatsappMessageId,
      } as any);
  } catch (err) {
    console.error("[webhook] Error logging to inbound_messages:", err);
  }

  const userState = await getUserState();
  const accountsData = await getAllAccountsWithTotal();

  // ── SECRET ADMIN COMMAND: delete_all_records ──────────────────────────────
  if (messageText.trim().toLowerCase() === "delete_all_records") {
    console.log("[webhook] Executing secret admin command: delete_all_records");
    try {
      // 1. Delete all transactions
      await supabase.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      // 2. Delete all accounts
      await supabase.from("accounts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      // 3. Reset budget
      await supabase.from("budget").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      // 4. Delete budget history
      await supabase.from("budget_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      // 5. Reset user state
      await (supabase.from("user_state") as any).update({
        setup_stage: null,
        pending_transaction: null,
        updated_at: new Date().toISOString(),
      }).neq("id", "00000000-0000-0000-0000-000000000000");

      await sendWhatsAppMessage(
        replyTarget,
        "🚨 *All records have been completely reset.*\n\nAccounts, transactions, budget history, and states are wiped clean. The system is fresh.\n\nSend any message to start setup!"
      );
      res.status(200).json({ status: "all_records_deleted" });
      return;
    } catch (err: any) {
      console.error("[webhook] Error deleting all records:", err);
      await sendWhatsAppMessage(replyTarget, `❌ Error resetting database: ${err.message}`);
      res.status(500).json({ error: err.message });
      return;
    }
  }

  // ── PRIORITY 1: Active Interactive State Machine / Onboarding ──────────────
  if (userState.setup_stage) {
    // 1a. Manual Entry state flow
    if (userState.setup_stage.startsWith("manual_entry_")) {
      const manualHandled = await handleManualEntryFlow(
        messageText,
        buttonId,
        userState,
        accountsData.accounts,
        replyTarget
      );
      if (manualHandled.handled) {
        res.status(200).json({ status: "manual_entry_stage_handled" });
        return;
      }
    }

    // 1b. Budget Limit & Choice Stage
    if (
      userState.setup_stage === "awaiting_budget_choice" ||
      userState.setup_stage === "awaiting_new_budget_limit"
    ) {
      const budgetHandled = await handleBudgetFlow(
        messageText,
        buttonId,
        userState,
        replyTarget
      );
      if (budgetHandled.handled) {
        res.status(200).json({ status: "budget_stage_handled" });
        return;
      }
    }

    // 1c. Check Salary state flow
    if (
      userState.setup_stage === "awaiting_salary_confirmation" ||
      userState.setup_stage === "awaiting_salary_amount"
    ) {
      const salaryHandled = await handleSalaryFlow(
        messageText,
        buttonId,
        userState,
        accountsData.accounts,
        replyTarget
      );
      if (salaryHandled.handled) {
        res.status(200).json({ status: "salary_stage_handled" });
        return;
      }
    }

    // 1d. Check Onboarding / Primary / Add Account state flow
    const onboardingResult = await handleOnboardingFlow(
      messageText,
      buttonId,
      userState,
      accountsData.accounts,
      replyTarget
    );
    if (onboardingResult.handled) {
      if (onboardingResult.replyText) {
        await sendWhatsAppMessage(replyTarget, onboardingResult.replyText);
        console.log(`[webhook] Onboarding stage reply sent to ${replyTarget}`);
      }
      res.status(200).json({ status: "onboarding_stage_handled" });
      return;
    }
  }

  // ── PRIORITY 2: Exact Command & Follow-up Button Matches ───────────────────

  // 2a. Action: "View full summary" from Monthly Reset Cron
  if (buttonId === "summary_view_full" || messageText.toLowerCase() === "view summary") {
    const { data: historyRows } = await supabase
      .from("budget_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

    if (historyRows && historyRows.length > 0) {
      const hist = historyRows[0] as any;
      const summary = hist.summary_data || {};
      const categories: Record<string, number> = summary.all_categories || {};
      const txCount = summary.tx_count || 0;

      const lines = [
        `📊 *Full Monthly Summary (${hist.month})*`,
        `💰 Total Spent: *${formatCurrency(Number(hist.spent))}* (Limit: ${formatCurrency(Number(hist.monthly_limit))})`,
        `🔢 Total Transactions: ${txCount}`,
        "",
        "📂 *Category Breakdown:*",
      ];

      const catEntries = Object.entries(categories).sort((a, b) => b[1] - a[1]);
      if (catEntries.length > 0) {
        catEntries.forEach(([cat, amt]) => {
          lines.push(`• *${cat}*: ${formatCurrency(amt)}`);
        });
      } else {
        lines.push("• No categorized transactions recorded.");
      }

      await sendWhatsAppMessage(replyTarget, lines.join("\n"));
    } else {
      await sendWhatsAppMessage(
        replyTarget,
        "No previous monthly budget history records found."
      );
    }
    res.status(200).json({ status: "full_summary_sent" });
    return;
  }

  // 2b. Action: "Adjust limit" from Monthly Reset Cron OR "Increase limit" from Budget Warning
  if (
    buttonId === "summary_adjust_limit" ||
    buttonId === "action_increase_limit" ||
    messageText.toLowerCase() === "increase limit" ||
    messageText.toLowerCase() === "adjust limit"
  ) {
    await setUserSetupStage(userState.id, "awaiting_new_budget_limit", {});
    await sendWhatsAppMessage(
      replyTarget,
      "What's the new monthly budget limit? (e.g. 20000 or 25000)"
    );
    res.status(200).json({ status: "awaiting_new_budget_limit" });
    return;
  }

  // 2c. Parser-failure button actions
  if (buttonId === "fail_retry") {
    await sendWhatsAppMessage(
      replyTarget,
      "Go ahead, send your entry again (e.g. 'rs 247 debit food')."
    );
    res.status(200).json({ status: "retry_prompted" });
    return;
  }

  if (buttonId === "fail_commands" || isCommandsCommand(messageText)) {
    const commandsText = getAllCommandsHelpText();
    await sendWhatsAppMessage(replyTarget, commandsText);
    res.status(200).json({ status: "all_commands_sent" });
    return;
  }

  if (buttonId === "fail_manual" || messageText.toLowerCase() === "add manually") {
    await startManualEntryFlow(replyTarget, userState.id);
    res.status(200).json({ status: "manual_entry_started" });
    return;
  }

  // 2d. Action: "View budget" button click
  if (buttonId === "action_view_budget" || messageText.toLowerCase() === "view budget") {
    const budgetSummary = await getCurrentBudgetSummary();
    const balanceReply = formatBalanceReport(
      accountsData.accounts,
      accountsData.total,
      budgetSummary
    );
    await sendWhatsAppMessage(replyTarget, balanceReply);
    console.log(`[webhook] Sent budget view report to ${replyTarget}`);
    res.status(200).json({ status: "budget_viewed" });
    return;
  }

  // 2e. "check balance" / "balance" / "my balance"
  if (isBalanceCommand(messageText)) {
    const budgetSummary = await getCurrentBudgetSummary();
    const balanceReply = formatBalanceReport(
      accountsData.accounts,
      accountsData.total,
      budgetSummary
    );
    await sendWhatsAppMessage(replyTarget, balanceReply);
    console.log(`[webhook] Sent balance report to ${replyTarget}`);
    res.status(200).json({ status: "balance_checked" });
    return;
  }

  // 2f. Budget choice flow trigger command ("set budget", "budget", "change budget")
  const budgetFlowResult = await handleBudgetFlow(
    messageText,
    buttonId,
    userState,
    replyTarget
  );
  if (budgetFlowResult.handled) {
    res.status(200).json({ status: "budget_flow_handled" });
    return;
  }

  // 2g. Salary Prompt trigger command
  const salaryResult = await handleSalaryFlow(
    messageText,
    buttonId,
    userState,
    accountsData.accounts,
    replyTarget
  );
  if (salaryResult.handled) {
    res.status(200).json({ status: "salary_flow_handled" });
    return;
  }

  // 2g. Onboarding / "add account" / "set primary account" initiation
  const flowResult = await handleOnboardingFlow(
    messageText,
    buttonId,
    userState,
    accountsData.accounts,
    replyTarget
  );
  if (flowResult.handled) {
    if (flowResult.replyText) {
      await sendWhatsAppMessage(replyTarget, flowResult.replyText);
      console.log(`[webhook] Flow command reply sent to ${replyTarget}`);
    }
    res.status(200).json({ status: "command_handled" });
    return;
  }

  // ── PRIORITY 3: Expense / Transaction Parsing ──────────────────────────────
  const knownAccountNames = accountsData.accounts.map((a) => a.name);

  let parsed = parseMessage(messageText, knownAccountNames);

  if (!parsed) {
    console.log("[webhook] Regex parser returned null. Trying Gemini LLM fallback...");
    parsed = await parseMessageWithGemini(messageText, knownAccountNames);
    console.log("[webhook] Gemini LLM result:", JSON.stringify(parsed));
  }

  // ── 4. Parser Failure: Offer Interactive Buttons ──────────────────────────
  if (!parsed) {
    console.log("[webhook] Could not parse message as a transaction. Offering interactive fallback options.");
    try {
      const fallbackButtons = [
        { id: "fail_retry", title: "Try again" },
        { id: "fail_commands", title: "All commands" },
        { id: "fail_manual", title: "Add manually" },
      ];
      await sendWhatsAppButtons(
        replyTarget,
        "Couldn't understand that message.",
        fallbackButtons
      );
    } catch (err) {
      console.error("[webhook] Error sending parser fallback buttons:", err);
    }
    res.status(200).json({ status: "unrecognized_format_buttons_sent" });
    return;
  }

  // ── 5. Apply Transaction to Ledger with Resolved Target Account ───────────
  try {
    const targetAccount =
      resolveTargetAccount(parsed.accountName, accountsData.accounts) ||
      (await getOrCreateDefaultAccount());

    const { transaction, updatedBudget } = await applyTransaction(
      targetAccount.id,
      parsed.amount,
      parsed.type,
      parsed.category,
      messageText
    );

    const updatedAccountsData = await getAllAccountsWithTotal();

    // ── 1. Format & Send Rich Confirmation Reply ────────────────────────────
    const replyText = formatConfirmationReply(
      transaction,
      updatedAccountsData.total,
      updatedAccountsData.accounts,
      updatedBudget,
      targetAccount.name
    );

    await sendWhatsAppMessage(replyTarget, replyText);
    console.log(`[webhook] Rich confirmation sent to ${replyTarget}:\n${replyText}`);

    // If this transaction was a salary credit, automatically trigger monthly summary
    if (parsed.type === "credit" && parsed.category && parsed.category.toLowerCase().includes("salary")) {
      const { sendMonthlySummaryMessage } = await import("../lib/salary.js");
      await sendMonthlySummaryMessage(replyTarget);
    }

    // ── 2. Follow-up Interactive Buttons on Budget Warning Threshold ────────
    if (updatedBudget.limit > 0) {
      const budgetButtons = [
        { id: "action_view_budget", title: "View budget" },
        { id: "action_increase_limit", title: "Increase limit" },
      ];

      if (updatedBudget.spent >= updatedBudget.limit) {
        await sendWhatsAppButtons(
          replyTarget,
          "⚠️ *You've exceeded your monthly budget!*",
          budgetButtons
        );
        console.log(`[webhook] Sent budget exceeded follow-up buttons to ${replyTarget}`);
      } else if (updatedBudget.spent >= 0.8 * updatedBudget.limit) {
        await sendWhatsAppButtons(
          replyTarget,
          "⚠️ *You've used 80%+ of your monthly budget.*",
          budgetButtons
        );
        console.log(`[webhook] Sent 80% budget warning follow-up buttons to ${replyTarget}`);
      }
    }
  } catch (err) {
    console.error("[webhook] Error processing ledger & reply:", err);
  }

  res.status(200).json({ status: "ok" });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "GET") {
    handleGet(req, res);
    return;
  }

  if (req.method === "POST") {
    await handlePost(req, res);
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
