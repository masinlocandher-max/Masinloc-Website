/* Bulletin archive filtering. The full list is in the HTML; this only hides
   what does not match, so the archive is complete with JavaScript off. */
(() => {
  'use strict';
  const chips = [...document.querySelectorAll('.archive-filters .chip')];
  const list = document.getElementById('storyList');
  const empty = document.getElementById('archiveEmpty');
  if (!chips.length || !list) return;

  chips.forEach((chip) => chip.addEventListener('click', () => {
    const want = chip.dataset.filter;
    chips.forEach((c) => {
      const on = c === chip;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', String(on));
    });
    let shown = 0;
    [...list.children].forEach((item) => {
      const match = want === 'all' || item.dataset.category === want;
      item.hidden = !match;
      if (match) shown += 1;
    });
    if (empty) empty.hidden = shown > 0;
  }));
  chips.forEach((c) => c.setAttribute('aria-pressed', String(c.classList.contains('is-active'))));
})();
