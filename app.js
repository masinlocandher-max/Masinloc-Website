const header = document.getElementById('siteHeader');
const menuButton = document.getElementById('menuButton');
const mobileNav = document.getElementById('mobileNav');

const syncHeader = () => {
  header?.classList.toggle('scrolled', window.scrollY > 20);
};
syncHeader();
window.addEventListener('scroll', syncHeader, { passive: true });

if (menuButton && mobileNav) {
  const setMenu = (open) => {
    menuButton.setAttribute('aria-expanded', String(open));
    mobileNav.setAttribute('aria-hidden', String(!open));
    mobileNav.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
  };

  menuButton.addEventListener('click', () => {
    setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
  });

  mobileNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setMenu(false));
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenu(false);
  });
}

const revealItems = [...document.querySelectorAll('.reveal')];
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add('visible'));
}
