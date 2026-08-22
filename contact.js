/* Contact form.
 *
 * A message goes to the private review console and nowhere else. There is no
 * mail integration and no auto-reply: an admin reads it and writes back. The
 * confirmation says exactly that, so nobody sits waiting for an email that is
 * never coming.
 */
(() => {
  'use strict';

  const ENDPOINT = 'https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-masinloc';

  const form = document.getElementById('contactForm');
  const status = document.getElementById('contactMessage');
  if (!form || !status) return;

  const button = form.querySelector('.contact-submit');
  const value = (name) => String(new FormData(form).get(name) || '').trim();

  function say(text, tone) {
    status.textContent = text;
    status.className = 'contact-message' + (tone ? ` is-${tone}` : '');
  }

  /* Validate before sending so a mistake is corrected in place rather than
     bounced back from the server as a generic failure. */
  function firstProblem() {
    if (!value('senderName')) return ['We need a name to address you by.', 'senderName'];
    const email = value('senderEmail');
    if (!email) return ['We need an email address to reply to.', 'senderEmail'];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return ['That email address does not look right. Please check it.', 'senderEmail'];
    }
    const message = value('message');
    if (!message) return ['Please tell us what you need.', 'message'];
    if (message.length < 12) {
      return ['Please add a little more detail so we can actually help.', 'message'];
    }
    return null;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const problem = firstProblem();
    if (problem) {
      const [text, field] = problem;
      say(text, 'error');
      form.elements[field]?.focus();
      return;
    }

    const payload = {
      senderName: value('senderName'),
      senderEmail: value('senderEmail'),
      senderPhone: value('senderPhone'),
      topic: value('topic') || 'general',
      subject: value('subject'),
      message: value('message'),
      website: value('website'),
    };

    const body = new FormData();
    body.append('category', 'contact');
    body.append('payload', JSON.stringify(payload));
    if (window.masinlocTurnstileToken) {
      body.append('turnstileToken', window.masinlocTurnstileToken);
    }

    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Sending…';
    say('Sending your message…');

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST', body, credentials: 'omit', cache: 'no-store',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || 'We could not send this right now. Please try again.');
      }

      const reference = result.reference_code || result.reference || '';
      form.reset();
      say(reference
        ? `Salamat. Your message is with the team, reference ${reference}. Someone will read it and reply to you directly.`
        : 'Salamat. Your message is with the team. Someone will read it and reply to you directly.',
        'success');
      status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (error) {
      say(error instanceof Error && error.message
        ? error.message
        : 'We could not send this right now. Please try again.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
})();
