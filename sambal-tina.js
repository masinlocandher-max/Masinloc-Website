(() => {
  'use strict';

  const PAGE_SIZE = 36;
  const SOURCE_ENTRY_COUNT = 5222;
  const DATA_FILES = [
    'data/sambal-tina-v2-01.js',
    'data/sambal-tina-v2-02.js',
    'data/sambal-tina-v2-03.js',
    'data/sambal-tina-v2-04.js',
    'data/sambal-tina-v2-05.js'
  ];

  const state = {
    sourceEntries: [],
    communityEntries: [],
    entries: [],
    filtered: [],
    visible: PAGE_SIZE,
    letter: 'ALL',
    query: '',
    sourceReady: false
  };

  const $ = (id) => document.getElementById(id);

  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function normalized(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function initialLetter(word) {
    const match = normalized(word).match(/[a-z]/);
    return match ? match[0].toUpperCase() : '#';
  }

  function readingLabel(word) {
    const source = String(word || '').trim();
    if (!source) return 'Source spelling unavailable';
    return source.replace(/-/g, ' ʔ ').replace(/\s+/g, ' ').trim();
  }

  function communityRows() {
    const source = window.SAMBAL_TINA_COMMUNITY;
    if (!source || !Array.isArray(source.entries)) return [];
    return source.entries.map((item) => ({
      word: String(item.word || '').trim(),
      pos: String(item.type || '').trim(),
      english: String(item.english || '').trim(),
      filipino: String(item.filipino || '').trim(),
      review: false,
      community: true,
      note: String(item.note || '').trim()
    })).filter((entry) => entry.word);
  }

  function bytesFromBase64(value) {
    const raw = atob(value);
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => {
      merged.set(part, offset);
      offset += part.length;
    });
    return merged;
  }

  async function fetchDataChunks() {
    return Promise.all(DATA_FILES.map(async (path) => {
      const response = await fetch(path, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Dictionary data file failed to load: ${path}`);
      const text = await response.text();
      const match = text.match(/\+"([A-Za-z0-9+/=]+)";?\s*$/);
      if (!match) throw new Error(`Dictionary data wrapper is invalid: ${path}`);
      return match[1];
    }));
  }

  async function gunzipJson(bytes) {
    if (!('DecompressionStream' in window)) {
      throw new Error('This dictionary needs a current browser with built-in gzip support.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const json = await new Response(stream).text();
    return JSON.parse(json);
  }

  async function inflateDataset() {
    const chunks = await fetchDataChunks();
    const candidates = [];

    // Some build pipelines encode binary chunks separately, while others split
    // one base64 stream. Support both layouts without rewriting the master data.
    try {
      candidates.push(concatBytes(chunks.map(bytesFromBase64)));
    } catch (error) {
      console.warn('Per-chunk base64 decode was not usable.', error);
    }
    try {
      candidates.push(bytesFromBase64(chunks.join('')));
    } catch (error) {
      console.warn('Joined base64 decode was not usable.', error);
    }

    let parsed = null;
    let lastError = null;
    for (const candidate of candidates) {
      try {
        parsed = await gunzipJson(candidate);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!parsed) throw lastError || new Error('The dictionary source could not be decoded.');
    if (!Array.isArray(parsed) || parsed.length !== SOURCE_ENTRY_COUNT) {
      throw new Error('The dictionary source did not pass its 5,222-entry integrity check.');
    }

    return parsed.map((row) => ({
      word: String(row[0] || '').trim(),
      pos: String(row[1] || '').trim(),
      english: String(row[2] || '').trim(),
      filipino: String(row[3] || '').trim(),
      review: Number(row[4]) === 1,
      community: false
    }));
  }

  function mergeSearchLayer() {
    const seen = new Set(state.sourceEntries.map((entry) => normalized(entry.word)));
    const supplemental = state.communityEntries.filter((entry) => !seen.has(normalized(entry.word)));
    state.entries = [...state.sourceEntries, ...supplemental];
  }

  function dateSeed() {
    const now = new Date();
    return Number(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`);
  }

  function renderWordOfDay() {
    const eligible = state.sourceReady
      ? state.sourceEntries.filter((entry) => !entry.review && entry.word && entry.english)
      : state.communityEntries.filter((entry) => entry.word && entry.english);
    if (!eligible.length) return;
    const entry = eligible[dateSeed() % eligible.length];
    $('wordDayWord').textContent = entry.word;
    $('wordDayMeaning').textContent = entry.english + (entry.filipino ? ` · ${entry.filipino}` : '');
    $('wordDayReading').textContent = readingLabel(entry.word);
  }

  function renderCommunityWords() {
    const root = $('communityWords');
    if (!root) return;
    root.replaceChildren();

    state.communityEntries.forEach((entry) => {
      const button = make('button', 'community-word');
      button.type = 'button';
      button.setAttribute('aria-label', `Search for ${entry.word}`);
      button.append(
        make('strong', '', entry.word),
        make('span', '', entry.filipino || entry.english)
      );
      button.addEventListener('click', () => {
        const input = $('dictionarySearch');
        input.value = entry.word;
        state.query = entry.word;
        state.letter = 'ALL';
        state.visible = PAGE_SIZE;
        buildLetters();
        applyFilters();
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      root.append(button);
    });

    const exampleRoot = $('communityExample');
    const examples = window.SAMBAL_TINA_COMMUNITY?.examples || [];
    if (exampleRoot && examples.length) {
      const example = examples[0];
      exampleRoot.replaceChildren(
        make('p', 'community-example-label', 'Language in use'),
        make('blockquote', '', example.tina),
        make('p', 'community-example-translation', example.filipino),
        make('small', '', 'Community-confirmed learning sentence')
      );
    }
  }

  function buildLetters() {
    const rail = $('letterRail');
    const letters = ['ALL', ...Array.from(new Set(state.entries.map((entry) => initialLetter(entry.word))))
      .filter((letter) => /[A-Z]/.test(letter))
      .sort()];
    rail.replaceChildren();
    letters.forEach((letter) => {
      const button = make('button', letter === state.letter ? 'active' : '', letter === 'ALL' ? 'All' : letter);
      button.type = 'button';
      button.dataset.letter = letter;
      button.setAttribute('aria-pressed', String(letter === state.letter));
      button.addEventListener('click', () => {
        state.letter = letter;
        state.visible = PAGE_SIZE;
        buildLetters();
        applyFilters();
      });
      rail.append(button);
    });
  }

  function applyFilters() {
    const q = normalized(state.query);
    state.filtered = state.entries.filter((entry) => {
      const letterMatch = state.letter === 'ALL' || initialLetter(entry.word) === state.letter;
      if (!letterMatch) return false;
      if (!q) return true;
      return [entry.word, entry.english, entry.filipino, entry.pos]
        .some((value) => normalized(value).includes(q));
    });

    state.filtered.sort((a, b) => {
      if (a.community !== b.community && q) return a.community ? -1 : 1;
      return a.word.localeCompare(b.word, 'fil', { sensitivity: 'base' });
    });
    renderCards();
  }

  function wordCard(entry) {
    const classes = ['word-card'];
    if (entry.review) classes.push('review');
    if (entry.community) classes.push('community-entry');

    const card = make('article', classes.join(' '));
    const head = make('div', 'word-head');
    head.append(make('h2', '', entry.word || 'Untitled entry'));
    if (entry.pos) head.append(make('span', 'word-pos', entry.pos));

    const reading = make('p', 'word-reading');
    reading.append(make('small', '', entry.community ? 'Community-confirmed form' : 'Reading guide'));
    reading.append(document.createTextNode(readingLabel(entry.word)));

    const definition = make('p', 'word-definition', entry.english || 'English meaning not supplied in this source entry.');
    const meta = make('div', 'word-meta');
    meta.append(make('span', '', entry.filipino ? `Filipino: ${entry.filipino}` : 'Filipino equivalent not supplied'));
    if (entry.community) meta.append(make('span', 'community-badge', 'Living usage'));
    else if (entry.review) meta.append(make('span', 'word-review', 'Source review'));

    card.append(head, reading, definition, meta);
    return card;
  }

  function renderCards() {
    const grid = $('dictionaryGrid');
    const total = state.filtered.length;
    const shown = Math.min(state.visible, total);
    $('resultCount').textContent = state.query || state.letter !== 'ALL'
      ? `${total.toLocaleString()} ${total === 1 ? 'result' : 'results'}`
      : `${SOURCE_ENTRY_COUNT.toLocaleString()} source entries`;

    grid.replaceChildren();
    if (!total) {
      grid.append(make('div', 'dictionary-empty', 'No matching entry. Try another Sambal Tina spelling, English meaning, or Filipino equivalent.'));
    } else {
      state.filtered.slice(0, shown).forEach((entry) => grid.append(wordCard(entry)));
    }

    const more = $('loadMore');
    more.hidden = shown >= total;
    if (!more.hidden) more.textContent = `Show more · ${Math.min(PAGE_SIZE, total - shown)} next`;
  }

  function wireControls() {
    const input = $('dictionarySearch');
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = input.value;
        state.visible = PAGE_SIZE;
        applyFilters();
      }, 90);
    });
    $('loadMore').addEventListener('click', () => {
      state.visible += PAGE_SIZE;
      renderCards();
    });
  }

  function setSourceStatus(message, mode) {
    const el = $('sourceStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.mode = mode;
  }

  async function init() {
    state.communityEntries = communityRows();
    state.entries = [...state.communityEntries];
    renderCommunityWords();
    wireControls();

    try {
      state.sourceEntries = await inflateDataset();
      state.sourceReady = true;
      mergeSearchLayer();
      $('dictionaryTotal').textContent = SOURCE_ENTRY_COUNT.toLocaleString();
      setSourceStatus('Source master verified · 5,222 entries', 'ready');
      renderWordOfDay();
      buildLetters();
      applyFilters();
      document.documentElement.classList.add('dictionary-ready');
    } catch (error) {
      state.sourceReady = false;
      state.entries = [...state.communityEntries];
      $('dictionaryTotal').textContent = SOURCE_ENTRY_COUNT.toLocaleString();
      setSourceStatus('Source master failed its integrity check. Living-language notes remain visible while the source is repaired.', 'fallback');
      renderWordOfDay();
      buildLetters();
      applyFilters();
      document.documentElement.classList.add('dictionary-degraded');
      console.error(error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
