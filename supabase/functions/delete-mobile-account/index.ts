import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://www.masinloc-zambales.com",
  "capacitor://localhost",
  "https://localhost",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : null;
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  const origin = req.headers.get("Origin") || "";

  if (req.method === "OPTIONS") {
    if (!ALLOWED_ORIGINS.has(origin)) return new Response("Origin not allowed", { status: 403, headers });
    return new Response("ok", { headers });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, headers);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "Origin not allowed" }, 403, headers);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "Authentication required" }, 401, headers);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ ok: false, error: "Server configuration error" }, 500, headers);

  const token = authHeader.slice("Bearer ".length);
  const verifier = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await verifier.auth.getUser(token);
  const user = authData.user;
  if (authError || !user) return json({ ok: false, error: "Invalid or expired session" }, 401, headers);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Remove optional/personal application data. Emergency incidents, responder
  // messages, financial ledgers and audit records are intentionally retained
  // where operational recordkeeping requires them.
  const deletions: Array<[string, string]> = [
    ["saved_content", "user_id"],
    ["saved_jobs", "user_id"],
    ["resume_versions", "user_id"],
    ["career_profiles", "user_id"],
    ["job_preferences", "user_id"],
    ["member_profiles", "user_id"],
    ["application_activity", "user_id"],
    ["pos_access_applications", "user_id"],
    ["pos_memberships", "user_id"],
  ];

  for (const [table, column] of deletions) {
    const { error } = await admin.from(table).delete().eq(column, user.id);
    if (error) {
      console.error("account deletion failed", { table, code: error.code });
      return json({ ok: false, error: "Could not complete account deletion" }, 500, headers);
    }
  }

  // Soft-delete the Auth identity. The account can no longer authenticate,
  // while retained safety/financial/audit rows may continue to reference its
  // non-usable UUID without breaking their integrity.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id, true);
  if (deleteError) {
    console.error("auth soft delete failed", { code: deleteError.code });
    return json({ ok: false, error: "Could not complete account deletion" }, 500, headers);
  }

  return json({ ok: true }, 200, headers);
});

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
