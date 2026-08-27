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
    map.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', () => { map.open = false; });
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
