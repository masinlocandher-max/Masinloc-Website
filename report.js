/* Message a Masinloc desk.
 *
 * Two rules govern everything here.
 *
 * NEVER CLAIM DELIVERY. Submitting stores a report. It does not put it in
 * front of anybody. The confirmation says the report was submitted and that
 * nobody at the desk has opened it yet, because that is what is true until a
 * desk officer opens it and the database stamps the acknowledgement. Telling
 * somebody "the PNP has your message" when it is sitting unread is how a
 * person decides not to make the call they should have made.
 *
 * NEVER SWALLOW THE EMERGENCY PATH. Nothing in this file can hide, disable or
 * move the hotlines above the form. They are ordinary anchors in the markup
 * and this script does not touch them.
 */
import { createClient } from './assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL = 'https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const ENDPOINT = `${SUPABASE_URL}/functions/v1/submit-masinloc`;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const $ = (selector) => document.querySelector(selector);

/* --- reasons follow the desk ------------------------------------------- */

const form = $('#reportForm');
const kindSelect = $('#reportKind');

/* The reasons are rendered per desk as <optgroup data-desk>, so with scripting
   off every reason is still selectable under a labelled group and the form
   works unaided. With scripting on, only the chosen desk's reasons are offered
   — asking the police about a hazard report helps nobody. */
function syncKinds() {
  const desk = form?.querySelector('input[name="deskCode"]:checked')?.value;
  if (!desk || !kindSelect) return;
  let firstVisible = null;
  [...kindSelect.querySelectorAll('optgroup')].forEach((group) => {
    const matches = group.dataset.desk === desk;
    group.hidden = !matches;
    group.disabled = !matches;
    if (matches && !firstVisible) firstVisible = group.querySelector('option');
  });
  const selected = kindSelect.selectedOptions[0];
  if ((!selected || selected.parentElement.hidden) && firstVisible) {
    kindSelect.value = firstVisible.value;
  }
}

form?.querySelectorAll('input[name="deskCode"]').forEach((radio) => {
  radio.addEventListener('change', syncKinds);
});
syncKinds();

/* --- a live count, because 6000 is a real ceiling ----------------------- */

const body = $('#reportBody');
const bodyCount = $('#bodyCount');
body?.addEventListener('input', () => {
  if (bodyCount) bodyCount.textContent = String(body.value.length);
});

/* --- submit ------------------------------------------------------------- */

const status = $('#reportStatus');
const submitButton = $('#reportSubmit');
const receipt = $('#reportReceipt');

const say = (text, tone) => {
  if (!status) return;
  status.textContent = text;
  status.className = 'rp-status' + (tone ? ` is-${tone}` : '');
};

const value = (id) => String($(id)?.value || '').trim();

/* Checked here so a mistake is corrected in place rather than coming back as a
   generic server rejection. The Edge Function validates the same things again;
   this is convenience, not the boundary. */
