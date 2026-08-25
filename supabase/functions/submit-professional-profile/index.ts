import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const SECURITY_HASH_KEY = Deno.env.get("SECURITY_HASH_KEY") || SERVICE_ROLE_KEY;
const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
const TURNSTILE_REQUIRED = Deno.env.get("TURNSTILE_REQUIRED") === "true";
const ALLOWED_ORIGINS = new Set([
  "https://masinloc-zambales.com",
  "https://www.masinloc-zambales.com",
  "https://masinloc-website.vercel.app",
]);
const MASINLOC_BARANGAYS = new Set([
  "Baloganon","Bamban","Bani","Collat","Inhobol","North Poblacion","San Lorenzo",
  "San Salvador","Santa Rita","Santo Rosario","South Poblacion","Taltal","Tapuac",
]);
const QUESTION_LABELS: Record<string,string> = {
  barangay: "Anong barangay ang inilagay mo sa dati mong profile?",
  addressLine: "Ano ang house number, street, purok, o sitio na inilagay mo?",
  targetJob: "Anong trabaho ang gusto mong pasukan noong gumawa ka ng profile?",
  education: "Hanggang saan ang inilagay mong naabot sa pag-aaral?",
  lastRole: "Ano ang inilagay mong dati mong trabaho o role?",
  workType: "Anong klaseng trabaho ang pinili mo?",
  school: "Anong school ang inilagay mo?",
  course: "Anong course, strand, o program ang inilagay mo?",
};
const QUESTION_PRIORITY = ["barangay","addressLine","targetJob","education","lastRole","workType","school","course"];

type Severity = "low" | "medium" | "high" | "critical";

