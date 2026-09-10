import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Validates whether the incoming request is authorized to access dashboard APIs.
 * If DASHBOARD_KEY is not configured, allows requests (for local dev convenience)
 * with a warning in production.
 */
export function isDashboardAuthorized(req: VercelRequest): boolean {
  const secret = process.env.DASHBOARD_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      console.warn("[auth] Warning: DASHBOARD_KEY is not set in environment variables. Dashboard API is unprotected.");
    }
    return true;
  }

  const authHeader = req.headers.authorization;
  const customHeader = req.headers["x-dashboard-key"] as string | undefined;
  const queryKey = req.query.key as string | undefined;

  const providedKey =
    customHeader ||
    queryKey ||
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : authHeader);

  return providedKey === secret;
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
