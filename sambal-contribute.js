(() => {
  'use strict';

  const ENDPOINT = 'https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-masinloc';
  const tabs = [...document.querySelectorAll('[data-contribution-tab]')];
  const panels = [...document.querySelectorAll('[data-contribution-panel]')];

  function setMode(mode, { focus = false } = {}) {
    tabs.forEach((tab) => {
      const active = tab.dataset.contributionTab === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.contributionPanel !== mode;
    });
    if (focus) tabs.find((tab) => tab.dataset.contributionTab === mode)?.focus();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.contributionTab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const next = event.key === 'ArrowRight'
        ? (current + 1) % tabs.length
        : (current - 1 + tabs.length) % tabs.length;
      setMode(tabs[next].dataset.contributionTab, { focus: true });
    });
  });

  document.querySelectorAll('[data-contribution-link]').forEach((link) => {
    link.addEventListener('click', () => {
      setMode(link.dataset.contributionLink || 'word');
    });
  });

  const value = (form, name) => String(new FormData(form).get(name) || '').trim();

  function buildPayload(form, mode) {
    if (mode === 'word') {
      const tina = value(form, 'tina');
      const filipino = value(form, 'filipino');
      const english = value(form, 'english');
      const place = value(form, 'place');
      const example = value(form, 'example');
      const evidence = value(form, 'evidence');
      return {
        title: `Sambal Tina word submission: ${tina}`,
        about: 'Sambal Tina language contribution',
        story: [
          `Proposed Sambal Tina form: ${tina}`,
          `Filipino meaning: ${filipino}`,
          english ? `English meaning: ${english}` : '',
          place ? `Where it is used/heard: ${place}` : '',
          example ? `Example or usage: ${example}` : '',
          evidence ? `Verification context: ${evidence}` : ''
        ].filter(Boolean).join('\n'),
        location: place,
        contributorName: value(form, 'contributorName'),
        contributorContact: value(form, 'contributorContact'),
        submissionKind: 'sambal_tina_word',
        website: value(form, 'website')
      };
    }

    const entry = value(form, 'entry');
    const proposed = value(form, 'proposed');
    const correction = value(form, 'correction');
    const evidence = value(form, 'evidence');
    return {
      title: `Sambal Tina correction: ${entry}`,
      about: 'Sambal Tina dictionary correction',
      story: [
        `Entry being corrected: ${entry}`,
        `Proposed form or meaning: ${proposed}`,
        `Correction details: ${correction}`,
        evidence ? `Verification context: ${evidence}` : ''
      ].filter(Boolean).join('\n'),
      location: '',
      contributorName: value(form, 'contributorName'),
      contributorContact: value(form, 'contributorContact'),
      submissionKind: 'sambal_tina_correction',
      website: value(form, 'website')
    };
  }

  async function send(form, mode) {
    const status = form.querySelector('.language-form-status');
    const button = form.querySelector('.language-submit');
    if (!form.reportValidity()) return;

    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Sending…';
    status.className = 'language-form-status';
    status.textContent = 'Sending your contribution for review…';

    const body = new FormData();
    body.append('category', 'story');
    body.append('payload', JSON.stringify(buildPayload(form, mode)));
    if (window.masinlocTurnstileToken) {
      body.append('turnstileToken', window.masinlocTurnstileToken);
    }

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        body,
        credentials: 'omit',
        cache: 'no-store'
      });
      let result = {};
      try { result = await response.json(); } catch {}
      if (!response.ok || !result.ok) {
        throw new Error(result.error || 'We could not submit this right now. Please try again.');
      }

      const reference = result.reference_code || result.reference || '';
      form.reset();
      status.className = 'language-form-status is-success';
      status.textContent = reference
        ? `Salamat. Your contribution is in review. Reference: ${reference}`
        : 'Salamat. Your contribution is in review.';
    } catch (error) {
      status.className = 'language-form-status is-error';
      status.textContent = error instanceof Error
        ? error.message
        : 'We could not submit this right now. Please try again.';
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  document.getElementById('sambalWordForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    send(event.currentTarget, 'word');
  });

  document.getElementById('sambalCorrectionForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    send(event.currentTarget, 'correction');
  });
})();