function firstProblem() {
  if (!value('#reportSubject')) return ['Give the desk a subject, even a short one.', '#reportSubject'];
  const details = value('#reportBody');
  if (!details) return ['Tell the desk what this is about.', '#reportBody'];
  if (details.length < 20) {
    return ['Please add a little more detail — a desk cannot act on one line.', '#reportBody'];
  }
  const contact = value('#reporterContact');
  if (contact && contact.length < 5) {
    return ['That contact does not look complete. Leave it blank if you would rather not say.',
            '#reporterContact'];
  }
  return null;
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const problem = firstProblem();
  if (problem) {
    say(problem[0], 'error');
    $(problem[1])?.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Sending…';
  say('Sending your message to the desk.');

  const payload = {
    deskCode: form.querySelector('input[name="deskCode"]:checked')?.value,
    reportKind: value('#reportKind'),
    subject: value('#reportSubject'),
    body: value('#reportBody'),
    barangay: value('#reportBarangay') || null,
    reporterName: value('#reporterName') || null,
    reporterContact: value('#reporterContact') || null,
    website: value('#reportWebsite'),
  };

  const data = new FormData();
  data.set('category', 'assistance');
  data.set('payload', JSON.stringify(payload));

  try {
    const response = await fetch(ENDPOINT, { method: 'POST', body: data });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
      say(result.error || 'We could not send that right now. If it is urgent, call the desk.',
          'error');
      submitButton.disabled = false;
      submitButton.textContent = 'Send to the desk';
      return;
    }

    form.hidden = true;
    if (receipt) {
      receipt.hidden = false;
      $('#receiptReference').textContent = result.reference_code || '—';
      $('#receiptToken').textContent = result.access_token || '—';
      $('#receiptHonest').textContent =
        'It is stored and waiting. Nobody at the desk has opened it yet — you will not get a '
        + 'reply until an officer does, and that may be the next working day.';
    }
    /* Held for this tab only, so a resident who just wrote can keep the
       conversation going without transcribing a key they have not written
       down yet. sessionStorage, not localStorage: this is somebody's report
       to the police on what may be a shared phone, and it should not outlive
       the tab. The receipt says so and tells them to write both down. */
    remember(result.reference_code, result.access_token);
    await openThread(result.reference_code, result.access_token);
  } catch {
    say('We could not reach the desk service. Check your connection, or call instead.', 'error');
    submitButton.disabled = false;
    submitButton.textContent = 'Send to the desk';
  }
});

/* --- the conversation --------------------------------------------------- */

const threadView = $('#threadView');
const threadMessages = $('#threadMessages');
const threadWait = $('#threadWait');

let openReference = null;
let openToken = null;

const KEY = 'masinloc-assistance-thread';

function remember(reference, token) {
  openReference = reference;
  openToken = token;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ reference, token }));
  } catch {
    /* Private mode, or storage disabled. The conversation still works for as
       long as this page stays open; only the convenience is lost. */
  }
}

function recall() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved?.reference && saved?.token) return saved;
  } catch { /* nothing worth recovering */ }
  return null;
}

const STATUS_PLAIN = {
  submitted: 'Not opened yet',
  received: 'Opened by the desk',
  in_progress: 'The desk is working on it',
  closed: 'Closed by the desk',
};

/* How long something has been waiting, in words. Deliberately coarse: "about
   an hour ago" is honest, "58 minutes ago" pretends to a precision that means
   nothing about when somebody will read it. */
