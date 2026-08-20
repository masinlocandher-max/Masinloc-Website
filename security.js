(function(){
  const MB=1024*1024;

  function setAccept(input){
    if(!input || input.type!=='file') return;
    if(input.name==='brandLogo'){
      input.accept='image/jpeg,image/png,image/webp';
      input.multiple=false;
    }
    if(input.name==='media'){
      input.accept='image/jpeg,image/png,image/webp,application/pdf';
      input.multiple=true;
    }
    if(input.name==='existingResume'){
      input.accept='application/pdf';
      input.multiple=false;
    }
  }

  function rules(input){
    if(input.name==='brandLogo') return {allowed:new Set(['image/jpeg','image/png','image/webp']),maxFiles:1,maxBytes:10*MB,message:'Business logos must be JPG, PNG, or WebP and no larger than 10 MB.'};
    if(input.name==='existingResume') return {allowed:new Set(['application/pdf']),maxFiles:1,maxBytes:10*MB,message:'Existing resumes must be one PDF no larger than 10 MB.'};
    return {allowed:new Set(['image/jpeg','image/png','image/webp','application/pdf']),maxFiles:5,maxBytes:25*MB,message:'Story files must be JPG, PNG, WebP, or PDF. Each file must be no larger than 25 MB, with up to 5 files.'};
  }

  document.addEventListener('click',e=>{
    const input=e.target.closest('input[type="file"]');
    if(input) setAccept(input);
  },true);

  document.addEventListener('change',e=>{
    const input=e.target.closest('input[type="file"]');
    if(!input) return;
    setAccept(input);
    const files=[...input.files];
    const rule=rules(input);
    const badType=files.find(f=>!rule.allowed.has(f.type));
    const tooLarge=files.find(f=>f.size>rule.maxBytes);
    if(files.length>rule.maxFiles || badType || tooLarge){
      input.value='';
      alert(rule.message);
    }
  },true);

  window.masinlocTurnstileToken='';
  window.masinlocSetTurnstileToken=function(token){ window.masinlocTurnstileToken=token||''; };
})();