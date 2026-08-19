(() => {
  const headers = [...document.querySelectorAll('.overlay-nav, .form-header')];
  const toggles = [...document.querySelectorAll('.connect-menu-toggle')];

  const closeAll = () => {
    headers.forEach(header => header.classList.remove('nav-open'));
    toggles.forEach(toggle => {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
    });
    document.body.classList.remove('connect-menu-open');
  };

  toggles.forEach(toggle => {
    const header = toggle.closest('.overlay-nav, .form-header');
    if (!header) return;

    toggle.addEventListener('click', () => {
      const willOpen = !header.classList.contains('nav-open');
      closeAll();
      if (!willOpen) return;
      header.classList.add('nav-open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
      document.body.classList.add('connect-menu-open');
    });

    header.querySelectorAll('nav a').forEach(link => link.addEventListener('click', closeAll));
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAll();
  });

  document.addEventListener('click', event => {
    if (!document.body.classList.contains('connect-menu-open')) return;
    if (event.target.closest('.overlay-nav, .form-header')) return;
    closeAll();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 800) closeAll();
  }, { passive: true });
})();
