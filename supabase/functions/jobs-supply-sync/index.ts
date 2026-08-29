import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const SOURCE = "https://philjobnet.gov.ph/job-vacancies/";
const PROVIDER_CODE = "philjobnet";
const MIN_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RUN_LEASE_MS = 15 * 60 * 1000;
const FRESH_FOR_MS = 48 * 60 * 60 * 1000;
const SOURCE_HEADERS = { Accept: "text/html,application/xhtml+xml", "User-Agent": "MasinlocConnectJobs/1.0 (+https://www.masinloc-zambales.com/jobs.html)" };
const TARGETS = [
  { term: "MASINLOC", pages: 1, priority: 150, label: "Masinloc" },
  { term: "ZAMBALES", pages: 3, priority: 120, label: "Zambales" },
  { term: "PAMPANGA", pages: 2, priority: 100, label: "Pampanga / Clark" },
  { term: "WORK FROM HOME", pages: 1, priority: 85, label: "Work from home" },
  { term: "BATAAN", pages: 1, priority: 75, label: "Bataan" },
  { term: "MANILA", pages: 1, priority: 60, label: "Metro Manila" },
] as const;

type ParsedJob = { external_job_id:string; title:string; company:string|null; location:string|null; education:string|null; employment_type:string|null; work_setup:string|null; salary_text:string|null; published_at:string|null; source_url:string; source_queries:string[]; priority:number };

