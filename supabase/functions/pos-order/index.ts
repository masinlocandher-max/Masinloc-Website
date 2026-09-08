import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

type Severity = "low" | "medium" | "high" | "critical";

type AuthUser = { id: string; email?: string | null };

// Exact origins only.
//
// Both of these functions reflect the caller's origin back in
// Access-Control-Allow-Origin, and both used to decide whether to do that with
// a prefix test on the hostname: any https host ending ".vercel.app" whose name
// began "masinloc-website-" (and, in pos-order, "pos-masinloc-"). Vercel project
// names are not reserved. Anyone can create a project called
// "masinloc-website-anything", receive a preview origin that satisfies both
// halves of the test, and read these responses cross-origin from a page they
// control. For pos-order that reaches order placement and order tracking.
//
// This is the same defect already fixed once in marketplace-directory, and the
// pattern scripts/check-security.py exists to reject.
//
// A specific preview deployment can be allowed by listing its full origin in
// POS_ALLOWED_ORIGINS (comma-separated). Values are compared exactly; no
// prefix, suffix or wildcard matching is performed on them either, and only
// https origins are accepted.
//
// The plain-http localhost exemption is gone as well: a production endpoint
// that trusts http://localhost hands live order data to any page running on a
// developer's machine, and nothing here needs it.
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://masinloc-zambales.com",
  "https://www.masinloc-zambales.com",
  "https://masinloc-website.vercel.app",
  "https://pos-masinloc.vercel.app",
  "https://masinlocandher-max.github.io",
  ...(Deno.env.get("POS_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("https://")),
]);

function originAllowed(origin: string) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin);
}

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": originAllowed(origin) ? origin : "null",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "content-type, x-client-info, apikey, authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}

