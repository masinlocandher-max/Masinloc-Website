import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const TURNSTILE_SECRET_KEY=Deno.env.get("TURNSTILE_SECRET_KEY")||"";
const TURNSTILE_REQUIRED=Deno.env.get("TURNSTILE_REQUIRED")==="true";

const configs={
  business:{table:"business_submissions",bucket:"masinloc-business-assets",maxFiles:1,maxFileBytes:10*1024*1024,mime:["image/jpeg","image/png","image/webp"]},
  story:{table:"story_submissions",bucket:"masinloc-story-assets",maxFiles:5,maxFileBytes:25*1024*1024,mime:["image/jpeg","image/png","image/webp","application/pdf"]},
  dictionary:{table:"dictionary_submissions",bucket:null,maxFiles:0,maxFileBytes:0,mime:[]},
  contact:{table:"contact_submissions",bucket:null,maxFiles:0,maxFileBytes:0,mime:[]},
  professional:{table:"professional_submissions",bucket:null,maxFiles:0,maxFileBytes:0,mime:[]},
  resume:{table:"resume_support_submissions",bucket:"masinloc-resume-assets",maxFiles:1,maxFileBytes:10*1024*1024,mime:["application/pdf"]},
} as const;
type Category=keyof typeof configs;
type Severity="low"|"medium"|"high"|"critical";

