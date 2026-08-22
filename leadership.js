/* Portrait reveals for the leadership record.

   site.js reveals whole sections. The portraits want to arrive one after
   another rather than as a block, which is the only motion on this page
   beyond a hover.

   The reveal styles in site-polish.css are gated on html.js and the attribute
   is added here rather than in the HTML, so with scripts off every portrait is
   simply visible — the same arrangement site.js uses, for the same reason.

   The stagger deliberately restarts per group. The current mayor and the first
   former mayor arrive at the same moment in their own sections; nobody waits
   longer than anybody else for their portrait to appear. */
(() => {
  'use strict';

  const cards = [...document.querySelectorAll('.leader')];
  if (!cards.length) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  cards.forEach((card) => {
    card.setAttribute('data-reveal', 'up');
    // Position within its own list, so the delay ladder is identical in the
    // one-card section and the four-card one.
    const position = [...card.parentElement.children].indexOf(card);
    card.setAttribute('data-delay', String(Math.min(position + 1, 5)));
  });

  if (reduceMotion.matches || !('IntersectionObserver' in window)) {
    cards.forEach((card) => card.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
    /* threshold stays 0, matching site.js: a card taller than the viewport can
       never show a given percentage of itself. */
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

  cards.forEach((card) => observer.observe(card));
})();
