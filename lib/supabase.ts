import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
  );
}

/**
 * Supabase client configured with the service-role key.
 * Only use server-side (API routes / serverless functions) — never expose to the browser.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    // Service-role key bypasses RLS — no user session needed
    persistSession: false,
    autoRefreshToken: false,
  },
});
