(function(){
  const toggle=document.querySelector('.menu-toggle');
  const nav=document.querySelector('#primaryNav');
  if(toggle&&nav){
    toggle.addEventListener('click',()=>{
      const open=toggle.getAttribute('aria-expanded')==='true';
      toggle.setAttribute('aria-expanded',String(!open));
      nav.classList.toggle('open',!open);
      document.body.classList.toggle('menu-open',!open);
    });
    nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
      toggle.setAttribute('aria-expanded','false');
      nav.classList.remove('open');
      document.body.classList.remove('menu-open');
    }));
  }
})();
