import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const PROVIDER_CODE = "dmw";
const DMW_API = "https://master-api.dmw.gov.ph/api/v1/public/approved-job-orders/filter";
const DMW_PAGE = "https://dmw.gov.ph/inquiry/approved-job-orders";
// Public browser API key published by the official DMW website client. It is not a Masinloc Connect secret.
const DMW_PUBLIC_API_KEY = "RTA0X0lOWFcycm9KU29WTlZxNDUzSDY5enc5OWFxY2ktWkxVdkFwZjEyMjkwNTA2MTE";
const MIN_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RUN_LEASE_MS = 15 * 60 * 1000;
const FRESH_FOR_MS = 36 * 60 * 60 * 1000;
const MAX_PER_TERM = 5;
const TERMS = [
  "WELDER",
  "ELECTRICIAN",
  "DRIVER",
  "CAREGIVER",
  "NURSE",
  "COOK",
  "WAITER",
  "FACTORY",
  "TECHNICIAN",
  "MECHANIC",
  "HOUSEKEEPING",
  "ADMINISTRATIVE",
] as const;

type DmwRecord = {
  agency?: string | null;
  principal?: string | null;
  jobsite?: string | null;
  position?: string | null;
  balance?: string | number | null;
  data_as_of?: string | null;
  date_approved?: string | null;
  accreditation_class?: string | null;
};

type SelectedJob = {
  external_job_id: string;
  title: string;
  company: string | null;
  location: string | null;
  agency: string | null;
  principal: string | null;
  slots: number;
  data_as_of: string | null;
  date_approved: string | null;
  accreditation_class: string | null;
  source_query: string;
};

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try { key = JSON.parse(secretKeys)?.default || key; } catch { /* legacy fallback */ }
  }
  if (!url || !key) throw new Error("Supabase admin credentials are unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function clean(value: unknown, max = 300) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function slots(value: unknown) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isRecent(date: string | null) {
  if (!date) return false;
  const time = new Date(date).getTime();
  return Number.isFinite(time) && Date.now() - time < MIN_SYNC_INTERVAL_MS;
}

async function fetchTerm(term: string) {
  const url = new URL(DMW_API);
  url.searchParams.set("page", "1");
  url.searchParams.set("position", term);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "x-api-key": DMW_PUBLIC_API_KEY,
      "User-Agent": "MasinlocConnectJobs/1.0 (+https://www.masinloc-zambales.com/jobs.html)",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`DMW returned HTTP ${response.status} for ${term}.`);
  const payload = await response.json();
  const records: DmwRecord[] = Array.isArray(payload?.data) ? payload.data : [];
  const usable = records.filter((record) => clean(record.position) && slots(record.balance) > 0).slice(0, MAX_PER_TERM);
  return { term, records: usable, total: Number(payload?.meta?.total || 0) || null };
}

