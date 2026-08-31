/* PNP and MDRRMO desk consoles.

   One file, two consoles. The desk is read off the body, and every query is
   scoped to it — but that scoping is convenience, not security. The boundary
   is the RLS policy on assistance_reports, which lets a signed-in officer read
   only the desk they are a member of. If this file asked for another desk's
   reports it would get an empty list, not somebody else's queue.

   WHAT THIS CONSOLE DELIBERATELY CANNOT DO. It cannot edit the text of a
   report, and it cannot delete one. A resident's account of what happened is
   the record; an officer adds to it with notes and moves it through its
   statuses, and both are written to an append-only history. Nor is there a
   control for marking a report acknowledged: the database stamps that on the
   first move off 'submitted', which is what makes the resident-facing "nobody
   has opened it yet" a fact rather than a hope.
*/
import { createClient } from './assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL = 'https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const $ = (selector) => document.querySelector(selector);
const DESK = document.body.dataset.desk;
const DESK_NAME = document.body.dataset.deskName;

const KINDS = {
  blotter_followup: 'Following up an earlier report',
  safety_concern: 'Public safety concern',
  hazard_report: 'Hazard, not an active emergency',
  assistance_request: 'Requesting assistance',
  information: 'Question for the desk',
};
const STATUS_LABEL = {
  submitted: 'New', received: 'Opened', in_progress: 'Working', closed: 'Closed',
};

let reports = [];
let selectedId = null;
let filter = 'all';
let query = '';

/* --- views -------------------------------------------------------------- */

const show = (view) => {
  $('#authView').hidden = view !== 'auth';
  $('#deniedView').hidden = view !== 'denied';
  $('#deskView').hidden = view !== 'desk';
  $('#signOutBtn').hidden = view === 'auth';
};

/* --- sign in ------------------------------------------------------------ */

