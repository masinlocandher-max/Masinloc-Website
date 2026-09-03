// Masinloc POS merchant console.
//
// Served from this origin. A CDN outage must not take a store's counter
// offline, and Browser QA must not fail on a third-party host being
// unreachable. Rebuild the client with scripts/build-vendor.sh.
import { createClient } from '/assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL = 'https://uwcqvsitjtknxsaypjxj.supabase.co';
// Publishable key. Every table this console touches is behind RLS and every
// action behind a SECURITY DEFINER function that re-checks membership, so this
// key grants nothing on its own.
const SUPABASE_KEY = 'sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/* ------------------------------------------------------------------ util */

const $ = (s, root = document) => root.querySelector(s);
const el = (id) => document.getElementById(id);

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]
  ));
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const money = (v) => peso.format(Number(v || 0));
const clock = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' });
const stamp = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
const time = (v) => (v ? clock.format(new Date(v)) : '—');
const when = (v) => (v ? stamp.format(new Date(v)) : '—');

function minutesSince(v) {
  if (!v) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60000));
}

// Postgres raises the store's own rules as plain messages ("Order is not
// awaiting payment"). Those are worth showing. Anything that looks like a
// database internal is replaced, so a schema detail never reaches a counter.
function readable(error) {
  const raw = String(error?.message || error || '').trim();
  if (!raw) return 'Something went wrong. Please try again.';
  if (/permission denied|violates|relation |column |syntax|JWT|function /i.test(raw)) {
    return 'You do not have permission to do that.';
  }
  return raw.length > 160 ? 'Something went wrong. Please try again.' : raw;
}

/* ----------------------------------------------------------------- state */

const state = {
  session: null,
  contexts: [],
  ctx: null,          // the active { merchant_id, role, outlet_id, ... }
  plan: null,         // pos_plan_limits row for this merchant's plan
  route: 'dashboard',
  orders: [],
  categories: [],
  products: [],
  channel: null,
  busy: false,
};

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', kitchen: 'Kitchen' };

// What each role may do. The database enforces the same thing; this only keeps
// the console from offering a button that would be refused.
const can = {
  money: () => ['owner', 'manager', 'cashier'].includes(state.ctx?.role),
  kitchen: () => ['owner', 'manager', 'cashier', 'kitchen'].includes(state.ctx?.role),
  catalog: () => ['owner', 'manager'].includes(state.ctx?.role),
  store: () => ['owner', 'manager'].includes(state.ctx?.role),
};

const STATUS = {
  parked: ['Parked', 'is-wait'],
  awaiting_payment: ['Awaiting payment', 'is-wait'],
  payment_review: ['Payment review', 'is-wait'],
  paid: ['Paid', 'is-live'],
  preparing: ['Preparing', 'is-live'],
  ready: ['Ready', 'is-live'],
  out_for_delivery: ['Out for delivery', 'is-live'],
  completed: ['Completed', 'is-done'],
  cancelled: ['Cancelled', 'is-stop'],
};
const FULFILLMENT = { dine_in: 'Dine in', pickup: 'Pickup', delivery: 'Delivery' };

function statusPill(status) {
  const [label, tone] = STATUS[status] || [status, ''];
  return `<span class="pill ${tone}">${esc(label)}</span>`;
}

/* ------------------------------------------------------------------ auth */

function showGate(message = '') {
  el('gate').hidden = false;
  el('picker').hidden = true;
  el('app').hidden = true;
  setNote(el('gateNote'), message, message ? 'is-bad' : '');
}

function setNote(node, message, tone = '') {
  if (!node) return;
  node.className = `note ${tone}`.trim();
  node.textContent = message || '';
}

async function boot() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { showGate(); return; }
  state.session = session;
  await afterSignIn();
}

async function afterSignIn() {
  const { data, error } = await supabase.rpc('pos_my_contexts');
  if (error) { showGate(readable(error)); return; }

  state.contexts = data || [];
  if (state.contexts.length === 0) {
    // A real account with no membership. Signing them out would hide the
    // reason, so say it plainly and leave them signed in.
    el('gate').hidden = false;
    el('picker').hidden = true;
    el('app').hidden = true;
    setNote(el('gateNote'), 'This account is not linked to a store yet. Masinloc Connect adds staff to a store.', 'is-bad');
    return;
  }
  if (state.contexts.length === 1) { await enter(state.contexts[0]); return; }

  el('gate').hidden = true;
  el('app').hidden = true;
  el('picker').hidden = false;
  el('pickerList').innerHTML = state.contexts.map((c, i) => `
    <button type="button" data-index="${i}">
      <b>${esc(c.merchant_name)}</b>
      <span>${esc(ROLE_LABEL[c.role] || c.role)}${c.outlet_name ? ` · ${esc(c.outlet_name)}` : ''}</span>
    </button>`).join('');
}

