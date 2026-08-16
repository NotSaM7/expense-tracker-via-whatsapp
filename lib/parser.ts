export interface ParsedTransaction {
  amount: number;
  type: "debit" | "credit";
  category: string | null;
  accountName: string | null;
}

const DEBIT_KEYWORDS = [
  "debit",
  "debited",
  "spent",
  "spend",
  "paid",
  "pay",
  "paying",
  "dr",
  "out",
  "loss",
  "withdrawn",
  "withdraw",
  "kharch",
  "kharcha",
  "diya",
  "diye",
  "gaya",
  "gaye",
  "bhara",
  "bhare",
  "lagaya",
  "lagaye",
  "khrch",
];

const CREDIT_KEYWORDS = [
  "credit",
  "credited",
  "received",
  "receive",
  "got",
  "get",
  "income",
  "cr",
  "added",
  "deposit",
  "deposited",
  "salary",
  "aaya",
  "aaye",
  "aayi",
  "mila",
  "mili",
  "mile",
  "jama",
  "kamaya",
];

// Stop words to strip out when extracting the category
const STOP_WORDS = new Set([
  "on",
  "for",
  "in",
  "at",
  "to",
  "from",
  "via",
  "by",
  "a",
  "an",
  "the",
  "of",
  "and",
  "is",
  "was",
  "rs",
  "rs.",
  "inr",
  "rupee",
  "rupees",
  "pe",
  "par",
  "ko",
  "se",
  "mein",
  "me",
  "liye",
  "kiye",
  "kiya",
  "ka",
  "ki",
  "ke",
  "ne",
]);

/**
 * Matches tokens against a list of known account names or their aliases/words.
 * Returns the matching original account name and the matching token index.
 */
function findMatchingAccount(
  tokens: string[],
  knownAccountNames: string[]
): { matchedName: string; matchedToken: string } | null {
  if (!knownAccountNames || knownAccountNames.length === 0) return null;

  for (const accountName of knownAccountNames) {
    const accLower = accountName.toLowerCase();
    const accTokens = accLower.split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      // 1. Direct exact word match (e.g. "cash" === "cash", "bank" === "bank")
      if (accTokens.includes(token)) {
        return { matchedName: accountName, matchedToken: token };
      }
      // 2. Substring/prefix match for multi-character tokens (e.g. "hdfc" in "hdfc bank")
      if (token.length >= 3 && accLower.includes(token)) {
        return { matchedName: accountName, matchedToken: token };
      }
    }
  }

  return null;
}

/**
 * Fast regex-based parser for structured and semi-structured WhatsApp expense messages.
 * Optionally extracts account targeting based on known account names.
 */
export function parseMessage(
  text: string,
  knownAccountNames: string[] = []
): ParsedTransaction | null {
  if (!text || typeof text !== "string") return null;

  const clean = text.trim();
  if (!clean) return null;

  // 1. Extract Amount: supports "₹ 247", "rs 247.50", "rs.247", "247 rs", "247.00"
  const amountRegex = /(?:(?:rs\.?|inr|₹)\s*)?(\d+(?:\.\d{1,2})?)(?:\s*(?:rs\.?|inr|₹|rupees?))?/i;
  const amountMatch = clean.match(amountRegex);

  if (!amountMatch || !amountMatch[1]) {
    return null;
  }

  const rawAmount = parseFloat(amountMatch[1]);
  if (isNaN(rawAmount) || rawAmount <= 0) {
    return null;
  }

  // Tokenize the text into lowercased words
  const tokens = clean
    .toLowerCase()
    .replace(/[₹.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // 2. Identify Transaction Type
  let type: "debit" | "credit" | null = null;
  let typeMatchedWord: string | null = null;

  for (const token of tokens) {
    if (DEBIT_KEYWORDS.includes(token)) {
      type = "debit";
      typeMatchedWord = token;
      break;
    }
    if (CREDIT_KEYWORDS.includes(token)) {
      type = "credit";
      typeMatchedWord = token;
      break;
    }
  }

  if (!type) {
    return null;
  }

  // 3. Extract Account Target (if any)
  const accountMatch = findMatchingAccount(tokens, knownAccountNames);
  const matchedAccountName = accountMatch ? accountMatch.matchedName : null;
  const matchedAccountToken = accountMatch ? accountMatch.matchedToken : null;

  // 4. Extract Category
  const categoryTokens = tokens.filter((token) => {
    // skip digits/amounts (e.g. "500", "500rs", "rs500", "500inr")
    if (/^\d+(?:\.\d+)?$/.test(token)) return false;
    if (/^\d+(?:rs|inr|rupees?)$/i.test(token)) return false;
    if (/^(?:rs|inr|₹)\d+$/i.test(token)) return false;
    // skip the matched type keyword
    if (token === typeMatchedWord) return false;
    // skip the matched account token
    if (matchedAccountToken && token === matchedAccountToken) return false;
    // skip stop words
    if (STOP_WORDS.has(token)) return false;
    return true;
  });

  const category = categoryTokens.length > 0 ? categoryTokens.join(" ") : null;

  return {
    amount: rawAmount,
    type,
    category,
    accountName: matchedAccountName,
  };
}
