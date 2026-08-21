(function(){
  const ENDPOINT='https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-masinloc';
  const PROFILE_ENDPOINT='https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-professional-profile';
  const DRAFT_MAX_AGE_MS=7*24*60*60*1000;
  let fileStore={};

  const style=document.createElement('style');
  style.textContent=`
    .form-header{display:none!important}
    .overlay-nav.inner-nav{position:relative!important;background:#fff!important;border-bottom:1px solid #eff0f4!important}
    .backend-error{margin:12px 0 0;padding:10px 12px;border-radius:8px;background:#fff1f2;color:#b4232d;font-size:12px;line-height:1.5}
    .next[disabled]{opacity:.62;cursor:wait}
    .professional-progress{height:4px;background:#eceff4;border-radius:999px;overflow:hidden;width:100%}
    .professional-progress span{display:block;height:100%;background:#ffb90a;border-radius:999px;transition:width .25s ease}
    .professional-step-meta{display:flex;justify-content:space-between;gap:12px;margin-top:9px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#777}
    .review-group{padding:17px 0;border-bottom:1px solid #eceef2}
    .review-group:last-child{border-bottom:0}
    .review-group h3{font-size:12px;margin:0 0 10px;color:#111}
    .review-item{display:grid;grid-template-columns:minmax(110px,.7fr) minmax(0,1.3fr);gap:14px;padding:5px 0}
    .review-item span{font-size:11px;color:#767676}
    .review-item strong{font-size:12px;color:#111;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere}
    .resume-preview{background:#fff;border:1px solid #e2e5ea;border-radius:14px;padding:26px;box-shadow:0 12px 40px rgba(20,28,45,.06)}
    .resume-preview-head{padding-bottom:18px;border-bottom:2px solid #111}
    .resume-preview-head h3{font-size:25px;line-height:1.05;margin:0 0 7px;letter-spacing:-.03em}
    .resume-preview-role{font-size:13px;font-weight:700;margin-bottom:9px}
    .resume-preview-contact{font-size:11px;line-height:1.55;color:#555}
    .resume-section{padding-top:18px}
    .resume-section h4{margin:0 0 8px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#555}
    .resume-section p{margin:0;font-size:12px;line-height:1.6;white-space:pre-wrap}
    .resume-section .line{margin-bottom:4px}
    .resume-edit-note{margin-top:15px;padding:12px;border-radius:8px;background:#f7f8fa;font-size:11px;line-height:1.5;color:#555}
    @media(max-width:640px){
      .review-item{grid-template-columns:1fr;gap:2px}
      .resume-preview{padding:20px}
      .resume-preview-head h3{font-size:22px}
    }
  `;
  document.head.appendChild(style);

  function selectedFilesFor(category){
    if(category==='business')return fileStore.brandLogo||[];
    if(category==='story')return fileStore.media||[];
    if(category==='resume')return fileStore.existingResume||[];
    return[];
  }

  function showBackendError(message){
    const card=document.querySelector('#formCard');
    if(!card){alert(message);return}
    card.querySelector('.backend-error')?.remove();
    const el=document.createElement('div');
    el.className='backend-error';
    el.setAttribute('role','alert');
    el.textContent=message||'Hindi namin ma-submit ngayon. Pakisubukan ulit.';
    card.appendChild(el);
  }

  function setSubmitting(on){
    const btn=document.querySelector('#nextBtn');
    if(!btn)return;
    if(on){
      if(!btn.dataset.originalText)btn.dataset.originalText=btn.innerHTML;
      btn.disabled=true;
      btn.textContent='SUBMITTING…';
    }else{
      btn.disabled=false;
      if(btn.dataset.originalText)btn.innerHTML=btn.dataset.originalText;
    }
  }

  async function postSubmission(category,payload){
    const form=new FormData();
    form.append('category',category);
    const clean={...payload};
    delete clean.consent;
    delete clean.brandLogo;
    delete clean.media;
    delete clean.existingResume;
    clean.website=document.querySelector('#websiteTrap')?.value||'';
    form.append('payload',JSON.stringify(clean));
    if(window.masinlocTurnstileToken)form.append('turnstileToken',window.masinlocTurnstileToken);
    selectedFilesFor(category).forEach((file,i)=>form.append(`file_${i}`,file,file.name));
    const response=await fetch(ENDPOINT,{method:'POST',body:form,credentials:'omit',cache:'no-store'});
    let result={};
    try{result=await response.json()}catch{}
    if(!response.ok||!result.ok)throw new Error(result.error||'Submission failed. Please try again.');
    return result;
  }

  async function postProfessionalProfile(payload){
    const response=await fetch(PROFILE_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',body:JSON.stringify({payload:{...payload,website:document.querySelector('#websiteTrap')?.value||''},turnstileToken:window.masinlocTurnstileToken||''})});
    let result={};
    try{result=await response.json()}catch{}
    if(!response.ok||!result.ok)throw new Error(result.error||'Hindi namin ma-submit ang profile ngayon. Pakisubukan ulit.');
    return result;
  }

  function showGenericSuccess(result,category,payload){
    const ref=result.reference_code||result.reference||`MC-${Date.now().toString().slice(-6)}`;
    const submittedAt=new Date().toISOString();
    lastSubmission={reference:ref,type:category,data:{...payload},submittedAt,backendId:result.id||null};
    storeSet('masinlocLastSubmission',JSON.stringify({reference:ref,type:category,data:{},submittedAt,backendId:result.id||null}));
    storeRemove('masinlocConnectDraft');
    document.querySelector('#refCode').textContent=ref;
    const lead=document.querySelector('#successView .success-panel>p');
    const note=document.querySelector('#successView .success-small');
    lead.textContent='Your submission is ready for review.';
    note.textContent='Nothing is published automatically. We may contact you if we need clarification, verification, or permission before anything appears on the Masinloc website.';
    show('success');
  }

  function splitList(value){return String(value||'').split(/\n|,|;/).map(v=>v.trim()).filter(Boolean).slice(0,20)}
  function cleanLine(value){const s=String(value||'').trim().replace(/\s+/g,' ');if(!s)return'';return s.charAt(0).toUpperCase()+s.slice(1)}
  function prepareResumeSnapshot(d){
    const experience=[];
    if(d.hasWorkExperience==='Oo')experience.push({title:cleanLine(d.lastRole)||'Work Experience',place:cleanLine(d.lastEmployer),details:cleanLine(d.workTasks)});
    if(String(d.practicalExperience||'').trim())experience.push({title:d.hasWorkExperience==='Oo'?'Other Experience':'Practical Experience',place:'',details:cleanLine(d.practicalExperience)});
    return{name:cleanLine(d.fullName),targetRole:cleanLine(d.targetJob),contact:{phone:String(d.contactNumber||'').trim(),email:String(d.email||'').trim(),location:cleanLine(d.currentLocation)},workPreference:{type:String(d.workType||'').trim(),location:cleanLine(d.preferredLocation)},skills:splitList(d.skills),tools:splitList(d.tools),experience,education:{level:cleanLine(d.education),school:cleanLine(d.school),course:cleanLine(d.course)},training:splitList(d.training),languages:splitList(d.languages)};
  }
  function escText(value){return esc(String(value??''))}

  const labels={fullName:'Buong pangalan',contactNumber:'Cellphone number',email:'Email',currentLocation:'Saan ka nakatira ngayon?',targetJob:'Anong trabaho ang gusto mo?',workType:'Anong klaseng trabaho ang okay sa iyo?',preferredLocation:'Saan ka puwedeng magtrabaho?',hasWorkExperience:'Nakapagtrabaho ka na ba dati?',lastEmployer:'Saan ka huling nagtrabaho?',lastRole:'Ano ang trabaho mo doon?',workTasks:'Ano ang madalas mong ginagawa?',practicalExperience:'May sideline, OJT, family business, volunteer work, o ibang experience ka ba?',skills:'Ano ang marunong mong gawin?',tools:'May machine, gamit, software, o equipment ka bang marunong gamitin?',training:'May TESDA, training, certificate, lisensya, o seminar ka ba?',education:'Hanggang saan ka nakapag-aral?',school:'Anong school?',course:'May course, strand, o program ka ba?',languages:'Anong wika ang kaya mong gamitin?'};
  const professionalSections=[{title:'Tungkol sa iyo',fields:['fullName','contactNumber','email','currentLocation']},{title:'Trabahong gusto mo',fields:['targetJob','workType','preferredLocation']},{title:'Experience',fields:['hasWorkExperience','lastEmployer','lastRole','workTasks','practicalExperience']},{title:'Skills at training',fields:['skills','tools','training']},{title:'Education',fields:['education','school','course','languages']}];

  function renderProfessionalReview(){
    return `<div class="review-list">${professionalSections.map(section=>{const rows=section.fields.filter(k=>String(data[k]||'').trim()).map(k=>`<div class="review-item"><span>${escText(labels[k]||pretty(k))}</span><strong>${escText(data[k])}</strong></div>`).join('');return rows?`<div class="review-group"><h3>${escText(section.title)}</h3>${rows}</div>`:''}).join('')}</div>`;
  }

  function renderResumePreview(){
    const r=data.resumeSnapshot||prepareResumeSnapshot(data);data.resumeSnapshot=r;
    const contact=[r.contact.phone,r.contact.email,r.contact.location].filter(Boolean).map(escText).join(' · ');
    const experience=(r.experience||[]).map(item=>`<div class="line"><strong>${escText(item.title)}</strong>${item.place?` · ${escText(item.place)}`:''}</div>${item.details?`<p>${escText(item.details)}</p>`:''}`).join('');
    const education=[r.education.level,r.education.course,r.education.school].filter(Boolean).map(escText).join(' · ');
    const skills=[...(r.skills||[]),...(r.tools||[])].filter(Boolean).map(escText).join(' · ');
    return `<div class="resume-preview"><div class="resume-preview-head"><h3>${escText(r.name)}</h3><div class="resume-preview-role">${escText(r.targetRole)}</div><div class="resume-preview-contact">${contact}</div></div>${skills?`<section class="resume-section"><h4>Skills</h4><p>${skills}</p></section>`:''}${experience?`<section class="resume-section"><h4>Experience</h4>${experience}</section>`:''}${education?`<section class="resume-section"><h4>Education</h4><p>${education}</p></section>`:''}${(r.training||[]).length?`<section class="resume-section"><h4>Training / Certificates</h4><p>${r.training.map(escText).join(' · ')}</p></section>`:''}${(r.languages||[]).length?`<section class="resume-section"><h4>Languages</h4><p>${r.languages.map(escText).join(' · ')}</p></section>`:''}<div class="resume-edit-note">May mali o kulang? Bumalik at baguhin muna bago mag-submit. Ang impormasyong makikita mo rito ang ise-save sa iyong Masinloc Connect profile.</div></div>`;
  }

  const base=document.createElement('script');
  base.src='app-base.js';
  base.onload=()=>{
    const originalRenderForm=renderForm,originalCollect=collect,originalValidate=validate,originalBindStep=bindStep,originalStoreGet=storeGet;
    configs.professional={label:'PROFESSIONAL',icon:'●',color:'#ffb90a',aside:'Sagutin lang nang simple. Hindi mo kailangang marunong gumawa ng résumé.',steps:[
      {label:'Ikaw',title:'Ikaw muna.',help:'Simple lang. Ito ang basic information na kailangan para sa profile mo.',fields:[{name:'fullName',label:'Ano ang buong pangalan mo?',type:'text',placeholder:'Buong pangalan',required:true,full:true},{name:'contactNumber',label:'Ano ang cellphone number mo?',type:'tel',placeholder:'09XXXXXXXXX',required:true},{name:'email',label:'May email ka ba?',type:'email',placeholder:'Optional',required:false},{name:'currentLocation',label:'Saan ka nakatira ngayon?',type:'text',placeholder:'Hal. Brgy. Taltal, Masinloc',required:true,full:true}]},
      {label:'Trabaho',title:'Anong trabaho ang gusto mo?',help:'Hindi kailangang exact ang job title. Isulat mo lang kung anong klaseng trabaho ang gusto mong pasukan.',fields:[{name:'targetJob',label:'Trabahong gusto mo',type:'text',placeholder:'Hal. Welder, driver, office staff, production worker',required:true,full:true},{name:'workType',label:'Anong klaseng trabaho ang okay sa iyo?',type:'select',required:true,options:['Kahit ano','Full-time','Part-time','Contract / project','Seasonal']},{name:'preferredLocation',label:'Saan ka puwedeng magtrabaho?',type:'text',placeholder:'Hal. Masinloc, Zambales, kahit saan',required:false,full:true}]},
      {label:'Experience',title:'Ano na ang mga nagawa mong trabaho?',help:'Okay lang kahit hindi formal na kumpanya. Puwede ang sideline, OJT, family business, volunteer work, o praktikal na experience.',fields:[{name:'hasWorkExperience',label:'Nakapagtrabaho ka na ba dati?',type:'select',required:true,options:['Oo','Hindi pa']},{name:'lastEmployer',label:'Kung oo, saan ka huling nagtrabaho?',type:'text',placeholder:'Company, negosyo, organization, o employer',required:false},{name:'lastRole',label:'Ano ang trabaho mo doon?',type:'text',placeholder:'Hal. Helper, cashier, driver',required:false},{name:'workTasks',label:'Ano ang madalas mong ginagawa?',type:'textarea',placeholder:'Hal. Nag-aasikaso ng customer, nag-aayos ng gamit, nagde-deliver, nag-eencode.',required:false,full:true},{name:'practicalExperience',label:'May iba ka pa bang sideline, OJT, family business, volunteer work, o experience?',type:'textarea',placeholder:'Okay lang kung wala. Kung meron, ikuwento lang nang simple.',required:false,full:true}]},
      {label:'Kaya mo',title:'Ano ang marunong mong gawin?',help:'Hindi kailangan ng malalalim na salita. Isulat mo lang ang kaya mong gawin sa trabaho.',fields:[{name:'skills',label:'Mga marunong mong gawin',type:'textarea',placeholder:'Hal. Welding, driving, customer service, pagluluto, paggamit ng computer',required:true,full:true},{name:'tools',label:'May machine, gamit, software, o equipment ka bang marunong gamitin?',type:'textarea',placeholder:'Hal. welding machine, power tools, Excel. Optional.',required:false,full:true},{name:'training',label:'May TESDA, training, certificate, lisensya, o seminar ka ba?',type:'textarea',placeholder:'Isulat kung meron. Optional.',required:false,full:true}]},
      {label:'Aral',title:'Hanggang saan ka nakapag-aral?',help:'Piliin ang pinakamalapit sa iyo. Okay lang kung hindi ka nakatapos.',fields:[{name:'education',label:'Pinakamataas na naabot sa pag-aaral',type:'select',required:true,options:['Elementary','High School','Senior High School','Vocational / TESDA','College undergraduate','College graduate','Graduate studies','Iba pa']},{name:'school',label:'Anong school?',type:'text',placeholder:'Pangalan ng school. Optional.',required:false,full:true},{name:'course',label:'May course, strand, o program ka ba?',type:'text',placeholder:'Hal. ABM, Automotive, BS Tourism. Optional.',required:false,full:true},{name:'languages',label:'Anong wika ang kaya mong gamitin?',type:'text',placeholder:'Hal. Filipino, English, Sambal Tina. Optional.',required:false,full:true}]},
      {label:'Check',title:'Paki-check muna ang impormasyon mo.',help:'Bago namin ayusin ang résumé mo, siguraduhin munang tama ang mga sagot na inilagay mo.',rawReview:true,consentName:'rawConfirmed',consent:'Tama ang impormasyong inilagay ko. Naiintindihan kong aayusin lamang ang pagkakasulat at hindi babaguhin ang tunay kong experience.'},
      {label:'Final',title:'Final review.',help:'Ito ang résumé information na ise-save sa iyong Masinloc Connect profile. Basahin muna bago mag-submit.',resumePreview:true,consentName:'finalConfirmed',consent:'Nabasa ko ang résumé sa itaas at tama ang impormasyong nakalagay.'}
    ]};

    const draftIsFresh=draft=>{const updated=Date.parse(draft?.updatedAt||'');return Number.isFinite(updated)&&Date.now()-updated<=DRAFT_MAX_AGE_MS};
    saveDraft=function(){if(!type)return;const draftData={...data};delete draftData.brandLogo;delete draftData.media;delete draftData.existingResume;storeSet('masinlocConnectDraft',JSON.stringify({type,step,data:draftData,updatedAt:new Date().toISOString()}));const status=document.querySelector('#saveStatus');if(status)status.textContent='Saved on this device for 7 days'};
    checkDraft=function(){const raw=originalStoreGet('masinlocConnectDraft');if(!raw){document.querySelector('#resumeBar').hidden=true;return}try{const draft=JSON.parse(raw);if(!draftIsFresh(draft)){storeRemove('masinlocConnectDraft');document.querySelector('#resumeBar').hidden=true;return}const total=configs[draft.type]?.steps?.length||4;document.querySelector('#resumeMeta').textContent=`${configs[draft.type]?.label||'Submission'} · Step ${(draft.step||0)+1} of ${total}`;document.querySelector('#resumeBar').hidden=false}catch{storeRemove('masinlocConnectDraft');document.querySelector('#resumeBar').hidden=true}};
    show=function(name){Object.entries(views).forEach(([k,v])=>{const active=k===name;v.hidden=!active;v.classList.toggle('active',active)});document.querySelector('#overlayNav').style.display='flex';document.querySelector('#overlayNav').classList.toggle('inner-nav',name!=='landing');window.scrollTo({top:0,behavior:'auto'})};

    function collectProfessional(){document.querySelectorAll('#formCard input,#formCard textarea,#formCard select').forEach(el=>{if(el.type==='checkbox')data[el.name]=el.checked;else data[el.name]=el.value})}
    function validateProfessional(){const s=configs.professional.steps[step];let ok=true;(s.fields||[]).forEach(f=>{if(!f.required)return;const el=document.querySelector(`[name="${f.name}"]`),wrap=document.querySelector(`[data-field="${f.name}"]`),value=el?.value?.trim(),bad=!value;wrap?.classList.toggle('invalid',bad);if(bad)ok=false});if(s.consentName){const c=document.querySelector(`#${s.consentName}`),err=document.querySelector(`#${s.consentName}Error`);if(!c?.checked){if(err)err.style.display='block';ok=false}else{if(err)err.style.display='none';data[s.consentName]=true}}return ok}
    function renderProfessionalForm(){const cfg=configs.professional,s=cfg.steps[step],pct=Math.round(((step+1)/cfg.steps.length)*100);document.querySelector('#progressRail').innerHTML=`<div style="width:100%"><div class="professional-progress"><span style="width:${pct}%"></span></div><div class="professional-step-meta"><span>Step ${step+1} of ${cfg.steps.length}</span><span>${escText(s.label)}</span></div></div>`;document.querySelector('#categoryAside').innerHTML=`<div class="side-icon" style="background:${cfg.color}">${cfg.icon}</div><h3 style="color:${cfg.color}">${cfg.label}</h3><p>${cfg.aside}</p>`;let h=`<div class="step-kicker" style="color:${cfg.color}">MASINLOC CONNECT</div><h2>${s.title}</h2><p class="step-help">${s.help}</p>`;if(s.fields)h+=renderFields(s.fields);if(s.rawReview)h+=renderProfessionalReview();if(s.resumePreview)h+=renderResumePreview();if(s.consentName)h+=`<div class="consent"><input type="checkbox" name="${s.consentName}" id="${s.consentName}" ${data[s.consentName]?'checked':''}><label for="${s.consentName}">${s.consent}</label></div><div class="consent-error" id="${s.consentName}Error">Paki-confirm muna bago magpatuloy.</div>`;const nextText=step===5?'IHANDA ANG RESUME KO':step===cfg.steps.length-1?'SUBMIT MY PROFILE':'CONTINUE';h+=`<div class="form-actions">${step?'<button type="button" class="prev" id="prevBtn">BACK</button>':'<span></span>'}<button type="button" class="next" id="nextBtn" style="background:${cfg.color}">${nextText} <span>→</span></button></div><button type="button" class="save-later" id="saveLater">Save and continue later</button>`;document.querySelector('#formCard').innerHTML=h;bindProfessionalStep()}
    function bindProfessionalStep(){document.querySelectorAll('#formCard input,#formCard textarea,#formCard select').forEach(el=>{const fn=()=>{if(el.type==='checkbox')data[el.name]=el.checked;else data[el.name]=el.value;saveDraft()};el.addEventListener('input',fn);el.addEventListener('change',fn)});document.querySelector('#nextBtn').addEventListener('click',async()=>{if(!validateProfessional())return;collectProfessional();if(step===5)data.resumeSnapshot=prepareResumeSnapshot(data);if(step<configs.professional.steps.length-1){step++;renderProfessionalForm();saveDraft();window.scrollTo(0,0)}else await submitProfessional()});document.querySelector('#prevBtn')?.addEventListener('click',()=>{collectProfessional();step--;renderProfessionalForm();saveDraft();window.scrollTo(0,0)});document.querySelector('#saveLater').addEventListener('click',()=>{collectProfessional();saveDraft();show('landing');checkDraft()})}
    async function submitProfessional(){collectProfessional();data.resumeSnapshot=prepareResumeSnapshot(data);setSubmitting(true);try{const profilePayload={targetJob:data.targetJob||'',workType:data.workType||'',preferredLocation:data.preferredLocation||'',hasWorkExperience:data.hasWorkExperience||'',lastEmployer:data.lastEmployer||'',lastRole:data.lastRole||'',workTasks:data.workTasks||'',practicalExperience:data.practicalExperience||'',tools:data.tools||'',training:data.training||'',education:data.education||'',school:data.school||'',course:data.course||'',languages:data.languages||''};const description=[data.lastRole,data.lastEmployer,data.workTasks,data.practicalExperience].filter(Boolean).join(' · ').slice(0,1800)||data.targetJob;const result=await postProfessionalProfile({fullName:data.fullName,targetJob:data.targetJob,skills:data.skills,currentLocation:data.currentLocation,contactNumber:data.contactNumber,email:data.email||'',professionalDescription:description,professionalLink:'',profilePayload,resumeSnapshot:data.resumeSnapshot});const ref=result.reference_code,submittedAt=new Date().toISOString();lastSubmission={reference:ref,type:'professional',data:{},submittedAt,backendId:result.id||null};storeSet('masinlocLastSubmission',JSON.stringify(lastSubmission));storeRemove('masinlocConnectDraft');document.querySelector('#refCode').textContent=ref;const panel=document.querySelector('#successView .success-panel'),heading=panel.querySelector('h2'),lead=panel.querySelector(':scope>p'),note=panel.querySelector('.success-small');heading.textContent='Profile ready.';lead.textContent='Your Masinloc Connect professional profile has been submitted.';note.textContent='Save your Profile Code. It identifies your existing profile for future Masinloc Connect account and mobile app access.';const oldButton=document.querySelector('#downloadReceipt');if(oldButton){const copyButton=oldButton.cloneNode(true);copyButton.textContent='Copy Profile Code';oldButton.replaceWith(copyButton);copyButton.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(ref);copyButton.textContent='Code Copied';setTimeout(()=>copyButton.textContent='Copy Profile Code',1600)}catch{window.prompt('Copy your Masinloc Connect Profile Code:',ref)}})}document.querySelector('#submitAnother').textContent='Done';fileStore={};checkDraft();show('success')}catch(err){showBackendError(err instanceof Error?err.message:'Hindi namin ma-submit ang profile ngayon. Pakisubukan ulit.')}finally{setSubmitting(false)}}

    renderForm=function(){if(type==='professional')return renderProfessionalForm();return originalRenderForm()};
    collect=function(){if(type==='professional')return collectProfessional();return originalCollect()};
    validate=function(){if(type==='professional')return validateProfessional();return originalValidate()};
    bindStep=function(){if(type==='professional')return bindProfessionalStep();return originalBindStep()};
    submit=async function(){if(type==='professional')return submitProfessional();originalCollect();setSubmitting(true);try{const result=await postSubmission(type,data);showGenericSuccess(result,type,data);fileStore={}}catch(err){showBackendError(err instanceof Error?err.message:'Submission failed. Please try again.')}finally{setSubmitting(false)}};

    document.addEventListener('change',e=>{const input=e.target.closest('input[type="file"]');if(!input)return;fileStore[input.name]=[...input.files]},true);
    document.addEventListener('click',e=>{const firstChoice=e.target.closest('[data-choose]');if(firstChoice){e.preventDefault();e.stopImmediatePropagation();fileStore={};const category=firstChoice.classList.contains('business')?'business':firstChoice.classList.contains('story')?'story':'professional';openCategory(category);return}if(e.target.closest('#changeCategory')){e.preventDefault();e.stopImmediatePropagation();fileStore={};show('landing');return}if(e.target.closest('#submitAnother')){e.preventDefault();e.stopImmediatePropagation();type=null;step=0;data={};fileStore={};show('landing')}},true);
    checkDraft();
    show('landing');
  };
  document.body.appendChild(base);
})();