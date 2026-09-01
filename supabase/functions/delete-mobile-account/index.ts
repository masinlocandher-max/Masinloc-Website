import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "Authentication required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ ok: false, error: "Server configuration error" }, 500);

  const token = authHeader.slice("Bearer ".length);
  const verifier = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await verifier.auth.getUser(token);
  const user = authData.user;
  if (authError || !user) return json({ ok: false, error: "Invalid or expired session" }, 401);

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
      return json({ ok: false, error: "Could not complete account deletion" }, 500);
    }
  }

  // Soft-delete the Auth identity. The account can no longer authenticate,
  // while retained safety/financial/audit rows may continue to reference its
  // non-usable UUID without breaking their integrity.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id, true);
  if (deleteError) {
    console.error("auth soft delete failed", { code: deleteError.code });
    return json({ ok: false, error: "Could not complete account deletion" }, 500);
  }

  return json({ ok: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
