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
      /* The honest sentence. Written from the status the database actually
         returned rather than assumed, so if that ever starts arriving as
         something else this line changes with it. */
      $('#receiptHonest').textContent =
        result.status === 'submitted'
          ? 'It is stored and waiting. Nobody at the desk has opened it yet — you will not get a reply until an officer does, and that may be the next working day.'
          : `Its status is "${result.status}".`;
      receipt.scrollIntoView({ behavior: 'smooth', block: 'start' });
      receipt.setAttribute('tabindex', '-1');
      receipt.focus({ preventScroll: true });
    }
  } catch {
    say('We could not reach the desk service. Check your connection, or call instead.', 'error');
    submitButton.disabled = false;
    submitButton.textContent = 'Send to the desk';
  }
});

/* --- checking a message already sent ------------------------------------ */

/* Both halves required. assistance_report_status matches the reference code
   and the full token, so a wrong or missing key returns nothing rather than
   confirming that a code exists — the table is never enumerable by guessing. */
const checkForm = $('#checkForm');
const checkResult = $('#checkResult');

const PLAIN = {
  submitted: 'Submitted. Nobody at the desk has opened it yet.',
  received: 'A desk officer has opened it.',
  in_progress: 'The desk is working on it.',
  closed: 'The desk has closed it.',
};

checkForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const reference = value('#checkReference');
  const token = value('#checkToken');

  if (!reference || !token) {
    checkResult.textContent = 'Enter both the reference code and the access key.';
    return;
  }

  checkResult.textContent = 'Checking…';
  const { data, error } = await supabase.rpc('assistance_report_status', {
    p_reference_code: reference,
    p_access_token: token,
  });

  if (error) {
    checkResult.textContent = 'We could not check that right now. Please try again later.';
    return;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    // Deliberately one message for "no such code" and "wrong key".
    checkResult.textContent = 'No message matches that reference code and access key.';
    return;
  }
  const when = new Date(row.updated_at).toLocaleDateString('en-PH',
    { year: 'numeric', month: 'long', day: 'numeric' });
  checkResult.textContent = `${PLAIN[row.status] || row.status} Last updated ${when}.`;
});
