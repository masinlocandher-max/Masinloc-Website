(() => {
  const headers = [...document.querySelectorAll('.overlay-nav, .form-header')];
  const toggles = [...document.querySelectorAll('.connect-menu-toggle')];

  const exposeHelpDesk = () => {
    const pathList = document.querySelector('.connect-path-list');
    if (pathList && !pathList.querySelector('[data-help-desk-path]')) {
      const path = document.createElement('div');
      path.className = 'connect-path';
      path.dataset.helpDeskPath = 'true';
      path.innerHTML = '<span>Help Desk</span><div><h3>Reach PNP or MDRRMO.</h3><p>Report an emergency or request assistance, share your location when available, and keep the report queued on your device if your connection drops.</p></div><a href="emergency/">Open Help Desk</a>';
      pathList.appendChild(path);
    }

    const footerNav = document.querySelector('.footer-links');
    if (footerNav && !footerNav.querySelector('a[href="emergency/"]')) {
      const link = document.createElement('a');
      link.href = 'emergency/';
      link.textContent = 'Help Desk';
      const connect = footerNav.querySelector('a[href="connect.html"]');
      if (connect) connect.insertAdjacentElement('afterend', link);
      else footerNav.appendChild(link);
    }
  };

  exposeHelpDesk();

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
