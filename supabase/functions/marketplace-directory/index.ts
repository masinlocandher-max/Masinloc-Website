import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CATEGORY_LABELS: Record<string, string> = {
  "food-drinks": "Food & Drinks",
  "catering-events": "Catering & Events",
  retail: "Retail",
  "beauty-wellness": "Beauty & Wellness",
  services: "Services",
  "tourism-accommodation": "Tourism & Accommodation",
  other: "Other",
};

function originAllowed(origin: string) {
  if (!origin) return true; // The response contains public directory data only.
  if (origin === "https://masinloc-zambales.com" || origin === "https://www.masinloc-zambales.com") return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    if (url.hostname === "masinloc-website.vercel.app") return true;
    return url.hostname.endsWith(".vercel.app") &&
      (url.hostname.startsWith("masinloc-website-") || url.hostname.startsWith("masinloc-connect-"));
  } catch {
    return false;
  }
}

function headers(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": origin && originAllowed(origin) ? origin : origin ? "null" : "*",
    "Access-Control-Allow-Headers": "content-type, x-client-info, apikey, authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    "X-Content-Type-Options": "nosniff",
  };
}

Deno.serve(async (req) => {
  const responseHeaders = headers(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers: responseHeaders });
  }

  const origin = req.headers.get("origin") || "";
  if (!originAllowed(origin)) {
    return new Response(JSON.stringify({ ok: false, error: "Origin not allowed" }), { status: 403, headers: responseHeaders });
  }

  try {
    const url = new URL(req.url);
    const requestedSlug = (url.searchParams.get("slug") || "").trim().toLowerCase();
    if (requestedSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug)) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid listing" }), { status: 400, headers: responseHeaders });
    }

    let listingsQuery = supabase
      .from("marketplace_listings")
      .select("slug,name,category,location,barangay,description,descriptor,schema_type,facebook_page,pos_merchant_id,updated_at")
      .eq("publication_status", "published")
      .eq("admin_hidden", false)
      .order("name", { ascending: true })
      .limit(1000);
    if (requestedSlug) listingsQuery = listingsQuery.eq("slug", requestedSlug);

    const { data: listings, error: listingsError } = await listingsQuery;
    if (listingsError) throw listingsError;

    const posIds = [...new Set((listings || []).map((row) => row.pos_merchant_id).filter(Boolean))] as string[];
    const merchants = new Map<string, any>();
    const outletsByMerchant = new Map<string, any[]>();
    const availableProductMerchants = new Set<string>();
    const paymentOutletIds = new Set<string>();

    if (posIds.length) {
      const [merchantResult, outletResult, productResult, paymentResult] = await Promise.all([
        supabase.from("pos_merchants").select("id,slug,status,eligibility_status").in("id", posIds),
        supabase.from("pos_outlets")
          .select("id,merchant_id,dine_in_enabled,pickup_enabled,delivery_enabled,active,ordering_enabled,archived_at,created_at")
          .in("merchant_id", posIds)
          .eq("active", true)
          .eq("ordering_enabled", true)
          .is("archived_at", null)
          .order("created_at", { ascending: true }),
        supabase.from("pos_products")
          .select("merchant_id,track_inventory,stock_on_hand")
          .in("merchant_id", posIds)
          .eq("active", true)
          .is("archived_at", null),
        supabase.from("pos_payment_methods")
          .select("merchant_id,outlet_id")
          .in("merchant_id", posIds)
          .eq("enabled", true),
      ]);
      for (const result of [merchantResult, outletResult, productResult, paymentResult]) {
        if (result.error) throw result.error;
      }

      for (const merchant of merchantResult.data || []) merchants.set(merchant.id, merchant);
      for (const outlet of outletResult.data || []) {
        const list = outletsByMerchant.get(outlet.merchant_id) || [];
        list.push(outlet);
        outletsByMerchant.set(outlet.merchant_id, list);
      }
      for (const product of productResult.data || []) {
        if (!product.track_inventory || Number(product.stock_on_hand) > 0) availableProductMerchants.add(product.merchant_id);
      }
      for (const payment of paymentResult.data || []) paymentOutletIds.add(payment.outlet_id);
    }

    const publicListings = (listings || []).map((listing) => {
      let orderingAvailable = false;
      let orderPath: string | null = null;
      const fulfillment: string[] = [];

      if (listing.pos_merchant_id) {
        const merchant = merchants.get(listing.pos_merchant_id);
        const outlets = outletsByMerchant.get(listing.pos_merchant_id) || [];
        const outlet = outlets.find((candidate) =>
          paymentOutletIds.has(candidate.id) &&
          (candidate.dine_in_enabled || candidate.pickup_enabled || candidate.delivery_enabled)
        );
        if (merchant?.status === "active" && merchant?.eligibility_status === "verified" && outlet && availableProductMerchants.has(listing.pos_merchant_id)) {
          orderingAvailable = true;
          if (outlet.dine_in_enabled) fulfillment.push("dine_in");
          if (outlet.pickup_enabled) fulfillment.push("pickup");
          if (outlet.delivery_enabled) fulfillment.push("delivery");
          orderPath = `/posmasinloqueno?store=${encodeURIComponent(merchant.slug)}`;
        }
      }

      return {
        slug: listing.slug,
        name: listing.name,
        category: listing.category,
        categoryLabel: CATEGORY_LABELS[listing.category] || "Other",
        location: listing.location,
        barangay: listing.barangay,
        description: listing.description,
        descriptor: listing.descriptor,
        schemaType: listing.schema_type,
        facebook: listing.facebook_page,
        orderingAvailable,
        fulfillment,
        orderPath,
        updatedAt: listing.updated_at,
      };
    });

    return new Response(JSON.stringify({ ok: true, businesses: publicListings, count: publicListings.length }), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("marketplace_directory_error", error instanceof Error ? error.message : "unknown");
    return new Response(JSON.stringify({ ok: false, error: "The Marketplace directory is temporarily unavailable." }), {
      status: 500,
      headers: { ...responseHeaders, "Cache-Control": "no-store" },
    });
  }
});
