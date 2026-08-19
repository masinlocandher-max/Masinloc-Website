document.querySelectorAll('.js-approved-hero').forEach((image)=>{
  image.addEventListener('load',()=>image.classList.add('is-loaded'),{once:true});
  image.src='assets/stage1/masinloc-hero.avif';
  if(image.complete && image.naturalWidth){
    image.classList.add('is-loaded');
  }
});