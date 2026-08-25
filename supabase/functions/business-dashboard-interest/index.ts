import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const SECURITY_HASH_KEY = Deno.env.get("SECURITY_HASH_KEY") || SERVICE_ROLE_KEY;
const ALLOWED_ORIGINS = new Set([
  "https://masinloc-zambales.com",
  "https://www.masinloc-zambales.com",
  "https://masinloc-website.vercel.app",
]);

function originAllowed(origin: string) {
  return ALLOWED_ORIGINS.has(origin);
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
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };
}

function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}

async function hmac256(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECURITY_HASH_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function consumeRate(fingerprint: string, limit: number, windowSeconds = 900) {
  const { data, error } = await supabase.rpc("check_submission_rate_limit", {
    p_fingerprint: fingerprint,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error("RATE_CHECK");
  return data === true;
}

async function rateAllowed(req: Request) {
  const perIp = await hmac256(`${clientIp(req)}|business-dashboard-interest`);
  if (!(await consumeRate(perIp, 8))) return false;
  const global = await hmac256("global|business-dashboard-interest");
  return consumeRate(global, 1200);
}

async function logSecurityEvent(req: Request, eventType: string, severity: "low" | "medium" | "high", metadata: Record<string, unknown> = {}) {
  try {
    const ip = clientIp(req) || "unknown";
    const ipHash = await hmac256(ip);
    const keepRaw = severity === "high" && ip !== "unknown";
    await supabase.from("security_events").insert({
      event_type: eventType,
      severity,
      category: "business",
      ip_hash: ipHash,
      ip_address: keepRaw ? ip : null,
      raw_ip_expires_at: keepRaw ? new Date(Date.now() + 30 * 86400000).toISOString() : null,
      user_agent: (req.headers.get("user-agent") || "").slice(0, 500) || null,
      origin: (req.headers.get("origin") || "").slice(0, 500) || null,
      metadata,
      expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
    });
  } catch (error) {
    console.error("business_dashboard_security_log_error", error instanceof Error ? error.message : "unknown");
  }
}

Deno.serve(async (req: Request) => {
  const h = headers(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") {
    await logSecurityEvent(req, "unsupported_method", "medium", { method: req.method });
    return new Response(JSON.stringify({ ok: false }), { status: 405, headers: h });
  }
  if (!originAllowed(req.headers.get("origin") || "")) {
    await logSecurityEvent(req, "blocked_origin", "high");
    return new Response(JSON.stringify({ ok: false }), { status: 403, headers: h });
  }

  try {
    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > 16 * 1024) {
      await logSecurityEvent(req, "oversized_submission", "high", { content_length: contentLength });
      return new Response(JSON.stringify({ ok: false, error: "Invalid request." }), { status: 413, headers: h });
    }
    if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
      await logSecurityEvent(req, "invalid_submission", "medium", { reason: "content_type" });
      return new Response(JSON.stringify({ ok: false, error: "Invalid request." }), { status: 415, headers: h });
    }
    if (!(await rateAllowed(req))) {
      await logSecurityEvent(req, "rate_limit_block", "high");
      return new Response(JSON.stringify({ ok: false, error: "Please try again later." }), { status: 429, headers: h });
    }

    const body = await req.json();
    const referenceCode = String(body?.referenceCode || "").trim().toUpperCase();
    const ownerEmail = String(body?.ownerEmail || "").trim().toLowerCase();

    if (!/^MC-B-[A-F0-9]{10}$/.test(referenceCode) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      await logSecurityEvent(req, "invalid_submission", "medium", { reason: "validation" });
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
      await logSecurityEvent(req, "invalid_submission", "medium", { reason: "record_mismatch" });
      return new Response(JSON.stringify({ ok: false, error: "Please check your reference code and owner email." }), { status: 400, headers: h });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
  } catch (error) {
    console.error("business_dashboard_interest_error", error instanceof Error ? error.message : "unknown");
    return new Response(JSON.stringify({ ok: false, error: "We could not save your interest right now." }), { status: 500, headers: h });
  }
});
