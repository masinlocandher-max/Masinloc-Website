(function(){
  const ENDPOINT='https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-masinloc';
  const DRAFT_MAX_AGE_MS=7*24*60*60*1000;
  let fileStore={};
  let persistedProfessional=null;

  const style=document.createElement('style');
  style.textContent=`
    .form-header{display:none!important}
    .overlay-nav.inner-nav{position:relative!important;background:#fff!important;border-bottom:1px solid #eff0f4!important}
    .backend-error{margin:12px 0 0;padding:10px 12px;border-radius:6px;background:#fff1f2;color:#b4232d;font-size:11px;line-height:1.45}
    .next[disabled]{opacity:.62;cursor:wait}
  `;
  document.head.appendChild(style);

  function selectedFilesFor(category){
    if(category==='business') return fileStore.brandLogo||[];
    if(category==='story') return fileStore.media||[];
    if(category==='resume') return fileStore.existingResume||[];
    return [];
  }

  function showBackendError(message){
    const card=document.querySelector('#formCard');
    if(!card){ alert(message); return; }
    card.querySelector('.backend-error')?.remove();
    const el=document.createElement('div');
    el.className='backend-error';
    el.setAttribute('role','alert');
    el.textContent=message || 'We could not submit this right now. Please try again.';
    card.appendChild(el);
  }

  function setSubmitting(on){
    const btn=document.querySelector('#nextBtn');
    if(!btn) return;
    if(on){
      if(!btn.dataset.originalText) btn.dataset.originalText=btn.innerHTML;
      btn.disabled=true;
      btn.textContent='SUBMITTING…';
    }else{
      btn.disabled=false;
      if(btn.dataset.originalText) btn.innerHTML=btn.dataset.originalText;
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
    if(window.masinlocTurnstileToken) form.append('turnstileToken',window.masinlocTurnstileToken);
    selectedFilesFor(category).forEach((file,i)=>form.append(`file_${i}`,file,file.name));

    const response=await fetch(ENDPOINT,{method:'POST',body:form,credentials:'omit',cache:'no-store'});
    let result={};
    try{ result=await response.json(); }catch{}
    if(!response.ok || !result.ok){
      throw new Error(result.error || 'Submission failed. Please try again.');
    }
    return result;
  }

  function showSuccess(result,category,payload){
    const ref=result.reference_code || result.reference || `MC-${Date.now().toString().slice(-6)}`;
    const submittedAt=new Date().toISOString();
    lastSubmission={reference:ref,type:category,data:{...payload},submittedAt,backendId:result.id||null};
    storeSet('masinlocLastSubmission',JSON.stringify({reference:ref,type:category,data:{},submittedAt,backendId:result.id||null}));
    storeRemove('masinlocConnectDraft');
    document.querySelector('#refCode').textContent=ref;
    const lead=document.querySelector('#successView .success-panel>p');
    const note=document.querySelector('#successView .success-small');
    if(category==='resume'){
      lead.textContent='Your resume information has been submitted.';
      note.textContent='Your information and any optional PDF you attached are private and available only to the review team.';
    }else if(category==='professional' && (payload.publicProfile==='no' || payload.publicProfile===false)){
      lead.textContent='Thank you for your submission.';
      note.textContent='Your professional profile will not be posted publicly, as requested.';
    }else{
      lead.textContent='Your submission is ready for review.';
      note.textContent='Nothing is published automatically. We may contact you if we need clarification, verification, or permission before anything appears on the Masinloc website.';
    }
    checkDraft();
    show('success');
  }

  const base=document.createElement('script');
  base.src='app-base.js';
  base.onload=()=>{
    configs.business.steps=[
      {
        label:'Brand',
        title:'Tell us about your business.',
        help:'Start with the name and a short description customers will understand.',
        fields:[
          {name:'brandName',label:'Brand name',type:'text',placeholder:'Your business or brand name',required:true},
          {name:'shortDescription',label:'Short description',type:'textarea',placeholder:'Briefly tell people what your business offers.',required:true,full:true},
          {name:'brandLogo',label:'Brand logo',type:'file',required:false,full:true,accept:'image/jpeg,image/png,image/webp',multiple:false}
        ]
      },
      {
        label:'Public contact',
        title:'How can customers find and contact your business?',
        help:'These are the details that may appear on your business listing after review.',
        fields:[
          {name:'storeLocations',label:'Store location/s',type:'textarea',placeholder:'Barangay, address, landmark, or multiple branches. Leave blank if you do not have a physical store.',required:false,full:true},
          {name:'contactNumber',label:'Public business contact number',type:'text',placeholder:'Number customers may use',required:true},
          {name:'facebookPage',label:'Facebook Page URL',type:'url',placeholder:'https://facebook.com/yourpage',required:true,full:true}
        ]
      },
      {
        label:'Owner',
        title:'Who should we contact about this listing?',
        help:'Owner details are kept private and used for verification, listing management, and future Business Dashboard access.',
        fields:[
          {name:'ownerName',label:'Owner / authorized representative',type:'text',placeholder:'Full name',required:true},
          {name:'ownerEmail',label:'Private owner email',type:'email',placeholder:'name@example.com',required:true},
          {name:'ownerPhone',label:'Private owner contact number',type:'tel',placeholder:'Contact number for verification',required:true,full:true}
        ]
      },
      {
        label:'Review',
        title:'Review your business submission.',
        help:'Check the public listing details and the private owner information before sending.',
        review:true,
        consent:'I confirm that I am authorized to submit this business information, that the details are accurate to the best of my knowledge, and that the private owner contact details may be used to verify and manage this listing.'
      }
    ];

    const baseRenderFields=renderFields;
    renderFields=function(fields){
      return `<div class="field-grid">${fields.map(f=>{
        const v=data[f.name]||'';
        let control='';
        if(f.type==='textarea') control=`<textarea name="${f.name}" placeholder="${f.placeholder||''}">${esc(v)}</textarea>`;
        else if(f.type==='select') control=`<select name="${f.name}"><option value="">Choose one</option>${f.options.map(o=>`<option ${v===o?'selected':''}>${o}</option>`).join('')}</select>`;
        else if(f.type==='file'){
          const accept=f.accept||'image/*,.pdf,.doc,.docx';
          const multiple=f.multiple===false?'':' multiple';
          control=`<div class="file-box"><input name="${f.name}" type="file"${multiple} accept="${accept}"></div>`;
        }else control=`<input name="${f.name}" type="${f.type}" value="${esc(v)}" placeholder="${f.placeholder||''}">`;
        return `<div class="field ${f.full?'full':''}" data-field="${f.name}"><label>${f.label}${f.required?' *':''}</label>${control}<div class="error">Please complete this field.</div></div>`;
      }).join('')}</div>`;
    };

    configs.story.steps[2].fields[0]={...configs.story.steps[2].fields[0],accept:'image/jpeg,image/png,image/webp,application/pdf',multiple:true};
    configs.resume.steps[3]={
      label:'Review',
      title:'Review your resume information.',
      help:'Check the details below. If you already have a resume, you may attach one PDF up to 10 MB.',
      fields:[{name:'existingResume',label:'Existing resume PDF, if any',type:'file',required:false,full:true,accept:'application/pdf',multiple:false}],
      review:true,
      consent:'I confirm that the information I submitted may be used to prepare my resume and support future job applications.'
    };

    const originalStoreGet=storeGet;
    const draftIsFresh=(draft)=>{
      const updated=Date.parse(draft?.updatedAt||'');
      return Number.isFinite(updated) && Date.now()-updated<=DRAFT_MAX_AGE_MS;
    };

    saveDraft=function(){
      if(!type)return;
      const draftData={...data};
      delete draftData.brandLogo;
      delete draftData.media;
      delete draftData.existingResume;
      storeSet('masinlocConnectDraft',JSON.stringify({type,step,data:draftData,updatedAt:new Date().toISOString()}));
      const status=document.querySelector('#saveStatus');
      if(status) status.textContent='Saved on this device for 7 days';
    };

    checkDraft=function(){
      const raw=originalStoreGet('masinlocConnectDraft');
      if(!raw){document.querySelector('#resumeBar').hidden=true;return}
      try{
        const draft=JSON.parse(raw);
        if(!draftIsFresh(draft)){
          storeRemove('masinlocConnectDraft');
          document.querySelector('#resumeBar').hidden=true;
          return;
        }
        document.querySelector('#resumeMeta').textContent=`${configs[draft.type]?.label||'Submission'} · Step ${(draft.step||0)+1} of 4`;
        document.querySelector('#resumeBar').hidden=false;
      }catch{
        storeRemove('masinlocConnectDraft');
        document.querySelector('#resumeBar').hidden=true;
      }
    };

    show=function(name){
      Object.entries(views).forEach(([k,v])=>{
        const active=k===name;
        v.hidden=!active;
        v.classList.toggle('active',active);
      });
      document.querySelector('#overlayNav').style.display='flex';
      document.querySelector('#overlayNav').classList.toggle('inner-nav',name!=='landing');
      window.scrollTo({top:0,behavior:'auto'});
    };

    submit=async function(){
      collect();
      setSubmitting(true);
      try{
        const result=await postSubmission(type,data);
        showSuccess(result,type,data);
        fileStore={};
        persistedProfessional=null;
      }catch(err){
        showBackendError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
      }finally{
        setSubmitting(false);
      }
    };

    showResumeOffer=async function(){
      collect();
      setSubmitting(true);
      try{
        const result=await postSubmission('professional',data);
        persistedProfessional={result,payload:{...data}};
        data.professionalSubmissionId=result.id;
        data.professionalReference=result.reference_code;

        const modal=document.createElement('div');
        modal.className='resume-modal';
        modal.innerHTML=`<div class="resume-modal-card"><button class="modal-close" type="button" id="resumeNoTop" aria-label="Close">×</button><p class="modal-kicker">YOUR PROFILE WILL STAY PRIVATE</p><h2>Would you like us to create your resume?</h2><p>We can use your professional information as a starting point, ask a few more questions about your credentials, then prepare your resume using the standard Masinloc Connect resume design.</p><div class="modal-actions"><button type="button" class="modal-primary" id="resumeYes">Yes, create my resume</button><button type="button" class="modal-secondary" id="resumeNo">No, thank you</button></div></div>`;
        document.body.appendChild(modal);

        document.querySelector('#resumeYes').addEventListener('click',()=>{
          modal.remove();
          const professionalData={...data};
          type='resume';
          step=0;
          data={...professionalData,professionalSubmissionId:result.id};
          renderForm();
          show('form');
          saveDraft();
        });

        const no=()=>{
          modal.remove();
          showSuccess(result,'professional',persistedProfessional.payload);
          persistedProfessional=null;
          fileStore={};
        };
        document.querySelector('#resumeNo').addEventListener('click',no);
        document.querySelector('#resumeNoTop').addEventListener('click',no);
      }catch(err){
        showBackendError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
      }finally{
        setSubmitting(false);
      }
    };

    document.addEventListener('change',e=>{
      const input=e.target.closest('input[type="file"]');
      if(!input) return;
      fileStore[input.name]=[...input.files];
    },true);

    document.addEventListener('click',e=>{
      const firstChoice=e.target.closest('[data-choose]');
      if(firstChoice){
        e.preventDefault();
        e.stopImmediatePropagation();
        fileStore={};
        persistedProfessional=null;
        const category=firstChoice.classList.contains('business')?'business':firstChoice.classList.contains('story')?'story':'professional';
        openCategory(category);
        return;
      }
      if(e.target.closest('#changeCategory')){
        e.preventDefault();
        e.stopImmediatePropagation();
        fileStore={};
        persistedProfessional=null;
        show('landing');
        return;
      }
      if(e.target.closest('#submitAnother')){
        e.preventDefault();
        e.stopImmediatePropagation();
        type=null;step=0;data={};
        fileStore={};
        persistedProfessional=null;
        show('landing');
      }
    },true);

    checkDraft();
    show('landing');
  };
  document.body.appendChild(base);
})();