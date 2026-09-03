// The public face of Masinloc POS: storefront, menu, order placement, order
// tracking and order chat.
//
// WHY THIS EXISTS
//
// pos_public_storefront, pos_public_menu, pos_create_guest_order_internal,
// pos_guest_tracking_internal and pos_guest_message_internal are all granted to
// service_role only -- migration 20260828134204 is literally named
// "route_public_pos_catalog_through_edge". The browser cannot call them, and
// must not: they are SECURITY DEFINER and read across every merchant. This
// function is that route. It holds the service key, exposes exactly five
// actions, and validates before it delegates.
//
// The RPCs enforce the real rules (store must be active and verified, product
// must be in stock, payment method must be enabled, plan limits, and so on).
// The checks here are the cheap outer ring: shape, size and rate, so obvious
// abuse never reaches the database.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECURITY_HASH_KEY = Deno.env.get("SECURITY_HASH_KEY") || SERVICE_ROLE_KEY;

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Exact origins only. No prefix, suffix or wildcard matching: Vercel project
// names are not reserved, so any pattern that trusts "*.vercel.app" hands a
// preview origin to whoever registers the name. Additional origins may be
// listed in full, comma-separated, in POS_ALLOWED_ORIGINS.
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://masinloc-zambales.com",
  "https://www.masinloc-zambales.com",
  "https://masinloc-website.vercel.app",
  ...(Deno.env.get("POS_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("https://")),
]);

function originAllowed(origin: string) {
  // A same-origin fetch and a non-browser client send no Origin header at all.
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function headers(req: Request, cache: string) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": origin && originAllowed(origin) ? origin : origin ? "null" : "*",
    "Access-Control-Allow-Headers": "content-type, x-client-info, apikey, authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
  };
}

const PRIVATE = "no-store";
const SHORT = "public, max-age=30, stale-while-revalidate=120";

function json(body: unknown, status: number, req: Request, cache = PRIVATE) {
  return new Response(JSON.stringify(body), { status, headers: headers(req, cache) });
}

/* ------------------------------------------------------------------ */
/* Abuse controls                                                      */
/* ------------------------------------------------------------------ */

function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}

// A bare digest of an IP is reversible -- the whole IPv4 space is four billion
// values. Keying the hash means a leaked rate-limit or security table cannot be
// walked back to addresses.
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
  if (error) throw new Error("SERVER");
  return data === true;
}

// Two buckets: this caller, and everyone. The global bucket is the backstop for
// a distributed flood that never trips a per-IP limit.
async function checkRate(req: Request, category: string, perIpLimit: number, globalLimit: number) {
  if (!(await consumeRate(await hmac256(`${clientIp(req)}|pos:${category}`), perIpLimit))) return false;
  return consumeRate(await hmac256(`global|pos:${category}`), globalLimit);
}

/* ------------------------------------------------------------------ */
/* Input shapes                                                        */
/* ------------------------------------------------------------------ */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCES = new Set(["qr", "marketplace"]);
const FULFILLMENTS = new Set(["dine_in", "pickup", "delivery"]);
const METHODS = new Set(["cash", "gcash", "maya", "qrph", "card", "room_charge"]);

const MAX_LINES = 40;
const MAX_QTY_PER_LINE = 99;

function slug(value: unknown) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s || s.length > 80 || !SLUG_RE.test(s)) throw new Error("VALIDATION");
  return s;
}

function uuid(value: unknown) {
  const s = String(value ?? "").trim();
  if (!UUID_RE.test(s)) throw new Error("VALIDATION");
  return s;
}

function text(value: unknown, max: number, { required = false } = {}) {
  const s = String(value ?? "").trim();
  if (!s) {
    if (required) throw new Error("VALIDATION");
    return null;
  }
  if (s.length > max) throw new Error("VALIDATION");
  return s;
}

function pick<T>(value: unknown, allowed: Set<string>): T {
  const s = String(value ?? "").trim();
  if (!allowed.has(s)) throw new Error("VALIDATION");
  return s as T;
}

