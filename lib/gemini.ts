import type { ParsedTransaction } from "./parser.js";

/**
 * Fallback parser using Google Gemini API via lightweight direct REST fetch.
 * Extracts { amount, type, category, accountName } from natural or unstructured messages.
 */
export async function parseMessageWithGemini(
  text: string,
  knownAccountNames: string[] = []
): Promise<ParsedTransaction | null> {
  const rawKey = process.env.GEMINI_API_KEY;
  if (!rawKey) {
    console.warn("[gemini] GEMINI_API_KEY is not configured — skipping LLM fallback");
    return null;
  }
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");

  const accountsListStr =
    knownAccountNames.length > 0
      ? `Known user accounts: [${knownAccountNames.map((a) => `"${a}"`).join(", ")}].`
      : "";

  const prompt = `You are a strict transaction parser for a personal WhatsApp expense tracker.
Extract the transaction details from the following message: "${text}".
${accountsListStr}

Output MUST be a single raw JSON object with this exact structure:
{
  "amount": number (positive decimal or integer),
  "type": "debit" or "credit",
  "category": string or null,
  "accountName": string or null
}

Rules:
- "debit": expenses, spent, paid, shopping, food, bill, groceries, cab, etc.
- "credit": salary, received, income, bonus, refund, cashback, deposited, etc.
- "category": concise single or two-word category (e.g., "food", "groceries", "salary", "uber", "coffee", "pizza"). If not clear, set to null.
- "accountName": if the message mentions one of the known accounts (or an obvious alias like "cash", "bank", "hdfc"), return the exact matched account name from the known list. Otherwise null.
- If the message is NOT a financial transaction (e.g. greeting, random chat, question), return {"amount": null, "type": null, "category": null, "accountName": null}.
- Return ONLY valid JSON, no markdown codeblocks, no explanations.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[gemini] API call failed with status ${response.status}: ${errText}`);
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      error?: unknown;
    };

    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawJson) return null;

    // Clean any accidental markdown wrap
    const cleaned = rawJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    if (
      typeof parsed.amount === "number" &&
      parsed.amount > 0 &&
      (parsed.type === "debit" || parsed.type === "credit")
    ) {
      return {
        amount: parsed.amount,
        type: parsed.type,
        category:
          typeof parsed.category === "string" && parsed.category.trim().length > 0
            ? parsed.category.trim().toLowerCase()
            : null,
        accountName:
          typeof parsed.accountName === "string" && parsed.accountName.trim().length > 0
            ? parsed.accountName.trim()
            : null,
      };
    }

    return null;
  } catch (err) {
    console.warn("[gemini] Exception while parsing transaction with Gemini:", err);
    return null;
  }
}
