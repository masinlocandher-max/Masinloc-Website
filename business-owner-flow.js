(() => {
  const DASHBOARD_INTEREST_ENDPOINT = 'https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/business-dashboard-interest';
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

  function businessSubmission() {
    try {
      if (typeof lastSubmission === 'undefined' || !lastSubmission || lastSubmission.type !== 'business') return null;
      return lastSubmission;
    } catch {
      return null;
    }
  }

  async function saveDashboardInterest(button, message) {
    const submission = businessSubmission();
    const referenceCode = submission?.reference || '';
    const ownerEmail = submission?.data?.ownerEmail || '';
    if (!referenceCode || !ownerEmail) {
      message.textContent = 'We could not save this automatically. Please keep your Masinloc Connect code and contact us when you want dashboard access.';
      return;
    }

    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'SAVING…';
    try {
      const response = await fetch(DASHBOARD_INTEREST_ENDPOINT, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({referenceCode, ownerEmail})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to save');
      button.textContent = 'INTEREST SAVED';
      button.classList.add('saved');
      message.textContent = 'Got it. We will use the private contact details from your registration when Business Dashboard access is available.';
      localStorage.setItem(`masinlocDashboardInterest:${referenceCode}`, 'yes');
    } catch {
      button.disabled = false;
      button.textContent = original;
      message.textContent = 'We could not save this right now. Your business registration is still safe. You can try again later.';
    }
  }

  function addDashboardPromotion() {
    try {
      const submission = businessSubmission();
      const successView = document.querySelector('#successView');
      const panel = successView?.querySelector('.success-panel');
      if (!submission || !successView?.classList.contains('active') || !panel || panel.querySelector('.business-dashboard-promo')) return;

      const heading = panel.querySelector('h2');
      const lead = panel.querySelector(':scope > p');
      const note = panel.querySelector('.success-small');
      if (heading) heading.textContent = 'Business registration received.';
      if (lead) lead.textContent = 'Your Masinloc business has been submitted for review.';
      if (note) note.textContent = 'Your private owner details stay with Masinloc Connect. When your business is listed, customers will be routed to your Facebook Page.';

      const promo = document.createElement('section');
      promo.className = 'business-dashboard-promo';
      promo.innerHTML = `
        <div class="dashboard-promo-copy">
          <span class="dashboard-promo-label">OPTIONAL BUSINESS TOOLS</span>
          <h3>Want more control over your business on Masinloc Connect?</h3>
          <p>You can tell us if you want a Business Dashboard with tools for managing and promoting your listing.</p>
        </div>
        <div class="dashboard-feature-list" aria-label="Business Dashboard features">
          <div><strong>Edit your business profile</strong><span>Update your business information without registering again.</span></div>
          <div><strong>Manage products and services</strong><span>Keep what you offer current for Marketplace visitors.</span></div>
          <div><strong>Post promos and offers</strong><span>Highlight timely deals and announcements.</span></div>
          <div><strong>See visibility activity</strong><span>Track listing views and customer clicks to your Facebook Page.</span></div>
        </div>
        <p class="dashboard-scope-note">No ordering, checkout, or booking tools are included at this stage. Customer transactions stay on your Facebook Page.</p>
        <div class="dashboard-promo-actions">
          <button type="button" class="dashboard-interest-button">I WANT A BUSINESS DASHBOARD</button>
          <button type="button" class="dashboard-not-now">NOT NOW</button>
        </div>
        <p class="dashboard-promo-message" role="status"></p>
      `;

      const buttons = panel.querySelector('.success-buttons');
      if (buttons) panel.insertBefore(promo, buttons);
      else panel.appendChild(promo);

      const interestButton = promo.querySelector('.dashboard-interest-button');
      const notNow = promo.querySelector('.dashboard-not-now');
      const message = promo.querySelector('.dashboard-promo-message');
      const stored = localStorage.getItem(`masinlocDashboardInterest:${submission.reference}`);
      if (stored === 'yes') {
        interestButton.textContent = 'INTEREST SAVED';
        interestButton.disabled = true;
        interestButton.classList.add('saved');
        message.textContent = 'You already asked for Business Dashboard access.';
      } else {
        interestButton.addEventListener('click', () => saveDashboardInterest(interestButton, message));
      }
      notNow.addEventListener('click', () => {
        promo.classList.add('collapsed');
        promo.innerHTML = '<p class="dashboard-not-now-message">No problem. Your business registration is complete. Dashboard access is optional and can be added later.</p>';
      });
    } catch {}
  }

  const style = document.createElement('style');
  style.textContent = `
    .business-private-note{margin:18px 0;padding:14px 15px;border:1px solid #dbe4ff;border-radius:10px;background:#f7f9ff;font-size:12px;line-height:1.55;color:#31394a}
    .business-private-note strong{display:block;margin-bottom:4px;color:#0a34b7;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
    .business-private-note span{display:block}
    .business-dashboard-promo{margin:26px 0 18px;padding:22px;border:1px solid #dfe6f5;border-radius:16px;background:linear-gradient(180deg,#f8faff 0%,#fff 100%);text-align:left}
    .dashboard-promo-label{display:block;margin-bottom:7px;color:#0a34b7;font-size:10px;font-weight:800;letter-spacing:.12em}
    .business-dashboard-promo h3{margin:0 0 8px;font-size:20px;line-height:1.2;color:#111}
    .dashboard-promo-copy>p{margin:0;color:#555;font-size:12px;line-height:1.6}
    .dashboard-feature-list{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}
    .dashboard-feature-list>div{padding:13px;border:1px solid #e7ebf3;border-radius:11px;background:#fff}
    .dashboard-feature-list strong{display:block;margin-bottom:4px;font-size:12px;color:#111}
    .dashboard-feature-list span{display:block;font-size:11px;line-height:1.5;color:#666}
    .dashboard-scope-note{margin:0 0 16px;padding-top:2px;font-size:10.5px;line-height:1.5;color:#6f7480}
    .dashboard-promo-actions{display:flex;gap:9px;flex-wrap:wrap}
    .dashboard-interest-button,.dashboard-not-now{border:0;border-radius:9px;padding:12px 15px;font-size:10px;font-weight:800;letter-spacing:.04em;cursor:pointer}
    .dashboard-interest-button{background:#0a34b7;color:#fff}
    .dashboard-interest-button.saved{background:#174d2f}
    .dashboard-not-now{background:#eef1f6;color:#353b47}
    .dashboard-promo-message{min-height:18px;margin:10px 0 0;font-size:11px;line-height:1.5;color:#4b5360}
    .business-dashboard-promo.collapsed{padding:14px 16px;background:#fafbfc}
    .dashboard-not-now-message{margin:0;font-size:11px;line-height:1.55;color:#5c626d}
    @media(max-width:640px){.dashboard-feature-list{grid-template-columns:1fr}.business-dashboard-promo{padding:18px}.dashboard-promo-actions{display:grid}.dashboard-interest-button,.dashboard-not-now{width:100%}}
  `;
  document.head.appendChild(style);

  updateEntryCopy();
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const ready = patchBusinessConfig();
    updateEntryCopy();
    addDashboardPromotion();
    if (ready || attempts > 200) clearInterval(timer);
  }, 50);

  const observer = new MutationObserver(() => {
    patchBusinessConfig();
    updateEntryCopy();
    addPrivacyNote();
    addDashboardPromotion();
  });
  observer.observe(document.documentElement, {childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});
})();
