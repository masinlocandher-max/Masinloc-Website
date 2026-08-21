(() => {
  'use strict';

  const PAGE_SIZE = 36;
  const SOURCE_ENTRY_COUNT = 5222;
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

  // These are kept as a separate community-confirmed learning layer.
  // They do not alter, overwrite, or inflate the locked 5,222-entry source master.
  const COMMUNITY_CONFIRMED = [
    { word: 'lanom', english: 'water', filipino: 'tubig', type: 'word' },
    { word: 'ayama', english: 'crabs', filipino: 'mga alimango / crab', type: 'word' },
    { word: 'talacaca', english: 'sibling', filipino: 'kapatid', type: 'word' },
    { word: 'nakabayo', english: 'young man', filipino: 'binata', type: 'word' },
    { word: 'masitas', english: 'plants', filipino: 'mga halaman', type: 'word' },
    { word: 'cabatwan', english: 'river', filipino: 'ilog', type: 'word' },
    { word: 'oybon', english: 'egg', filipino: 'itlog', type: 'word' },
    { word: 'awlo', english: 'sun', filipino: 'araw', type: 'word' },
    { word: 'matibya', english: 'red', filipino: 'pula', type: 'word' },
    { word: 'labay-labay', english: 'likes very much', filipino: 'gustong-gusto', type: 'word' },
    { word: 'macicwa', english: 'to ask for', filipino: 'manghingi', type: 'word' },
    { word: 'igwa', english: 'to put / place', filipino: 'ilagay', type: 'word' },
    { word: 'balaybay mi', english: 'our garden', filipino: 'garden namin', type: 'phrase' },
    { word: 'Omnoy damolag a main?', english: 'How many carabaos are there?', filipino: 'Ilang kalabaw ang mayroon?', type: 'phrase' },
    { word: 'Inaro ni Cha Baby yay masitas na.', english: 'Cha Baby loves her plant.', filipino: 'Mahal ni Cha Baby ang halaman niya.', type: 'phrase' }
  ];

  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function normalized(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
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
    return COMMUNITY_CONFIRMED.map((item) => ({
      word: item.word,
      pos: item.type === 'phrase' ? 'phrase' : '',
      english: item.english,
      filipino: item.filipino,
      review: false,
      community: true
    }));
  }

  async function inflateDataset() {
    if (!window.SAMBAL_TINA_DATA) throw new Error('Dictionary source data is unavailable.');
    if (!('DecompressionStream' in window)) throw new Error('This dictionary needs a current browser with built-in gzip support.');
    const raw = atob(window.SAMBAL_TINA_DATA);
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const json = await new Response(stream).text();
    const parsed = JSON.parse(json);
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
    COMMUNITY_CONFIRMED.forEach((item) => {
      const button = make('button', 'community-word');
      button.type = 'button';
      button.setAttribute('aria-label', `Search for ${item.word}`);
      button.append(
        make('strong', '', item.word),
        make('span', '', item.filipino || item.english)
      );
      button.addEventListener('click', () => {
        const input = $('dictionarySearch');
        input.value = item.word;
        state.query = item.word;
        state.letter = 'ALL';
        state.visible = PAGE_SIZE;
        buildLetters();
        applyFilters();
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      root.append(button);
    });
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
      return [entry.word, entry.english, entry.filipino, entry.pos].some((value) => normalized(value).includes(q));
    });
    state.filtered.sort((a, b) => {
      if (a.community !== b.community && q) return a.community ? -1 : 1;
      return a.word.localeCompare(b.word, 'fil', { sensitivity: 'base' });
    });
    renderCards();
  }

  function wordCard(entry) {
    const classNames = ['word-card'];
    if (entry.review) classNames.push('review');
    if (entry.community) classNames.push('community-entry');
    const card = make('article', classNames.join(' '));
    const head = make('div', 'word-head');
    head.append(make('h2', '', entry.word || 'Untitled entry'));
    if (entry.pos) head.append(make('span', 'word-pos', entry.pos));

    const reading = make('p', 'word-reading');
    reading.append(make('small', '', entry.community ? 'Community-confirmed form' : 'Reading guide'));
    reading.append(document.createTextNode(readingLabel(entry.word)));

    const definition = make('p', 'word-definition', entry.english || 'English meaning not supplied in this source entry.');
    const meta = make('div', 'word-meta');
    meta.append(make('span', '', entry.filipino ? `Filipino: ${entry.filipino}` : 'Filipino equivalent not supplied'));
    if (entry.community) meta.append(make('span', 'community-badge', 'Community-confirmed'));
    else if (entry.review) meta.append(make('span', 'word-review', 'Source review'));

    card.append(head, reading, definition, meta);
    return card;
  }

  function renderCards() {
    const grid = $('dictionaryGrid');
    const total = state.filtered.length;
    const shown = Math.min(state.visible, total);
    const sourceLabel = state.sourceReady ? `${SOURCE_ENTRY_COUNT.toLocaleString()} source entries` : 'Community layer available';
    $('resultCount').textContent = state.query || state.letter !== 'ALL'
      ? `${total.toLocaleString()} ${total === 1 ? 'result' : 'results'}`
      : sourceLabel;
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
    } catch (error) {
      console.error(error);
      state.sourceReady = false;
      state.entries = [...state.communityEntries];
      $('dictionaryTotal').textContent = SOURCE_ENTRY_COUNT.toLocaleString();
      setSourceStatus('Source master is being repaired. Community-confirmed learning notes remain available.', 'fallback');
    }

    renderWordOfDay();
    buildLetters();
    applyFilters();
    document.documentElement.classList.add('dictionary-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
