(()=>{
  const softenCheckedCopy=value=>String(value||'').replace(/current checked opportunities/gi,'current opportunities').replace(/checked opportunities/gi,'opportunities');

  function applyPresentation(){
    document.querySelectorAll('.jobs-detail-badges span').forEach(span=>{
      const label=(span.textContent||'').trim();
      if(/^Checked\b/i.test(label)||/^Source check/i.test(label))span.remove();
    });

    const summary=document.getElementById('summaryChecked');
    if(summary&&summary.textContent!=='Ongoing')summary.textContent='Ongoing';

    const sourceNote=document.querySelector('.jobs-source-note');
    if(sourceNote&&!sourceNote.dataset.masPresentation){
      sourceNote.dataset.masPresentation='1';
      sourceNote.innerHTML='<strong>Masinloc Connect found and organized this opportunity for you.</strong> We help you compare the role, prepare your application, and keep your job search in one place. When you are ready to apply, you will continue through the official application page.';
    }

    for(const id of ['jobsStatus','quickMatchNote']){
      const node=document.getElementById(id);
      if(!node)continue;
      const revised=softenCheckedCopy(node.textContent);
      if(revised!==node.textContent)node.textContent=revised;
    }
  }

  const observer=new MutationObserver(applyPresentation);
  const start=()=>{
    applyPresentation();
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();