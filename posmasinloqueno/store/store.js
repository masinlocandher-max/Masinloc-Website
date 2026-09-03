// Masinloc POS storefront: browse, cart, checkout.
//
// No Supabase client here on purpose. The public POS RPCs are granted to
// service_role only (migration 20260828134204, "route_public_pos_catalog_
// through_edge"), so this page talks to the pos-public Edge Function and
// nothing else. That keeps every anonymous read behind one audited surface
// with rate limiting, rather than handing the browser a database connection.

const API = 'https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/pos-public';

const el = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]
));

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const money = (v) => peso.format(Number(v || 0));

const params = new URLSearchParams(location.search);
const SLUG = (params.get('s') || '').trim().toLowerCase();
const TABLE = (params.get('t') || '').trim().slice(0, 60);

const FULFILLMENT_LABEL = { dine_in: 'Dine in', pickup: 'Pickup', delivery: 'Delivery' };

const state = {
  store: null,
  menu: [],
  cart: new Map(),   // product_id -> { product, quantity }
  step: 'menu',      // menu | details | placed
  fulfillment: null,
  method: null,
  error: '',
  placing: false,
};

/* ------------------------------------------------------------------- api */

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let body = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error || 'We could not reach the store. Please try again.');
  }
  return body;
}

/* ------------------------------------------------------------------ cart */

const cartLines = () => [...state.cart.values()].filter((l) => l.quantity > 0);
const cartCount = () => cartLines().reduce((n, l) => n + l.quantity, 0);
const cartSubtotal = () => cartLines().reduce((n, l) => n + l.quantity * Number(l.product.price), 0);

function deliveryFee() {
  return state.fulfillment === 'delivery' ? Number(state.store?.outlet?.delivery_fee || 0) : 0;
}

function setQuantity(productId, quantity) {
  const product = state.menu.flatMap((c) => c.products || []).find((p) => p.id === productId);
  if (!product) return;
  const next = Math.max(0, Math.min(99, quantity));
  if (next === 0) state.cart.delete(productId);
  else state.cart.set(productId, { product, quantity: next });
  render();
}

/* ---------------------------------------------------------------- render */

function render() {
  const body = el('body');
  const bar = el('cartbar');

  if (state.step === 'menu') { body.innerHTML = viewMenu(); }
  else if (state.step === 'details') { body.innerHTML = viewDetails(); }
  else { body.innerHTML = viewPlaced(); }

  const count = cartCount();
  bar.hidden = state.step !== 'menu' || !state.store;
  el('cartTotal').textContent = money(cartSubtotal());
  el('cartCount').textContent = count
    ? `${count} item${count === 1 ? '' : 's'}`
    : 'Your order is empty';
  el('cartNext').disabled = count === 0;
}

function viewMenu() {
  if (!state.store) return `<p class="note is-bad">${esc(state.error)}</p>`;

  const categories = state.menu.filter((c) => (c.products || []).length);
  if (!categories.length) {
    return `<div class="empty"><h3>Nothing on the menu yet</h3>
      <p>This store has not published any items. Please check back later.</p></div>`;
  }

  return categories.map((c) => `
    <h2>${esc(c.name)}</h2>
    <ul class="menu">
      ${(c.products || []).map((p) => {
        const line = state.cart.get(p.id);
        const quantity = line?.quantity || 0;
        return `
        <li class="item">
          <div class="item-main">
            <p class="item-name">${esc(p.name)}</p>
            ${p.description ? `<p class="item-desc">${esc(p.description)}</p>` : ''}
            <p class="item-price">${esc(money(p.price))}</p>
            ${p.available ? '' : '<p class="item-out">Out of stock</p>'}
          </div>
          ${p.available ? (quantity
            ? `<div class="stepper">
                 <button class="step" type="button" data-less="${esc(p.id)}" aria-label="One less ${esc(p.name)}">−</button>
                 <span class="step-count" aria-live="polite">${quantity}</span>
                 <button class="step" type="button" data-more="${esc(p.id)}" aria-label="One more ${esc(p.name)}">+</button>
               </div>`
            : `<button class="add" type="button" data-more="${esc(p.id)}">Add</button>`)
            : '<button class="add" type="button" disabled>Add</button>'}
        </li>`;
      }).join('')}
    </ul>`).join('') + `
    <p class="foot">Prices are set by the store. You pay the store directly — Masinloc POS takes no cut.</p>`;
}

function fulfillmentOptions() {
  const o = state.store.outlet || {};
  return [
    ['dine_in', 'Dine in', o.dine_in_enabled, TABLE ? `Table ${TABLE}` : 'Eat at the store'],
    ['pickup', 'Pickup', o.pickup_enabled, 'Collect at the counter'],
    ['delivery', 'Delivery', o.delivery_enabled,
      Number(o.delivery_fee) > 0 ? `${money(o.delivery_fee)} delivery fee` : 'Delivered to you'],
  ].filter(([, , enabled]) => enabled);
}

