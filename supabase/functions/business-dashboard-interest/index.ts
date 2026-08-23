import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function originAllowed(origin: string) {
  if (!origin) return false;
  if (origin === "https://masinloc-zambales.com" || origin === "https://www.masinloc-zambales.com") return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    if (u.hostname === "masinloc-website.vercel.app") return true;
    return u.hostname.endsWith(".vercel.app") && (u.hostname.startsWith("masinloc-website-") || u.hostname.startsWith("masinloc-connect-"));
  } catch {
    return false;
  }
}

function headers(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": originAllowed(origin) ? origin : "null",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}

async function sha256(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rateAllowed(req: Request) {
  const fingerprint = await sha256(`${clientIp(req)}|business-dashboard-interest`);
  const { data, error } = await supabase.rpc("check_submission_rate_limit", {
    p_fingerprint: fingerprint,
    p_limit: 8,
    p_window_seconds: 900,
  });
  if (error) throw new Error("RATE_CHECK");
  return data === true;
}

Deno.serve(async (req: Request) => {
  const h = headers(req);
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: h });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false }), { status: 405, headers: h });
  if (!originAllowed(req.headers.get("origin") || "")) return new Response(JSON.stringify({ ok: false }), { status: 403, headers: h });

  try {
    if (!(await rateAllowed(req))) return new Response(JSON.stringify({ ok: false, error: "Please try again later." }), { status: 429, headers: h });

    const body = await req.json();
    const referenceCode = String(body?.referenceCode || "").trim().toUpperCase();
    const ownerEmail = String(body?.ownerEmail || "").trim().toLowerCase();

    if (!/^MC-B-[A-F0-9]{10}$/.test(referenceCode) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid request." }), { status: 400, headers: h });
    }

    const { data, error } = await supabase
      .from("business_submissions")
      .update({ dashboard_interest: true, dashboard_interest_at: new Date().toISOString() })
      .eq("reference_code", referenceCode)
      .eq("owner_email", ownerEmail)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return new Response(JSON.stringify({ ok: false, error: "Please check your reference code and owner email." }), { status: 400, headers: h });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
  } catch (error) {
    console.error("business_dashboard_interest_error", error instanceof Error ? error.message : "unknown");
    return new Response(JSON.stringify({ ok: false, error: "We could not save your interest right now." }), { status: 500, headers: h });
  }
});
