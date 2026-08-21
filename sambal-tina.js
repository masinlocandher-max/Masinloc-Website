(() => {
  'use strict';

  const PAGE_SIZE = 36;
  const state = { entries: [], filtered: [], visible: PAGE_SIZE, letter: 'ALL', query: '' };
  const $ = (id) => document.getElementById(id);

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
    // In the dictionary's approved modern orthography, a medial hyphen marks a glottal stop.
    // We surface that one source-supported cue while leaving stress untouched when the resolved
    // transcription does not preserve the original accent mark.
    return source.replace(/-/g, ' ʔ ').replace(/\s+/g, ' ').trim();
  }

  async function inflateDataset() {
    if (!window.SAMBAL_TINA_DATA) throw new Error('Dictionary data is unavailable.');
    if (!('DecompressionStream' in window)) throw new Error('This dictionary needs a current browser with built-in gzip support.');
    const raw = atob(window.SAMBAL_TINA_DATA);
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const json = await new Response(stream).text();
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length !== 5222) throw new Error('The dictionary dataset did not pass its entry-count check.');
    return parsed.map((row) => ({
      word: String(row[0] || '').trim(),
      pos: String(row[1] || '').trim(),
      english: String(row[2] || '').trim(),
      filipino: String(row[3] || '').trim(),
      review: Number(row[4]) === 1
    }));
  }

  function dateSeed() {
    const now = new Date();
    return Number(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`);
  }

  function renderWordOfDay() {
    const eligible = state.entries.filter((entry) => !entry.review && entry.word && entry.english);
    if (!eligible.length) return;
    const entry = eligible[dateSeed() % eligible.length];
    $('wordDayWord').textContent = entry.word;
    $('wordDayMeaning').textContent = entry.english + (entry.filipino ? ` · ${entry.filipino}` : '');
    $('wordDayReading').textContent = readingLabel(entry.word);
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
    state.filtered.sort((a, b) => a.word.localeCompare(b.word, 'fil', { sensitivity: 'base' }));
    renderCards();
  }

  function wordCard(entry) {
    const card = make('article', `word-card${entry.review ? ' review' : ''}`);
    const head = make('div', 'word-head');
    head.append(make('h2', '', entry.word || 'Untitled entry'), make('span', 'word-pos', entry.pos || 'entry'));

    const reading = make('p', 'word-reading');
    reading.append(make('small', '', 'Reading guide'));
    reading.append(document.createTextNode(readingLabel(entry.word)));

    const definition = make('p', 'word-definition', entry.english || 'English meaning not supplied in this source entry.');
    const meta = make('div', 'word-meta');
    meta.append(make('span', '', entry.filipino ? `Filipino: ${entry.filipino}` : 'Filipino equivalent not supplied'));
    if (entry.review) meta.append(make('span', 'word-review', 'Source review'));

    card.append(head, reading, definition, meta);
    return card;
  }

  function renderCards() {
    const grid = $('dictionaryGrid');
    const total = state.filtered.length;
    const shown = Math.min(state.visible, total);
    $('resultCount').textContent = `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}`;
    grid.replaceChildren();
    if (!total) grid.append(make('div', 'dictionary-empty', 'No matching entry. Try another spelling, English meaning, or Filipino equivalent.'));
    else state.filtered.slice(0, shown).forEach((entry) => grid.append(wordCard(entry)));
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
    $('loadMore').addEventListener('click', () => { state.visible += PAGE_SIZE; renderCards(); });
  }

  async function init() {
    try {
      state.entries = await inflateDataset();
      $('dictionaryTotal').textContent = state.entries.length.toLocaleString();
      renderWordOfDay();
      buildLetters();
      wireControls();
      applyFilters();
      document.documentElement.classList.add('dictionary-ready');
    } catch (error) {
      console.error(error);
      $('dictionaryGrid').replaceChildren(make('div', 'dictionary-empty', error.message || 'The dictionary could not be loaded.'));
      $('resultCount').textContent = 'Unavailable';
      $('loadMore').hidden = true;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