function viewDetails() {
  const lines = cartLines();
  const fees = deliveryFee();
  const subtotal = cartSubtotal();
  const methods = state.store.payment_methods || [];
  const options = fulfillmentOptions();
  const selectedMethod = methods.find((m) => m.method === state.method);
  const minimum = Number(state.store.outlet?.minimum_delivery_order || 0);
  const belowMinimum = state.fulfillment === 'delivery' && subtotal < minimum;

  return `
    <button class="btn btn-quiet" type="button" data-back style="margin-bottom:16px">← Back to menu</button>

    <h2>Your order</h2>
    <ul class="lines">
      ${lines.map((l) => `<li><span>${l.quantity}× ${esc(l.product.name)}</span>
        <span>${esc(money(l.quantity * Number(l.product.price)))}</span></li>`).join('')}
      ${fees ? `<li><span>Delivery</span><span>${esc(money(fees))}</span></li>` : ''}
      <li class="total"><span>Total</span><span>${esc(money(subtotal + fees))}</span></li>
    </ul>

    <form id="checkout" novalidate>
      <h2>How do you want it?</h2>
      ${options.length ? `<div class="choices">
        ${options.map(([value, label, , hint]) => `
          <label class="choice">
            <input type="radio" name="fulfillment" value="${value}" ${state.fulfillment === value ? 'checked' : ''} required>
            <span class="choice-main"><b>${esc(label)}</b><small>${esc(hint)}</small></span>
          </label>`).join('')}
      </div>` : `<p class="note is-bad">This store is not accepting orders right now.</p>`}

      <label class="field"><span>Your name</span>
        <input class="input" type="text" name="customer_name" maxlength="120" required
               autocomplete="name" placeholder="So the store can call you">
      </label>

      ${state.fulfillment === 'dine_in' ? `
        <label class="field"><span>Table</span>
          <input class="input" type="text" name="table_label" maxlength="60" value="${esc(TABLE)}"
                 placeholder="Table number or name">
        </label>` : ''}

      <label class="field"><span>Mobile number${state.fulfillment === 'delivery' ? '' : ' (optional)'}</span>
        <input class="input" type="tel" name="customer_phone" maxlength="40" inputmode="tel"
               autocomplete="tel" ${state.fulfillment === 'delivery' ? 'required' : ''}>
        <small>Used for this order, and to keep your loyalty points if you opt in.</small>
      </label>

      ${state.fulfillment === 'delivery' ? `
        <label class="field"><span>Delivery address</span>
          <textarea class="textarea" name="delivery_address" maxlength="500" required></textarea>
        </label>
        <label class="field"><span>Landmark</span>
          <input class="input" type="text" name="delivery_landmark" maxlength="300">
        </label>
        ${belowMinimum ? `<p class="note is-bad">Delivery starts at ${esc(money(minimum))}. Add ${esc(money(minimum - subtotal))} more.</p>` : ''}
      ` : ''}

      <h2>Payment</h2>
      ${methods.length ? `<div class="choices">
        ${methods.map((m) => `
          <label class="choice">
            <input type="radio" name="payment_method" value="${esc(m.method)}" ${state.method === m.method ? 'checked' : ''} required>
            <span class="choice-main"><b>${esc(m.label)}</b>
              <small>${esc(m.requires_manual_verification ? 'Staff confirms your payment before the kitchen starts' : 'Pay at the counter')}</small></span>
          </label>`).join('')}
      </div>` : `<p class="note is-bad">This store has no payment method enabled yet.</p>`}

      ${selectedMethod?.instructions ? `<p class="note">${esc(selectedMethod.instructions)}</p>` : ''}

      ${selectedMethod?.requires_manual_verification ? `
        <label class="field"><span>Reference number</span>
          <input class="input" type="text" name="payment_reference" maxlength="120" required>
          <small>The number your ${esc(selectedMethod.label)} receipt shows.</small>
        </label>` : ''}

      <label class="choice" style="margin-bottom:16px">
        <input type="checkbox" name="loyalty_opt_in">
        <span class="choice-main"><b>Collect loyalty points</b>
          <small>Points are tied to your mobile number. No account, no password.</small></span>
      </label>

      <p class="note" id="checkoutNote" role="status" aria-live="polite">${esc(state.error)}</p>

      <button class="btn btn-primary btn-block" type="submit" id="placeBtn"
        ${state.placing || belowMinimum || !options.length || !methods.length ? 'disabled' : ''}>
        ${state.placing ? 'Placing your order…' : `Place order · ${esc(money(subtotal + fees))}`}
      </button>
      <p class="foot">Placing an order does not charge you. You pay the store directly.</p>
    </form>`;
}