$('#authForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = String($('#deskEmail').value || '').trim().toLowerCase();
  const message = $('#authMessage');
  if (!email.includes('@')) {
    message.textContent = 'Enter the work address your account was issued to.';
    return;
  }
  const button = $('#sendLinkBtn');
  button.disabled = true;
  button.textContent = 'Sending…';
  /* shouldCreateUser:false — this console never mints an account. A desk
     officer is added to the roster out of band; typing an address here must
     not be a way to create one. */
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/${DESK}-desk.html` },
  });
  message.textContent = error
    ? 'Could not send a sign-in link to that address.'
    : 'Check your email for the secure sign-in link.';
  button.disabled = false;
  button.textContent = 'Send secure sign-in link';
});

const signOut = async () => { await supabase.auth.signOut(); location.reload(); };
$('#signOutBtn')?.addEventListener('click', signOut);
$('#deniedSignOutBtn')?.addEventListener('click', signOut);

/* --- membership --------------------------------------------------------- */

async function start() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { show('auth'); return; }

  $('#deskAccount').textContent = user.email || 'Signed in';

  /* Membership is asked of the database rather than read from a token claim,
     so removing somebody from the roster takes effect on their next load
     instead of when their session happens to expire. */
  const { data, error } = await supabase
    .from('assistance_desk_members')
    .select('desk_code')
    .eq('desk_code', DESK)
    .maybeSingle();

  if (error || !data) { show('denied'); return; }

  show('desk');
  await load();
}

/* --- loading ------------------------------------------------------------ */

async function load() {
  const status = $('#deskStatus');
  status.textContent = 'Loading reports…';

  const { data, error } = await supabase
    .from('assistance_reports')
    .select('id, reference_code, report_kind, subject, body, barangay, reporter_name, ' +
            'reporter_contact, status, acknowledged_at, desk_note, created_at, updated_at')
    .eq('desk_code', DESK)
    .order('created_at', { ascending: false });

  if (error) {
    status.textContent = 'Could not load reports. Try again, or reload the page.';
    return;
  }
  reports = data || [];
  status.textContent = '';
  render();
}

/* --- rendering ---------------------------------------------------------- */

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const when = (value) => new Date(value).toLocaleString('en-PH',
  { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function visible() {
  const needle = query.trim().toLowerCase();
  return reports.filter((report) => {
    if (filter !== 'all' && report.status !== filter) return false;
    if (!needle) return true;
    return [report.subject, report.barangay, report.reference_code]
      .some((field) => String(field || '').toLowerCase().includes(needle));
  });
}

function render() {
  const counts = { all: reports.length };
  reports.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  document.querySelectorAll('.dc-chip').forEach((chip) => {
    const key = chip.dataset.status;
    chip.querySelector('[data-count]').textContent = String(counts[key] || 0);
    chip.classList.toggle('is-active', key === filter);
  });

  const list = $('#reportList');
  const rows = visible();
  if (!rows.length) {
    list.innerHTML = '<li class="dc-empty">No reports in this view.</li>';
    return;
  }
  list.innerHTML = rows.map((report) => `
    <li>
      <button class="dc-row${report.id === selectedId ? ' is-open' : ''}" type="button"
              data-id="${escapeHtml(report.id)}">
        <span class="dc-row-top">
          <span class="dc-badge is-${escapeHtml(report.status)}">${escapeHtml(STATUS_LABEL[report.status] || report.status)}</span>
          <span class="dc-row-when">${escapeHtml(when(report.created_at))}</span>
        </span>
        <span class="dc-row-subject">${escapeHtml(report.subject)}</span>
        <span class="dc-row-meta">${escapeHtml(KINDS[report.report_kind] || report.report_kind)}${
          report.barangay ? ` · ${escapeHtml(report.barangay)}` : ''}</span>
      </button>
    </li>`).join('');
}

$('#reportList')?.addEventListener('click', (event) => {
  const button = event.target.closest('.dc-row');
  if (!button) return;
  selectedId = button.dataset.id;
  render();
  openReport();
});

document.querySelectorAll('.dc-chip').forEach((chip) => {
  chip.addEventListener('click', () => { filter = chip.dataset.status; render(); });
});
$('#deskSearch')?.addEventListener('input', (event) => { query = event.target.value; render(); });

/* --- one report --------------------------------------------------------- */

function openReport() {
  const report = reports.find((r) => r.id === selectedId);
  const detail = $('#reportDetail');
  if (!report) { detail.innerHTML = '<p class="dc-detail-empty">Choose a report to read it.</p>'; return; }

  const node = $('#detailTemplate').content.cloneNode(true);
  const set = (field, value) => {
    const target = node.querySelector(`[data-field="${field}"]`);
    if (target) target.textContent = value;
  };

  set('status', STATUS_LABEL[report.status] || report.status);
  node.querySelector('[data-field="status"]').className = `dc-badge is-${report.status}`;
  set('reference', report.reference_code);
  set('subject', report.subject);
  set('kind', KINDS[report.report_kind] || report.report_kind);
  set('barangay', report.barangay || 'Not given');
  set('created', when(report.created_at));
  set('reporter', report.reporter_name || 'Not given');
  /* "Not given" rather than an empty cell, because a blank could be read as a
     rendering fault and an officer might go looking for a contact that the
     resident deliberately did not leave. */
  set('contact', report.reporter_contact || 'Not given — no reply possible');
  set('body', report.body);

  node.querySelector('#deskNote').value = report.desk_note || '';
  detail.innerHTML = '';
  detail.appendChild(node);

  detail.querySelectorAll('[data-set-status]').forEach((button) => {
    button.disabled = button.dataset.setStatus === report.status;
    button.addEventListener('click', () => setStatus(report, button.dataset.setStatus));
  });
  detail.querySelector('#saveNoteBtn')?.addEventListener('click', () => saveNote(report));

  loadEvents(report.id);
}

async function setStatus(report, status) {
  const say = $('#reportDetail').querySelector('[data-field="actionStatus"]');
  say.textContent = 'Saving…';
  const { error } = await supabase
    .from('assistance_reports')
    .update({ status })
    .eq('id', report.id);
  if (error) { say.textContent = 'Could not update that. Try again.'; return; }
  say.textContent = `Moved to ${STATUS_LABEL[status] || status}.`;
  await load();
  openReport();
}

async function saveNote(report) {
  const say = $('#reportDetail').querySelector('[data-field="actionStatus"]');
  const note = String($('#deskNote').value || '').trim();
  say.textContent = 'Saving note…';
  const { error } = await supabase
    .from('assistance_reports')
    .update({ desk_note: note || null })
    .eq('id', report.id);
  say.textContent = error ? 'Could not save that note.' : 'Note saved.';
  if (!error) await load();
}

async function loadEvents(reportId) {
  const list = $('#reportDetail').querySelector('[data-field="events"]');
  if (!list) return;
  const { data, error } = await supabase
    .from('assistance_report_events')
    .select('event_type, from_status, to_status, note, created_at')
    .eq('report_id', reportId)
    .order('created_at', { ascending: false });
  if (error || !data?.length) {
    list.innerHTML = '<li class="dc-event">Nothing recorded yet.</li>';
    return;
  }
  list.innerHTML = data.map((event) => `
    <li class="dc-event">
      <span>${escapeHtml(when(event.created_at))}</span>
      ${event.from_status
        ? `${escapeHtml(STATUS_LABEL[event.from_status] || event.from_status)} → ${
             escapeHtml(STATUS_LABEL[event.to_status] || event.to_status)}`
        : escapeHtml(event.event_type)}
    </li>`).join('');
}

supabase.auth.onAuthStateChange(() => { start(); });
start();
