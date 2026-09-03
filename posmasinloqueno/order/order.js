// Order tracking and order chat.
//
// The tracking token in the URL is the only credential. It is a random UUID
// minted per order, it is never listed anywhere, and it grants access to
// exactly one order — so it is treated like a bearer token: never logged,
// never put in a query the page shows, and the page is noindex.

const API = 'https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/pos-public';

const el = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]
));

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const money = (v) => peso.format(Number(v || 0));
const clock = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' });
const time = (v) => (v ? clock.format(new Date(v)) : '');

const TOKEN = (new URLSearchParams(location.search).get('t') || '').trim();

const STATUS_TEXT = {
  awaiting_payment: ['Waiting for payment', 'Pay at the counter. The kitchen starts once the store confirms.'],
  payment_review: ['Checking your payment', 'The store is confirming the transfer. This is usually quick.'],
  paid: ['Payment confirmed', 'The store has your order. The kitchen starts shortly.'],
  preparing: ['Being prepared', 'The kitchen is working on it now.'],
  ready: ['Ready', 'Collect it at the counter.'],
  out_for_delivery: ['On the way', 'Your order has left the store.'],
  completed: ['Completed', 'Thanks for ordering.'],
  cancelled: ['Cancelled', 'This order was cancelled. Message the store if that looks wrong.'],
  parked: ['Held', 'The store has parked this order.'],
};

// The path a normal order walks. Cancelled orders never render this.
const JOURNEY = [
  ['awaiting_payment', 'Ordered'],
  ['paid', 'Payment confirmed'],
  ['preparing', 'Being prepared'],
  ['ready', 'Ready'],
  ['completed', 'Completed'],
];
const RANK = {
  awaiting_payment: 0, payment_review: 0, parked: 0,
  paid: 1, preparing: 2, ready: 3, out_for_delivery: 3, completed: 4,
};

const state = { order: null, error: '', sending: false };

const OFFLINE = 'We could not reach the store. Check your connection and try again.';

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch {
    throw new Error(OFFLINE);
  }
  let body = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !body?.ok) throw new Error(body?.error || OFFLINE);
  return body;
}

function render() {
  const body = el('body');
  if (state.error && !state.order) {
    el('orderMeta').textContent = '';
    body.innerHTML = `<div class="empty"><h3>Order not found</h3><p>${esc(state.error)}</p></div>`;
    return;
  }
  if (!state.order) return;

  const o = state.order;
  const [heading, detail] = STATUS_TEXT[o.status] || [o.status, ''];
  const rank = RANK[o.status] ?? 0;
  const cancelled = o.status === 'cancelled';

  el('orderTitle').textContent = `Order #${o.order_number}`;
  el('orderMeta').textContent = `${o.customer_name} · ${money(o.total)}`;

  body.innerHTML = `
    <div class="track-status">
      <b>${esc(heading)}</b>
      <span>${esc(detail)}</span>
    </div>

    ${cancelled ? '' : `<ul class="steps">
      ${JOURNEY.map(([key, label], i) => {
        const cls = i < rank ? 'done' : i === rank ? 'now' : '';
        return `<li class="${cls}"><b></b>${esc(label)}</li>`;
      }).join('')}
    </ul>`}

    <h2>Message the store</h2>
    <ul class="chat" id="chat">
      ${(o.messages || []).length
        ? o.messages.map((m) => `
            <li class="${m.sender_type === 'customer' ? 'me' : 'them'}">
              ${esc(m.message)}<time>${esc(time(m.created_at))}</time>
            </li>`).join('')
        : '<li class="them">No messages yet. Ask the store anything about this order.</li>'}
    </ul>

    <p class="note" id="chatNote" role="status" aria-live="polite">${esc(state.error)}</p>

    ${['completed', 'cancelled'].includes(o.status)
      ? '<p class="note">This order is closed, so the chat is read-only.</p>'
      : `<form class="chatform" id="chatForm" novalidate>
          <label class="field" style="flex:1;margin:0">
            <span class="visually-hidden-label">Your message</span>
            <input class="input" type="text" name="message" maxlength="1000" required
                   placeholder="Type a message" autocomplete="off">
          </label>
          <button class="btn btn-primary" type="submit" ${state.sending ? 'disabled' : ''}>Send</button>
        </form>`}

    <p class="foot">This page updates on its own. Keep the link — it is the only way back to this order.</p>`;
}

async function load() {
  try {
    const body = await api(`?action=track&token=${encodeURIComponent(TOKEN)}`);
    state.order = body.order;
    state.error = '';
  } catch (err) {
    // A failed refresh must not blank an order the customer is already
    // reading; it becomes a note above the order they already have.
    state.error = err.message;
  }
  render();
}

el('body').addEventListener('submit', async (e) => {
  if (e.target.id !== 'chatForm') return;
  e.preventDefault();
  const input = e.target.elements.message;
  const message = input.value.trim();
  if (!message) return;

  state.sending = true; render();
  try {
    await api('', { method: 'POST', body: JSON.stringify({ action: 'message', token: TOKEN, message }) });
    state.error = '';
    await load();
  } catch (err) {
    state.error = err.message;
    render();
  } finally {
    state.sending = false;
  }
});

if (!TOKEN) {
  state.error = 'This link is missing its order code. Use the link the store gave you when you ordered.';
  render();
} else {
  load();
  // Polling, not realtime: the customer holds no Supabase session, so there is
  // no authenticated socket to subscribe on. Fifteen seconds is fast enough to
  // watch an order move and slow enough to be cheap.
  setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });
}