function viewPlaced() {
  const o = state.placed;
  return `
    <div class="empty" style="border-style:solid">
      <h3>Order #${esc(String(o.order_number))} is in</h3>
      <p>${esc(o.payment_status === 'pending_verification'
        ? 'The store is checking your payment. You will see it move as soon as they do.'
        : 'Pay at the counter. The kitchen starts once the store confirms.')}</p>
    </div>
    <a class="btn btn-primary btn-block" href="../order/?t=${encodeURIComponent(o.tracking_token)}"
       style="margin-top:18px">Track this order</a>
    <p class="foot">Keep this link. It is the only way back to your order, and it needs no password.</p>`;
}

/* ---------------------------------------------------------------- events */

el('body').addEventListener('click', (e) => {
  const more = e.target.closest('[data-more]');
  const less = e.target.closest('[data-less]');
  const back = e.target.closest('[data-back]');
  if (more) {
    const id = more.dataset.more;
    setQuantity(id, (state.cart.get(id)?.quantity || 0) + 1);
  }
  if (less) {
    const id = less.dataset.less;
    setQuantity(id, (state.cart.get(id)?.quantity || 0) - 1);
  }
  if (back) { state.step = 'menu'; state.error = ''; render(); }
});

// The form re-renders when fulfillment or payment changes, because both decide
// which fields are even asked for.
el('body').addEventListener('change', (e) => {
  if (e.target.name === 'fulfillment') { state.fulfillment = e.target.value; render(); }
  if (e.target.name === 'payment_method') { state.method = e.target.value; render(); }
});

el('cartNext').addEventListener('click', () => {
  const options = fulfillmentOptions();
  if (!state.fulfillment && options.length === 1) state.fulfillment = options[0][0];
  if (!state.fulfillment && TABLE && options.some(([v]) => v === 'dine_in')) state.fulfillment = 'dine_in';
  state.step = 'details';
  state.error = '';
  render();
  el('body').focus();
});

el('body').addEventListener('submit', async (e) => {
  if (e.target.id !== 'checkout') return;
  e.preventDefault();
  const form = e.target;
  if (!form.reportValidity()) return;

  state.placing = true; state.error = ''; render();
  const data = new FormData(form);
  const value = (k) => String(data.get(k) || '').trim() || null;

  try {
    const body = await api('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'order',
        slug: SLUG,
        // "qr" when a table QR carried a table label, "marketplace" otherwise.
        source: TABLE ? 'qr' : 'marketplace',
        fulfillment: state.fulfillment,
        customer_name: value('customer_name'),
        customer_phone: value('customer_phone'),
        table_label: value('table_label'),
        delivery_address: value('delivery_address'),
        delivery_landmark: value('delivery_landmark'),
        payment_method: state.method,
        payment_reference: value('payment_reference'),
        loyalty_opt_in: data.get('loyalty_opt_in') === 'on',
        items: cartLines().map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
        // Generated once per attempt, so a double tap or a retry on a flaky
        // connection returns the same order instead of creating a second one.
        idempotency_key: idempotencyKey(),
      }),
    });
    state.placed = body.order;
    state.step = 'placed';
    state.cart.clear();
    clearIdempotencyKey();
  } catch (err) {
    state.error = err.message;
  } finally {
    state.placing = false;
    render();
    el('body').focus();
  }
});

let pendingKey = null;
function idempotencyKey() {
  if (!pendingKey) pendingKey = crypto.randomUUID();
  return pendingKey;
}
function clearIdempotencyKey() { pendingKey = null; }

/* ------------------------------------------------------------------ boot */

async function boot() {
  if (!SLUG) {
    el('storeName').textContent = 'No store selected';
    el('storeMeta').textContent = '';
    state.error = 'This link is missing the store name. Scan the store’s QR code or ask them for the link again.';
    render();
    return;
  }
  try {
    const body = await api(`?action=storefront&slug=${encodeURIComponent(SLUG)}`);
    state.store = body.store;
    state.menu = body.menu || [];
    el('storeName').textContent = state.store.name;
    const options = fulfillmentOptions();
    el('storeMeta').textContent = options.length
      ? options.map(([, label]) => label).join(' · ')
      : 'Not accepting orders right now';
    if (TABLE && options.some(([v]) => v === 'dine_in')) state.fulfillment = 'dine_in';
  } catch (err) {
    el('storeName').textContent = 'Store unavailable';
    el('storeMeta').textContent = '';
    state.error = err.message;
  }
  render();
}

boot();
