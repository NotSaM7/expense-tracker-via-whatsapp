import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Validates whether the incoming request is authorized to access dashboard APIs.
 * Checks DASHBOARD_KEY, with fallback to WHATSAPP_VERIFY_TOKEN if DASHBOARD_KEY is unset.
 * In production, requests are strictly rejected if no valid key is provided.
 */
export function isDashboardAuthorized(req: VercelRequest): boolean {
  const secret = process.env.DASHBOARD_KEY || process.env.WHATSAPP_VERIFY_TOKEN;

  if (!secret) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      console.error("[auth] Error: No DASHBOARD_KEY or WHATSAPP_VERIFY_TOKEN set in production. Rejecting request.");
      return false;
    }
    // Allow unauthenticated access only in local development when no secret is configured
    return true;
  }

  const authHeader = req.headers.authorization;
  const customHeader = req.headers["x-dashboard-key"] as string | undefined;
  const queryKey = req.query.key as string | undefined;

  const providedKey =
    customHeader ||
    queryKey ||
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : authHeader);

  return Boolean(providedKey && providedKey === secret);
}

export function requireDashboardAuth(
  req: VercelRequest,
  res: VercelResponse
): boolean {
  if (!isDashboardAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized: Invalid or missing dashboard key" });
    return false;
  }
  return true;
}
