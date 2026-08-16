(function(){
  const ENDPOINT='https://uwcqvsitjtknxsaypjxj.supabase.co/functions/v1/submit-masinloc';
  let fileStore={};
  let persistedProfessional=null;

  const style=document.createElement('style');
  style.textContent=`
    .form-header{display:none!important}
    .overlay-nav.inner-nav{position:relative!important;background:#fff!important;border-bottom:1px solid #eff0f4!important}
    .backend-error{margin:12px 0 0;padding:10px 12px;border-radius:6px;background:#fff1f2;color:#b4232d;font-size:9px;line-height:1.45}
    .next[disabled]{opacity:.62;cursor:wait}
  `;
  document.head.appendChild(style);

  function selectedFilesFor(category){
    if(category==='business') return fileStore.brandLogo||[];
    if(category==='story') return fileStore.media||[];
    return [];
  }

  function showBackendError(message){
    const card=document.querySelector('#formCard');
    if(!card){ alert(message); return; }
    card.querySelector('.backend-error')?.remove();
    const el=document.createElement('div');
    el.className='backend-error';
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
    form.append('payload',JSON.stringify(clean));
    if(window.masinlocTurnstileToken) form.append('turnstileToken',window.masinlocTurnstileToken);
    selectedFilesFor(category).forEach((file,i)=>form.append(`file_${i}`,file,file.name));

    const response=await fetch(ENDPOINT,{method:'POST',body:form});
    let result={};
    try{ result=await response.json(); }catch{}
    if(!response.ok || !result.ok){
      throw new Error(result.error || 'Submission failed. Please try again.');
    }
    return result;
  }

  function showSuccess(result,category,payload){
    const ref=result.reference_code || result.reference || `MC-${Date.now().toString().slice(-6)}`;
    lastSubmission={reference:ref,type:category,data:{...payload},submittedAt:new Date().toISOString(),backendId:result.id||null};
    storeSet('masinlocLastSubmission',JSON.stringify(lastSubmission));
    storeRemove('masinlocConnectDraft');
    document.querySelector('#refCode').textContent=ref;
    const lead=document.querySelector('#successView .success-panel>p');
    const note=document.querySelector('#successView .success-small');
    if(category==='resume'){
      lead.textContent='Your resume information has been submitted.';
      note.textContent='We will use your submitted credentials to prepare your resume using the unified Masinloc Connect resume design.';
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
    configs.resume.steps[3]={
      label:'Review',
      title:'Review your resume information.',
      help:'We will use these details to prepare your resume using one standard Masinloc Connect design.',
      review:true,
      consent:'I confirm that the information I submitted may be used to prepare my resume and support future job applications.'
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
        modal.innerHTML=`<div class="resume-modal-card"><button class="modal-close" type="button" id="resumeNoTop">×</button><p class="modal-kicker">YOUR PROFILE WILL STAY PRIVATE</p><h2>Would you like us to create your resume?</h2><p>We can use your professional information as a starting point, ask a few more questions about your credentials, then prepare your resume using the standard Masinloc Connect resume design.</p><div class="modal-actions"><button type="button" class="modal-primary" id="resumeYes">Yes, create my resume</button><button type="button" class="modal-secondary" id="resumeNo">No, thank you</button></div></div>`;
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

    show('landing');
  };
  document.body.appendChild(base);
})();