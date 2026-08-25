/* Masinloc homepage behaviour.
 *
 * Every slide, every place and every dictionary entry is already in the HTML.
 * This file only adds timing and depth to markup that reads correctly without
 * it, so the page survives a failed script and is fully visible to a crawler.
 *
 * Motion is transform and opacity only. No animation library: the whole page
 * needs one carousel, one observer and one scroll handler, and pulling in a
 * framework to fade text would cost more than it does.
 */
(() => {
  'use strict';

  const root = document.querySelector('.home');
  if (!root) return;

  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* --- reveals ---------------------------------------------------------- */

  /* threshold 0, deliberately: a stage taller than the viewport can never
     show a given fraction of itself, and anything asking for one would stay
     invisible on a phone forever. */
  const revealTargets = [...document.querySelectorAll('.rise, .mask, .language-scene')];
  const reveal = (element) => {
    element.classList.add('is-in');
    shown.unobserve(element);
  };
  const shown = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      reveal(entry.target);
    });
  }, { threshold: 0, rootMargin: '0px' });

  revealTargets.forEach((element) => shown.observe(element));

  /* A reader can fling past a short row between two observer samples. Once an
     element has crossed the viewport it must not remain transparent forever,
     so a passive, frame-coalesced check reveals anything the scroll has
     already passed. This is a fallback for fast travel, not a second motion
     system: the same class and transition still do the work. */
  let revealFrame = 0;
  const revealPassed = () => {
    revealFrame = 0;
    for (const element of revealTargets) {
      if (!element.classList.contains('is-in')
          && element.getBoundingClientRect().top < window.innerHeight) {
        reveal(element);
      }
    }
  };
  window.addEventListener('scroll', () => {
    if (!revealFrame) revealFrame = requestAnimationFrame(revealPassed);
  }, { passive: true });
  revealPassed();

  /* --- hero drift ------------------------------------------------------- */
  /* The navigation's scrolled and open states belong to site.js, which every
     page shares. Duplicating them here would mean two handlers racing for
     the same class. */

  const hero = document.querySelector('.hero');
  const heroImg = document.querySelector('.hero-media img');
  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      if (heroImg && !calm.matches && y < window.innerHeight * 1.2) {
        /* The photograph lags the page slightly. Capped so it can never drift
           far enough to expose an edge. */
        heroImg.style.setProperty('--hero-drift', `${Math.min(y * 0.12, 90)}px`);
      }
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  requestAnimationFrame(() => hero?.classList.add('is-ready'));

  /* --- campaign carousel ------------------------------------------------ */

  const rail = document.querySelector('[data-rail]');
  if (rail) {
    const track = rail.querySelector('.rail-track');
    const dots = rail.querySelector('.dots');
    const real = [...track.children];
    const count = real.length;

    if (count > 1) {
      /* A clone of the first slide sits after the last one, so advancing past
         the end keeps moving forward and then snaps back invisibly. Wrapping
         by animating backwards would read as a rewind. */
      const clone = real[0].cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.querySelectorAll('a, button').forEach((el) => el.setAttribute('tabindex', '-1'));
      track.appendChild(clone);
    }

    let index = 0;
    let timer = 0;
    let held = false;

    const buttons = real.map((slide, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', `Campaign ${i + 1} of ${count}`);
      dot.addEventListener('click', () => { go(i); rest(); });
      dots.appendChild(dot);
      return dot;
    });

    function paint() {
      const at = index % count;
      buttons.forEach((dot, i) => dot.setAttribute('aria-selected', String(i === at)));
      real.forEach((slide, i) => slide.toggleAttribute('inert', i !== at));
    }

    function place(animate) {
      track.classList.toggle('is-animating', animate && !calm.matches);
      track.style.transform = `translate3d(${-index * 100}%,0,0)`;
    }

    function go(to) {
      index = to;
      place(true);
      paint();
    }

    function next() {
      if (count < 2) return;
      index += 1;
      place(true);
      if (index >= count) {
        /* Landed on the clone. Once the move finishes, jump to the real first
           slide with the transition off so the swap is invisible. */
        const settle = () => {
          track.removeEventListener('transitionend', settle);
          index = 0;
          place(false);
        };
        if (calm.matches) settle();
        else track.addEventListener('transitionend', settle);
      }
      paint();
    }

    function prev() {
      index = index <= 0 ? count - 1 : index - 1;
      place(true);
      paint();
    }

    function play() {
      if (held || calm.matches || document.hidden || count < 2) return;
      stop();
      timer = window.setInterval(next, 5000);
    }
    function stop() { window.clearInterval(timer); timer = 0; }
    function rest() { stop(); play(); }

    rail.querySelectorAll('.rail-arrow').forEach((button) => {
      button.addEventListener('click', () => {
        button.dataset.dir === 'next' ? next() : prev();
        rest();
      });
    });

    /* Pause while the visitor is actually engaging, and resume once they are
       not. Hover alone does not stop it; pointer-down, focus and touch do. */
    ['pointerdown', 'focusin'].forEach((type) =>
      rail.addEventListener(type, () => { held = true; stop(); }));
    ['pointerup', 'pointercancel', 'focusout'].forEach((type) =>
      rail.addEventListener(type, () => { held = false; play(); }));
    rail.addEventListener('mouseenter', stop);
    rail.addEventListener('mouseleave', () => { if (!held) play(); });

    document.addEventListener('visibilitychange', () => document.hidden ? stop() : play());

    /* Swipe and drag. The track follows the finger, then commits or returns
       depending on how far it travelled. */
    let startX = 0, delta = 0, dragging = false;
    const width = () => rail.querySelector('.rail-window').clientWidth || 1;

    rail.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      dragging = true; startX = event.clientX; delta = 0;
      track.classList.remove('is-animating');
    });
    rail.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      delta = event.clientX - startX;
      if (Math.abs(delta) > 8) event.preventDefault();
      track.style.transform =
        `translate3d(calc(${-index * 100}% + ${delta}px),0,0)`;
    }, { passive: false });

    function release() {
      if (!dragging) return;
      dragging = false;
      const far = Math.abs(delta) > Math.min(80, width() * 0.16);
      if (far && delta < 0) next();
      else if (far && delta > 0) prev();
      else place(true);
      delta = 0;
    }
    rail.addEventListener('pointerup', release);
    rail.addEventListener('pointercancel', release);
    rail.addEventListener('pointerleave', release);

    dots.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.key === 'ArrowRight' ? next() : prev();
      buttons[index % count].focus();
      rest();
    });

    place(false);
    paint();
    play();
  }

  /* --- discover: the photograph follows the writing ---------------------- */

  const rows = [...document.querySelectorAll('.place-row')];
  const shots = [...document.querySelectorAll('.discover-shot')];
  const caption = document.querySelector('.discover-caption');

  if (rows.length && shots.length) {
    const live = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const at = rows.indexOf(entry.target);
        if (at < 0) return;
        rows.forEach((row, i) => row.classList.toggle('is-live', i === at));
        shots.forEach((shot, i) => shot.classList.toggle('is-live', i === at));
        if (caption) caption.textContent = entry.target.dataset.where || '';
      });
    }, { threshold: 0, rootMargin: '-45% 0px -45% 0px' });
    rows.forEach((row) => live.observe(row));

    rows[0].classList.add('is-live');
    shots[0].classList.add('is-live');
    if (caption) caption.textContent = rows[0].dataset.where || '';
  }
})();