async function normalize(record: DmwRecord, term: string): Promise<SelectedJob | null> {
  const title = clean(record.position);
  if (!title) return null;
  const agency = clean(record.agency);
  const principal = clean(record.principal);
  const location = clean(record.jobsite);
  const remaining = slots(record.balance);
  if (!remaining) return null;
  const dateApproved = clean(record.date_approved, 80);
  const fingerprint = [agency, principal, location, title, dateApproved].map((v) => v || "").join("|").toLowerCase();
  return {
    external_job_id: await sha256Hex(fingerprint),
    title,
    company: principal || agency,
    location,
    agency,
    principal,
    slots: remaining,
    data_as_of: clean(record.data_as_of, 80),
    date_approved: dateApproved,
    accreditation_class: clean(record.accreditation_class, 120),
    source_query: term,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const supabase = adminClient();
  const presentedKey = req.headers.get("x-sync-key") || "";
  const { data: control, error: controlError } = await supabase
    .from("job_sync_control")
    .select("secret_sha256")
    .eq("provider_code", PROVIDER_CODE)
    .single();
  if (controlError || !control) return json({ ok: false, error: "Sync authorization is not configured." }, 503);
  const presentedHash = presentedKey ? await sha256Hex(presentedKey) : "";
  if (!presentedHash || !safeEqual(presentedHash, control.secret_sha256)) return json({ ok: false, error: "Unauthorized" }, 401);

  const nowIso = new Date().toISOString();
  let runId: string | null = null;
  try {
    const { data: provider, error: providerError } = await supabase
      .from("job_providers")
      .select("id,code,status,last_sync_at")
      .eq("code", PROVIDER_CODE)
      .single();
    if (providerError || !provider) throw providerError || new Error("DMW provider is not configured.");
    if (isRecent(provider.last_sync_at)) return json({ ok: true, skipped: true, reason: "A recent DMW sync already completed." });

    const leaseCutoff = new Date(Date.now() - RUN_LEASE_MS).toISOString();
    await supabase.from("job_sync_runs")
      .update({ status: "failed", finished_at: nowIso, message: "Previous DMW sync lease expired before completion." })
      .eq("provider_id", provider.id).eq("status", "running").lt("started_at", leaseCutoff);

    const { data: run, error: runError } = await supabase.from("job_sync_runs")
      .insert({ provider_id: provider.id, status: "running", metadata: { trigger: "scheduled_dmw_public_api" } })
      .select("id").single();
    if (runError) {
      if (runError.code === "23505") return json({ ok: true, skipped: true, reason: "Another DMW sync is already running." });
      throw runError;
    }
    runId = run.id;

    const settled = await Promise.allSettled(TERMS.map(fetchTerm));
    const deduped = new Map<string, SelectedJob>();
    const sourceStats: unknown[] = [];
    let sourceItemsSeen = 0;
    let failedTargets = 0;

    for (const result of settled) {
      if (result.status === "rejected") {
        failedTargets += 1;
        sourceStats.push({ error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
        continue;
      }
      sourceItemsSeen += result.value.records.length;
      sourceStats.push({ query: result.value.term, returned: result.value.records.length, source_total: result.value.total });
      for (const record of result.value.records) {
        const normalized = await normalize(record, result.value.term);
        if (!normalized) continue;
        const existing = deduped.get(normalized.external_job_id);
        if (!existing || normalized.slots > existing.slots) deduped.set(normalized.external_job_id, normalized);
      }
    }

    if (!deduped.size) throw new Error("No usable approved DMW job orders were returned by the curated searches.");
    const selected = [...deduped.values()].slice(0, TERMS.length * MAX_PER_TERM);
    const selectedIds = selected.map((job) => job.external_job_id);
    const { data: existingRows, error: existingError } = await supabase.from("external_jobs")
      .select("external_job_id").eq("provider_id", provider.id).in("external_job_id", selectedIds);
    if (existingError) throw existingError;
    const existingIds = new Set((existingRows || []).map((row) => row.external_job_id));

    const freshUntil = new Date(Date.now() + FRESH_FOR_MS).toISOString();
    const rows = selected.map((job) => ({
      provider_id: provider.id,
      external_job_id: job.external_job_id,
      title: job.title,
      company: job.company,
      location: job.location,
      work_setup: "On-site abroad",
      employment_type: "Overseas",
      salary_text: null,
      description_excerpt: `${job.title} opportunity in ${job.location || "an overseas location"}${job.principal ? ` with ${job.principal}` : ""}. Recruitment is handled by ${job.agency || "a licensed recruitment agency listed by DMW"}.`.slice(0, 4000),
      requirements_excerpt: `DMW data shows ${job.slots} approved job-order slot${job.slots === 1 ? "" : "s"} remaining in the source data. Verify that the job order is still active with the licensed recruitment agency and review all agency requirements before applying.`.slice(0, 4000),
      published_at: null,
      expires_at: null,
      source_url: DMW_PAGE,
      apply_url: DMW_PAGE,
      canonical_key: `dmw:${job.external_job_id}`,
      last_verified_at: nowIso,
      cache_expires_at: freshUntil,
      provider_metadata: {
        auto_synced: true,
        overseas: true,
        source_kind: "official_public_api",
        recruitment_agency: job.agency,
        principal: job.principal,
        slots_remaining: job.slots,
        data_as_of: job.data_as_of,
        date_approved: job.date_approved,
        accreditation_class: job.accreditation_class,
        source_query: job.source_query,
        attribution: "Department of Migrant Workers approved job orders",
      },
      is_active: true,
      updated_at: nowIso,
      verification_status: "live",
      source_checked_at: nowIso,
      verification_method: "provider_api",
      stale_after: freshUntil,
      last_seen_active_at: nowIso,
      curator_note: "Automatically refreshed from the DMW public approved-job-orders API. Applicants must verify current availability with the licensed recruitment agency.",
    }));

    for (let i = 0; i < rows.length; i += 30) {
      const { error } = await supabase.from("external_jobs")
        .upsert(rows.slice(i, i + 30), { onConflict: "provider_id,external_job_id" });
      if (error) throw error;
    }

    const { data: expiredRows, error: expireError } = await supabase.from("external_jobs")
      .update({ is_active: false, verification_status: "expired", updated_at: nowIso })
      .eq("provider_id", provider.id).eq("is_active", true)
      .contains("provider_metadata", { auto_synced: true }).lt("stale_after", nowIso).select("id");
    if (expireError) throw expireError;

    const inserted = selectedIds.filter((id) => !existingIds.has(id)).length;
    const updated = selected.length - inserted;
    const runStatus = failedTargets ? "partial" : "success";
    const message = failedTargets
      ? `Refreshed ${selected.length} curated overseas opportunities; ${failedTargets} DMW search(es) failed.`
      : `Refreshed ${selected.length} curated overseas opportunities from the DMW public API.`;

    await Promise.all([
      supabase.from("job_providers").update({ last_sync_at: nowIso, updated_at: nowIso }).eq("id", provider.id),
      supabase.from("job_sync_runs").update({
        finished_at: new Date().toISOString(),
        status: runStatus,
        source_items_seen: sourceItemsSeen,
        jobs_selected: selected.length,
        jobs_inserted: inserted,
        jobs_updated: updated,
        jobs_expired: (expiredRows || []).length,
        pages_fetched: TERMS.length,
        message,
        metadata: { source_stats: sourceStats, freshness_hours: FRESH_FOR_MS / 3600000, max_per_term: MAX_PER_TERM },
      }).eq("id", runId),
    ]);

    return json({ ok: true, status: runStatus, provider: PROVIDER_CODE, unique_jobs_refreshed: selected.length, inserted, updated, expired: (expiredRows || []).length, failed_targets: failedTargets });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("jobs_supply_sync_dmw_error", message);
    if (runId) {
      try { await supabase.from("job_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), message: message.slice(0, 1000) }).eq("id", runId); } catch { /* best effort */ }
    }
    return json({ ok: false, error: "The DMW jobs refresh failed.", detail: message }, 500);
  }
});