function safeHeader(value: string | null, max = 500) {
  return (value || "").slice(0, max) || null;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function logSecurityEvent(req: Request, eventType: string, severity: Severity, metadata: Record<string, unknown> = {}) {
  try {
    const ip = clientIp(req) || "unknown";
    const ipHash = await sha256(ip);
    const keepRaw = severity === "high" || severity === "critical";
    const now = Date.now();
    await supabase.from("security_events").insert({
      event_type: eventType,
      severity,
      category: "pos",
      ip_hash: ipHash,
      ip_address: keepRaw && ip !== "unknown" ? ip : null,
      raw_ip_expires_at: keepRaw && ip !== "unknown" ? new Date(now + 30 * 86400000).toISOString() : null,
      user_agent: safeHeader(req.headers.get("user-agent")),
      origin: safeHeader(req.headers.get("origin")),
      metadata,
      expires_at: new Date(now + 90 * 86400000).toISOString(),
    });
  } catch (err) {
    console.error("pos_security_log_error", err instanceof Error ? err.message : "unknown");
  }
}

async function checkRate(req: Request, key: string, limit: number, windowSeconds: number) {
  const fp = await sha256(`${clientIp(req)}|${key}`);
  const { data, error } = await supabase.rpc("check_submission_rate_limit", {
    p_fingerprint: fp,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("pos_rate_error", error.message);
    throw new Error("SERVER");
  }
  return data === true;
}

async function authUser(req: Request): Promise<AuthUser | null> {
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email };
}

function isUuid(v: unknown) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function text(v: unknown, max: number, required = false) {
  const s = String(v ?? "").trim();
  if (required && !s) throw new Error("VALIDATION");
  if (s.length > max) throw new Error("VALIDATION");
  return s || null;
}

function json(reqBody: unknown) {
  if (!reqBody || typeof reqBody !== "object" || Array.isArray(reqBody)) throw new Error("VALIDATION");
  return reqBody as Record<string, unknown>;
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const origin = req.headers.get("origin") || "";
  if (!originAllowed(origin)) {
    await logSecurityEvent(req, "pos_blocked_origin", "high", { origin: origin.slice(0, 500) });
    return new Response(JSON.stringify({ ok: false, error: "Origin not allowed" }), { status: 403, headers });
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const resource = url.searchParams.get("resource") || "";
      if (resource !== "track") return new Response(JSON.stringify({ ok: false, error: "Not found" }), { status: 404, headers });

      const token = url.searchParams.get("token") || "";
      if (!isUuid(token)) throw new Error("VALIDATION");
      if (!(await checkRate(req, `pos-track:${token.slice(0, 8)}`, 120, 3600))) {
        await logSecurityEvent(req, "pos_track_rate_limit", "medium", {});
        return new Response(JSON.stringify({ ok: false, error: "Too many requests" }), { status: 429, headers });
      }

      const buyer = await authUser(req);
      const { data, error } = await supabase.rpc("pos_buyer_tracking_internal", {
        p_tracking_token: token,
        p_buyer_user_id: buyer?.id || null,
      });
      if (error) {
        console.error("pos_track_db_error", error.message);
        throw new Error("SERVER");
      }
      if (!data) return new Response(JSON.stringify({ ok: false, error: "Order not found" }), { status: 404, headers });
      return new Response(JSON.stringify({ ok: true, order: data }), { status: 200, headers });
    }

    if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers });

    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > 50000) {
      await logSecurityEvent(req, "pos_oversized_request", "high", { content_length: contentLength });
      return new Response(JSON.stringify({ ok: false, error: "Request too large" }), { status: 413, headers });
    }
    if (!(req.headers.get("content-type") || "").toLowerCase().includes("application/json")) throw new Error("VALIDATION");

    const raw = await req.text();
    if (raw.length > 50000) {
      await logSecurityEvent(req, "pos_oversized_request", "high", { body_length: raw.length });
      return new Response(JSON.stringify({ ok: false, error: "Request too large" }), { status: 413, headers });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("VALIDATION");
    }
    const body = json(parsed);
    if (body.website) return new Response(JSON.stringify({ ok: true }), { status: 201, headers });

    const action = String(body.action || "create");
    if (action === "chat") {
      const buyer = await authUser(req);
      if (!buyer) {
        await logSecurityEvent(req, "pos_chat_account_required", "low", {});
        return new Response(JSON.stringify({ ok: false, error: "Sign in to message the store." }), { status: 401, headers });
      }
      const token = String(body.trackingToken || "");
      const message = text(body.message, 1000, true)!;
      if (!isUuid(token)) throw new Error("VALIDATION");
      if (!(await checkRate(req, `pos-chat-order:${buyer.id}:${token.slice(0, 8)}`, 30, 3600)) ||
          !(await checkRate(req, `pos-chat-account:${buyer.id}`, 100, 3600))) {
        await logSecurityEvent(req, "pos_chat_rate_limit", "medium", { buyer_user_id: buyer.id });
        return new Response(JSON.stringify({ ok: false, error: "Too many messages. Please try again later." }), { status: 429, headers });
      }
      const { data, error } = await supabase.rpc("pos_buyer_message_internal", {
        p_tracking_token: token,
        p_buyer_user_id: buyer.id,
        p_message: message,
      });
      if (error) {
        console.error("pos_chat_db_error", error.message);
        if (error.message.includes("another buyer account")) throw new Error("ACCOUNT_MISMATCH");
        if (error.message.includes("Chat closed")) throw new Error("CHAT_CLOSED");
        throw new Error("SERVER");
      }
      return new Response(JSON.stringify({ ok: true, messageId: data }), { status: 201, headers });
    }

    const slug = text(body.slug, 120, true)!;
    const clientId = String(body.clientId || "");
    const idempotencyKey = String(body.idempotencyKey || "");
    if (!isUuid(clientId) || !isUuid(idempotencyKey)) throw new Error("VALIDATION");

    if (!(await checkRate(req, `pos-order-device:${slug}:${clientId}`, 12, 900))) {
      await logSecurityEvent(req, "pos_order_device_rate_limit", "high", { slug });
      return new Response(JSON.stringify({ ok: false, error: "Too many order attempts. Please wait and try again." }), { status: 429, headers });
    }
    if (!(await checkRate(req, `pos-order-ip:${slug}`, 80, 3600))) {
      await logSecurityEvent(req, "pos_order_ip_rate_limit", "high", { slug });
      return new Response(JSON.stringify({ ok: false, error: "Too many order attempts from this network. Please ask the store for help." }), { status: 429, headers });
    }

    const source = String(body.source || "qr");
    if (!["qr", "marketplace"].includes(source)) throw new Error("VALIDATION");
    const fulfillment = String(body.fulfillment || "");
    const customerName = text(body.customerName, 120, true)!;
    const paymentMethod = String(body.paymentMethod || "");
    const paymentReference = text(body.paymentReference, 120);
    const items = body.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) throw new Error("VALIDATION");

    if (["gcash", "maya", "qrph"].includes(paymentMethod) && !paymentReference) {
      await logSecurityEvent(req, "pos_missing_payment_reference", "medium", { slug, payment_method: paymentMethod });
      return new Response(JSON.stringify({ ok: false, error: "Payment reference is required." }), { status: 400, headers });
    }

    const buyer = await authUser(req);
    const { data, error } = await supabase.rpc("pos_create_guest_order_internal", {
      p_slug: slug,
      p_source: source,
      p_fulfillment: fulfillment,
      p_customer_name: customerName,
      p_items: items,
      p_payment_method: paymentMethod,
      p_table_label: text(body.tableLabel, 80),
      p_customer_phone: text(body.customerPhone, 40),
      p_delivery_address: text(body.deliveryAddress, 500),
      p_delivery_landmark: text(body.deliveryLandmark, 300),
      p_payment_reference: paymentReference,
      p_loyalty_opt_in: body.loyaltyOptIn === true,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      console.error("pos_order_db_error", error.message);
      const known = [
        "Store unavailable",
        "Store ordering unavailable",
        "Product unavailable",
        "Product is out of stock",
        "Payment method unavailable",
        "Payment reference is required",
        "Dine in is disabled",
        "Pickup is disabled",
        "Delivery is disabled",
        "Customer name is required",
        "Mobile number is required for delivery",
        "Delivery address is required",
        "Minimum delivery order not met",
        "Modifier requirements not satisfied",
        "Invalid modifier selection",
        "Order quantity limit exceeded",
        "Too many order lines",
      ];
      const safe = known.find((x) => error.message.includes(x));
      if (safe) return new Response(JSON.stringify({ ok: false, error: safe }), { status: 400, headers });
      throw new Error("SERVER");
    }

    if (buyer && data && typeof data === "object" && "tracking_token" in data && isUuid((data as Record<string, unknown>).tracking_token)) {
      const { error: attachError } = await supabase.rpc("pos_attach_buyer_to_order_internal", {
        p_tracking_token: (data as Record<string, unknown>).tracking_token,
        p_buyer_user_id: buyer.id,
      });
      if (attachError) {
        console.error("pos_buyer_attach_error", attachError.message);
        if (attachError.message.includes("another buyer account")) throw new Error("ACCOUNT_MISMATCH");
      }
    }

    return new Response(JSON.stringify({ ok: true, order: data }), { status: 201, headers });
  } catch (err) {
    const code = err instanceof Error ? err.message : "SERVER";
    if (code === "VALIDATION") {
      await logSecurityEvent(req, "pos_invalid_request", "medium", {});
      return new Response(JSON.stringify({ ok: false, error: "Please check the order details and try again." }), { status: 400, headers });
    }
    if (code === "CHAT_CLOSED") return new Response(JSON.stringify({ ok: false, error: "This order chat is closed." }), { status: 409, headers });
    if (code === "ACCOUNT_MISMATCH") return new Response(JSON.stringify({ ok: false, error: "This order is linked to another buyer account." }), { status: 403, headers });
    console.error("pos_order_error", code);
    return new Response(JSON.stringify({ ok: false, error: "We could not process the request right now." }), { status: 500, headers });
  }
});