// Rebuild the cart rather than forwarding whatever the client sent: only these
// three fields reach the database, and each is checked. Prices are never taken
// from the client -- the RPC reads them from pos_products.
function cart(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LINES) throw new Error("VALIDATION");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("VALIDATION");
    const line = raw as Record<string, unknown>;
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_LINE) throw new Error("VALIDATION");
    const modifiers = line.modifier_option_ids;
    const modifier_option_ids = modifiers === undefined || modifiers === null
      ? []
      : (() => {
        if (!Array.isArray(modifiers) || modifiers.length > 25) throw new Error("VALIDATION");
        return modifiers.map(uuid);
      })();
    return {
      product_id: uuid(line.product_id),
      quantity,
      note: text(line.note, 500),
      modifier_option_ids,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

// Postgres raises these as plain messages. They are the store's own words about
// the customer's own order, so they are safe to pass through; anything else
// becomes a generic message so an unexpected database error cannot leak schema.
const PASSTHROUGH = new Set([
  "Store unavailable",
  "Store ordering unavailable",
  "Dine in is disabled",
  "Pickup is disabled",
  "Delivery is disabled",
  "Mobile number is required for delivery",
  "Delivery address is required",
  "Payment method unavailable",
  "Order must contain items",
  "Product unavailable",
  "Product is out of stock",
  "Too many order lines",
  "Order quantity limit exceeded",
  "Invalid quantity",
  "Invalid modifier selection",
  "Modifier requirements not satisfied",
  "Minimum delivery order not met",
  "Customer name is required",
  "Payment reference is required",
  "Order not found",
  "Chat closed",
  "Invalid message",
]);

function rpcError(error: { message?: string } | null) {
  const message = String(error?.message || "").trim();
  return PASSTHROUGH.has(message) ? message : "Something went wrong. Please try again.";
}

async function storefront(req: Request, url: URL) {
  const s = slug(url.searchParams.get("slug"));
  const [store, menu] = await Promise.all([
    supabase.rpc("pos_public_storefront", { p_slug: s }),
    supabase.rpc("pos_public_menu", { p_slug: s }),
  ]);
  if (store.error || menu.error) return json({ ok: false, error: "Store unavailable" }, 502, req);
  if (!store.data) return json({ ok: false, error: "Store unavailable" }, 404, req);
  return json({ ok: true, store: store.data, menu: menu.data ?? [] }, 200, req, SHORT);
}

async function placeOrder(req: Request, body: Record<string, unknown>) {
  if (!(await checkRate(req, "order", 12, 3000))) {
    return json({ ok: false, error: "Too many orders from this connection. Please wait a moment." }, 429, req);
  }

  const fulfillment = pick<string>(body.fulfillment, FULFILLMENTS);
  const payload = {
    p_slug: slug(body.slug),
    p_source: pick<string>(body.source, SOURCES),
    p_fulfillment: fulfillment,
    p_customer_name: text(body.customer_name, 120, { required: true }),
    p_items: cart(body.items),
    p_payment_method: pick<string>(body.payment_method, METHODS),
    p_table_label: text(body.table_label, 60),
    p_customer_phone: text(body.customer_phone, 40),
    p_delivery_address: text(body.delivery_address, 500),
    p_delivery_landmark: text(body.delivery_landmark, 300),
    p_payment_reference: text(body.payment_reference, 120),
    p_loyalty_opt_in: body.loyalty_opt_in === true,
    // Supplied by the client so a retried submission cannot double-charge; the
    // RPC returns the original order instead of creating a second one.
    p_idempotency_key: text(body.idempotency_key, 100),
  };

  const { data, error } = await supabase.rpc("pos_create_guest_order_internal", payload);
  if (error) return json({ ok: false, error: rpcError(error) }, 400, req);
  return json({ ok: true, order: data }, 200, req);
}

async function track(req: Request, url: URL) {
  const token = uuid(url.searchParams.get("token"));
  const { data, error } = await supabase.rpc("pos_guest_tracking_internal", { p_tracking_token: token });
  if (error) return json({ ok: false, error: rpcError(error) }, 400, req);
  // An unknown token and a deleted order are the same answer on purpose: the
  // token is the only credential, and a distinct 404 would confirm guesses.
  if (!data) return json({ ok: false, error: "Order not found" }, 404, req);
  return json({ ok: true, order: data }, 200, req);
}

async function message(req: Request, body: Record<string, unknown>) {
  if (!(await checkRate(req, "chat", 40, 5000))) {
    return json({ ok: false, error: "Too many messages. Please wait a moment." }, 429, req);
  }
  const token = uuid(body.token);
  const text_ = text(body.message, 1000, { required: true });
  const { error } = await supabase.rpc("pos_guest_message_internal", {
    p_tracking_token: token,
    p_message: text_,
  });
  if (error) return json({ ok: false, error: rpcError(error) }, 400, req);
  return json({ ok: true }, 200, req);
}

/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headers(req, PRIVATE) });
  }

  const origin = req.headers.get("origin") || "";
  if (!originAllowed(origin)) {
    return json({ ok: false, error: "Origin not allowed" }, 403, req);
  }

  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const action = url.searchParams.get("action") || "";
      if (action === "storefront") return await storefront(req, url);
      if (action === "track") return await track(req, url);
      return json({ ok: false, error: "Unknown action" }, 404, req);
    }

    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: "Invalid request" }, 400, req);
      }
      const action = String(body.action || "");
      if (action === "order") return await placeOrder(req, body);
      if (action === "message") return await message(req, body);
      return json({ ok: false, error: "Unknown action" }, 404, req);
    }

    return json({ ok: false, error: "Method not allowed" }, 405, req);
  } catch (err) {
    if (err instanceof Error && err.message === "VALIDATION") {
      return json({ ok: false, error: "Please check the details and try again." }, 400, req);
    }
    console.error("pos_public_error", err instanceof Error ? err.message : "unknown");
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500, req);
  }
});