function originAllowed(origin: string) {
  return ALLOWED_ORIGINS.has(origin);
}
function headers(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": originAllowed(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "content-type, x-client-info, apikey, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
  };
}
function text(value: unknown, max: number, required = false) {
  const s = String(value ?? "").trim();
  if ((required && !s) || s.length > max) throw new Error("VALIDATION");
  return s || null;
}
function safeObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
function normalizeEmail(value: unknown) {
  const s = String(value ?? "").trim().toLowerCase();
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error("VALIDATION");
  return s || null;
}
function normalizeMobile(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0063")) digits = digits.slice(2);
  if (digits.startsWith("09") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith("639") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("9") && digits.length === 10) return `+63${digits}`;
  return digits ? `+${digits}` : null;
}
function normalizeAnswer(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function parseMasinlocAddress(value: string) {
  const match = value.match(/^(.+), Brgy\. (.+), Masinloc, Zambales 2211$/);
  if (!match) throw new Error("MASINLOC_ADDRESS");
  const addressLine = match[1].trim();
  const barangay = match[2].trim();
  if (!addressLine || addressLine.length > 180 || !MASINLOC_BARANGAYS.has(barangay)) throw new Error("MASINLOC_ADDRESS");
  return { addressLine, barangay, municipality: "Masinloc", province: "Zambales", postalCode: "2211" };
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
function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}
async function consumeRate(fingerprint: string, limit: number, windowSeconds = 900) {
  const { data, error } = await supabase.rpc("check_submission_rate_limit", { p_fingerprint: fingerprint, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) throw new Error("SERVER");
  return data === true;
}
async function checkRate(req: Request) {
  const perIp = await hmac256(`${clientIp(req)}|professional-profile`);
  if (!(await consumeRate(perIp, 12))) return false;
  const global = await hmac256("global|professional-profile");
  return consumeRate(global, 1800);
}
async function logSecurityEvent(req: Request, eventType: string, severity: Severity, metadata: Record<string, unknown> = {}) {
  try {
    const ip = clientIp(req) || "unknown";
    const ipHash = await hmac256(ip);
    const keepRaw = (severity === "high" || severity === "critical") && ip !== "unknown";
    await supabase.from("security_events").insert({
      event_type: eventType,
      severity,
      category: "professional",
      ip_hash: ipHash,
      ip_address: keepRaw ? ip : null,
      raw_ip_expires_at: keepRaw ? new Date(Date.now() + 30 * 86400000).toISOString() : null,
      user_agent: (req.headers.get("user-agent") || "").slice(0, 500) || null,
      origin: (req.headers.get("origin") || "").slice(0, 500) || null,
      metadata,
      expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
    });
  } catch (error) {
    console.error("professional_security_log_error", error instanceof Error ? error.message : "unknown");
  }
}
async function verifyTurnstile(req: Request, token: string) {
  if (!TURNSTILE_REQUIRED) return true;
  if (!TURNSTILE_SECRET_KEY || !token) return false;
  const body = new URLSearchParams();
  body.set("secret", TURNSTILE_SECRET_KEY);
  body.set("response", token);
  const ip = clientIp(req);
  if (ip && ip !== "unknown") body.set("remoteip", ip);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: controller.signal });
    const result = await r.json();
    if (!result?.success) return false;
    if (result.hostname && !ALLOWED_ORIGINS.has(`https://${String(result.hostname)}`)) return false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
function chooseQuestions(payload: Record<string,unknown>) {
  const pool = QUESTION_PRIORITY.filter((key) => normalizeAnswer(payload[key]));
  const selected: string[] = [];
  while (selected.length < 3 && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    selected.push(pool.splice(i, 1)[0]);
  }
  return selected;
}
function publicQuestions(keys: string[]) {
  return keys.map((key) => ({ key, question: QUESTION_LABELS[key] || "Ano ang sagot na inilagay mo dati?" }));
}
async function findDuplicate(normalizedMobile: string | null, normalizedEmail: string | null) {
  let mobileMatch: any = null;
  let emailMatch: any = null;
  if (normalizedMobile) {
    const { data } = await supabase.from("professional_submissions").select("id,reference_code,normalized_mobile,normalized_email,profile_payload").eq("normalized_mobile", normalizedMobile).neq("status","archived").order("created_at", { ascending: true }).limit(1).maybeSingle();
    mobileMatch = data;
  }
  if (normalizedEmail) {
    const { data } = await supabase.from("professional_submissions").select("id,reference_code,normalized_mobile,normalized_email,profile_payload").eq("normalized_email", normalizedEmail).neq("status","archived").order("created_at", { ascending: true }).limit(1).maybeSingle();
    emailMatch = data;
  }
  if (mobileMatch && emailMatch && mobileMatch.id !== emailMatch.id) return { conflict: true, profile: null };
  return { conflict: false, profile: mobileMatch || emailMatch };
}
async function createChallenge(profile: any) {
  const payload = safeObject(profile.profile_payload);
  const questionKeys = chooseQuestions(payload);
  const { data, error } = await supabase.from("professional_recovery_challenges").insert({ profile_id: profile.id, question_keys: questionKeys }).select("id").single();
  if (error) throw new Error("SERVER");
  return { id: data.id, questionKeys };
}
async function getChallenge(id: string) {
  const { data: challenge, error } = await supabase.from("professional_recovery_challenges").select("id,profile_id,question_keys,attempts,expires_at").eq("id", id).maybeSingle();
  if (error || !challenge) throw new Error("CHALLENGE");
  if (new Date(challenge.expires_at).getTime() < Date.now() || challenge.attempts >= 5) throw new Error("CHALLENGE");
  const { data: profile, error: profileError } = await supabase.from("professional_submissions").select("id,reference_code,normalized_email,profile_payload").eq("id", challenge.profile_id).maybeSingle();
  if (profileError || !profile) throw new Error("CHALLENGE");
  return { challenge, profile };
}
async function bumpAttempts(id: string, attempts: number) {
  await supabase.from("professional_recovery_challenges").update({ attempts: Math.min(attempts + 1, 5) }).eq("id", id);
}

Deno.serve(async (req) => {
  const h = headers(req);
  /* A 204 carries no body. Returning "" made some browsers treat the
     preflight as malformed and drop the request before it was sent — the
     same fault PR #29 repaired in submit-masinloc and
     business-dashboard-interest. This function was not fixed with them
     because its source was not in the repository at the time. */
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") {
    await logSecurityEvent(req, "unsupported_method", "medium", { method: req.method });
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers: h });
  }
  const origin = req.headers.get("origin") || "";
  if (!originAllowed(origin)) {
    await logSecurityEvent(req, "blocked_origin", "high");
    return new Response(JSON.stringify({ ok: false, error: "Origin not allowed" }), { status: 403, headers: h });
  }

  try {
    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > 64 * 1024) {
      await logSecurityEvent(req, "oversized_submission", "high", { content_length: contentLength });
      throw new Error("VALIDATION");
    }
    if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
      await logSecurityEvent(req, "invalid_submission", "medium", { reason: "content_type" });
      return new Response(JSON.stringify({ ok: false, error: "Unsupported content type" }), { status: 415, headers: h });
    }
    if (!(await checkRate(req))) {
      await logSecurityEvent(req, "rate_limit_block", "high");
      return new Response(JSON.stringify({ ok: false, error: "Too many attempts. Please try again later." }), { status: 429, headers: h });
    }
    const body = await req.json();
    const mode = String(body?.mode || "submit");

    if (mode === "verify_email") {
      const challengeId = text(body?.challengeId, 100, true)!;
      const enteredEmail = normalizeEmail(body?.email);
      const { challenge, profile } = await getChallenge(challengeId);
      if (enteredEmail && profile.normalized_email && enteredEmail === profile.normalized_email) {
        await supabase.from("professional_recovery_challenges").delete().eq("id", challengeId);
        return new Response(JSON.stringify({ ok: true, duplicate_verified: true, reference_code: profile.reference_code }), { status: 200, headers: h });
      }
      await bumpAttempts(challengeId, challenge.attempts);
      return new Response(JSON.stringify({ ok: true, duplicate: true, verification_step: "questions", challenge_id: challengeId, questions: publicQuestions(challenge.question_keys || []) }), { status: 200, headers: h });
    }

    if (mode === "verify_answers") {
      const challengeId = text(body?.challengeId, 100, true)!;
      const answers = safeObject(body?.answers);
      const { challenge, profile } = await getChallenge(challengeId);
      const stored = safeObject(profile.profile_payload);
      const keys: string[] = Array.isArray(challenge.question_keys) ? challenge.question_keys : [];
      let correct = 0;
      for (const key of keys) {
        const expected = normalizeAnswer(stored[key]);
        const received = normalizeAnswer(answers[key]);
        if (expected && received && expected === received) correct += 1;
      }
      if (keys.length >= 2 && correct >= 2) {
        await supabase.from("professional_recovery_challenges").delete().eq("id", challengeId);
        return new Response(JSON.stringify({ ok: true, duplicate_verified: true, reference_code: profile.reference_code }), { status: 200, headers: h });
      }
      await bumpAttempts(challengeId, challenge.attempts);
      const nextAttempts = challenge.attempts + 1;
      if (nextAttempts >= 5) return new Response(JSON.stringify({ ok: true, duplicate: true, verification_step: "manual", message: "Hindi namin ma-confirm nang automatic ang existing profile. Kailangan muna itong i-review." }), { status: 200, headers: h });
      return new Response(JSON.stringify({ ok: true, duplicate: true, verification_step: "questions", challenge_id: challengeId, questions: publicQuestions(keys), message: "May sagot na hindi tumugma. Pakisubukan ulit." }), { status: 200, headers: h });
    }

    if (!(await verifyTurnstile(req, String(body?.turnstileToken || "")))) {
      await logSecurityEvent(req, "bot_verification_failed", "medium", { turnstile_required: TURNSTILE_REQUIRED });
      return new Response(JSON.stringify({ ok: false, error: "Verification failed. Please try again." }), { status: 403, headers: h });
    }
    const payload = safeObject(body?.payload);
    if (JSON.stringify(payload).length > 50000) throw new Error("VALIDATION");
    if (payload.website) {
      await logSecurityEvent(req, "honeypot_triggered", "high");
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: h });
    }

    const fullName = text(payload.fullName, 160, true)!;
    const targetJob = text(payload.targetJob, 200, true)!;
    const skills = text(payload.skills, 2500, true)!;
    const currentLocation = text(payload.currentLocation, 300, true)!;
    const address = parseMasinlocAddress(currentLocation);
    const contactNumber = text(payload.contactNumber, 100, true)!;
    const email = text(payload.email, 320, false);
    const normalizedMobile = normalizeMobile(contactNumber);
    const normalizedEmail = normalizeEmail(email);
    const professionalLink = text(payload.professionalLink, 500, false);
    const professionalDescription = text(payload.professionalDescription || targetJob, 1800, true)!;
    const submittedProfilePayload = safeObject(payload.profilePayload);
    const profilePayload = {
      ...submittedProfilePayload,
      addressLine: address.addressLine,
      barangay: address.barangay,
      municipality: address.municipality,
      province: address.province,
      postalCode: address.postalCode,
      jobSeekingStatus: "looking",
      employerSharingRule: "automatic_when_job_seeking",
    };
    const resumeSnapshot = safeObject(payload.resumeSnapshot);

    const duplicate = await findDuplicate(normalizedMobile, normalizedEmail);
    if (duplicate.conflict) return new Response(JSON.stringify({ ok: true, duplicate: true, verification_step: "manual", message: "May nakita kaming magkaibang existing profile na tumutugma sa contact details. Kailangan muna itong i-review." }), { status: 200, headers: h });
    if (duplicate.profile) {
      const challenge = await createChallenge(duplicate.profile);
      const hasStoredEmail = !!duplicate.profile.normalized_email;
      return new Response(JSON.stringify({ ok: true, duplicate: true, verification_step: hasStoredEmail ? "email" : "questions", challenge_id: challenge.id, questions: hasStoredEmail ? undefined : publicQuestions(challenge.questionKeys), message: "May nakita kaming existing Masinloc Connect profile na maaaring iyo. Hindi muna kami gagawa ng panibagong profile para maiwasan ang duplicate." }), { status: 200, headers: h });
    }

    const { data, error } = await supabase.from("professional_submissions").insert({
      full_name: fullName,
      profession: targetJob,
      skills,
      current_location: currentLocation,
      contact_number: contactNumber,
      email,
      normalized_mobile: normalizedMobile,
      normalized_email: normalizedEmail,
      professional_link: professionalLink,
      professional_description: professionalDescription,
      public_profile: false,
      status: "private",
      job_seeking_status: "looking",
      profile_payload: profilePayload,
      resume_snapshot: resumeSnapshot,
      final_reviewed_at: new Date().toISOString(),
    }).select("id, reference_code, status, job_seeking_status, employer_sharing_consent").single();
    if (error) { console.error("professional_profile_insert_error", error.message); throw new Error("DB"); }
    return new Response(JSON.stringify({ ok: true, ...data }), { status: 201, headers: h });
  } catch (err) {
    const code = err instanceof Error ? err.message : "SERVER";
    console.error("professional_profile_error", code);
    if (code === "VALIDATION") await logSecurityEvent(req, "invalid_submission", "medium", { error_code: code });
    if (code === "MASINLOC_ADDRESS") return new Response(JSON.stringify({ ok: false, error: "Professional profiles are for Masinloc, Zambales residents only. Please check your Masinloc address." }), { status: 400, headers: h });
    if (code === "CHALLENGE") return new Response(JSON.stringify({ ok: false, error: "This verification session expired. Please start again." }), { status: 410, headers: h });
    const clientError = code === "VALIDATION";
    return new Response(JSON.stringify({ ok: false, error: clientError ? "Please check your information and try again." : "We could not process your profile right now." }), { status: clientError ? 400 : 500, headers: h });
  }
});
