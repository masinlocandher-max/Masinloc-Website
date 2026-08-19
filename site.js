(() => {
  const root = document.documentElement;
  const body = document.body;
  const toggle = document.getElementById('menuToggle');
  const nav = document.getElementById('primaryNav');
  const siteNav = document.getElementById('siteNav');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  root.classList.add('js');

  const closeMenu = () => {
    if (!toggle || !nav) return;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    nav.classList.remove('open');
    body.classList.remove('menu-open');
  };

  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const isOpen = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!isOpen));
      toggle.setAttribute('aria-label', isOpen ? 'Open menu' : 'Close menu');
      nav.classList.toggle('open', !isOpen);
      body.classList.toggle('menu-open', !isOpen);
    });

    nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 980) closeMenu();
    }, { passive: true });
  }

  /* Persistent navigation state. */
  if (siteNav) {
    let navFrame = 0;
    const syncNav = () => {
      navFrame = 0;
      siteNav.classList.toggle('is-scrolled', window.scrollY > 30);
    };
    const requestNavSync = () => {
      if (navFrame) return;
      navFrame = window.requestAnimationFrame(syncNav);
    };
    syncNav();
    window.addEventListener('scroll', requestNavSync, { passive: true });
  }

  /* Scroll reveals are added at runtime so no-JS rendering stays complete. */
  const revealTargets = [
    ...document.querySelectorAll('main > section:not(.hero)'),
    ...document.querySelectorAll('.editorial-link'),
    ...document.querySelectorAll('.about-photo'),
    ...document.querySelectorAll('.about-section'),
    ...document.querySelectorAll('.about-commitment'),
    ...document.querySelectorAll('.home-footer')
  ];

  const uniqueTargets = [...new Set(revealTargets)];
  uniqueTargets.forEach((element) => {
    element.setAttribute('data-reveal', element.classList.contains('about-photo') ? 'scale' : 'up');
  });

  document.querySelectorAll('.editorial-link').forEach((element, index) => {
    element.setAttribute('data-delay', String(Math.min(index + 1, 5)));
  });

  if (reduceMotion.matches || !('IntersectionObserver' in window)) {
    uniqueTargets.forEach((element) => element.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });

    uniqueTargets.forEach((element) => observer.observe(element));
  }

  /* Very light hero parallax; the image file itself is untouched. */
  const heroMedia = document.querySelector('.hero-media');
  if (heroMedia && !reduceMotion.matches) {
    let heroFrame = 0;
    const syncHero = () => {
      heroFrame = 0;
      const shift = Math.min(Math.max(window.scrollY * 0.035, 0), 24);
      heroMedia.style.setProperty('--hero-shift', `${shift}px`);
    };
    const requestHeroSync = () => {
      if (heroFrame) return;
      heroFrame = window.requestAnimationFrame(syncHero);
    };
    syncHero();
    window.addEventListener('scroll', requestHeroSync, { passive: true });
  }

  /* Fast same-origin fade for browsers without useful cross-document transitions. */
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;

    const rawHref = link.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) return;

    let destination;
    try {
      destination = new URL(link.href, window.location.href);
    } catch {
      return;
    }

    if (destination.origin !== window.location.origin) return;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;
    if (reduceMotion.matches) return;

    event.preventDefault();
    closeMenu();
    body.classList.add('is-leaving');
    window.setTimeout(() => window.location.assign(destination.href), 135);
  });

  window.addEventListener('pageshow', () => body.classList.remove('is-leaving'));

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => body.classList.add('is-ready'));
  });
})();
