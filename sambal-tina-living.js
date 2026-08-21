/* User-confirmed living Sambal Tina layer.
 *
 * The archival dictionary remains untouched. This small bridge adds current,
 * explicitly confirmed usage at read time, preserving archival spellings and
 * page citations while making living forms searchable beside them.
 */
(() => {
  'use strict';

  const ARCHIVE_PATH = 'data/sambal-tina.json';
  const LIVING_URL = 'data/sambal-tina-living.json?v=20260822-1';
  const LIVING_STATUS = 'USER-CONFIRMED LIVING USAGE';
  const LIVING_MARKER = 'User-confirmed living usage.';
  const ARCHIVE_COUNT = 5222;
  const nativeFetch = window.fetch.bind(window);
  const numberFormat = new Intl.NumberFormat('en-US');

  const fold = (value) => String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  function noteFor(item, suppliedGlosses = []) {
    const supplied = suppliedGlosses.length
      ? `Living layer supplies the missing ${suppliedGlosses.join(' and ')} gloss for search/display; the archival source row remains unchanged.`
      : '';
    return [
      LIVING_MARKER,
      item.verification ? item.verification + '.' : '',
      item.archive_relation || '',
      supplied,
      item.note || ''
    ].filter(Boolean).join(' ');
  }

  function mergeLivingUsage(archive, living) {
    if (!archive || !Array.isArray(archive.entries) || !Array.isArray(living?.entries)) {
      return archive;
    }

    archive.statuses = Array.isArray(archive.statuses) ? archive.statuses : [];
    let livingStatusIndex = archive.statuses.indexOf(LIVING_STATUS);
    if (livingStatusIndex < 0) {
      livingStatusIndex = archive.statuses.push(LIVING_STATUS) - 1;
    }

    const byHeadword = new Map();
    archive.entries.forEach((entry) => {
      const key = fold(entry?.[0]).trim();
      if (key && !byHeadword.has(key)) byHeadword.set(key, entry);
    });

    let added = 0;
    let reinforced = 0;

    living.entries.forEach((item) => {
      const key = fold(item.tina).trim();
      if (!key) return;
      const existing = byHeadword.get(key);

      if (existing) {
        const suppliedGlosses = [];
        if (!String(existing[2] || '').trim() && item.en) {
          existing[2] = item.en;
          suppliedGlosses.push('English');
        }
        if (!String(existing[3] || '').trim() && item.fil) {
          existing[3] = item.fil;
          suppliedGlosses.push('Filipino');
        }

        const livingNote = noteFor(item, suppliedGlosses);
        const oldNote = String(existing[7] || '').trim();
        if (!oldNote.includes(LIVING_MARKER)) {
          existing[7] = [oldNote, livingNote].filter(Boolean).join(' ');
        }
        reinforced += 1;
        return;
      }

      const entry = [
        item.tina || '',
        item.pos || '',
        item.en || '',
        item.fil || '',
        '',
        livingStatusIndex,
        3,
        noteFor(item)
      ];
      archive.entries.push(entry);
      byHeadword.set(key, entry);
      added += 1;
    });

    archive.living_usage = {
      title: living.title || 'Sambal Tina living usage',
      source_layer: living.source_layer || LIVING_STATUS,
      editorial_rule: living.editorial_rule || '',
      confirmed: living.entries.length,
      added_to_archive_search: added,
      already_archive_backed: reinforced
    };
    window.__SAMBAL_LIVING_USAGE__ = archive.living_usage;

    return archive;
  }

  window.fetch = async (input, init) => {
    const requestUrl = typeof input === 'string' ? input : input?.url || '';
    if (!requestUrl.includes(ARCHIVE_PATH)) return nativeFetch(input, init);

    const archiveResponse = await nativeFetch(input, init);
    if (!archiveResponse.ok) return archiveResponse;

    let archive;
    try {
      archive = await archiveResponse.clone().json();
    } catch {
      return archiveResponse;
    }

    try {
      const livingResponse = await nativeFetch(LIVING_URL, { cache: 'no-store' });
      if (livingResponse.ok) {
        const living = await livingResponse.json();
        mergeLivingUsage(archive, living);
      }
    } catch {
      /* Archive search must remain usable even if the small living layer fails. */
    }

    const headers = new Headers(archiveResponse.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.delete('content-length');
    return new Response(JSON.stringify(archive), {
      status: archiveResponse.status,
      statusText: archiveResponse.statusText,
      headers
    });
  };

  function decorateEntry(entry) {
    if (!entry || entry.dataset.livingDecorated === 'true') return;
    const status = entry.querySelector('.entry-status');
    const note = entry.querySelector('.entry-note');
    const isLivingOnly = status?.textContent?.trim() === LIVING_STATUS;
    const isLiving = isLivingOnly || note?.textContent?.includes(LIVING_MARKER);
    if (!isLiving) return;

    entry.dataset.livingDecorated = 'true';
    entry.classList.add('is-living-usage');

    const meta = entry.querySelector('.entry-meta');
    const confidenceBadge = meta?.querySelector('.badge-strong, .badge-ok, .badge-check');

    if (isLivingOnly && confidenceBadge) {
      confidenceBadge.className = 'badge badge-living';
      confidenceBadge.textContent = 'User-confirmed';
    } else if (meta && !meta.querySelector('.badge-living')) {
      const livingBadge = document.createElement('span');
      livingBadge.className = 'badge badge-living';
      livingBadge.textContent = 'User-confirmed';
      meta.insertBefore(livingBadge, meta.querySelector('.entry-copy'));
    }

    if (isLivingOnly && status) {
      status.classList.add('entry-status-living');
      status.textContent = 'Living usage confirmed in current project work.';
    }
  }

  function decorateResults() {
    document.querySelectorAll('#dictResults .dict-entry').forEach(decorateEntry);
  }

  function decorateStatus() {
    const meta = window.__SAMBAL_LIVING_USAGE__;
    const status = document.getElementById('dictStatus');
    const query = document.getElementById('dictQuery');
    const allActive = document.querySelector('.chip[data-filter="all"]')?.classList.contains('is-active');
    const letterActive = document.querySelector('.dict-alphabet button.is-active[data-letter]:not([data-letter=""])');
    if (!meta || !status || !query || query.value.trim() || !allActive || letterActive) return;

    const text = status.textContent || '';
    if (!/^\d[\d,]* entries\.$/.test(text.trim())) return;

    const searchable = ARCHIVE_COUNT + meta.added_to_archive_search;
    status.textContent = `${numberFormat.format(ARCHIVE_COUNT)} archive entries + `
      + `${numberFormat.format(meta.added_to_archive_search)} living-only forms `
      + `(${numberFormat.format(searchable)} searchable). `
      + `${numberFormat.format(meta.confirmed)} forms are user-confirmed in the living layer.`;
  }

  const results = document.getElementById('dictResults');
  if (results) {
    new MutationObserver(() => {
      decorateResults();
      decorateStatus();
    }).observe(results, { childList: true, subtree: true });
    decorateResults();
  }

  const status = document.getElementById('dictStatus');
  if (status) {
    new MutationObserver(decorateStatus).observe(status, { childList: true, characterData: true, subtree: true });
  }
})();
