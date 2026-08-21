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
      const streetInput = document.querySelector('#formCard [name="streetAddress"]');
      const barangayInput = document.querySelector('#formCard [name="barangay"]');
      if (streetInput) data.streetAddress = streetInput.value;
      if (barangayInput) data.barangay = barangayInput.value;
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

/* Professional submissions are job-seeking submissions and enter the hiring pool automatically. */
(() => {
  const style = document.createElement('style');
  style.textContent = `
    .hiring-pool-notice{margin:18px 0;padding:14px 15px;border:1px solid #e4e7ec;border-radius:10px;background:#f8fafc;font-size:12px;line-height:1.55;color:#333}
    .hiring-pool-notice strong{display:block;margin-bottom:4px;color:#111;font-size:11px;letter-spacing:.05em;text-transform:uppercase}
  `;
  document.head.appendChild(style);

  function updateEntryCopy() {
    const quick = document.querySelector('.quick-card.professional p');
    const chooser = document.querySelector('.selection-card.professional p');
    if (quick) quick.textContent = 'Looking for work? Create your professional profile and résumé. Submitted profiles are automatically included in the Masinloc Connect hiring pool.';
    if (chooser) chooser.textContent = 'Create your professional profile and résumé. When you submit, your profile can be matched with approved hiring partners.';
  }

  function addNotice() {
    try {
      if (typeof type === 'undefined' || type !== 'professional') return;
      if (typeof configs === 'undefined' || typeof step === 'undefined') return;
      const card = document.querySelector('#formCard');
      if (!card || card.querySelector('.hiring-pool-notice')) return;
      if (step !== configs.professional.steps.length - 1) return;

      const notice = document.createElement('div');
      notice.className = 'hiring-pool-notice';
      notice.innerHTML = '<strong>Job opportunities</strong>By submitting this Professional profile, you are telling Masinloc Connect that you are looking for work. Your professional profile will automatically join the Masinloc Connect hiring pool and may be matched with approved hiring partners. You can mark yourself unavailable later to stop employer matching.';
      const actions = card.querySelector('.form-actions');
      if (actions) card.insertBefore(notice, actions);
      else card.appendChild(notice);
    } catch {}
  }

  updateEntryCopy();
  const observer = new MutationObserver(() => {
    updateEntryCopy();
    addNotice();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
