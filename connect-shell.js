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

/* Masinloc-only professional profile address rule. */
(() => {
  const BARANGAYS = [
    'Baloganon',
    'Bamban',
    'Bani',
    'Collat',
    'Inhobol',
    'North Poblacion',
    'San Lorenzo',
    'San Salvador',
    'Santa Rita',
    'Santo Rosario',
    'South Poblacion',
    'Taltal',
    'Tapuac'
  ];

  const fixedAddress = {
    municipality: 'Masinloc',
    province: 'Zambales',
    postalCode: '2211'
  };

  function syncAddress() {
    try {
      if (typeof data === 'undefined') return;
      data.municipality = fixedAddress.municipality;
      data.province = fixedAddress.province;
      data.postalCode = fixedAddress.postalCode;

      const street = String(data.streetAddress || '').trim();
      const barangay = String(data.barangay || '').trim();
      data.currentLocation = [
        street,
        barangay ? `Brgy. ${barangay}` : '',
        `${fixedAddress.municipality}, ${fixedAddress.province} ${fixedAddress.postalCode}`
      ].filter(Boolean).join(', ');
    } catch {}
  }

  function lockFixedFields() {
    Object.entries(fixedAddress).forEach(([name, value]) => {
      const el = document.querySelector(`#formCard [name="${name}"]`);
      if (!el) return;
      el.value = value;
      el.readOnly = true;
      el.setAttribute('aria-readonly', 'true');
      el.setAttribute('tabindex', '-1');
    });
    syncAddress();
  }

  function patchProfessionalAddress() {
    try {
      if (typeof configs === 'undefined' || typeof data === 'undefined' || !configs.professional?.steps?.[0]) return false;
      /* The guided résumé flow has 7 steps. Do not patch the legacy 4-step form. */
      if (configs.professional.steps.length !== 7) return false;
      if (configs.professional.__masinlocAddressLocked) return true;

      data.municipality = fixedAddress.municipality;
      data.province = fixedAddress.province;
      data.postalCode = fixedAddress.postalCode;

      configs.professional.steps[0].title = 'Taga-Masinloc ka ba?';
      configs.professional.steps[0].help = 'Para sa Masinloqueños ang professional profile na ito. Ilagay ang address mo sa Masinloc.';
      configs.professional.steps[0].fields = [
        {name:'fullName',label:'Ano ang buong pangalan mo?',type:'text',placeholder:'Buong pangalan',required:true,full:true},
        {name:'contactNumber',label:'Ano ang cellphone number mo?',type:'tel',placeholder:'09XXXXXXXXX',required:true},
        {name:'email',label:'May email ka ba?',type:'email',placeholder:'Optional',required:false},
        {name:'streetAddress',label:'House number / Street',type:'text',placeholder:'Hal. 123 Rizal Street',required:true,full:true},
        {name:'barangay',label:'Barangay',type:'select',required:true,options:BARANGAYS},
        {name:'municipality',label:'Municipality',type:'text',placeholder:'Masinloc',required:true},
        {name:'province',label:'Province',type:'text',placeholder:'Zambales',required:true},
        {name:'postalCode',label:'Postal code',type:'text',placeholder:'2211',required:true}
      ];
      configs.professional.__masinlocAddressLocked = true;
      syncAddress();
      return true;
    } catch {
      return false;
    }
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (patchProfessionalAddress() || attempts > 200) clearInterval(timer);
  }, 50);

  document.addEventListener('input', event => {
    const field = event.target.closest?.('#formCard [name="streetAddress"], #formCard [name="barangay"]');
    if (!field) return;
    try { data[field.name] = field.value; } catch {}
    syncAddress();
  }, true);

  document.addEventListener('change', event => {
    const field = event.target.closest?.('#formCard [name="streetAddress"], #formCard [name="barangay"]');
    if (!field) return;
    try { data[field.name] = field.value; } catch {}
    syncAddress();
  }, true);

  document.addEventListener('click', event => {
    if (!event.target.closest?.('#nextBtn')) return;
    syncAddress();
  }, true);

  const observer = new MutationObserver(() => {
    patchProfessionalAddress();
    lockFixedFields();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
