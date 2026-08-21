(() => {
  const CONFIG = {
    label: 'BUSINESS OWNER',
    icon: '▥',
    color: '#0a34b7',
    aside: 'Register your Masinloc business for the local Marketplace.',
    steps: [
      {
        label: 'Business',
        title: 'Tell us about your business.',
        help: 'Start with the business information customers should recognize.',
        fields: [
          {name:'brandName',label:'Business name',type:'text',placeholder:'Pangalan ng negosyo',required:true},
          {name:'brandLogo',label:'Business logo, if available',type:'file',required:false,full:true},
          {name:'shortDescription',label:'What does your business offer?',type:'textarea',placeholder:'Hal. food, accommodation, repair service, beauty service, retail products, or other local services.',required:true,full:true}
        ]
      },
      {
        label: 'Location',
        title: 'Where in Masinloc is your business?',
        help: 'For home-based or online businesses, enter your barangay or the Masinloc area you serve.',
        fields: [
          {name:'storeLocations',label:'Business location / Barangay / Service area',type:'textarea',placeholder:'Hal. Brgy. Taltal, Masinloc. If home-based or online, enter the barangay or service area.',required:true,full:true}
        ]
      },
      {
        label: 'Contact',
        title: 'Owner details and customer link.',
        help:'Your name, email, and phone are private and used only by Masinloc Connect. Customers will be routed to your Facebook Page.',
        fields: [
          {name:'ownerName',label:'Owner / authorized representative name',type:'text',placeholder:'Private',required:true,full:true},
          {name:'ownerEmail',label:'Email address',type:'email',placeholder:'Private',required:true},
          {name:'ownerPhone',label:'Mobile number',type:'tel',placeholder:'Private',required:true},
          {name:'facebookPage',label:'Facebook Page link',type:'url',placeholder:'https://www.facebook.com/yourpage',required:true,full:true}
        ]
      },
      {
        label: 'Review',
        title: 'Review your business registration.',
        help:'Check the information before submitting. Masinloc Connect does not process customer orders yet. Customers will be directed to your Facebook Page.',
        review:true,
        consent:'I confirm that I am the business owner or an authorized representative and that the information is accurate. I understand that my name, email, and phone are private registration information, while my business details and Facebook Page may be used to route customers to my business.'
      }
    ]
  };

  function updateEntryCopy() {
    document.querySelectorAll('.quick-card.business strong, .selection-card.business strong').forEach(el => el.textContent = 'BUSINESS OWNER');
    const quick = document.querySelector('.quick-card.business p');
    const chooser = document.querySelector('.selection-card.business p');
    if (quick) quick.textContent = 'Register your Masinloc business for the local Marketplace. Customers will be routed to your Facebook Page.';
    if (chooser) chooser.textContent = 'Register a Masinloc business. Add your business details and Facebook Page so customers can reach you directly.';
  }

  function patchBusinessConfig() {
    try {
      if (typeof configs === 'undefined' || !configs.business) return false;
      configs.business = CONFIG;
      return true;
    } catch {
      return false;
    }
  }

  function addPrivacyNote() {
    try {
      if (typeof type === 'undefined' || type !== 'business' || typeof step === 'undefined') return;
      if (step !== 2) return;
      const card = document.querySelector('#formCard');
      if (!card || card.querySelector('.business-private-note')) return;
      const note = document.createElement('div');
      note.className = 'business-private-note';
      note.innerHTML = '<strong>Private owner information</strong><span>Your name, email, and mobile number are for Masinloc Connect verification and contact only. Customers will not see them. Customers will be sent to your Facebook Page.</span>';
      const actions = card.querySelector('.form-actions');
      if (actions) card.insertBefore(note, actions);
      else card.appendChild(note);
    } catch {}
  }

  const style = document.createElement('style');
  style.textContent = `
    .business-private-note{margin:18px 0;padding:14px 15px;border:1px solid #dbe4ff;border-radius:10px;background:#f7f9ff;font-size:12px;line-height:1.55;color:#31394a}
    .business-private-note strong{display:block;margin-bottom:4px;color:#0a34b7;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
    .business-private-note span{display:block}
  `;
  document.head.appendChild(style);

  updateEntryCopy();
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const ready = patchBusinessConfig();
    updateEntryCopy();
    if (ready || attempts > 200) clearInterval(timer);
  }, 50);

  const observer = new MutationObserver(() => {
    patchBusinessConfig();
    updateEntryCopy();
    addPrivacyNote();
  });
  observer.observe(document.documentElement, {childList:true,subtree:true});
})();
