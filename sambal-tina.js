/* The Masinloc Sambal Tina Dictionary search experience. */
(() => {
  'use strict';

  const DATA_URL = 'data/sambal-tina.json?v=20260821-3';
  const PAGE_SIZE = 60;
  const TINA = 0, POS = 1, EN = 2, FIL = 3, PAGES = 4, STATUS = 5, CONF = 6, NOTE = 7;
  const COMMUNITY_STATUS = 'USER-CONFIRMED LIVING USAGE';
  const COMMUNITY_MARKER = 'User-confirmed living usage.';

  const query = document.getElementById('dictQuery');
  const clear = document.getElementById('dictClear');
  const status = document.getElementById('dictStatus');
  const results = document.getElementById('dictResults');
  const more = document.getElementById('dictMore');
  const groups = document.getElementById('phrasebookGroups');
  const alphabet = document.getElementById('dictAlphabet');
  const daily = document.getElementById('daily');
  const chips = [...document.querySelectorAll('.chip')];
  const entryCount = document.getElementById('dictionaryEntryCount');

  if (!query || !results || !status) return;

  let entries = [];
  let haystack = [];
  let statuses = [];
  let matches = [];
  let shown = 0;
  let filter = 'all';
  let letter = '';

  const numberFormat = new Intl.NumberFormat('en-US');

  const escapeHtml = (value) => String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character])
  );

  function fold(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  /* Two badges, because the published collection now holds two kinds of entry.
     There used to be a third, "Review in progress", for readings whose glyphs
     the transcription could not resolve. Those are no longer published at all —
     they wait in the editors' review queue until somebody confirms them against
     the archive page — so nothing on this page needs that label. */
  function badgeFor(confidence) {
    if (confidence >= 4) return { className: 'badge-strong', label: 'Verified' };
    return { className: 'badge-ok', label: 'Reviewed' };
  }

  function isCommunityConfirmed(entry) {
    const statusText = statuses[entry[STATUS]] || '';
    return statusText === COMMUNITY_STATUS || String(entry[NOTE] || '').includes(COMMUNITY_MARKER);
  }

  function passesFilter(entry) {
    if (filter === 'supported' && entry[CONF] < 4) return false;
    if (letter && fold(entry[TINA]).charAt(0) !== letter) return false;
    return true;
  }

  function highlight(value, needle) {
    const text = escapeHtml(value);
    if (!needle) return text;
    const at = fold(value).indexOf(needle);
    if (at < 0) return text;

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
      if (haystack[i].indexOf(needle) < 0) continue;
      (fold(entries[i][TINA]).startsWith(needle) ? starts : contains).push(entries[i]);
    }
    return starts.concat(contains);
  }


  /* --- the editable layer ------------------------------------------------ */

  /* The archive is a static file and stays that way: it records what the
     source says. Anything an editor adds or corrects lives in the database and
     is merged in here, so a correction is visibly a correction rather than a
     silent rewrite of the record.

     Read directly over REST rather than through the client library, because
     the page needs one small GET and not a bundle. The key is the publishable
     one; row-level security and column grants are what actually protect the
     table, and only published rows with public columns are reachable. */
  const EDITS_URL = 'https://uwcqvsitjtknxsaypjxj.supabase.co/rest/v1/dictionary_entries'
    + '?select=tina,pos,en,fil,example,example_en,note,layer,credit_name'
    + '&status=eq.published&order=tina.asc';
  const EDITS_KEY = 'sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';

  const LAYER_LABEL = {
    living: 'Confirmed by speakers',
    correction: 'Corrected reading',
    new: 'Added by the community',
  };

  /* Editor rows are folded into the same shape the archive uses, so search,
     filtering and rendering need no special case. */
  function asEntry(row) {
    const entry = [];
    entry[TINA] = row.tina || '';
    entry[POS] = row.pos || '';
    entry[EN] = row.en || '';
    entry[FIL] = row.fil || '';
    entry[PAGES] = '';
    entry[STATUS] = null;
    /* Editor-maintained readings are settled by definition: someone decided
       them on purpose rather than reading them off a damaged page. */
    entry[CONF] = 5;
    entry[NOTE] = row.note || '';
    entry.edited = {
      layer: row.layer || 'living',
      credit: row.credit_name || '',
      example: row.example || '',
      exampleEn: row.example_en || '',
    };
    return entry;
  }

  function loadEdits() {
    return fetch(EDITS_URL, { headers: { apikey: EDITS_KEY }, cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows) => (Array.isArray(rows) ? rows.map(asEntry) : []))
      /* The archive alone is a complete dictionary. If this layer cannot be
         reached the page carries on rather than failing. */
      .catch(() => []);
  }

  function mergeEdits(edited) {
    if (!edited.length) return;
    const at = new Map();
    entries.forEach((entry, i) => at.set(fold(entry[TINA]), i));
    edited.forEach((entry) => {
      const key = fold(entry[TINA]);
      const found = at.get(key);
      /* A correction replaces the archive reading in the search results; a new
         word joins the list. Either way the entry carries its own label. */
      if (found !== undefined && entry.edited.layer === 'correction') entries[found] = entry;
      else if (found === undefined) entries.push(entry);
      else entries[found] = entry;
    });
    entries.sort((a, b) => fold(a[TINA]).localeCompare(fold(b[TINA])));
    haystack = entries.map((entry) => fold(entry[TINA] + ' ' + entry[EN] + ' ' + entry[FIL]));
  }

  function renderEntry(entry, needle) {
    const badge = badgeFor(entry[CONF]);
    const community = isCommunityConfirmed(entry);
    const parts = [];

    parts.push('<li class="dict-entry' + (community ? ' is-living-usage' : '')
      + '" data-tina="' + escapeHtml(entry[TINA]) + '">');

    parts.push('<div class="entry-head">');
    parts.push('<p class="entry-tina">' + highlight(entry[TINA], needle) + '</p>');
    if (entry[POS]) parts.push('<span class="entry-pos">' + escapeHtml(entry[POS]) + '</span>');
    parts.push('</div>');

    parts.push('<div class="entry-glosses">');
    if (entry[EN]) parts.push('<p class="entry-en">' + highlight(entry[EN], needle) + '</p>');
    else parts.push('<p class="entry-missing">Meaning still being reviewed.</p>');
    if (entry[FIL]) parts.push('<p class="entry-fil">' + highlight(entry[FIL], needle) + '</p>');
    if (entry.edited && entry.edited.example) {
      parts.push('<p class="entry-example">' + escapeHtml(entry.edited.example)
        + (entry.edited.exampleEn
          ? ' <span>' + escapeHtml(entry.edited.exampleEn) + '</span>'
          : '') + '</p>');
    }
    parts.push('</div>');

    parts.push('<div class="entry-meta">');
    if (entry.edited) {
      parts.push('<span class="badge badge-edited">'
        + escapeHtml(LAYER_LABEL[entry.edited.layer] || 'Confirmed by speakers') + '</span>');
      if (entry.edited.credit) {
        parts.push('<span class="entry-credit">Added by '
          + escapeHtml(entry.edited.credit) + '</span>');
      }
    }
    parts.push('<span class="badge ' + badge.className + '">' + badge.label + '</span>');
    if (community) parts.push('<span class="badge badge-living">Community-confirmed</span>');
    parts.push('<button type="button" class="entry-copy" data-copy="'
      + escapeHtml(entry[TINA]) + '">Copy</button>');
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
    results.insertAdjacentHTML('beforeend', next.map((entry) => renderEntry(entry, needle)).join(''));
    shown += next.length;
    more.hidden = shown >= matches.length;
    if (!more.hidden) {
      more.textContent = 'Show more (' + numberFormat.format(matches.length - shown) + ' remaining)';
    }
  }

  function refreshCounts() {
    const term = fold(query.value).trim();
    const counts = { all: 0, supported: 0 };

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (letter && fold(entry[TINA]).charAt(0) !== letter) continue;
      if (term && haystack[i].indexOf(term) < 0) continue;
      counts.all += 1;
      if (entry[CONF] >= 4) counts.supported += 1;
    }

    chips.forEach((chip) => {
      const slot = chip.querySelector('.chip-count');
      if (slot) slot.textContent = numberFormat.format(counts[chip.dataset.filter] ?? 0);
    });
  }

  function update(pushState) {
    matches = search(query.value);
    const term = query.value.trim();
    const total = numberFormat.format(matches.length);

    clear.hidden = !term;
    refreshCounts();

    if (!matches.length) {
      status.textContent = term ? `No entries match “${term}”.` : 'No entries match this filter.';
      results.innerHTML = '';
      more.hidden = true;
    } else {
      status.textContent = term
        ? `${total} ${matches.length === 1 ? 'entry' : 'entries'} matching “${term}”.`
        : `${total} searchable entries.`;
      renderPage(true);
    }

    if (pushState !== false) syncUrl();
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (query.value.trim()) params.set('q', query.value.trim());
    if (filter !== 'all') params.set('status', filter);
    if (letter) params.set('letter', letter);
    const hash = params.toString();
    const url = window.location.pathname + (hash ? '#' + hash : '');
    window.history.replaceState(null, '', url);
  }

  function readUrl() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const term = params.get('q');
    const wanted = params.get('status');
    const initial = params.get('letter');

    if (term) query.value = term;
    if (wanted && ['all', 'supported'].includes(wanted)) filter = wanted;
    if (initial) letter = fold(initial).charAt(0);

    chips.forEach((chip) => {
      const active = chip.dataset.filter === filter;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
  }

  function renderAlphabet() {
    if (!alphabet) return;
    const available = new Set(entries.map((entry) => fold(entry[TINA]).charAt(0))
      .filter((character) => /[a-z]/.test(character)));
    const buttons = ['<button type="button" data-letter="" class="'
      + (letter ? '' : 'is-active') + '">All</button>'];
    [...available].sort().forEach((character) => {
      buttons.push('<button type="button" data-letter="' + character + '" class="'
        + (letter === character ? 'is-active' : '') + '">'
        + character.toUpperCase() + '</button>');
    });
    alphabet.innerHTML = buttons.join('');
  }

  const SUSPECT = /[0-9~_!\]·]|[a-z][A-Z]|\w[fF]\w/;
  const firstSense = (gloss) => String(gloss || '').split(/[;,]/)[0].trim();
  const cleanGloss = (gloss) => {
    const sense = firstSense(gloss);
    return sense && !SUSPECT.test(sense) ? sense : '';
  };

  function renderDaily() {
    if (!daily) return;
    const entry = entries.find((item) => fold(item[TINA]) === 'matibya');
    if (!entry) return;

    const english = cleanGloss(entry[EN]) || 'red';
    const filipino = cleanGloss(entry[FIL]) || 'pula';
    daily.querySelector('.daily-word').textContent = 'matibya';
    daily.querySelector('.daily-gloss').textContent = `${english} · ${filipino}`;
    daily.querySelector('.daily-meta').textContent = 'Community-confirmed · adjective';
    daily.hidden = false;
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
        + '</li>'
      )).join('');
      return '<div class="phrase-group">'
        + '<h3>' + escapeHtml(group.title) + '</h3>'
        + '<ul>' + items + '</ul>'
        + '</div>';
    }).join('');
  }

  let debounce = 0;
  query.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(update, 110);
  });

  clear.addEventListener('click', () => {
    query.value = '';
    query.focus();
    update();
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

  if (alphabet) {
    alphabet.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-letter]');
      if (!button) return;
      letter = button.dataset.letter;
      renderAlphabet();
      update();
    });
  }

  results.addEventListener('click', (event) => {
    const button = event.target.closest('.entry-copy');
    if (!button || !navigator.clipboard) return;
    navigator.clipboard.writeText(button.dataset.copy).then(() => {
      button.textContent = 'Copied';
      button.classList.add('is-copied');
      window.setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('is-copied');
      }, 1400);
    }).catch(() => {});
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== query
        && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
      event.preventDefault();
      query.focus();
      query.select();
    } else if (event.key === 'Escape' && document.activeElement === query) {
      query.blur();
    }
  });

  window.addEventListener('hashchange', () => {
    readUrl();
    update(false);
  });

  fetch(DATA_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      entries = payload.entries || [];
      statuses = payload.statuses || [];
      haystack = entries.map((entry) => fold(entry[TINA] + ' ' + entry[EN] + ' ' + entry[FIL]));
      renderPhrasebook(payload.phrasebook);
      return loadEdits();
    })
    .then((edited) => {
      mergeEdits(edited || []);
      if (entryCount) entryCount.textContent = numberFormat.format(entries.length);
      readUrl();
      renderAlphabet();
      renderDaily();
      update(false);
    })
    .catch(() => {
      status.textContent = 'The word list could not be loaded right now. Please refresh and try again.';
      if (groups) groups.setAttribute('data-empty', 'Unavailable right now.');
    });
})();
