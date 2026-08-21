(() => {
  'use strict';

  const PAGE_SIZE = 36;
  const SOURCE_ENTRY_COUNT = 5222;
  const SOURCE_REVIEW_COUNT = 97;
  const COMMUNITY_PREVIEW_COUNT = 14;
  const DATA_FILES = [
    'data/sambal-tina-v3-01.js',
    'data/sambal-tina-v3-02.js',
    'data/sambal-tina-v3-03.js',
    'data/sambal-tina-v3-04.js',
    'data/sambal-tina-v3-05.js',
    'data/sambal-tina-v3-06.js',
    'data/sambal-tina-v3-07.js',
    'data/sambal-tina-v3-08.js'
  ];

  const state = {
    sourceEntries: [],
    communityEntries: [],
    entries: [],
    filtered: [],
    visible: PAGE_SIZE,
    letter: 'ALL',
    query: '',
    sourceReady: false,
    showAllCommunity: false
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
    return source.entries
      .map((item) => ({
        word: String(item.word || '').trim(),
        pos: String(item.type || '').trim(),
        english: String(item.english || '').trim(),
        filipino: String(item.filipino || '').trim(),
        review: false,
        community: true,
        communityConfirmed: true,
        note: String(item.note || '').trim()
      }))
      .filter((entry) => entry.word);
  }

  function bytesFromBase64(value) {
    if (!value || value.length % 4 !== 0) throw new Error('Dictionary payload has invalid base64 length.');
    const raw = atob(value);
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  }

  async function fetchDataChunks() {
    const pieces = await Promise.all(DATA_FILES.map(async (path) => {
      const response = await fetch(path, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Dictionary data file failed to load: ${path}`);
      const text = await response.text();
      const match = text.match(/\+\s*"([A-Za-z0-9+/=]+)"\s*;?\s*$/);
      if (!match) throw new Error(`Dictionary data wrapper is invalid: ${path}`);
      return match[1];
    }));
    return pieces.join('');
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
    const encoded = await fetchDataChunks();
    const parsed = await gunzipJson(bytesFromBase64(encoded));

    if (!Array.isArray(parsed) || parsed.length !== SOURCE_ENTRY_COUNT) {
      throw new Error('The dictionary source did not pass its 5,222-entry integrity check.');
    }

    const reviewCount = parsed.reduce((count, row) => count + (Number(row?.[4]) === 1 ? 1 : 0), 0);
    if (reviewCount !== SOURCE_REVIEW_COUNT) {
      throw new Error('The dictionary source-review count did not pass its integrity check.');
    }

    return parsed.map((row) => ({
      word: String(row[0] || '').trim(),
      pos: String(row[1] || '').trim(),
      english: String(row[2] || '').trim(),
      filipino: String(row[3] || '').trim(),
      review: Number(row[4]) === 1,
      community: false,
      communityConfirmed: false,
      note: ''
    }));
  }

  function mergeSearchLayer() {
    const livingByWord = new Map(state.communityEntries.map((entry) => [normalized(entry.word), entry]));
    const sourceWords = new Set();

    const sourceWithLivingContext = state.sourceEntries.map((entry) => {
      const key = normalized(entry.word);
      sourceWords.add(key);
      const living = livingByWord.get(key);
      if (!living) return entry;
      return {
        ...entry,
        communityConfirmed: true,
        communityMeaning: living.english,
        communityFilipino: living.filipino,
        note: living.note
      };
    });

    const supplemental = state.communityEntries.filter((entry) => !sourceWords.has(normalized(entry.word)));
    state.entries = [...sourceWithLivingContext, ...supplemental];
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

  function searchForCommunityWord(word) {
    const input = $('dictionarySearch');
    input.value = word;
    state.query = word;
    state.letter = 'ALL';
    state.visible = PAGE_SIZE;
    buildLetters();
    applyFilters();
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderCommunityWords() {
    const root = $('communityWords');
    if (!root) return;
    root.replaceChildren();

    const visible = state.showAllCommunity
      ? state.communityEntries
      : state.communityEntries.slice(0, COMMUNITY_PREVIEW_COUNT);

    visible.forEach((entry) => {
      const button = make('button', 'community-word');
      button.type = 'button';
      button.setAttribute('aria-label', `Search for ${entry.word}`);
      button.append(
        make('strong', '', entry.word),
        make('span', '', entry.filipino || entry.english)
      );
      button.addEventListener('click', () => searchForCommunityWord(entry.word));
      root.append(button);
    });

    if (state.communityEntries.length > COMMUNITY_PREVIEW_COUNT) {
      const toggle = make(
        'button',
        'community-word community-word-toggle',
        state.showAllCommunity ? 'Show fewer words' : `View all ${state.communityEntries.length} confirmed words`
      );
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(state.showAllCommunity));
      toggle.addEventListener('click', () => {
        state.showAllCommunity = !state.showAllCommunity;
        renderCommunityWords();
      });
      root.append(toggle);
    }

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
      return [
        entry.word,
        entry.english,
        entry.filipino,
        entry.pos,
        entry.communityMeaning,
        entry.communityFilipino
      ].some((value) => normalized(value).includes(q));
    });

    state.filtered.sort((a, b) => {
      if (a.communityConfirmed !== b.communityConfirmed && q) return a.communityConfirmed ? -1 : 1;
      return a.word.localeCompare(b.word, 'fil', { sensitivity: 'base' });
    });
    renderCards();
  }

  function wordCard(entry) {
    const classes = ['word-card'];
    if (entry.review) classes.push('review');
    if (entry.community) classes.push('community-entry');
    if (entry.communityConfirmed && !entry.community) classes.push('community-confirmed-source');

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

    if (entry.community) {
      meta.append(make('span', 'community-badge', 'Living usage'));
    } else if (entry.communityConfirmed) {
      meta.append(make('span', 'community-badge', 'Source + living usage'));
    } else if (entry.review) {
      meta.append(make('span', 'word-review', 'Source review'));
    }

    card.append(head, reading, definition, meta);
    return card;
  }

  function renderCards() {
    const grid = $('dictionaryGrid');
    const total = state.filtered.length;
    const shown = Math.min(state.visible, total);
    const livingCount = state.communityEntries.length;

    if (state.query || state.letter !== 'ALL') {
      $('resultCount').textContent = `${total.toLocaleString()} ${total === 1 ? 'result' : 'results'}`;
    } else if (state.sourceReady) {
      $('resultCount').textContent = `${SOURCE_ENTRY_COUNT.toLocaleString()} source entries · ${livingCount} living confirmations`;
    } else {
      $('resultCount').textContent = `${livingCount} living confirmations`;
    }

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
      setSourceStatus('Source master verified · 5,222 entries · 97 source-review flags', 'ready');
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
