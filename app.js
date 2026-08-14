const header=document.getElementById('siteHeader');
const menuButton=document.getElementById('menuButton');
const mobileNav=document.getElementById('mobileNav');
const setHeader=()=>header.classList.toggle('scrolled',window.scrollY>18);
setHeader();window.addEventListener('scroll',setHeader,{passive:true});
const closeMenu=()=>{menuButton.classList.remove('open');menuButton.setAttribute('aria-expanded','false');mobileNav.classList.remove('open');mobileNav.setAttribute('aria-hidden','true');document.body.style.overflow=''};
menuButton.addEventListener('click',()=>{const open=!mobileNav.classList.contains('open');menuButton.classList.toggle('open',open);menuButton.setAttribute('aria-expanded',String(open));mobileNav.classList.toggle('open',open);mobileNav.setAttribute('aria-hidden',String(!open));document.body.style.overflow=open?'hidden':'';});
mobileNav.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
window.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});
const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('in-view');observer.unobserve(entry.target)}}),{threshold:.13,rootMargin:'0px 0px -40px'});
document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
const rail=document.querySelector('.place-rail');
const dots=[...document.querySelectorAll('.rail-controls span')];
if(rail&&dots.length){rail.addEventListener('scroll',()=>{const cards=[...rail.children];let nearest=0,best=Infinity;cards.forEach((card,i)=>{const d=Math.abs(card.offsetLeft-rail.scrollLeft);if(d<best){best=d;nearest=i}});dots.forEach((d,i)=>d.classList.toggle('active',i===nearest));},{passive:true});}
