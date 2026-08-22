/* Adds current, explicitly confirmed Sambal Tina usage to the searchable collection. */
(() => {
  'use strict';

  const DATA_PATH = 'data/sambal-tina.json';
  const COMMUNITY_URL = 'data/sambal-tina-living.json?v=20260822-1';
  const COMMUNITY_STATUS = 'USER-CONFIRMED LIVING USAGE';
  const COMMUNITY_MARKER = 'User-confirmed living usage.';
  const nativeFetch = window.fetch.bind(window);

  const fold = (value) => String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  function noteFor(item, suppliedGlosses = []) {
    const supplied = suppliedGlosses.length
      ? `Community layer supplies the missing ${suppliedGlosses.join(' and ')} gloss for search/display.`
      : '';
    return [
      COMMUNITY_MARKER,
      item.verification ? item.verification + '.' : '',
      item.archive_relation || '',
      supplied,
      item.note || ''
    ].filter(Boolean).join(' ');
  }

  function mergeCommunityUsage(base, community) {
    if (!base || !Array.isArray(base.entries) || !Array.isArray(community?.entries)) return base;

    base.statuses = Array.isArray(base.statuses) ? base.statuses : [];
    let communityStatusIndex = base.statuses.indexOf(COMMUNITY_STATUS);
    if (communityStatusIndex < 0) communityStatusIndex = base.statuses.push(COMMUNITY_STATUS) - 1;

    const byHeadword = new Map();
    base.entries.forEach((entry) => {
      const key = fold(entry?.[0]).trim();
      if (key && !byHeadword.has(key)) byHeadword.set(key, entry);
    });

    community.entries.forEach((item) => {
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
        const oldNote = String(existing[7] || '').trim();
        if (!oldNote.includes(COMMUNITY_MARKER)) {
          existing[7] = [oldNote, noteFor(item, suppliedGlosses)].filter(Boolean).join(' ');
        }
        return;
      }

      const entry = [
        item.tina || '',
        item.pos || '',
        item.en || '',
        item.fil || '',
        '',
        communityStatusIndex,
        3,
        noteFor(item)
      ];
      base.entries.push(entry);
      byHeadword.set(key, entry);
    });

    return base;
  }

  window.fetch = async (input, init) => {
    const requestUrl = typeof input === 'string' ? input : input?.url || '';
    if (!requestUrl.includes(DATA_PATH)) return nativeFetch(input, init);

    const baseResponse = await nativeFetch(input, init);
    if (!baseResponse.ok) return baseResponse;

    let base;
    try {
      base = await baseResponse.clone().json();
    } catch {
      return baseResponse;
    }

    try {
      const communityResponse = await nativeFetch(COMMUNITY_URL, { cache: 'no-store' });
      if (communityResponse.ok) mergeCommunityUsage(base, await communityResponse.json());
    } catch {
      /* The base word list remains usable if the small community layer fails. */
    }

    const headers = new Headers(baseResponse.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.delete('content-length');
    return new Response(JSON.stringify(base), {
      status: baseResponse.status,
      statusText: baseResponse.statusText,
      headers
    });
  };
})();