function ago(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'about an hour ago' : `about ${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const stamp = (iso) => new Date(iso).toLocaleString('en-PH',
  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function renderThread(thread) {
  const field = (name) => threadView.querySelector(`[data-field="${name}"]`);
  field('subject').textContent = thread.subject;
  field('reference').textContent = thread.reference_code;
  const badge = field('status');
  badge.textContent = STATUS_PLAIN[thread.status] || thread.status;
  badge.className = `rp-badge is-${thread.status}`;

  /* The opening report is shown as the first thing in the thread, but it is
     not a message row — it is what started the conversation, and labelling it
     as such is why the desk's first reply reads as a reply. */
  const opening = `
    <li class="rp-message is-resident is-opening">
      <div class="rp-message-who">You · opened this <time datetime="${escapeAttr(thread.created_at)}">${escapeHtml(stamp(thread.created_at))}</time></div>
      <div class="rp-message-body">${escapeHtml(thread.body)}</div>
    </li>`;

  const rows = (thread.messages || []).map((message) => `
    <li class="rp-message is-${escapeAttr(message.sender)}">
      <div class="rp-message-who">${message.sender === 'desk' ? 'The desk' : 'You'} · <time datetime="${escapeAttr(message.created_at)}">${escapeHtml(stamp(message.created_at))}</time></div>
      <div class="rp-message-body">${escapeHtml(message.body)}</div>
    </li>`).join('');

  threadMessages.innerHTML = opening + rows;

  const messages = thread.messages || [];
  const lastDesk = [...messages].reverse().find((m) => m.sender === 'desk');
  const lastAny = messages[messages.length - 1];

  if (lastDesk && lastAny && lastAny.sender === 'desk') {
    threadWait.textContent = `The desk replied ${ago(lastDesk.created_at)}.`;
    threadWait.className = 'rp-thread-wait is-replied';
  } else {
    const since = lastAny ? lastAny.created_at : thread.created_at;
    threadWait.textContent = lastDesk
      ? `You wrote back ${ago(since)}. The desk has not answered that yet.`
      : `Sent ${ago(since)}. Nobody at the desk has replied yet.`;
    threadWait.className = 'rp-thread-wait';
  }

  /* A closed thread is not a locked one — a resident may still write, and that
     reopens it. Saying so beats a disabled box they cannot explain. */
  const replyNote = threadView.querySelector('#replyStatus');
  if (thread.status === 'closed' && replyNote && !replyNote.textContent) {
    replyNote.textContent = 'The desk closed this. Writing again reopens it.';
  }
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escapeAttr = escapeHtml;

async function openThread(reference, token) {
  const { data, error } = await supabase.rpc('assistance_thread', {
    p_reference_code: reference,
    p_access_token: token,
  });
  if (error || !data) return false;

  openReference = reference;
  openToken = token;
  threadView.hidden = false;
  renderThread(data);
  threadView.setAttribute('tabindex', '-1');
  threadView.scrollIntoView({ behavior: 'smooth', block: 'start' });
  threadView.focus({ preventScroll: true });
  return true;
}

$('#refreshThread')?.addEventListener('click', async () => {
  if (!openReference) return;
  const button = $('#refreshThread');
  button.disabled = true;
  button.textContent = 'Checking…';
  await openThread(openReference, openToken);
  button.disabled = false;
  button.textContent = 'Check for a reply';
});

$('#replyForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const box = $('#replyBody');
  const note = $('#replyStatus');
  const text = String(box.value || '').trim();

  if (!text) { note.textContent = 'Write something first.'; return; }

  const button = $('#replySubmit');
  button.disabled = true;
  button.textContent = 'Sending…';
  note.textContent = '';

  const { data, error } = await supabase.rpc('assistance_reply', {
    p_reference_code: openReference,
    p_access_token: openToken,
    p_body: text,
  });

  button.disabled = false;
  button.textContent = 'Send';

  if (error || !data?.ok) {
    /* Named reasons, because "something went wrong" leaves somebody retrying
       a thing that will never work. */
    const REASONS = {
      not_found: 'That conversation could not be opened again. Check the reference code and key.',
      invalid_body: 'That message is too long to send.',
      thread_full: 'This conversation has reached its limit. Call the desk to continue.',
      too_fast: 'Give that a moment before sending again.',
    };
    note.textContent = REASONS[data?.error] || 'We could not send that. Please try again.';
    return;
  }

  box.value = '';
  await openThread(openReference, openToken);
});

/* --- opening a conversation again --------------------------------------- */

/* Both halves required. assistance_thread matches the reference code and the
   full token, so a wrong or missing key returns nothing rather than confirming
   that a code exists — the table is never enumerable by guessing. */
const checkForm = $('#checkForm');
const checkResult = $('#checkResult');

checkForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const reference = value('#checkReference');
  const token = value('#checkToken');

  if (!reference || !token) {
    checkResult.textContent = 'Enter both the reference code and the access key.';
    return;
  }

  checkResult.textContent = 'Opening…';
  const opened = await openThread(reference, token);
  if (!opened) {
    // Deliberately one message for "no such code" and "wrong key".
    checkResult.textContent = 'No conversation matches that reference code and access key.';
    return;
  }
  checkResult.textContent = '';
  remember(reference, token);
});

/* Someone who sent a message earlier in this tab lands back on their thread
   rather than on an empty form. Cleared when the tab closes. */
const saved = recall();
if (saved) openThread(saved.reference, saved.token);