async function enter(ctx) {
  state.ctx = ctx;
  el('gate').hidden = true;
  el('picker').hidden = true;
  el('app').hidden = false;

  el('storeName').textContent = ctx.merchant_name;
  el('storeMeta').textContent =
    `${ROLE_LABEL[ctx.role] || ctx.role}${ctx.outlet_name ? ` · ${ctx.outlet_name}` : ''}`;

  const { data: plan } = await supabase
    .from('pos_plan_limits').select('*').eq('plan_code', ctx.plan_code).maybeSingle();
  state.plan = plan || null;

  // A kitchen account has nothing to do on the Today screen, so it lands where
  // its work is.
  state.route = ctx.role === 'kitchen' ? 'kitchen' : 'dashboard';
  subscribe();
  await refresh();
}

async function signOut() {
  if (state.channel) { await supabase.removeChannel(state.channel); state.channel = null; }
  await supabase.auth.signOut();
  state.session = null; state.ctx = null; state.contexts = [];
  showGate();
}

/* -------------------------------------------------------------- realtime */

// Orders are the only thing that changes without this console doing it, so
// that is the only subscription. RLS applies to realtime too: another
// merchant's rows never arrive here.
function subscribe() {
  if (state.channel) supabase.removeChannel(state.channel);
  state.channel = supabase
    .channel(`pos-orders-${state.ctx.merchant_id}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'pos_orders',
      filter: `merchant_id=eq.${state.ctx.merchant_id}`,
    }, () => { loadOrders().then(render); })
    .subscribe();
}

/* ------------------------------------------------------------------ data */

async function loadOrders() {
  const { data, error } = await supabase
    .from('pos_orders')
    .select('id,order_number,customer_name,customer_phone,table_label,source,fulfillment,status,payment_status,subtotal,delivery_fee,total,notes,created_at,updated_at,kitchen_sent_at,completed_at,delivery_address,pos_order_items(id,product_name,quantity,unit_price,modifier_total,note)')
    .eq('merchant_id', state.ctx.merchant_id)
    .order('created_at', { ascending: false })
    .limit(120);
  if (error) { state.error = readable(error); return; }
  state.error = null;
  state.orders = data || [];
}

async function loadCatalog() {
  const [cats, prods] = await Promise.all([
    supabase.from('pos_categories').select('id,name,sort_order,active')
      .eq('merchant_id', state.ctx.merchant_id).is('archived_at', null)
      .order('sort_order').order('name'),
    supabase.from('pos_products')
      .select('id,category_id,name,description,price,active,track_inventory,stock_on_hand,low_stock_threshold,sort_order')
      .eq('merchant_id', state.ctx.merchant_id).is('archived_at', null)
      .order('sort_order').order('name'),
  ]);
  state.categories = cats.data || [];
  state.products = prods.data || [];
}

async function loadDashboard() {
  const { data, error } = await supabase.rpc('pos_dashboard', {
    p_merchant_id: state.ctx.merchant_id,
    p_outlet_id: state.ctx.outlet_id || null,
  });
  if (error) { state.metrics = null; state.error = readable(error); return; }
  state.metrics = data;
}

async function refresh() {
  state.loading = true; render();
  const jobs = [loadOrders()];
  if (state.route === 'dashboard') jobs.push(loadDashboard());
  if (state.route === 'catalog') jobs.push(loadCatalog());
  if (state.route === 'store') jobs.push(loadStore());
  await Promise.all(jobs);
  state.loading = false;
  render();
}

async function loadStore() {
  const [outlets, methods, profile] = await Promise.all([
    supabase.from('pos_outlets')
      .select('id,name,code,address,barangay,ordering_enabled,dine_in_enabled,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_order')
      .eq('merchant_id', state.ctx.merchant_id).is('archived_at', null).order('created_at'),
    supabase.from('pos_payment_methods')
      .select('id,outlet_id,method,label,enabled,requires_manual_verification,instructions')
      .eq('merchant_id', state.ctx.merchant_id).order('sort_order'),
    can.store()
      ? supabase.rpc('pos_get_marketplace_profile', { p_merchant_id: state.ctx.merchant_id })
      : Promise.resolve({ data: null }),
  ]);
  state.outlets = outlets.data || [];
  state.methods = methods.data || [];
  state.profile = profile.data || null;
}

/* ---------------------------------------------------------------- render */

function render() {
  const screen = el('screen');
  if (!state.ctx) return;

  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.route === state.route;
    tab.setAttribute('aria-current', active ? 'page' : 'false');
  });

  const waiting = state.orders.filter((o) => ['awaiting_payment', 'payment_review'].includes(o.status)).length;
  const cooking = state.orders.filter((o) => ['paid', 'preparing', 'ready', 'out_for_delivery'].includes(o.status)).length;
  badge('ordersCount', waiting);
  badge('kitchenCount', cooking);

  if (state.loading && !state.orders.length) { screen.innerHTML = skeleton(); return; }

  const view = {
    dashboard: viewDashboard,
    orders: viewOrders,
    kitchen: viewKitchen,
    catalog: viewCatalog,
    store: viewStore,
  }[state.route] || viewDashboard;

  screen.innerHTML = (state.error ? `<p class="note is-bad">${esc(state.error)}</p>` : '') + view();
}

function badge(id, n) {
  const node = el(id);
  node.hidden = !n;
  node.textContent = n > 99 ? '99+' : String(n);
}

const skeleton = () => `<div class="skeleton"><i></i><i></i><i></i><i></i></div>`;

function empty(title, body, action = '') {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;
}

/* --------------------------------------------------------- view: today */

function viewDashboard() {
  const m = state.metrics || {};
  const completedToday = state.orders.filter(
    (o) => o.status === 'completed' && new Date(o.completed_at || o.updated_at).toDateString() === new Date().toDateString(),
  );
  const items = new Map();
  completedToday.forEach((o) => (o.pos_order_items || []).forEach((i) => {
    const row = items.get(i.product_name) || { qty: 0, value: 0 };
    row.qty += i.quantity;
    row.value += Number(i.unit_price + (i.modifier_total || 0)) * i.quantity;
    items.set(i.product_name, row);
  }));
  const best = [...items.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);

  return `
    <h1>Today</h1>
    <p class="sub">${esc(when(new Date()))}</p>

    <div class="metrics">
      <div class="metric"><span>Sales</span><strong>${esc(money(m.sales_today))}</strong></div>
      <div class="metric"><span>Orders</span><strong>${esc(String(m.orders_today ?? 0))}</strong></div>
      <div class="metric${m.payment_review ? ' warn' : ''}"><span>To verify</span><strong>${esc(String(m.payment_review ?? 0))}</strong></div>
      <div class="metric${m.low_stock ? ' warn' : ''}"><span>Low stock</span><strong>${esc(String(m.low_stock ?? 0))}</strong></div>
    </div>

    <h2>Best sellers today</h2>
    ${best.length ? `<ul class="list">${best.map(([name, row]) => `
      <li class="row">
        <div class="row-main">
          <p class="row-title">${esc(name)}</p>
          <p class="row-meta">${esc(String(row.qty))} sold</p>
        </div>
        <div class="row-side"><span class="row-amount">${esc(money(row.value))}</span></div>
      </li>`).join('')}</ul>`
      : empty('Nothing completed yet', 'Completed orders appear here with the day’s totals.')}

    <h2>Your plan</h2>
    ${planCard()}
  `;
}

function planCard() {
  const p = state.plan;
  const code = state.ctx.plan_code;
  const label = { community_free: 'Free', pro: 'Pro', business: 'Business+' }[code] || code;
  if (!p) {
    return `<div class="card"><p class="row-meta">Plan <b>${esc(label)}</b>. Limits are not available right now.</p></div>`;
  }
  const products = state.products.length || null;
  return `
    <div class="card">
      <p class="row-title">${esc(label)} plan</p>
      <p class="row-meta">These limits are set by the plan, not by this device.</p>
      <ul class="plan">
        <li><b>${esc(String(p.product_limit))}</b> products${products !== null ? ` · ${esc(String(products))} used` : ''}</li>
        <li><b>${esc(String(p.staff_limit))}</b> staff</li>
        <li><b>${esc(String(p.outlet_limit))}</b> outlet${p.outlet_limit === 1 ? '' : 's'}</li>
        <li><b>${esc(String(p.category_limit))}</b> categories</li>
        <li><b>${esc(String(p.max_order_lines))}</b> lines per order</li>
      </ul>
    </div>`;
}

/* -------------------------------------------------------- view: orders */

function orderCard(o, actions) {
  const lines = (o.pos_order_items || [])
    .map((i) => `${i.quantity}× ${i.product_name}`).join(', ');
  return `
    <li class="row">
      <div class="row-main">
        <p class="row-title">#${esc(String(o.order_number))} · ${esc(o.customer_name)}</p>
        <p class="row-meta">
          ${statusPill(o.status)}
          ${esc(FULFILLMENT[o.fulfillment] || o.fulfillment)}${o.table_label ? ` · Table ${esc(o.table_label)}` : ''}
          · ${esc(time(o.created_at))}
        </p>
        ${lines ? `<p class="row-meta">${esc(lines)}</p>` : ''}
        ${actions ? `<div class="row-actions">${actions}</div>` : ''}
      </div>
      <div class="row-side"><span class="row-amount">${esc(money(o.total))}</span></div>
    </li>`;
}

function viewOrders() {
  const open = state.orders.filter((o) => !['completed', 'cancelled'].includes(o.status));
  const closed = state.orders.filter((o) => ['completed', 'cancelled'].includes(o.status)).slice(0, 25);

  const actionsFor = (o) => {
    const buttons = [];
    if (can.money() && ['awaiting_payment', 'payment_review'].includes(o.status)) {
      buttons.push(`<button class="btn btn-primary btn-sm" data-act="verify" data-id="${esc(o.id)}">Payment received</button>`);
      buttons.push(`<button class="btn btn-danger btn-sm" data-act="cancel" data-id="${esc(o.id)}">Cancel</button>`);
    }
    if (can.kitchen() && o.status === 'paid') {
      buttons.push(`<button class="btn btn-primary btn-sm" data-act="advance" data-id="${esc(o.id)}" data-to="preparing">Start preparing</button>`);
    }
    return buttons.join('');
  };

  return `
    <h1>Orders</h1>
    <p class="sub">${open.length} open${open.length === 1 ? '' : ''} · newest first</p>
    ${open.length
      ? `<ul class="list">${open.map((o) => orderCard(o, actionsFor(o))).join('')}</ul>`
      : empty('No open orders', 'New orders from the storefront and the counter appear here the moment they are placed.')}
    ${closed.length ? `<h2>Recently closed</h2><ul class="list">${closed.map((o) => orderCard(o, '')).join('')}</ul>` : ''}
  `;
}

/* ------------------------------------------------------- view: kitchen */

function viewKitchen() {
  const queue = state.orders
    .filter((o) => ['paid', 'preparing', 'ready', 'out_for_delivery'].includes(o.status))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const next = { paid: 'preparing', preparing: 'ready', ready: null, out_for_delivery: 'completed' };
  const label = { paid: 'Accept', preparing: 'Mark ready', out_for_delivery: 'Delivered' };

  const actionsFor = (o) => {
    if (!can.kitchen()) return '';
    if (o.status === 'ready') {
      const to = o.fulfillment === 'delivery' ? 'out_for_delivery' : 'completed';
      const text = o.fulfillment === 'delivery' ? 'Out for delivery' : 'Handed over';
      return `<button class="btn btn-primary btn-sm" data-act="advance" data-id="${esc(o.id)}" data-to="${to}">${text}</button>`;
    }
    const to = next[o.status];
    if (!to) return '';
    return `<button class="btn btn-primary btn-sm" data-act="advance" data-id="${esc(o.id)}" data-to="${to}">${esc(label[o.status])}</button>`;
  };

  return `
    <h1>Kitchen</h1>
    <p class="sub">Paid orders only. Oldest first.</p>
    ${queue.length ? `<ul class="list">${queue.map((o) => {
      const mins = minutesSince(o.kitchen_sent_at || o.created_at);
      const items = (o.pos_order_items || []).map((i) => `
        <p class="row-meta"><b>${esc(String(i.quantity))}×</b> ${esc(i.product_name)}${i.note ? ` — ${esc(i.note)}` : ''}</p>`).join('');
      return `
        <li class="row">
          <div class="row-main">
            <p class="row-title">#${esc(String(o.order_number))} · ${esc(o.customer_name)}</p>
            <p class="row-meta">${statusPill(o.status)} ${esc(FULFILLMENT[o.fulfillment] || o.fulfillment)}${o.table_label ? ` · Table ${esc(o.table_label)}` : ''} · ${esc(String(mins))} min</p>
            ${items}
            <div class="row-actions">${actionsFor(o)}</div>
          </div>
        </li>`;
    }).join('')}</ul>`
      : empty('Nothing cooking', 'Orders arrive here once payment is verified.')}
  `;
}

/* ------------------------------------------------------- view: catalog */

function viewCatalog() {
  if (!can.catalog()) {
    return `<h1>Menu</h1>${empty('Not your section', 'Only an owner or manager can change the menu.')}`;
  }
  const atLimit = state.plan && state.products.length >= state.plan.product_limit;
  const byCategory = state.categories.map((c) => ({
    category: c,
    products: state.products.filter((p) => p.category_id === c.id),
  }));
  const orphans = state.products.filter((p) => !p.category_id);

  return `
    <h1>Menu</h1>
    <p class="sub">${state.products.length} product${state.products.length === 1 ? '' : 's'} in ${state.categories.length} categor${state.categories.length === 1 ? 'y' : 'ies'}</p>

    <div class="row-actions">
      <button class="btn btn-quiet btn-sm" data-act="new-category">New category</button>
      <button class="btn btn-primary btn-sm" data-act="new-product" ${atLimit || !state.categories.length ? 'disabled' : ''}>New product</button>
    </div>
    ${atLimit ? `<p class="note" style="margin-top:12px">You have reached the ${esc(String(state.plan.product_limit))}-product limit of the ${esc(state.ctx.plan_code)} plan.</p>` : ''}
    ${!state.categories.length ? `<p class="note" style="margin-top:12px">Add a category first. A product with no category does not appear on the storefront.</p>` : ''}

    ${orphans.length ? `
      <h2>Not on the storefront</h2>
      <p class="note is-bad">These products have no category, so customers cannot see them. Give each one a category.</p>
      <ul class="list">${orphans.map(productRow).join('')}</ul>` : ''}

    ${byCategory.length ? byCategory.map(({ category, products }) => `
      <h2>${esc(category.name)}</h2>
      ${products.length
        ? `<ul class="list">${products.map(productRow).join('')}</ul>`
        : `<p class="note">No products in this category yet.</p>`}
    `).join('')
      : empty('No menu yet', 'Create a category, then add the products that go in it.')}
  `;
}

function productRow(p) {
  const low = p.track_inventory && Number(p.stock_on_hand) <= Number(p.low_stock_threshold);
  const stock = p.track_inventory
    ? `<span class="pill ${low ? 'is-stop' : 'is-done'}">${esc(String(Number(p.stock_on_hand)))} in stock</span>`
    : '<span class="pill">Not tracked</span>';
  return `
    <li class="row">
      <div class="row-main">
        <p class="row-title">${esc(p.name)}</p>
        <p class="row-meta">${p.active ? stock : '<span class="pill is-stop">Hidden</span>'}</p>
        <div class="row-actions">
          <button class="btn btn-quiet btn-sm" data-act="edit-product" data-id="${esc(p.id)}">Edit</button>
          ${p.track_inventory ? `<button class="btn btn-quiet btn-sm" data-act="stock" data-id="${esc(p.id)}">Stock</button>` : ''}
        </div>
      </div>
      <div class="row-side"><span class="row-amount">${esc(money(p.price))}</span></div>
    </li>`;
}

/* --------------------------------------------------------- view: store */

function viewStore() {
  if (!can.store()) {
    return `<h1>Store</h1>${empty('Not your section', 'Only an owner or manager can change store settings.')}`;
  }
  const outlet = (state.outlets || [])[0];
  const profile = state.profile || {};
  const slug = state.ctx.merchant_slug;
  const storeUrl = `${location.origin}/posmasinloqueno/store/?s=${encodeURIComponent(slug)}`;

  return `
    <h1>Store</h1>
    <p class="sub">${esc(state.ctx.merchant_name)} · ${esc(state.ctx.merchant_status)} · ${esc(state.ctx.eligibility_status)}</p>

    <h2>Customer link</h2>
    <div class="card">
      <p class="row-meta">Print this on the table card or share it. Customers order without an account.</p>
      <p class="row-title" style="word-break:break-all;margin-top:8px">${esc(storeUrl)}</p>
      <div class="row-actions">
        <a class="btn btn-quiet btn-sm" href="${esc(storeUrl)}" target="_blank" rel="noopener">Open storefront</a>
        <button class="btn btn-quiet btn-sm" data-act="copy-link" data-link="${esc(storeUrl)}">Copy link</button>
      </div>
    </div>

    <h2>Ordering</h2>
    ${outlet ? `
      <div class="card">
        <p class="row-title">${esc(outlet.name)}</p>
        <p class="row-meta">${outlet.ordering_enabled ? 'Accepting orders' : 'Ordering is off'}</p>
        <div class="row-actions">
          <button class="btn btn-quiet btn-sm" data-act="edit-outlet">Change</button>
        </div>
        <ul class="plan" style="margin-top:12px">
          <li>Dine in <b>${outlet.dine_in_enabled ? 'on' : 'off'}</b></li>
          <li>Pickup <b>${outlet.pickup_enabled ? 'on' : 'off'}</b></li>
          <li>Delivery <b>${outlet.delivery_enabled ? 'on' : 'off'}</b></li>
          ${outlet.delivery_enabled ? `<li>Fee <b>${esc(money(outlet.delivery_fee))}</b></li>` : ''}
        </ul>
      </div>` : `<p class="note is-bad">This store has no outlet, so it cannot take orders.</p>`}

    <h2>Payment methods</h2>
    ${(state.methods || []).length
      ? `<ul class="list">${state.methods.map((m) => `
          <li class="row">
            <div class="row-main">
              <p class="row-title">${esc(m.label)}</p>
              <p class="row-meta">${m.enabled ? '<span class="pill is-live">Enabled</span>' : '<span class="pill is-stop">Off</span>'}
                ${m.requires_manual_verification ? '<span class="pill is-wait">Staff verifies</span>' : ''}</p>
            </div>
          </li>`).join('')}</ul>`
      : `<p class="note is-bad">No payment method is enabled, so customers cannot check out.</p>`}

    <h2>Marketplace listing</h2>
    <div class="card">
      ${profile && profile.publication_status
        ? `<p class="row-meta">Status ${statusPill(profile.publication_status === 'published' ? 'completed' : 'parked')} ${esc(profile.publication_status)}</p>`
        : `<p class="row-meta">Not listed yet.</p>`}
      <p class="row-meta">A verified store appears in Masinloc Marketplace. Category and location are what customers browse by.</p>
      <div class="row-actions">
        <button class="btn btn-quiet btn-sm" data-act="edit-profile">Edit listing</button>
      </div>
    </div>

    <h2>Account</h2>
    <div class="card">
      <p class="row-meta">Signed in as ${esc(state.session?.user?.email || '')}</p>
      ${state.contexts.length > 1 ? `<div class="row-actions"><button class="btn btn-quiet btn-sm" data-act="switch-store">Switch store</button></div>` : ''}
    </div>
  `;
}

/* --------------------------------------------------------------- sheets */

const sheet = el('sheet');
const sheetForm = el('sheetForm');

function openSheet(title, bodyHTML, onSubmit, submitLabel = 'Save') {
  sheetForm.innerHTML = `
    <h2>${esc(title)}</h2>
    ${bodyHTML}
    <p class="note" id="sheetNote" role="status" aria-live="polite"></p>
    <div class="sheet-actions">
      <button class="btn btn-quiet" type="button" data-close>Cancel</button>
      <button class="btn btn-primary" type="submit" id="sheetSubmit">${esc(submitLabel)}</button>
    </div>`;
  sheetForm.onsubmit = async (e) => {
    e.preventDefault();
    const submit = el('sheetSubmit');
    submit.disabled = true;
    const previous = submit.textContent;
    submit.textContent = 'Saving…';
    try {
      await onSubmit(new FormData(sheetForm));
      sheet.close();
      await refresh();
    } catch (err) {
      setNote(el('sheetNote'), readable(err), 'is-bad');
    } finally {
      submit.disabled = false;
      submit.textContent = previous;
    }
  };
  sheet.showModal();
}

sheetForm.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { e.preventDefault(); sheet.close(); }
});

function field(name, label, { type = 'text', value = '', hint = '', required = false, attrs = '' } = {}) {
  return `<label class="field"><span>${esc(label)}</span>
    <input class="input" type="${type}" name="${esc(name)}" value="${esc(value)}" ${required ? 'required' : ''} ${attrs}>
    ${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}

function checkbox(name, label, checked) {
  return `<label class="check"><input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;
}

function must(form, key, label) {
  const value = String(form.get(key) || '').trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

/* -------------------------------------------------------------- actions */

async function verifyPayment(id) {
  const order = state.orders.find((o) => o.id === id);
  openSheet(
    `Payment for #${order?.order_number ?? ''}`,
    `<p class="note">${esc(money(order?.total))} · ${esc(FULFILLMENT[order?.fulfillment] || '')}.
      Only confirm once the money is actually in hand or the transfer shows in your account.</p>
     ${field('reference', 'Reference number', { hint: 'For GCash, Maya or QR Ph. Leave blank for cash.' })}`,
    async (form) => {
      const { error } = await supabase.rpc('pos_confirm_payment', {
        p_order_id: id,
        p_reference_number: String(form.get('reference') || '').trim() || null,
      });
      if (error) throw error;
    },
    'Confirm payment',
  );
}

async function cancelOrder(id) {
  const order = state.orders.find((o) => o.id === id);
  openSheet(
    `Cancel #${order?.order_number ?? ''}`,
    `<p class="note is-bad">This cannot be undone. The customer sees the cancellation on their tracking page.</p>
     ${field('reason', 'Reason', { required: true, hint: 'Shown to the customer.' })}`,
    async (form) => {
      const { error } = await supabase.rpc('pos_cancel_unpaid_order', {
        p_order_id: id,
        p_reason: must(form, 'reason', 'A reason'),
      });
      if (error) throw error;
    },
    'Cancel order',
  );
}

async function advance(id, to) {
  const { error } = await supabase.rpc('pos_advance_order', { p_order_id: id, p_target_status: to });
  if (error) { toast(readable(error), 'is-bad'); return; }
  await refresh();
}

function editCategory() {
  openSheet('New category', field('name', 'Category name', { required: true, hint: 'Customers see this on the storefront.' }),
    async (form) => {
      const { error } = await supabase.from('pos_categories').insert({
        merchant_id: state.ctx.merchant_id,
        name: must(form, 'name', 'A name'),
      });
      if (error) throw error;
    }, 'Add category');
}

function editProduct(id) {
  const p = id ? state.products.find((x) => x.id === id) : null;
  const options = state.categories
    .map((c) => `<option value="${esc(c.id)}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');

  openSheet(p ? 'Edit product' : 'New product', `
    ${field('name', 'Name', { value: p?.name || '', required: true })}
    <label class="field"><span>Category</span>
      <select class="select" name="category_id" required>${options}</select>
      <small>A product with no category is not shown on the storefront.</small>
    </label>
    <div class="row2">
      ${field('price', 'Price', { type: 'number', value: p ? String(p.price) : '', required: true, attrs: 'min="0" step="0.01" inputmode="decimal"' })}
      ${field('low_stock_threshold', 'Low stock at', { type: 'number', value: p ? String(Number(p.low_stock_threshold)) : '0', attrs: 'min="0" step="1" inputmode="numeric"' })}
    </div>
    <label class="field"><span>Description</span>
      <textarea class="textarea" name="description" maxlength="1000">${esc(p?.description || '')}</textarea></label>
    ${checkbox('track_inventory', 'Track stock for this product', p ? p.track_inventory : false)}
    ${checkbox('active', 'Show on the storefront', p ? p.active : true)}
    ${p ? `<p class="note">Stock is changed from the Stock button, never here, so every movement stays on the ledger.</p>` : ''}
  `, async (form) => {
    const payload = {
      name: must(form, 'name', 'A name'),
      category_id: must(form, 'category_id', 'A category'),
      price: Number(form.get('price')),
      low_stock_threshold: Number(form.get('low_stock_threshold') || 0),
      description: String(form.get('description') || '').trim() || null,
      track_inventory: form.get('track_inventory') === 'on',
      active: form.get('active') === 'on',
    };
    if (!Number.isFinite(payload.price) || payload.price < 0) throw new Error('Enter a valid price.');

    const { error } = p
      ? await supabase.from('pos_products').update(payload).eq('id', p.id)
      : await supabase.from('pos_products').insert({ ...payload, merchant_id: state.ctx.merchant_id });
    if (error) throw error;
  }, p ? 'Save product' : 'Add product');
}

function adjustStock(id) {
  const p = state.products.find((x) => x.id === id);
  openSheet(`Stock · ${p?.name ?? ''}`, `
    <p class="note">Now: <b>${esc(String(Number(p?.stock_on_hand ?? 0)))}</b>. Every change is written to the
      inventory ledger, which is why stock cannot be typed in directly.</p>
    <label class="field"><span>What happened</span>
      <select class="select" name="reason">
        <option value="restock">Stock arrived</option>
        <option value="adjustment">Count correction</option>
        <option value="waste">Waste or spoilage</option>
      </select></label>
    ${field('delta', 'Change by', { type: 'number', required: true, hint: 'Use a negative number to take stock out.', attrs: 'step="1" inputmode="numeric"' })}
    ${field('note', 'Note', { hint: 'Optional.' })}
  `, async (form) => {
    const delta = Number(form.get('delta'));
    if (!Number.isFinite(delta) || delta === 0) throw new Error('Enter a change other than zero.');
    const { error } = await supabase.rpc('pos_record_inventory_movement', {
      p_product_id: id,
      p_delta: delta,
      p_reason: String(form.get('reason')),
      p_note: String(form.get('note') || '').trim() || null,
    });
    if (error) throw error;
  }, 'Record movement');
}

function editOutlet() {
  const o = (state.outlets || [])[0];
  if (!o) return;
  openSheet('Ordering settings', `
    ${field('name', 'Outlet name', { value: o.name, required: true })}
    ${field('address', 'Address', { value: o.address || '' })}
    ${checkbox('ordering_enabled', 'Accept online orders', o.ordering_enabled)}
    ${checkbox('dine_in_enabled', 'Dine in', o.dine_in_enabled)}
    ${checkbox('pickup_enabled', 'Pickup', o.pickup_enabled)}
    ${checkbox('delivery_enabled', 'Delivery', o.delivery_enabled)}
    <div class="row2">
      ${field('delivery_fee', 'Delivery fee', { type: 'number', value: String(o.delivery_fee), attrs: 'min="0" step="0.01" inputmode="decimal"' })}
      ${field('minimum_delivery_order', 'Minimum order', { type: 'number', value: String(o.minimum_delivery_order), attrs: 'min="0" step="0.01" inputmode="decimal"' })}
    </div>
  `, async (form) => {
    const { error } = await supabase.from('pos_outlets').update({
      name: must(form, 'name', 'A name'),
      address: String(form.get('address') || '').trim() || null,
      ordering_enabled: form.get('ordering_enabled') === 'on',
      dine_in_enabled: form.get('dine_in_enabled') === 'on',
      pickup_enabled: form.get('pickup_enabled') === 'on',
      delivery_enabled: form.get('delivery_enabled') === 'on',
      delivery_fee: Number(form.get('delivery_fee') || 0),
      minimum_delivery_order: Number(form.get('minimum_delivery_order') || 0),
    }).eq('id', o.id);
    if (error) throw error;
  });
}

const CATEGORIES = [
  ['food-drinks', 'Food & Drinks'], ['catering-events', 'Catering & Events'],
  ['retail', 'Retail'], ['beauty-wellness', 'Beauty & Wellness'],
  ['services', 'Services'], ['tourism-accommodation', 'Tourism & Accommodation'],
  ['other', 'Other'],
];

function editProfile() {
  const p = state.profile || {};
  openSheet('Marketplace listing', `
    <label class="field"><span>Category</span>
      <select class="select" name="category" required>
        ${CATEGORIES.map(([v, l]) => `<option value="${v}" ${p.category === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select></label>
    ${field('location', 'Location', { value: p.location || '', required: true, hint: 'Where customers find you.' })}
    ${field('barangay', 'Barangay', { value: p.barangay || '' })}
    ${field('descriptor', 'Short descriptor', { value: p.descriptor || '', hint: 'A few words under your name.' })}
    <label class="field"><span>Description</span>
      <textarea class="textarea" name="description" maxlength="1200">${esc(p.description || '')}</textarea></label>
    ${field('facebook_page', 'Facebook page', { value: p.facebook_page || '', type: 'url', hint: 'Optional. Must be a facebook.com link.' })}
  `, async (form) => {
    const { error } = await supabase.rpc('pos_update_marketplace_profile', {
      p_merchant_id: state.ctx.merchant_id,
      p_category: String(form.get('category')),
      p_location: must(form, 'location', 'A location'),
      p_barangay: String(form.get('barangay') || '').trim() || null,
      p_description: String(form.get('description') || '').trim() || null,
      p_descriptor: String(form.get('descriptor') || '').trim() || null,
      p_facebook_page: String(form.get('facebook_page') || '').trim() || null,
    });
    if (error) throw error;
  });
}

let toastTimer = null;
function toast(message, tone = '') {
  const screen = el('screen');
  let node = $('#toast', screen);
  if (!node) {
    node = document.createElement('p');
    node.id = 'toast';
    node.setAttribute('role', 'status');
    screen.prepend(node);
  }
  node.className = `note ${tone}`.trim();
  node.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 6000);
}

/* ---------------------------------------------------------------- events */

el('signInForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = el('signInBtn');
  button.disabled = true;
  setNote(el('gateNote'), 'Signing in…');
  const email = el('email').value.trim();
  const password = el('password').value;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  button.disabled = false;
  if (error) { setNote(el('gateNote'), error.message, 'is-bad'); return; }
  state.session = data.session;
  setNote(el('gateNote'), '');
  await afterSignIn();
});

el('magicBtn').addEventListener('click', async () => {
  const email = el('email').value.trim();
  if (!email) { setNote(el('gateNote'), 'Enter your email first.', 'is-bad'); return; }
  setNote(el('gateNote'), 'Sending a sign-in link…');
  // shouldCreateUser:false — this console never creates accounts, so an unknown
  // address gets the same answer as a known one and cannot be used to test
  // which emails belong to a store.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/posmasinloqueno/` },
  });
  setNote(el('gateNote'),
    error ? error.message : 'If that address belongs to a store, a sign-in link is on its way.',
    error ? 'is-bad' : 'is-good');
});

