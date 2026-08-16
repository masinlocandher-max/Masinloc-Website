(function(){
  const style=document.createElement('style');
  style.textContent=`
    .form-header{display:none!important}
    .overlay-nav.inner-nav{position:relative!important;background:#fff!important;border-bottom:1px solid #eff0f4!important}
  `;
  document.head.appendChild(style);

  const base=document.createElement('script');
  base.src='app-base.js';
  base.onload=()=>{
    show=function(name){
      Object.entries(views).forEach(([k,v])=>{
        const active=k===name;
        v.hidden=!active;
        v.classList.toggle('active',active);
      });
      $('#overlayNav').style.display='flex';
      $('#overlayNav').classList.toggle('inner-nav',name!=='landing');
      window.scrollTo({top:0,behavior:'auto'});
    };

    document.addEventListener('click',e=>{
      const firstChoice=e.target.closest('[data-choose]');
      if(firstChoice){
        e.preventDefault();
        e.stopImmediatePropagation();
        const category=firstChoice.classList.contains('business')?'business':firstChoice.classList.contains('story')?'story':'professional';
        openCategory(category);
        return;
      }
      if(e.target.closest('#changeCategory')){
        e.preventDefault();
        e.stopImmediatePropagation();
        show('landing');
        return;
      }
      if(e.target.closest('#submitAnother')){
        e.preventDefault();
        e.stopImmediatePropagation();
        type=null;step=0;data={};
        show('landing');
      }
    },true);

    show('landing');
  };
  document.body.appendChild(base);
})();