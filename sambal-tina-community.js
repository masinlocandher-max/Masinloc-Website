/* Community submissions and contributor credits for the Sambal Tina dictionary. */
(() => {
  'use strict';

  const ENDPOINT = 'https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-masinloc';
  const contributionModal = document.getElementById('contributionModal');
  const contributorsModal = document.getElementById('contributorsModal');
  const form = document.getElementById('dictionaryContributionForm');
  const message = document.getElementById('dictionaryFormMessage');
  const contributorsList = document.getElementById('contributorsList');
  const submissionType = document.getElementById('submissionType');
  let lastFocus = null;
  let contributorsLoaded = false;

  if (!contributionModal || !contributorsModal || !form) return;

  function openModal(modal) {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('dict-modal-open');
    window.setTimeout(() => modal.querySelector('button, input, textarea')?.focus(), 0);
  }

  function closeModal(modal) {
    modal.hidden = true;
    if (contributionModal.hidden && contributorsModal.hidden) {
      document.body.classList.remove('dict-modal-open');
    }
    lastFocus?.focus?.();
  }

  function setKind(kind, { clearMessage = true } = {}) {
    const correction = kind === 'correction';
    submissionType.value = correction ? 'correction' : 'new_entry';
    form.querySelectorAll('[data-kind]').forEach((button) => {
      const active = button.dataset.kind === submissionType.value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const details = form.elements.contributionDetails;
    if (details) {
      details.required = correction;
      details.placeholder = correction
        ? 'Tell us what you believe should be corrected and what the correct form or meaning should be.'
        : 'Tell us anything helpful about the word, meaning, pronunciation, or how people use it.';
    }
    const title = document.getElementById('contributionTitle');
    if (title) title.textContent = correction ? 'Help us correct an entry.' : 'Share a word you know.';
    if (clearMessage) message.textContent = '';
  }

  document.querySelectorAll('[data-contribution-type]').forEach((button) => {
    button.addEventListener('click', () => {
      setKind(button.dataset.contributionType || 'new_entry');
      openModal(contributionModal);
    });
  });

  form.querySelectorAll('[data-kind]').forEach((button) => {
    button.addEventListener('click', () => setKind(button.dataset.kind));
  });

  async function loadContributors() {
    if (contributorsLoaded) return;
    contributorsList.textContent = 'Loading contributors…';
    try {
      const response = await fetch(`${ENDPOINT}?resource=dictionary-contributors`, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error('LOAD');

      contributorsList.innerHTML = '';
      const names = Array.isArray(result.contributors) ? result.contributors : [];
      if (!names.length) {
        const empty = document.createElement('p');
        empty.className = 'contributors-empty';
        empty.textContent = 'The public contributor list will grow as community submissions are verified and approved.';
        contributorsList.appendChild(empty);
      } else {
        const list = document.createElement('ol');
        names.forEach((name) => {
          const item = document.createElement('li');
          item.textContent = String(name);
          list.appendChild(item);
        });
        contributorsList.appendChild(list);
      }
      contributorsLoaded = true;
    } catch {
      contributorsList.textContent = 'Contributors could not be loaded right now. Please try again.';
    }
  }

  [document.getElementById('contributorsLink'), document.getElementById('contributorsLinkSecondary')]
    .filter(Boolean)
    .forEach((button) => button.addEventListener('click', async () => {
      openModal(contributorsModal);
      await loadContributors();
    }));

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.closest('.dict-modal')));
  });

  [contributionModal, contributorsModal].forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!contributionModal.hidden) closeModal(contributionModal);
    else if (!contributorsModal.hidden) closeModal(contributorsModal);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.className = 'dict-form-message';
    message.textContent = '';

    const fields = new FormData(form);
    const kind = String(fields.get('submissionType') || 'new_entry');
    const filipino = String(fields.get('filipinoMeaning') || '').trim();
    const english = String(fields.get('englishMeaning') || '').trim();
    const details = String(fields.get('contributionDetails') || '').trim();

    if (!filipino && !english && !details) {
      message.classList.add('is-error');
      message.textContent = 'Please add a meaning or a short note about the word.';
      return;
    }
    if (kind === 'correction' && !details) {
      message.classList.add('is-error');
      message.textContent = 'For a correction, please tell us what you believe should be changed.';
      return;
    }

    const submit = form.querySelector('.dict-submit');
    submit.disabled = true;
    submit.textContent = 'Sending…';

    const payload = {
      submissionType: kind,
      headword: String(fields.get('headword') || '').trim(),
      filipinoMeaning: filipino,
      englishMeaning: english,
      contributionDetails: details,
      exampleUsage: String(fields.get('exampleUsage') || '').trim(),
      contributorName: String(fields.get('contributorName') || '').trim(),
      contributorContact: String(fields.get('contributorContact') || '').trim(),
      creditName: String(fields.get('creditName') || '').trim(),
      creditConsent: fields.get('creditConsent') === 'yes',
      website: String(fields.get('website') || '')
    };

    const body = new FormData();
    body.append('category', 'dictionary');
    body.append('payload', JSON.stringify(payload));
    if (window.masinlocTurnstileToken) body.append('turnstileToken', window.masinlocTurnstileToken);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        body,
        credentials: 'omit',
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        /* The function's own contract decides this, not a status range.
           400 (validation), 403 (verification failed), 413 (too large) and
           429 (too many submissions) carry sentences written for the person
           at the form. 404 and 405 are the infrastructure answering — a
           missing or misrouted function — and repeating those puts
           "Function not found" in front of someone who only wanted to send us a word.
           Everything they typed is left in the form either way. */
        const READER_STATUSES = [400, 403, 413, 429];
        const forReader = READER_STATUSES.includes(response.status) && result.error;
        throw new Error(forReader
          ? result.error
          : 'We could not send this just now. Please try again in a few '
            + 'minutes — what you typed is still here.');
      }

      const reference = result.reference_code || result.reference || '';
      form.reset();
      setKind('new_entry', { clearMessage: false });
      message.className = 'dict-form-message is-success';
      message.textContent = reference
        ? `Salamat! We received it. Reference ${reference}. We will check whether it already exists, review the details, and verify it before approval.`
        : 'Salamat! We received it. We will check whether it already exists, review the details, and verify it before approval.';
      contributorsLoaded = false;
    } catch (error) {
      message.classList.add('is-error');
      message.textContent = error instanceof Error && error.message
        ? error.message
        : 'We could not send this right now. Please try again.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send for review';
    }
  });

  setKind('new_entry');
})();
