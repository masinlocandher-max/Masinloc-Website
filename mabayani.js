/* MABAYANI reading aids.

   Everything here is an enhancement. With this file blocked or failing, the
   page is a complete, ordered, readable document: the sections are laid out,
   the story map is a <details> that opens, and every source drawer opens to
   its evidence. That is deliberate — the argument of this page is that the
   record should be inspectable, and a record you can only reach if a script
   loads is not inspectable.

   What it adds:
     - a class on <html> so the stylesheet may hide sections before they enter
       (never applied if the reader asked for reduced motion);
     - the entry reveal itself;
     - a quiet progress count, which appears only once the reader has moved
       and never covers the text;
     - closing the story map after a jump, so the destination is not hidden
       behind the menu that sent you there.
*/
(() => {
  const main = document.getElementById('main');
  if (!main) return;

  const sections = [...main.querySelectorAll('.mb-section[data-part]')];

  /* --- entry reveal ------------------------------------------------------ */

  /* There isn't one here, deliberately. site.js already applies the site-wide
     scroll reveal to every `main > section`, which is every section on this
     page. An earlier version of this file added a second observer with its own
     class and its own timing; the two then fought over the same elements and a
     section could sit at opacity 0 after a jump because one system had revealed
     it and the other had not. One reveal, shared with the rest of the site. */

  /* --- progress ---------------------------------------------------------- */

  const bar = document.getElementById('mbProgressBar');
  const text = document.getElementById('mbProgressText');
  const wrap = document.getElementById('mbProgress');
  const total = sections.length;

  if (wrap && bar && text && total) {
    let ticking = false;
    const update = () => {
      ticking = false;
      const top = window.scrollY;
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = height > 0 ? Math.min(1, Math.max(0, top / height)) : 0;

      // Stay out of the way until the reader has actually started.
      if (top < window.innerHeight * 0.6) {
        wrap.hidden = true;
        return;
      }
      wrap.hidden = false;
      bar.style.width = `${(ratio * 100).toFixed(2)}%`;

      let current = 1;
      sections.forEach((section, index) => {
        if (section.getBoundingClientRect().top <= window.innerHeight * 0.5) {
          current = index + 1;
        }
      });
      const label = `Part ${current} of ${total}`;
      if (text.textContent !== label) text.textContent = label;
    };
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  /* --- story map --------------------------------------------------------- */

  const map = document.getElementById('storyMap');
  if (map) {
    /* Jumping from the map is handled here rather than left to the browser,
       for two reasons.

       The landing has to be exact. Closing the map on the same click that
       navigates changes the layout while the smooth scroll is already running,
       and the reader ends up sixty-odd pixels past where they aimed. Closing
       first, then scrolling on the next frame, means the scroll is computed
       against final layout and lands on the section's scroll-margin every
       time.

       And focus has to travel with the reader. Following a link with the
       keyboard should leave you at the destination; without this, focus stays
       in the map and the next Tab carries on through a menu that has closed.
       preventScroll keeps focus() from fighting the scroll we just started.

       With this file blocked the href does the same job unaided, which is why
       the markup is a real anchor to a real id. */
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    map.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', (event) => {
        const id = link.getAttribute('href').slice(1);
        const target = document.getElementById(id);
        if (!target || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        map.open = false;
        requestAnimationFrame(() => {
          /* Land it before measuring it. The site-wide scroll reveal holds a
             section it has not shown yet at translateY(26px), and
             scrollIntoView aligns the box as currently transformed — so a jump
             to a section below the fold lands 26px out, and the transform then
             animates away and takes the heading up under the sticky bars.
             Dropping the attribute removes the transition with it, so the
             section snaps to its true position with no animation, which is
             where somebody who deliberately jumped to it expects it to be. */
          target.removeAttribute('data-reveal');
          target.classList.add('is-visible');
          target.scrollIntoView({
            behavior: still.matches ? 'auto' : 'smooth',
            block: 'start',
          });
          history.replaceState(null, '', `#${id}`);
          if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
        });
      });
    });

    /* Thirty-one rows all look the same. Opening the map halfway through a
       read and being shown an undifferentiated list is not navigation — the
       reader has to work out where they already are before they can decide
       where to go. So the row they are in is marked, and opening the map
       scrolls to it rather than to row one.

       Marked with aria-current="location" as well as a class: this is "the
       thing you are inside", not the current page, and a screen reader should
       hear that without depending on the styling. */
    const rows = new Map();
    map.querySelectorAll('a[href^="#"]').forEach((link) => {
      const target = document.getElementById(link.getAttribute('href').slice(1));
      if (target) rows.set(target, link);
    });

    let marked = null;
    const markCurrent = () => {
      let current = null;
      rows.forEach((link, target) => {
        if (target.getBoundingClientRect().top <= window.innerHeight * 0.5) {
          current = link;
        }
      });
      if (current === marked) return;
      if (marked) {
        marked.classList.remove('is-here');
        marked.removeAttribute('aria-current');
      }
      marked = current;
      if (marked) {
        marked.classList.add('is-here');
        marked.setAttribute('aria-current', 'location');
      }
      const here = document.getElementById('mbHere');
      if (!here) return;
      if (!marked) { here.textContent = ''; return; }
      // Built from the row's two spans rather than its textContent, which runs
      // them together: "13" and "1649: Anim na Caracoa" became "131649: Anim
      // na Caracoa". The reference rows carry a bullet instead of a number, so
      // only a real part number is printed.
      const number = (marked.querySelector('.mb-map-n') || {}).textContent || '';
      const label = marked.querySelector('span:not(.mb-map-n)');
      const title = (label ? label.textContent : marked.textContent).trim();
      here.textContent = /^\d+$/.test(number.trim())
        ? `${number.trim()} · ${title}`
        : title;
    };

    let pending = false;
    window.addEventListener('scroll', () => {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(() => { pending = false; markCurrent(); });
    }, { passive: true });
    markCurrent();

    /* Land on your own position. `block: 'center'` inside the map's own
       scroller, and only that scroller — scrollIntoView on a nested element
       can walk up and move the page too, which would drag the reader away
       from the section they were reading just for opening a menu. */
    map.addEventListener('toggle', () => {
      if (!map.open || !marked) return;
      const scroller = map.querySelector('nav');
      if (!scroller) return;
      scroller.scrollTop = Math.max(
        0, marked.offsetTop - scroller.clientHeight / 2 + marked.offsetHeight / 2);
    });
    // Escape closes it, as it would any other menu.
    map.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && map.open) {
        map.open = false;
        const summary = map.querySelector('summary');
        if (summary) summary.focus();
      }
    });
  }

  /* --- record drawers ---------------------------------------------------- */

  /* On a phone the open drawer is a sheet over the page, so Escape should
     close it and only one should be open at a time. On wider screens they are
     ordinary inline disclosures and are left alone. */
  const drawers = [...main.querySelectorAll('.mb-record')];
  const phone = window.matchMedia('(max-width: 640px)');
  drawers.forEach((drawer) => {
    drawer.addEventListener('toggle', () => {
      if (!drawer.open || !phone.matches) return;
      drawers.forEach((other) => { if (other !== drawer) other.open = false; });
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !phone.matches) return;
    const open = drawers.find((drawer) => drawer.open);
    if (!open) return;
    open.open = false;
    const summary = open.querySelector('summary');
    if (summary) summary.focus();
  });
})();
