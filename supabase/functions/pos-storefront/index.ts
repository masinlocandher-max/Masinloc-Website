import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
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
function headers(req: Request, cache = "no-store") { const origin = req.headers.get("origin") || ""; return { "Access-Control-Allow-Origin": originAllowed(origin) ? origin : "null", "Vary": "Origin", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", "Access-Control-Allow-Methods": "GET, OPTIONS", "Content-Type": "application/json", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" }; }
function validSlug(value: string) { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 120; }
Deno.serve(async (req) => { const h=headers(req); if(req.method==="OPTIONS") return new Response(null,{status:204,headers:h}); const origin=req.headers.get("origin")||""; if(!originAllowed(origin)) return new Response(JSON.stringify({ok:false,error:"Origin not allowed"}),{status:403,headers:h}); if(req.method!=="GET") return new Response(JSON.stringify({ok:false,error:"Method not allowed"}),{status:405,headers:h}); try { const url=new URL(req.url); const slug=(url.searchParams.get("slug")||"").trim().toLowerCase(); const source=url.searchParams.get("source")==="marketplace"?"marketplace":"qr"; if(!validSlug(slug)) return new Response(JSON.stringify({ok:false,error:"Invalid store"}),{status:400,headers:h}); const storeRpc=source==="marketplace"?"pos_marketplace_storefront":"pos_public_storefront"; const menuRpc=source==="marketplace"?"pos_public_marketplace_menu":"pos_public_menu"; const [{data:store,error:storeError},{data:menu,error:menuError}]=await Promise.all([supabase.rpc(storeRpc,{p_slug:slug}),supabase.rpc(menuRpc,{p_slug:slug})]); if(storeError||menuError){console.error("pos_storefront_db",storeError?.message||menuError?.message);throw new Error("SERVER");} if(!store) return new Response(JSON.stringify({ok:false,error:source==="marketplace"?"Marketplace ordering is unavailable for this store":"Store unavailable"}),{status:404,headers:h}); const paymentMethods:Array<Record<string,unknown>>=[]; for(const method of (store.payment_methods||[])){let qrUrl:string|null=null;if(method.qr_image_path){const {data,error}=await supabase.storage.from("pos-payment-assets").createSignedUrl(method.qr_image_path,600);if(error)console.error("pos_storefront_qr_sign",error.message);else qrUrl=data.signedUrl;}paymentMethods.push({method:method.method,label:method.label,requires_manual_verification:method.requires_manual_verification,instructions:method.instructions||null,qr_url:qrUrl});} const publicStore={name:store.name,slug:store.slug,currency:store.currency,marketplace_lead_time_minutes:Number(store.marketplace_lead_time_minutes||0),outlet:{name:store.outlet?.name,dine_in_enabled:source==="marketplace"?false:Boolean(store.outlet?.dine_in_enabled),pickup_enabled:Boolean(store.outlet?.pickup_enabled),delivery_enabled:Boolean(store.outlet?.delivery_enabled),delivery_fee:Number(store.outlet?.delivery_fee||0),minimum_delivery_order:Number(store.outlet?.minimum_delivery_order||0)},payment_methods:paymentMethods}; return new Response(JSON.stringify({ok:true,source,store:publicStore,menu:menu||[]}),{status:200,headers:headers(req,"private, max-age=30")}); } catch(err){console.error("pos_storefront_error",err instanceof Error?err.message:"unknown");return new Response(JSON.stringify({ok:false,error:"We could not load this store right now."}),{status:500,headers:h});} });
