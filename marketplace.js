/* Marketplace search, filters and the privacy-safe POS directory bridge.

   The eight reviewed listings stay in static HTML. That is deliberate: the
   directory still works when JavaScript, Supabase or the network is down, and
   crawlers keep the reviewed detail pages Claude built. The live feed only
   enhances that foundation: it adds an Order now action to a linked listing
   and appends newly published POS listings that do not yet have a static page.

   The browser never reads business_submissions or POS tables directly. The
   marketplace-directory Edge Function returns a fixed public field set only.
*/
(function () {
  'use strict';

  const liveStyles = document.createElement('link');
  liveStyles.rel = 'stylesheet';
  liveStyles.href = 'marketplace-live.css?v=20260828-1';
  document.head.appendChild(liveStyles);

  const ENDPOINT = 'https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/marketplace-directory';
  const CATEGORY_LABELS = {
    'food-drinks': 'Food & Drinks',
    'catering-events': 'Catering & Events',
    retail: 'Retail',
    'beauty-wellness': 'Beauty & Wellness',
    services: 'Services',
    'tourism-accommodation': 'Tourism & Accommodation',
    other: 'Other',
  };
  const ALLOWED_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

  const grid = document.getElementById('mkGrid');
  if (!grid) return;

  const search = document.getElementById('mkSearch');
  const count = document.getElementById('mkCount');
  const empty = document.getElementById('mkEmpty');
  const filters = document.querySelector('.mk-filters');

  let category = 'all';
  let term = '';

  function cards() {
    return [...grid.querySelectorAll('.mk-item')];
  }

  function chips() {
    return [...document.querySelectorAll('.mk-chip')];
  }

  function staticSlug(card) {
    if (card.dataset.slug) return card.dataset.slug;
    const href = card.querySelector(':scope > a:first-child')?.getAttribute('href') || '';
    const match = href.match(/^marketplace\/([a-z0-9-]+)\.html$/);
    if (match) card.dataset.slug = match[1];
    return match ? match[1] : '';
  }

  function apply() {
    let shown = 0;
    for (const card of cards()) {
      const matchesCategory = category === 'all' || card.dataset.category === category;
      const matchesTerm = !term || (card.dataset.search || '').includes(term);
      const show = matchesCategory && matchesTerm;
      card.hidden = !show;
      if (show) shown += 1;
    }

    if (empty) empty.hidden = shown > 0;
    if (count) {
      count.textContent = shown === 0
        ? 'No businesses found'
        : `${shown} ${shown === 1 ? 'business' : 'businesses'}`;
    }
  }

  function selectChip(chip) {
    category = chip.dataset.filter || 'all';
    for (const other of chips()) other.classList.toggle('is-on', other === chip);
    apply();
  }

  function bindChip(chip) {
    if (chip.dataset.bound === 'true') return;
    chip.dataset.bound = 'true';
    chip.addEventListener('click', () => selectChip(chip));
  }

  function ensureCategoryChip(categoryId, label) {
    if (!filters || !ALLOWED_CATEGORIES.has(categoryId)) return;
    if (filters.querySelector(`.mk-chip[data-filter="${categoryId}"]`)) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mk-chip';
    chip.dataset.filter = categoryId;
    chip.textContent = label || CATEGORY_LABELS[categoryId];
    filters.appendChild(chip);
    bindChip(chip);
  }

  function cleanBusiness(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
    const slug = text(raw.slug, 140).toLowerCase();
    const name = text(raw.name, 120);
    const categoryId = text(raw.category, 60);
    const location = text(raw.location, 300);
    const description = text(raw.description, 1200);
    const barangay = text(raw.barangay, 120);
    const categoryLabel = text(raw.categoryLabel, 80) || CATEGORY_LABELS[categoryId] || 'Other';
    const orderPath = text(raw.orderPath, 240);
    const facebook = text(raw.facebook, 500);

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !name || !ALLOWED_CATEGORIES.has(categoryId) || !location || !description) return null;
    if (raw.orderingAvailable === true && !/^\/posmasinloqueno\?store=[a-z0-9%_-]+$/i.test(orderPath)) return null;
    if (facebook && !/^https:\/\/(?:www\.|m\.)?(?:facebook\.com|fb\.com)\//i.test(facebook)) return null;

    return {
      slug,
      name,
      category: categoryId,
      categoryLabel,
      location,
      barangay,
      description,
      facebook,
      orderingAvailable: raw.orderingAvailable === true,
      orderPath: raw.orderingAvailable === true ? orderPath : '',
    };
  }

  function addOrderAction(card, business) {
    if (!business.orderingAvailable || !business.orderPath) return;
    if (card.querySelector('.mk-order-action')) return;

    const actions = document.createElement('div');
    actions.className = 'mk-actions';

    const order = document.createElement('a');
    order.className = 'mk-order-action';
    order.href = business.orderPath;
    order.textContent = 'Order now';
    order.setAttribute('aria-label', `Order from ${business.name}`);
    actions.appendChild(order);

    card.appendChild(actions);
    card.dataset.ordering = 'true';
  }

  function makeLiveCard(business) {
    const card = document.createElement('li');
    card.className = 'mk-item mk-item-live';
    card.dataset.slug = business.slug;
    card.dataset.category = business.category;
    card.dataset.search = [
      business.name,
      business.categoryLabel,
      business.location,
      business.barangay,
      business.description,
    ].join(' ').toLowerCase();

    const body = document.createElement('div');
    body.className = 'mk-business-link';

    const logo = document.createElement('span');
    logo.className = 'mk-logo mk-logo-none';
    logo.setAttribute('aria-hidden', 'true');
    logo.dataset.mono = business.name.slice(0, 1).toUpperCase();

    const ident = document.createElement('span');
    ident.className = 'mk-ident';
    const name = document.createElement('span');
    name.className = 'mk-name';
    name.textContent = business.name;
    const meta = document.createElement('span');
    meta.className = 'mk-meta';
    const cat = document.createElement('span');
    cat.className = 'mk-meta-cat';
    cat.textContent = business.categoryLabel;
    const loc = document.createElement('span');
    loc.className = 'mk-meta-loc';
    loc.textContent = business.location;
    meta.append(cat, loc);
    ident.append(name, meta);

    const about = document.createElement('span');
    about.className = 'mk-about';
    const desc = document.createElement('span');
    desc.className = 'mk-desc';
    desc.textContent = business.description;
    about.appendChild(desc);

    if (business.facebook) {
      const facebook = document.createElement('a');
      facebook.className = 'mk-more mk-live-facebook';
      facebook.href = business.facebook;
      facebook.target = '_blank';
      facebook.rel = 'noopener noreferrer';
      facebook.textContent = 'Facebook';
      about.appendChild(facebook);
    }

    body.append(logo, ident, about);
    card.appendChild(body);
    addOrderAction(card, business);
    return card;
  }

  async function loadLiveDirectory() {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (!payload?.ok || !Array.isArray(payload.businesses)) return;

      const existing = new Map();
      for (const card of cards()) {
        const slug = staticSlug(card);
        if (slug) existing.set(slug, card);
      }

      for (const raw of payload.businesses.slice(0, 1000)) {
        const business = cleanBusiness(raw);
        if (!business) continue;
        ensureCategoryChip(business.category, business.categoryLabel);

        const card = existing.get(business.slug);
        if (card) {
          addOrderAction(card, business);
          continue;
        }

        const liveCard = makeLiveCard(business);
        grid.appendChild(liveCard);
        existing.set(business.slug, liveCard);
      }
      apply();
    } catch {
      // Static Marketplace remains fully usable. A transient backend problem
      // must never erase or replace the reviewed directory already in the HTML.
    }
  }

  if (search) {
    search.addEventListener('input', () => {
      term = search.value.trim().toLowerCase();
      apply();
    });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && search.value) {
        search.value = '';
        term = '';
        apply();
      }
    });
  }

  for (const chip of chips()) bindChip(chip);
  for (const card of cards()) staticSlug(card);

  apply();
  loadLiveDirectory();
}());