el('pickerList').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-index]');
  if (button) enter(state.contexts[Number(button.dataset.index)]);
});

el('pickerSignOut').addEventListener('click', signOut);
el('signOutBtn').addEventListener('click', signOut);
el('refreshBtn').addEventListener('click', refresh);

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.route = tab.dataset.route;
    el('screen').focus();
    refresh();
  });
});

el('screen').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-act]');
  if (!button) return;
  const { act, id, to, link } = button.dataset;
  if (act === 'verify') verifyPayment(id);
  if (act === 'cancel') cancelOrder(id);
  if (act === 'advance') advance(id, to);
  if (act === 'new-category') editCategory();
  if (act === 'new-product') editProduct(null);
  if (act === 'edit-product') editProduct(id);
  if (act === 'stock') adjustStock(id);
  if (act === 'edit-outlet') editOutlet();
  if (act === 'edit-profile') editProfile();
  if (act === 'switch-store') { el('app').hidden = true; el('picker').hidden = false; }
  if (act === 'copy-link') {
    navigator.clipboard?.writeText(link).then(
      () => toast('Link copied.', 'is-good'),
      () => toast('Could not copy. Select the link and copy it manually.', 'is-bad'),
    );
  }
});

// A token refresh or a sign-out in another tab must not leave a stale console
// showing a store the account can no longer reach.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || !session) { state.session = null; state.ctx = null; showGate(); return; }
  state.session = session;
});

boot();
