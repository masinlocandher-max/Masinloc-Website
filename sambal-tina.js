/* Sambal Tina dictionary — search, filtering and provenance display.

   The data is one ordinary JSON file fetched after the page renders. The page
   itself (its purpose, the phrasebook heading, the legend, the noscript
   fallback) is complete in HTML, so nothing essential depends on this script.

   Deliberately not used here: no gzip stream, no base64, no split fragments,
   no runtime reconstruction. A dictionary is data; it is served as data. */
(() => {
  'use strict';

  const DATA_URL = 'data/sambal-tina.json?v=20260821-2';
  const PAGE_SIZE = 60;

  /* Column order is published in the JSON; mirrored here for readability. */
  const TINA = 0, POS = 1, EN = 2, FIL = 3, PAGES = 4, STATUS = 5, CONF = 6, NOTE = 7;

  const query = document.getElementById('dictQuery');
  const status = document.getElementById('dictStatus');
  const results = document.getElementById('dictResults');
  const more = document.getElementById('dictMore');
  const groups = document.getElementById('phrasebookGroups');
  const chips = [...document.querySelectorAll('.chip')];

  if (!query || !results || !status) return;

  let entries = [];
  let haystack = [];
  let matches = [];
  let shown = 0;
  let filter = 'all';

  const escapeHtml = (value) => String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character])
  );

  const numberFormat = new Intl.NumberFormat('en-US');

  /* --- confidence -------------------------------------------------------- */

  function badgeFor(confidence) {
    if (confidence >= 4) return { className: 'badge-strong', label: 'Well supported' };
    if (confidence === 3) return { className: 'badge-ok', label: 'Readable' };
    return { className: 'badge-check', label: 'Needs a source check' };
  }

  function passesFilter(entry) {
    if (filter === 'supported') return entry[CONF] >= 4;
    if (filter === 'check') return entry[CONF] <= 2;
    return true;
  }

  /* --- search ------------------------------------------------------------ */

  /* Accent- and case-insensitive, so "abóh" and "aboh" find each other. */
  function fold(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  function highlight(value, needle) {
    const text = escapeHtml(value);
    if (!needle) return text;
    const folded = fold(value);
    const at = folded.indexOf(needle);
    if (at < 0) return text;

    /* Fold can change length per character, so walk the original string to
       find the span that corresponds to the folded match. */
    let start = -1, end = -1, cursor = 0;
    for (let i = 0; i < value.length; i += 1) {
      const width = fold(value[i]).length;
      if (start < 0 && cursor + width > at) start = i;
      if (cursor + width >= at + needle.length) { end = i + 1; break; }
      cursor += width;
    }
    if (start < 0) return text;
    if (end < 0) end = value.length;

    return escapeHtml(value.slice(0, start))
      + '<mark>' + escapeHtml(value.slice(start, end)) + '</mark>'
      + escapeHtml(value.slice(end));
  }

  function search(term) {
    const needle = fold(term).trim();
    if (!needle) return entries.filter(passesFilter);

    const starts = [];
    const contains = [];
    for (let i = 0; i < entries.length; i += 1) {
      if (!passesFilter(entries[i])) continue;
      const at = haystack[i].indexOf(needle);
      if (at < 0) continue;
      /* A headword that begins with the term is the more useful answer. */
      (fold(entries[i][TINA]).startsWith(needle) ? starts : contains).push(entries[i]);
    }
    return starts.concat(contains);
  }

  /* --- rendering --------------------------------------------------------- */

  function renderEntry(entry, needle) {
    const badge = badgeFor(entry[CONF]);
    const parts = [];

    parts.push('<li class="dict-entry">');

    parts.push('<div class="entry-head">');
    parts.push('<p class="entry-tina">' + highlight(entry[TINA], needle) + '</p>');
    if (entry[POS]) {
      parts.push('<span class="entry-pos">' + escapeHtml(entry[POS]) + '</span>');
    }
    parts.push('</div>');

    parts.push('<div class="entry-glosses">');
    if (entry[EN]) {
      parts.push('<p class="entry-en">' + highlight(entry[EN], needle) + '</p>');
    } else {
      parts.push('<p class="entry-missing">No English gloss in the printed index.</p>');
    }
    if (entry[FIL]) {
      parts.push('<p class="entry-fil">' + highlight(entry[FIL], needle) + '</p>');
    }
    parts.push('</div>');

    parts.push('<div class="entry-meta">');
    parts.push('<span class="badge ' + badge.className + '">' + badge.label + '</span>');
    if (entry[PAGES]) {
      parts.push('<span class="badge badge-page">p.&nbsp;' + escapeHtml(entry[PAGES]) + '</span>');
    }
    if (entry[NOTE]) {
      parts.push('<p class="entry-note">' + escapeHtml(entry[NOTE]) + '</p>');
    }
    parts.push('</div>');

    parts.push('</li>');
    return parts.join('');
  }

  function renderPage(reset) {
    const needle = fold(query.value).trim();
    if (reset) {
      results.innerHTML = '';
      shown = 0;
    }
    const next = matches.slice(shown, shown + PAGE_SIZE);
    results.insertAdjacentHTML(
      'beforeend',
      next.map((entry) => renderEntry(entry, needle)).join('')
    );
    shown += next.length;
    more.hidden = shown >= matches.length;
  }

  function update() {
    matches = search(query.value);
    const total = numberFormat.format(matches.length);

    if (!matches.length) {
      status.textContent = query.value.trim()
        ? `No entries match “${query.value.trim()}”.`
        : 'No entries match this filter.';
      results.innerHTML = '';
      more.hidden = true;
      return;
    }

    status.textContent = query.value.trim()
      ? `${total} ${matches.length === 1 ? 'entry' : 'entries'} matching “${query.value.trim()}”.`
      : `Showing all ${total} entries. Start typing to narrow them down.`;

    renderPage(true);
  }

  function renderPhrasebook(phrasebook) {
    if (!groups || !Array.isArray(phrasebook) || !phrasebook.length) return;
    groups.innerHTML = phrasebook.map((group) => {
      const items = group.words.map((word) => (
        '<li>'
        + '<span>'
        + '<span class="phrase-tina">' + escapeHtml(word.tina) + '</span><br>'
        + '<span class="phrase-en">' + escapeHtml(word.en) + '</span>'
        + '</span>'
        + (word.pages
          ? '<span class="phrase-page">p.&nbsp;' + escapeHtml(word.pages) + '</span>'
          : '')
        + '</li>'
      )).join('');
      return '<div class="phrase-group">'
        + '<h3>' + escapeHtml(group.title) + '</h3>'
        + '<ul>' + items + '</ul>'
        + '</div>';
    }).join('');
  }

  /* --- wiring ------------------------------------------------------------ */

  let debounce = 0;
  query.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(update, 110);
  });

  more.addEventListener('click', () => renderPage(false));

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      filter = chip.dataset.filter;
      chips.forEach((other) => {
        const active = other === chip;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-pressed', String(active));
      });
      update();
    });
  });

  fetch(DATA_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      entries = payload.entries || [];
      /* One folded string per entry keeps every keystroke cheap. */
      haystack = entries.map((entry) => fold(
        entry[TINA] + ' ' + entry[EN] + ' ' + entry[FIL]
      ));
      renderPhrasebook(payload.phrasebook);
      update();
    })
    .catch(() => {
      status.textContent =
        'The dictionary could not be loaded just now. You can still download the '
        + 'complete data file, which includes every page reference and confidence rating.';
      if (groups) {
        groups.setAttribute('data-empty', 'The phrasebook could not be loaded.');
      }
    });
})();
