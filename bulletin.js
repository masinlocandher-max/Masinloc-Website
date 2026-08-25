/* Bulletin behaviour: archive filtering, and a quiet record of what a reader
   has already read.

   Both are enhancements. With JavaScript off the archive lists every story in
   full, and the MABAYANI sequence is a plain ordered list of links — nothing
   here is required to reach an article. */
(() => {
  'use strict';

  /* --- what this reader has read ---------------------------------------- */
  /* Kept in this browser only. It is never sent anywhere, and it exists to
     answer one question — where was I? — not to score anyone. Every access is
     guarded: private windows and blocked site data make storage throw. */
  const KEY = 'mabayani:read';

  function readSet() {
    try {
      const raw = window.localStorage.getItem(KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  function remember(slug) {
    try {
      const seen = readSet();
      if (seen.has(slug)) return;
      seen.add(slug);
      window.localStorage.setItem(KEY, JSON.stringify([...seen]));
    } catch {
      // Storage is unavailable. The reader simply gets no progress note.
    }
  }

  const main = document.getElementById('main');

  // On an article, reaching the page is what counts as read.
  const slug = main && main.dataset.story;
  if (slug) remember(slug);

  // On the archive, reflect it back — dimmed titles and one line of text.
  const path = document.getElementById('mabPath');
  if (path) {
    const seen = readSet();
    // Keyed off data-slug rather than a marker class: the sequence is styled
    // differently on Discover than it was here, and a hook that needs a
    // matching CSS rule in whichever sheet the host page loads is a hook that
    // breaks the next time the sequence is restyled.
    const steps = [...path.querySelectorAll('[data-slug]')];
    let done = 0;
    steps.forEach((step) => {
      if (seen.has(step.dataset.slug)) {
        step.classList.add('is-read');
        done += 1;
      }
    });
    const note = document.getElementById('mabProgress');
    if (note && done > 0) {
      note.textContent = `${done} of ${steps.length} stories explored`;
      note.hidden = false;
    }
  }

  /* --- archive filtering -------------------------------------------------- */
  const chips = [...document.querySelectorAll('.archive-filters .chip')];
  const groups = [...document.querySelectorAll('.bulletin-archive .archive-group')];
  const empty = document.getElementById('archiveEmpty');
  if (!chips.length || !groups.length) return;

  chips.forEach((chip) => chip.addEventListener('click', () => {
    const want = chip.dataset.filter;
    chips.forEach((c) => {
      const on = c === chip;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', String(on));
    });

    let shown = 0;
    groups.forEach((group) => {
      let inGroup = 0;
      group.querySelectorAll('.story').forEach((item) => {
        const match = want === 'all' || item.dataset.category === want;
        item.hidden = !match;
        if (match) inGroup += 1;
      });
      // Hide the heading too. A titled shelf with nothing on it reads as a bug.
      group.hidden = inGroup === 0;
      shown += inGroup;
    });
    if (empty) empty.hidden = shown > 0;
  }));

  chips.forEach((c) => c.setAttribute('aria-pressed', String(c.classList.contains('is-active'))));
})();
