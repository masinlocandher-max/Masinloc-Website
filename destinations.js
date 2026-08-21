/* Places in Masinloc — scroll behaviour and the full-screen viewer.
 *
 * Every photograph, name, locality and rhyme is already in the HTML. This
 * script only adds motion and the viewer, so the page is complete without it.
 */
(() => {
  'use strict';

  const places = [...document.querySelectorAll('.place')];
  const links = [...document.querySelectorAll('.places-index a')];
  const viewer = document.getElementById('viewer');
  if (!places.length) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* --- which place are we in ---------------------------------------------- */

  const setCurrent = (slug) => {
    places.forEach((place) => {
      place.classList.toggle('is-current', place.dataset.place === slug);
    });
    links.forEach((link) => {
      link.classList.toggle('is-current', link.getAttribute('href') === `#${slug}`);
    });
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      /* The most-visible section wins, so a tall photograph does not hand over
         too early on the way past. */
      const best = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (best) setCurrent(best.target.dataset.place);
    }, { threshold: [0.25, 0.5, 0.75] });

    places.forEach((place) => observer.observe(place));
  } else {
    places.forEach((place) => place.classList.add('is-current'));
  }

  /* --- parallax ------------------------------------------------------------ */

  /* A slow counter-drift as each section crosses the viewport. Small on
     purpose: the photograph should feel alive, not seasick. */
  if (!reduceMotion.matches) {
    let frame = 0;

    const sync = () => {
      frame = 0;
      const viewport = window.innerHeight;
      places.forEach((place) => {
        const box = place.getBoundingClientRect();
        if (box.bottom < -200 || box.top > viewport + 200) return;
        const centre = box.top + box.height / 2;
        const offset = (centre - viewport / 2) / viewport;
        const shift = Math.max(Math.min(offset * -38, 38), -38);
        place.style.setProperty('--place-shift', `${shift.toFixed(1)}px`);
      });
    };

    const request = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(sync);
    };

    sync();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request, { passive: true });
  }

  /* --- viewer -------------------------------------------------------------- */

  if (!viewer) return;

  const image = document.getElementById('viewerImage');
  const name = document.getElementById('viewerName');
  const locality = viewer.querySelector('.viewer-locality');
  const closeButton = document.getElementById('viewerClose');
  const previous = document.getElementById('viewerPrev');
  const next = document.getElementById('viewerNext');

  let index = 0;
  let restoreFocus = null;

  const show = (position) => {
    index = (position + places.length) % places.length;
    const place = places[index];
    const source = place.querySelector('.place-media img');

    /* Reuse the largest source the browser already knows about, so opening the
       viewer is usually instant rather than a second download. */
    image.src = source.currentSrc || source.src;
    image.alt = source.alt;
    name.textContent = place.querySelector('.place-name').textContent;
    locality.textContent = place.querySelector('.place-locality').textContent;
  };

  const open = (slug) => {
    const position = places.findIndex((place) => place.dataset.place === slug);
    if (position < 0) return;
    restoreFocus = document.activeElement;
    show(position);
    viewer.hidden = false;
    viewer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('viewer-open');
    closeButton.focus();
  };

  const close = () => {
    viewer.hidden = true;
    viewer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('viewer-open');
    image.src = '';
    if (restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
    restoreFocus = null;
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open]');
    if (trigger) {
      event.preventDefault();
      open(trigger.dataset.open);
    }
  });

  closeButton.addEventListener('click', close);
  previous.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));

  /* Clicking the backdrop closes; clicking the photograph does not. */
  viewer.addEventListener('click', (event) => {
    if (event.target === viewer) close();
  });

  document.addEventListener('keydown', (event) => {
    if (viewer.hidden) return;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowLeft') show(index - 1);
    else if (event.key === 'ArrowRight') show(index + 1);
    else if (event.key === 'Tab') {
      /* Keep focus inside the dialog while it is open. */
      const focusable = [closeButton, previous, next];
      const position = focusable.indexOf(document.activeElement);
      if (position >= 0) {
        event.preventDefault();
        const step = event.shiftKey ? -1 : 1;
        focusable[(position + step + focusable.length) % focusable.length].focus();
      }
    }
  });

  /* Swipe between places on a phone. */
  let startX = 0;
  let startY = 0;
  viewer.addEventListener('touchstart', (event) => {
    startX = event.changedTouches[0].clientX;
    startY = event.changedTouches[0].clientY;
  }, { passive: true });

  viewer.addEventListener('touchend', (event) => {
    const deltaX = event.changedTouches[0].clientX - startX;
    const deltaY = event.changedTouches[0].clientY - startY;
    if (Math.abs(deltaX) > 56 && Math.abs(deltaX) > Math.abs(deltaY)) {
      show(deltaX < 0 ? index + 1 : index - 1);
    }
  }, { passive: true });
})();