function adminClient(){
  const url=Deno.env.get("SUPABASE_URL")!;
  let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const secretKeys=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(secretKeys){try{key=JSON.parse(secretKeys)?.default||key}catch{/* legacy fallback */}}
  if(!url||!key)throw new Error("Supabase admin credentials are unavailable.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})}
async function sha256Hex(value:string){const bytes=new TextEncoder().encode(value);const hash=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("")}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
function decodeHtml(value:string){return value.replace(/&nbsp;/gi," ").replace(/&#39;/g,"'").replace(/&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&#8369;/g,"₱").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")}
function cleanHtml(value:string){return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim()}
function hiddenValue(html:string,name:string){const escaped=name.replace(/[$]/g,"\\$&");const first=html.match(new RegExp(`<input[^>]+name=["']${escaped}["'][^>]+value=["']([^"']*)["']`,"i"));const second=html.match(new RegExp(`<input[^>]+value=["']([^"']*)["'][^>]+name=["']${escaped}["']`,"i"));return decodeHtml(first?.[1]||second?.[1]||"")}
function viewStateBody(html:string){const body=new URLSearchParams();for(const name of ["__VIEWSTATE","__VIEWSTATEGENERATOR","__VIEWSTATEENCRYPTED","__EVENTVALIDATION"]){const value=hiddenValue(html,name);if(value!==""||name==="__VIEWSTATEENCRYPTED")body.set(name,value)}return body}
function classText(html:string,className:string){const match=html.match(new RegExp(`<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,"i"));const value=match?cleanHtml(match[1]):"";return value||null}
function iconText(html:string,iconClass:string){const match=html.match(new RegExp(`<i[^>]+class=["'][^"']*\\b${iconClass}\\b[^"']*["'][^>]*><\\/i>([\\s\\S]*?)(?=<\\/div>)`,"i"));const value=match?cleanHtml(match[1]):"";return value||null}
function parseDate(value:string|null){if(!value)return null;const match=value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(!match)return null;const [,month,day,year]=match;return new Date(Date.UTC(Number(year),Number(month)-1,Number(day),4,0,0)).toISOString()}
function parseCards(html:string,target:(typeof TARGETS)[number]):ParsedJob[]{const jobs:ParsedJob[]=[];for(const match of html.matchAll(/<a href=["']([^"']*\/job-vacancies\/job\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){const href=decodeHtml(match[1]);const inner=match[2];const externalId=href.match(/-(\d+)\/?$/)?.[1];const title=classText(inner,"jobtitle");if(!externalId||!title)continue;const salaryRaw=classText(inner,"salary");const company=classText(inner,"companytitle");const location=iconText(inner,"bi-geo-alt");const education=iconText(inner,"bi-mortarboard");const typeRaw=iconText(inner,"bi-file-text");const postedRaw=iconText(inner,"bi-files");const workFromHome=/work from home|online job|remote/i.test(`${typeRaw||""} ${location||""} ${title}`);jobs.push({external_job_id:externalId,title:title.slice(0,300),company:company?.slice(0,300)||null,location:location?.slice(0,300)||null,education:education?.slice(0,300)||null,employment_type:typeRaw?.slice(0,120)||null,work_setup:workFromHome?"Work from home":null,salary_text:salaryRaw&&!/salary not specified/i.test(salaryRaw)?salaryRaw.slice(0,300):null,published_at:parseDate(postedRaw),source_url:new URL(href,SOURCE).href,source_queries:[target.label],priority:target.priority})}return jobs}
async function fetchHtml(url:string,init?:RequestInit){const response=await fetch(url,{...init,headers:{...SOURCE_HEADERS,...(init?.headers||{})},signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`PhilJobNet returned HTTP ${response.status}.`);return await response.text()}
async function fetchTarget(baseHtml:string,target:(typeof TARGETS)[number]){const results:ParsedJob[]=[];const counts:{query:string;count:number|null;pages:number}={query:target.label,count:null,pages:0};const searchBody=viewStateBody(baseHtml);searchBody.set("ctl00$BodyContentPlaceHolder$searchterm",target.term);searchBody.set("ctl00$BodyContentPlaceHolder$Button1","Search");let currentHtml=await fetchHtml(SOURCE,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:searchBody.toString()});counts.pages+=1;const countMatch=cleanHtml(currentHtml).match(/([\d,]+)\s+job openings/i);counts.count=countMatch?Number(countMatch[1].replace(/,/g,"")):null;results.push(...parseCards(currentHtml,target));for(let page=2;page<=target.pages;page+=1){if(counts.count!==null&&results.length>=counts.count)break;const body=viewStateBody(currentHtml);body.set("__EVENTTARGET","ctl00$BodyContentPlaceHolder$GridView1");body.set("__EVENTARGUMENT",`Page$${page}`);body.set("ctl00$BodyContentPlaceHolder$searchterm",target.term);currentHtml=await fetchHtml(SOURCE,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});counts.pages+=1;results.push(...parseCards(currentHtml,target))}return{jobs:results,stats:counts}}
function isRecent(date:string|null){if(!date)return false;const time=new Date(date).getTime();return Number.isFinite(time)&&Date.now()-time<MIN_SYNC_INTERVAL_MS}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"Method not allowed"},405);
  const supabase=adminClient();
  const presentedKey=req.headers.get("x-sync-key")||"";
  const {data:control,error:controlError}=await supabase.from("job_sync_control").select("secret_sha256").eq("provider_code",PROVIDER_CODE).single();
  if(controlError||!control) return json({ok:false,error:"Sync authorization is not configured."},503);
  const presentedHash=presentedKey?await sha256Hex(presentedKey):"";
  if(!presentedHash||!safeEqual(presentedHash,control.secret_sha256)) return json({ok:false,error:"Unauthorized"},401);

  const nowIso=new Date().toISOString();let runId:string|null=null;
  try{
    const {data:provider,error:providerError}=await supabase.from("job_providers").select("id,code,status,last_sync_at").eq("code",PROVIDER_CODE).single();
    if(providerError||!provider)throw providerError||new Error("PhilJobNet provider is not configured.");
    if(isRecent(provider.last_sync_at))return json({ok:true,skipped:true,reason:"A recent official-source sync already completed."});
    const leaseCutoff=new Date(Date.now()-RUN_LEASE_MS).toISOString();
    await supabase.from("job_sync_runs").update({status:"failed",finished_at:nowIso,message:"Previous sync lease expired before completion."}).eq("provider_id",provider.id).eq("status","running").lt("started_at",leaseCutoff);
    const {data:run,error:runError}=await supabase.from("job_sync_runs").insert({provider_id:provider.id,status:"running",metadata:{trigger:"scheduled_official_source"}}).select("id").single();
    if(runError){if(runError.code==="23505")return json({ok:true,skipped:true,reason:"Another sync is already running."});throw runError}runId=run.id;
    const baseHtml=await fetchHtml(SOURCE);const settled=await Promise.allSettled(TARGETS.map(target=>fetchTarget(baseHtml,target)));const deduped=new Map<string,ParsedJob>();const sourceStats:unknown[]=[];let pagesFetched=1;let sourceItemsSeen=0;let failedTargets=0;
    settled.forEach((result,index)=>{const target=TARGETS[index];if(result.status==="rejected"){failedTargets+=1;sourceStats.push({query:target.label,error:result.reason instanceof Error?result.reason.message:String(result.reason)});return}pagesFetched+=result.value.stats.pages;sourceStats.push(result.value.stats);sourceItemsSeen+=result.value.jobs.length;for(const job of result.value.jobs){const existing=deduped.get(job.external_job_id);if(!existing){deduped.set(job.external_job_id,job);continue}const queries=[...new Set([...existing.source_queries,...job.source_queries])];if(job.priority>existing.priority)deduped.set(job.external_job_id,{...job,source_queries:queries});else existing.source_queries=queries}});
    if(!deduped.size)throw new Error("No parseable PhilJobNet vacancies were returned by the targeted searches.");
    const selected=[...deduped.values()].sort((a,b)=>{const masinlocA=/masinloc/i.test(a.location||"")?1:0;const masinlocB=/masinloc/i.test(b.location||"")?1:0;if(masinlocA!==masinlocB)return masinlocB-masinlocA;if(a.priority!==b.priority)return b.priority-a.priority;return new Date(b.published_at||0).getTime()-new Date(a.published_at||0).getTime()});
    const selectedIds=selected.map(job=>job.external_job_id);const {data:existingRows,error:existingError}=await supabase.from("external_jobs").select("external_job_id").eq("provider_id",provider.id).in("external_job_id",selectedIds);if(existingError)throw existingError;const existingIds=new Set((existingRows||[]).map(row=>row.external_job_id));
    const freshUntil=new Date(Date.now()+FRESH_FOR_MS).toISOString();const rows=selected.map(job=>({provider_id:provider.id,external_job_id:job.external_job_id,title:job.title,company:job.company,location:job.location,work_setup:job.work_setup,employment_type:job.employment_type,salary_text:job.salary_text,description_excerpt:null,requirements_excerpt:job.education&&!/educ level not specified/i.test(job.education)?`Education listed for this opportunity: ${job.education}`:null,published_at:job.published_at,expires_at:null,source_url:job.source_url,apply_url:job.source_url,canonical_key:`philjobnet:${job.external_job_id}`,last_verified_at:nowIso,cache_expires_at:freshUntil,provider_metadata:{auto_synced:true,source_kind:"official_public_listing",source_queries:job.source_queries,education:job.education,attribution:"PhilJobNet / Bureau of Local Employment, DOLE"},is_active:true,updated_at:nowIso,verification_status:"live",source_checked_at:nowIso,verification_method:"official_source",stale_after:freshUntil,last_seen_active_at:nowIso,curator_note:"Automatically refreshed from the official public vacancy listing. The original application source remains authoritative."}));
    for(let i=0;i<rows.length;i+=40){const chunk=rows.slice(i,i+40);const {error}=await supabase.from("external_jobs").upsert(chunk,{onConflict:"provider_id,external_job_id"});if(error)throw error}
    const {data:expiredRows,error:expireError}=await supabase.from("external_jobs").update({is_active:false,verification_status:"expired",updated_at:nowIso}).eq("provider_id",provider.id).eq("is_active",true).contains("provider_metadata",{auto_synced:true}).lt("stale_after",nowIso).select("id");if(expireError)throw expireError;
    const inserted=selectedIds.filter(id=>!existingIds.has(id)).length;const updated=selected.length-inserted;const runStatus=failedTargets?"partial":"success";const message=failedTargets?`Refreshed ${selected.length} unique opportunities; ${failedTargets} targeted search(es) failed.`:`Refreshed ${selected.length} unique opportunities for Masinloc Connect.`;
    await Promise.all([supabase.from("job_providers").update({last_sync_at:nowIso,updated_at:nowIso}).eq("id",provider.id),supabase.from("job_sync_runs").update({finished_at:new Date().toISOString(),status:runStatus,source_items_seen:sourceItemsSeen,jobs_selected:selected.length,jobs_inserted:inserted,jobs_updated:updated,jobs_expired:(expiredRows||[]).length,pages_fetched:pagesFetched,message,metadata:{source_stats:sourceStats,freshness_hours:FRESH_FOR_MS/3600000}}).eq("id",runId)]);
    return json({ok:true,status:runStatus,provider:PROVIDER_CODE,source_items_seen:sourceItemsSeen,unique_jobs_refreshed:selected.length,inserted,updated,expired:(expiredRows||[]).length,pages_fetched:pagesFetched,failed_targets:failedTargets});
  }catch(error){const message=error instanceof Error?error.message:String(error);console.error("jobs_supply_sync_error",message);if(runId){try{await supabase.from("job_sync_runs").update({status:"failed",finished_at:new Date().toISOString(),message:message.slice(0,1000)}).eq("id",runId)}catch{}}return json({ok:false,error:"The jobs refresh failed.",detail:message},500)}
});