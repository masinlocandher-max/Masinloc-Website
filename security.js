(function(){
  function setAccept(input){
    if(!input || input.type!=='file') return;
    if(input.name==='brandLogo') input.accept='image/jpeg,image/png,image/webp';
    if(input.name==='media') input.accept='image/jpeg,image/png,image/webp,application/pdf';
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
    const allowed=input.name==='brandLogo'
      ? new Set(['image/jpeg','image/png','image/webp'])
      : new Set(['image/jpeg','image/png','image/webp','application/pdf']);
    const bad=files.find(f=>!allowed.has(f.type));
    if(bad){
      input.value='';
      alert('For security, documents must be PDF. Images may be JPG, PNG, or WebP.');
    }
  },true);

  window.masinlocTurnstileToken='';
  window.masinlocSetTurnstileToken=function(token){ window.masinlocTurnstileToken=token||''; };
})();