function originAllowed(origin:string){if(!origin)return false;if(origin==="https://masinloc-zambales.com"||origin==="https://www.masinloc-zambales.com")return true;try{const u=new URL(origin);if(u.protocol!=="https:")return false;if(u.hostname==="masinloc-website.vercel.app")return true;return u.hostname.endsWith(".vercel.app")&&(u.hostname.startsWith("masinloc-website-")||u.hostname.startsWith("masinloc-connect-"));}catch{return false}}
function corsHeaders(req:Request){const origin=req.headers.get("origin")||"";return{"Access-Control-Allow-Origin":originAllowed(origin)?origin:"null","Vary":"Origin","Access-Control-Allow-Headers":"content-type, x-client-info, apikey, authorization","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}}
function cleanName(name:string){return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").slice(-120)||"file"}
function required(payload:Record<string,unknown>,fields:string[]){for(const f of fields){if(payload[f]===undefined||payload[f]===null||String(payload[f]).trim()==="")throw new Error("VALIDATION")}}
function text(v:unknown,max:number){const s=String(v??"").trim();if(s.length>max)throw new Error("VALIDATION");return s}
function emailText(v:unknown){const s=text(v,320).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw new Error("VALIDATION");return s}
function facebookLink(v:unknown){const s=text(v,300);try{const u=new URL(s);const h=u.hostname.toLowerCase();const ok=h==="facebook.com"||h.endsWith(".facebook.com")||h==="fb.com"||h.endsWith(".fb.com")||h==="m.me"||h.endsWith(".m.me");if(u.protocol!=="https:"||!ok)throw new Error();return u.toString()}catch{throw new Error("VALIDATION")}}
async function sha256(value:string){const bytes=new TextEncoder().encode(value);const hash=await crypto.subtle.digest("SHA-256",bytes);return[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("")}
function clientIp(req:Request){return req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||(req.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim()}
function safeHeader(value:string|null,max=500){return(value||"").slice(0,max)||null}
async function logSecurityEvent(req:Request,eventType:string,severity:Severity,category:Category|null=null,metadata:Record<string,unknown>={}){try{const ip=clientIp(req)||"unknown";const ipHash=await sha256(ip);const keepRaw=severity==="high"||severity==="critical";const now=Date.now();await supabase.from("security_events").insert({event_type:eventType,severity,category,ip_hash:ipHash,ip_address:keepRaw&&ip!=="unknown"?ip:null,raw_ip_expires_at:keepRaw&&ip!=="unknown"?new Date(now+30*86400000).toISOString():null,user_agent:safeHeader(req.headers.get("user-agent")),origin:safeHeader(req.headers.get("origin")),metadata,expires_at:new Date(now+90*86400000).toISOString()});}catch(err){console.error("security_log_error",err instanceof Error?err.message:"unknown")}}
async function cleanupSecurityLogs(){const now=new Date().toISOString();await supabase.from("security_events").update({ip_address:null,raw_ip_expires_at:null}).lt("raw_ip_expires_at",now).not("ip_address","is",null);await supabase.from("security_events").delete().lt("expires_at",now)}
async function checkRate(req:Request,category:string){const fp=await sha256(`${clientIp(req)}|${category}`);const{data,error}=await supabase.rpc("check_submission_rate_limit",{p_fingerprint:fp,p_limit:8,p_window_seconds:900});if(error)throw new Error("SERVER");return data===true}
async function verifyTurnstile(req:Request,token:string){if(!TURNSTILE_REQUIRED)return true;if(!TURNSTILE_SECRET_KEY||!token)return false;const body=new URLSearchParams();body.set("secret",TURNSTILE_SECRET_KEY);body.set("response",token);const ip=clientIp(req);if(ip&&ip!=="unknown")body.set("remoteip",ip);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);try{const r=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body,signal:controller.signal});const result=await r.json();if(!result?.success)return false;if(result.action&&result.action!=="masinloc_submit")return false;if(result.hostname&&!["masinloc-zambales.com","www.masinloc-zambales.com"].includes(result.hostname)&&!String(result.hostname).endsWith(".vercel.app"))return false;return true}catch{return false}finally{clearTimeout(timer)}}
async function ensureBucket(category:Category){const cfg=configs[category];if(!cfg.bucket)return;const{data}=await supabase.storage.getBucket(cfg.bucket);if(!data){const{error}=await supabase.storage.createBucket(cfg.bucket,{public:false,fileSizeLimit:cfg.maxFileBytes,allowedMimeTypes:[...cfg.mime]});if(error&&!String(error.message).toLowerCase().includes("already exists"))throw new Error("SERVER")}}
async function validMagic(file:File){const b=new Uint8Array(await file.slice(0,16).arrayBuffer());const isJpeg=b[0]===0xff&&b[1]===0xd8&&b[2]===0xff;const isPng=b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47;const isWebp=String.fromCharCode(...b.slice(0,4))==="RIFF"&&String.fromCharCode(...b.slice(8,12))==="WEBP";const isPdf=String.fromCharCode(...b.slice(0,4))==="%PDF";if(file.type==="image/jpeg")return isJpeg;if(file.type==="image/png")return isPng;if(file.type==="image/webp")return isWebp;if(file.type==="application/pdf")return isPdf;return false}
async function uploadFiles(category:Category,form:FormData){const cfg=configs[category];const files=[...form.values()].filter((v):v is File=>v instanceof File&&v.size>0);if(files.length>cfg.maxFiles)throw new Error("UPLOAD_VALIDATION");if(!cfg.bucket)return[] as string[];await ensureBucket(category);const paths:string[]=[];const stamp=crypto.randomUUID();for(const file of files){if(file.size>cfg.maxFileBytes||!cfg.mime.includes(file.type as never)||!(await validMagic(file)))throw new Error("UPLOAD_VALIDATION");const path=`${new Date().toISOString().slice(0,10)}/${stamp}/${cleanName(file.name)}`;const{error}=await supabase.storage.from(cfg.bucket).upload(path,file,{contentType:file.type,upsert:false});if(error)throw new Error("UPLOAD");paths.push(path)}return paths}
async function cleanup(category:Category,paths:string[]){const bucket=configs[category].bucket;if(bucket&&paths.length)await supabase.storage.from(bucket).remove(paths)}

/* The public contributors roll for the Sambal Tina dictionary.
   A name appears only when the contributor asked to be credited AND an admin
   has approved the submission. Contact details are never selected, so they
   cannot leak through this endpoint even by mistake. */
async function dictionaryContributors(){
  const{data,error}=await supabase.from("dictionary_submissions")
    .select("credit_name, contributor_name, created_at")
    .eq("credit_consent",true)
    .in("status",["approved","published"])
    .order("created_at",{ascending:true})
    .limit(2000);
  if(error){console.error("contributors_db_error",error.message);throw new Error("DB")}
  const seen=new Set<string>();const names:string[]=[];
  for(const row of data??[]){
    const name=String(row.credit_name||row.contributor_name||"").trim().slice(0,160);
    if(!name)continue;
    const key=name.toLowerCase();
    if(seen.has(key))continue;
    seen.add(key);names.push(name);
  }
  return names;
}

function rowFor(category:Category,p:Record<string,any>,files:string[]){
  if(category==="business"){
    required(p,["brandName","ownerName","ownerEmail","ownerPhone","contactNumber","facebookPage","shortDescription"]);
    return{
      brand_name:text(p.brandName,120),
      brand_logo_path:files[0]||null,
      store_locations:p.storeLocations?text(p.storeLocations,1500):null,
      owner_name:text(p.ownerName,160),
      owner_email:emailText(p.ownerEmail),
      owner_phone:text(p.ownerPhone,100),
      contact_number:text(p.contactNumber,80),
      facebook_page:facebookLink(p.facebookPage),
      short_description:text(p.shortDescription,1200),
    };
  }
  if(category==="story"){
    required(p,["title","about","story","contributorName","contributorContact"]);
    return{title:text(p.title,180),about:text(p.about,300),story:text(p.story,12000),location:p.location?text(p.location,300):null,contributor_name:text(p.contributorName,160),contributor_contact:text(p.contributorContact,200),attachment_paths:files};
  }
  if(category==="dictionary"){
    required(p,["headword","contributorName","contributorContact"]);
    const submissionType=p.submissionType==="correction"?"correction":"new_entry";
    const filipino=p.filipinoMeaning?text(p.filipinoMeaning,1000):null;
    const english=p.englishMeaning?text(p.englishMeaning,1000):null;
    const details=p.contributionDetails?text(p.contributionDetails,5000):null;
    /* A headword with no meaning and no note cannot be reviewed against the
       archive, and a correction that does not say what is wrong is not a
       correction. Reject both here as well as in the browser. */
    if(!filipino&&!english&&!details)throw new Error("VALIDATION");
    if(submissionType==="correction"&&!details)throw new Error("VALIDATION");
    return{
      submission_type:submissionType,
      headword:text(p.headword,180),
      filipino_meaning:filipino,
      english_meaning:english,
      contribution_details:details,
      example_usage:p.exampleUsage?text(p.exampleUsage,3000):null,
      contributor_name:text(p.contributorName,160),
      contributor_contact:text(p.contributorContact,240),
      credit_name:p.creditName?text(p.creditName,160):null,
      credit_consent:p.creditConsent===true||p.creditConsent==="yes"||p.creditConsent==="true",
    };
  }
  if(category==="contact"){
    required(p,["senderName","senderEmail","message"]);
    const topics=["general","business","language","history","correction","media","other"];
    const topic=topics.includes(String(p.topic))?String(p.topic):"general";
    return{
      sender_name:text(p.senderName,160),
      sender_email:emailText(p.senderEmail),
      sender_phone:p.senderPhone?text(p.senderPhone,100):null,
      topic,
      subject:p.subject?text(p.subject,200):null,
      message:text(p.message,6000),
    };
  }
  if(category==="professional"){
    required(p,["fullName","profession","skills","currentLocation","contactNumber","professionalDescription","publicProfile"]);
    const publicProfile=p.publicProfile===true||p.publicProfile==="yes"||p.publicProfile==="true";
    return{full_name:text(p.fullName,160),profession:text(p.profession,200),skills:text(p.skills,2500),current_location:text(p.currentLocation,300),contact_number:text(p.contactNumber,100),professional_link:p.professionalLink?text(p.professionalLink,500):null,professional_description:text(p.professionalDescription,1800),public_profile:publicProfile,status:publicProfile?"pending":"private"};
  }
  required(p,["targetJob","education","school","workExperience"]);
  return{professional_submission_id:p.professionalSubmissionId||null,full_name:p.fullName?text(p.fullName,160):null,profession:p.profession?text(p.profession,200):null,skills:p.skills?text(p.skills,2500):null,contact_number:p.contactNumber?text(p.contactNumber,100):null,target_job:text(p.targetJob,220),preferred_location:p.preferredLocation?text(p.preferredLocation,300):null,remote_work:p.remoteWork?text(p.remoteWork,80):null,education:text(p.education,500),school:text(p.school,500),training:p.training?text(p.training,5000):null,work_experience:text(p.workExperience,10000),achievements:p.achievements?text(p.achievements,5000):null,languages:p.languages?text(p.languages,1000):null,existing_resume_path:files[0]||null};
}

Deno.serve(async(req)=>{const headers=corsHeaders(req);if(Math.random()<0.02)cleanupSecurityLogs().catch(()=>{});if(req.method==="OPTIONS")return new Response("",{status:204,headers});const origin=req.headers.get("origin")||"";if(!originAllowed(origin)){await logSecurityEvent(req,"blocked_origin","high",null,{origin:origin.slice(0,500)});return new Response(JSON.stringify({ok:false,error:"Origin not allowed"}),{status:403,headers})}
if(req.method==="GET"){const resource=new URL(req.url).searchParams.get("resource")||"";if(resource!=="dictionary-contributors"){await logSecurityEvent(req,"unknown_resource","low",null,{resource:resource.slice(0,100)});return new Response(JSON.stringify({ok:false,error:"Not found"}),{status:404,headers})}try{const contributors=await dictionaryContributors();return new Response(JSON.stringify({ok:true,contributors,count:contributors.length}),{status:200,headers:{...headers,"Cache-Control":"public, max-age=300"}})}catch{return new Response(JSON.stringify({ok:false,error:"We could not load the contributors right now."}),{status:500,headers})}}
if(req.method!=="POST"){await logSecurityEvent(req,"unsupported_method","medium",null,{method:req.method});return new Response(JSON.stringify({ok:false,error:"Method not allowed"}),{status:405,headers})}let category:Category|null=null;let uploaded:string[]=[];try{const contentLength=Number(req.headers.get("content-length")||"0");if(contentLength>30*1024*1024){await logSecurityEvent(req,"oversized_submission","high",null,{content_length:contentLength});return new Response(JSON.stringify({ok:false,error:"Submission too large"}),{status:413,headers})}const form=await req.formData();category=String(form.get("category")||"") as Category;if(!(category in configs)){await logSecurityEvent(req,"invalid_category","medium",null,{category:String(form.get("category")||"").slice(0,100)});throw new Error("VALIDATION")}if(!(await checkRate(req,category))){await logSecurityEvent(req,"rate_limit_block","high",category,{});return new Response(JSON.stringify({ok:false,error:"Too many submissions. Please try again later."}),{status:429,headers})}const turnstileToken=String(form.get("turnstileToken")||form.get("cf-turnstile-response")||"");if(!(await verifyTurnstile(req,turnstileToken))){await logSecurityEvent(req,"bot_verification_failed","medium",category,{turnstile_required:TURNSTILE_REQUIRED});return new Response(JSON.stringify({ok:false,error:"Verification failed. Please try again."}),{status:403,headers})}const raw=String(form.get("payload")||"{}");if(raw.length>25000){await logSecurityEvent(req,"oversized_payload","high",category,{payload_length:raw.length});throw new Error("VALIDATION")}const payload=JSON.parse(raw);if(payload.website){await logSecurityEvent(req,"honeypot_triggered","high",category,{});return new Response(JSON.stringify({ok:true}),{status:201,headers})}uploaded=await uploadFiles(category,form);const row=rowFor(category,payload,uploaded);const{data,error}=await supabase.from(configs[category].table).insert(row).select("id, reference_code, status").single();if(error){console.error("submission_db_error",error.message);throw new Error("DB")}return new Response(JSON.stringify({ok:true,category,...data}),{status:201,headers})}catch(err){if(category)await cleanup(category,uploaded);const code=err instanceof Error?err.message:"SERVER";console.error("submission_error",code);if(["VALIDATION","UPLOAD_VALIDATION","UPLOAD"].includes(code))await logSecurityEvent(req,code==="UPLOAD_VALIDATION"?"blocked_upload":"invalid_submission","medium",category,{error_code:code});const clientError=["VALIDATION","UPLOAD_VALIDATION","UPLOAD"].includes(code);return new Response(JSON.stringify({ok:false,error:clientError?"Please check your submission and try again.":"We could not process your submission right now."}),{status:clientError?400:500,headers})}});