(() => {
  const ENDPOINT = 'https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-professional-profile';

  const style = document.createElement('style');
  style.textContent = `
    .mc-recovery{position:fixed;inset:0;z-index:9999;background:rgba(10,18,32,.58);display:grid;place-items:center;padding:18px}
    .mc-recovery-card{width:min(520px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:18px;padding:26px;box-shadow:0 28px 80px rgba(0,0,0,.22)}
    .mc-recovery-kicker{margin:0 0 8px;font-size:10px;letter-spacing:.12em;font-weight:800;color:#0a34b7}
    .mc-recovery-card h2{margin:0 0 10px;font-size:24px;line-height:1.08;letter-spacing:-.03em}
    .mc-recovery-card>p{margin:0 0 18px;color:#555;font-size:13px;line-height:1.6}
    .mc-recovery-field{margin:14px 0}
    .mc-recovery-field label{display:block;margin-bottom:7px;font-size:12px;font-weight:700;color:#222}
    .mc-recovery-field input,.mc-recovery-field select{width:100%;box-sizing:border-box;border:1px solid #d9dde5;border-radius:10px;padding:12px 13px;font:inherit;background:#fff;color:#111}
    .mc-recovery-actions{display:flex;gap:10px;margin-top:18px}
    .mc-recovery-actions button{border:0;border-radius:10px;padding:12px 16px;font-weight:800;cursor:pointer}
    .mc-recovery-primary{background:#0a34b7;color:#fff;flex:1}
    .mc-recovery-secondary{background:#f2f4f7;color:#222}
    .mc-recovery-error{display:none;margin-top:12px;padding:10px 12px;border-radius:8px;background:#fff1f2;color:#a51d28;font-size:12px;line-height:1.5}
    .mc-recovery-note{margin-top:14px!important;font-size:11px!important;color:#777!important}
    @media(max-width:640px){.mc-recovery-card{padding:20px;border-radius:15px}.mc-recovery-card h2{font-size:21px}.mc-recovery-actions{flex-direction:column}}
  `;
  document.head.appendChild(style);

  const readDraft = () => {
    try {
      const draft = JSON.parse(localStorage.getItem('masinlocConnectDraft') || '{}');
      return draft?.type === 'professional' ? draft : null;
    } catch { return null; }
  };

  const profilePayloadFrom = d => ({
    targetJob:d.targetJob||'', workType:d.workType||'', preferredLocation:d.preferredLocation||'',
    hasWorkExperience:d.hasWorkExperience||'', lastEmployer:d.lastEmployer||'', lastRole:d.lastRole||'',
    workTasks:d.workTasks||'', practicalExperience:d.practicalExperience||'', tools:d.tools||'',
    training:d.training||'', education:d.education||'', school:d.school||'', course:d.course||'',
    languages:d.languages||'', addressLine:d.streetAddress||'', barangay:d.barangay||'',
    municipality:'Masinloc', province:'Zambales', postalCode:'2211'
  });

  const makePayload = d => {
    const currentLocation = [
      String(d.streetAddress||'').trim(),
      d.barangay ? `Brgy. ${d.barangay}` : '',
      'Masinloc, Zambales 2211'
    ].filter(Boolean).join(', ');
    const description = [d.lastRole,d.lastEmployer,d.workTasks,d.practicalExperience].filter(Boolean).join(' · ').slice(0,1800) || d.targetJob || '';
    return {
      fullName:d.fullName||'', targetJob:d.targetJob||'', skills:d.skills||'', currentLocation,
      contactNumber:d.contactNumber||'', email:d.email||'', professionalDescription:description,
      professionalLink:'', profilePayload:profilePayloadFrom(d), resumeSnapshot:d.resumeSnapshot||{}
    };
  };

  async function request(body) {
    const r = await fetch(ENDPOINT, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'omit',
      cache:'no-store',
      body:JSON.stringify({...body, turnstileToken:window.masinlocTurnstileToken||''})
    });
    let result = {};
    try { result = await r.json(); } catch {}
    if (!r.ok || !result.ok) throw new Error(result.error || 'Hindi namin ma-check ang profile ngayon. Pakisubukan ulit.');
    return result;
  }

  function closeRecovery() { document.querySelector('.mc-recovery')?.remove(); }

  function shell(title, text) {
    closeRecovery();
    const modal = document.createElement('div');
    modal.className = 'mc-recovery';
    modal.innerHTML = `<div class="mc-recovery-card" role="dialog" aria-modal="true"><p class="mc-recovery-kicker">MASINLOC CONNECT</p><h2>${title}</h2><p>${text}</p><div id="mcRecoveryBody"></div><div class="mc-recovery-error" id="mcRecoveryError"></div></div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function error(message) {
    const el = document.querySelector('#mcRecoveryError');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
  }

  function showExistingSuccess(ref) {
    closeRecovery();
    try { localStorage.removeItem('masinlocConnectDraft'); } catch {}
    const form = document.querySelector('#formView');
    const success = document.querySelector('#successView');
    if (form) { form.hidden = true; form.classList.remove('active'); }
    if (success) { success.hidden = false; success.classList.add('active'); }
    const code = document.querySelector('#refCode');
    if (code) code.textContent = ref;
    const panel = document.querySelector('#successView .success-panel');
    if (panel) {
      const h = panel.querySelector('h2');
      const lead = panel.querySelector(':scope>p');
      const note = panel.querySelector('.success-small');
      if (h) h.textContent = 'Existing profile found.';
      if (lead) lead.textContent = 'Na-confirm namin na mayroon ka nang Masinloc Connect professional profile.';
      if (note) note.textContent = 'Hindi kami gumawa ng duplicate. Ito pa rin ang iyong original Masinloc Connect Profile Code.';
    }
    const btn = document.querySelector('#downloadReceipt');
    if (btn) {
      const copy = btn.cloneNode(true);
      copy.textContent = 'Copy Profile Code';
      btn.replaceWith(copy);
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(ref); copy.textContent = 'Code Copied'; setTimeout(()=>copy.textContent='Copy Profile Code',1600); }
        catch { window.prompt('Copy your Masinloc Connect Profile Code:', ref); }
      });
    }
    const done = document.querySelector('#submitAnother');
    if (done) done.textContent = 'Done';
    window.scrollTo({top:0,behavior:'auto'});
  }

  function showNewSuccess(result) {
    closeRecovery();
    const ref = result.reference_code;
    try {
      localStorage.removeItem('masinlocConnectDraft');
      localStorage.setItem('masinlocLastSubmission', JSON.stringify({reference:ref,type:'professional',data:{},submittedAt:new Date().toISOString(),backendId:result.id||null}));
    } catch {}
    const form = document.querySelector('#formView');
    const success = document.querySelector('#successView');
    if (form) { form.hidden = true; form.classList.remove('active'); }
    if (success) { success.hidden = false; success.classList.add('active'); }
    const code = document.querySelector('#refCode');
    if (code) code.textContent = ref;
    const panel = document.querySelector('#successView .success-panel');
    if (panel) {
      const h = panel.querySelector('h2');
      const lead = panel.querySelector(':scope>p');
      const note = panel.querySelector('.success-small');
      if (h) h.textContent = 'Profile ready.';
      if (lead) lead.textContent = 'Your Masinloc Connect professional profile has been submitted.';
      if (note) note.textContent = 'Save your Profile Code. It identifies your existing profile for future Masinloc Connect account and mobile app access.';
    }
    const btn = document.querySelector('#downloadReceipt');
    if (btn) {
      const copy = btn.cloneNode(true);
      copy.textContent = 'Copy Profile Code';
      btn.replaceWith(copy);
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(ref); copy.textContent = 'Code Copied'; setTimeout(()=>copy.textContent='Copy Profile Code',1600); }
        catch { window.prompt('Copy your Masinloc Connect Profile Code:', ref); }
      });
    }
    const done = document.querySelector('#submitAnother');
    if (done) done.textContent = 'Done';
    window.scrollTo({top:0,behavior:'auto'});
  }

  function showManual(message) {
    const modal = shell('Kailangan muna naming i-check.', message || 'Hindi namin ma-confirm nang automatic ang existing profile. Hindi muna kami gagawa ng panibagong profile.');
    modal.querySelector('#mcRecoveryBody').innerHTML = `<p class="mc-recovery-note">Pinoprotektahan nito ang existing profile at MC code laban sa maling duplicate o maling pagkuha.</p><div class="mc-recovery-actions"><button type="button" class="mc-recovery-primary" id="mcCloseManual">OK</button></div>`;
    modal.querySelector('#mcCloseManual').addEventListener('click', closeRecovery);
  }

  function showQuestions(result) {
    const questions = Array.isArray(result.questions) ? result.questions : [];
    if (questions.length < 2) return showManual('Kulang ang dating impormasyon para ma-confirm nang ligtas ang profile. Kailangan muna itong i-review.');
    const modal = shell('Sagutin natin ang ilang tanong.', 'Gagamit kami ng ilang sagot mula sa dati mong profile para ma-check kung ikaw rin ang gumawa nito.');
    modal.querySelector('#mcRecoveryBody').innerHTML = `${questions.map((q,i)=>`<div class="mc-recovery-field"><label for="mcq${i}">${q.question}</label><input id="mcq${i}" data-key="${q.key}" autocomplete="off"></div>`).join('')}<p class="mc-recovery-note">Hindi namin ipapakita ang tamang sagot kapag may hindi tumugma.</p><div class="mc-recovery-actions"><button type="button" class="mc-recovery-secondary" id="mcCancelQuestions">Cancel</button><button type="button" class="mc-recovery-primary" id="mcVerifyAnswers">CHECK MY ANSWERS</button></div>`;
    modal.querySelector('#mcCancelQuestions').addEventListener('click', closeRecovery);
    modal.querySelector('#mcVerifyAnswers').addEventListener('click', async e => {
      const button = e.currentTarget;
      const answers = {};
      modal.querySelectorAll('[data-key]').forEach(input => answers[input.dataset.key] = input.value);
      if (Object.values(answers).some(v => !String(v).trim())) return error('Sagutan muna ang lahat ng tanong.');
      button.disabled = true;
      button.textContent = 'CHECKING…';
      try {
        const next = await request({mode:'verify_answers',challengeId:result.challenge_id,answers});
        if (next.duplicate_verified) return showExistingSuccess(next.reference_code);
        if (next.verification_step === 'manual') return showManual(next.message);
        if (next.verification_step === 'questions') {
          error(next.message || 'May sagot na hindi tumugma. Pakisubukan ulit.');
          button.disabled = false;
          button.textContent = 'CHECK MY ANSWERS';
        }
      } catch (err) {
        error(err.message);
        button.disabled = false;
        button.textContent = 'CHECK MY ANSWERS';
      }
    });
  }

  function showEmailCheck(result) {
    const modal = shell('May existing profile na maaaring iyo.', 'Hindi muna kami gagawa ng panibagong profile. I-type ang email na ginamit mo noong gumawa ka ng dati mong Masinloc Connect profile.');
    modal.querySelector('#mcRecoveryBody').innerHTML = `<div class="mc-recovery-field"><label for="mcOldEmail">Email na ginamit mo dati</label><input id="mcOldEmail" type="email" autocomplete="email" placeholder="name@example.com"></div><p class="mc-recovery-note">Hindi namin ipapakita o huhulaan para sa iyo ang email na nasa existing profile.</p><div class="mc-recovery-actions"><button type="button" class="mc-recovery-secondary" id="mcCancelEmail">Cancel</button><button type="button" class="mc-recovery-primary" id="mcVerifyEmail">CHECK EMAIL</button></div>`;
    modal.querySelector('#mcCancelEmail').addEventListener('click', closeRecovery);
    modal.querySelector('#mcVerifyEmail').addEventListener('click', async e => {
      const button = e.currentTarget;
      const email = modal.querySelector('#mcOldEmail').value.trim();
      if (!email) return error('Ilagay muna ang email na ginamit mo dati.');
      button.disabled = true;
      button.textContent = 'CHECKING…';
      try {
        const next = await request({mode:'verify_email',challengeId:result.challenge_id,email});
        if (next.duplicate_verified) return showExistingSuccess(next.reference_code);
        if (next.verification_step === 'questions') return showQuestions(next);
        if (next.verification_step === 'manual') return showManual(next.message);
      } catch (err) {
        error(err.message);
        button.disabled = false;
        button.textContent = 'CHECK EMAIL';
      }
    });
  }

  async function submitFromDraft(button) {
    const draft = readDraft();
    if (!draft?.data) return;
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = 'SUBMITTING…';
    try {
      const result = await request({mode:'submit',payload:makePayload(draft.data)});
      if (result.duplicate) {
        button.disabled = false;
        button.innerHTML = original;
        if (result.verification_step === 'email') return showEmailCheck(result);
        if (result.verification_step === 'questions') return showQuestions(result);
        return showManual(result.message);
      }
      showNewSuccess(result);
    } catch (err) {
      button.disabled = false;
      button.innerHTML = original;
      let box = document.querySelector('#formCard .backend-error');
      if (!box) {
        box = document.createElement('div');
        box.className = 'backend-error';
        box.setAttribute('role','alert');
        document.querySelector('#formCard')?.appendChild(box);
      }
      box.textContent = err.message || 'Hindi namin ma-submit ang profile ngayon. Pakisubukan ulit.';
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('#nextBtn');
    if (!button || !document.querySelector('#formCard .resume-preview')) return;
    if (!String(button.textContent || '').toUpperCase().includes('SUBMIT MY PROFILE')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    submitFromDraft(button);
  }, true);
})();
