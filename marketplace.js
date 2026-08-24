/* Marketplace search and category filtering.

   Everything the search reads is already in the page. Each card carries a
   data-search attribute built at generation time from its name, category,
   location, barangay and description, so filtering is a string test against
   markup the visitor has already downloaded — no request, no spinner, no
   endpoint that can be down. With a directory this size that is not an
   optimisation, it is just the honest shape of the problem.

   The page is complete before this file runs. Every business, its details and
   its link are in the HTML, so a visitor with no JavaScript sees the whole
   directory and can still reach every business. Search and filters are an
   improvement on a working page, not the thing that makes it work.
*/
(function () {
  'use strict';

  const grid = document.getElementById('mkGrid');
  if (!grid) return;

  const search = document.getElementById('mkSearch');
  const count = document.getElementById('mkCount');
  const empty = document.getElementById('mkEmpty');
  const chips = [...document.querySelectorAll('.mk-chip')];
  const cards = [...grid.querySelectorAll('.mk-card')];

  let category = 'all';
  let term = '';

  function apply() {
    let shown = 0;
    for (const card of cards) {
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

  if (search) {
    search.addEventListener('input', () => {
      term = search.value.trim().toLowerCase();
      apply();
    });
    // A search field that cannot be cleared with Escape is a small daily
    // annoyance on a page whose whole job is looking things up.
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && search.value) {
        search.value = '';
        term = '';
        apply();
      }
    });
  }

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      category = chip.dataset.filter || 'all';
      for (const other of chips) other.classList.toggle('is-on', other === chip);
      apply();
    });
  }

  apply();
}());
