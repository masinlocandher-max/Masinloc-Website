(async()=>{
  const files=Array.from({length:7},(_,i)=>`assets/stage1/hero-b64-${String(i+1).padStart(2,'0')}.txt`);
  try{
    const parts=await Promise.all(files.map(async file=>{
      const response=await fetch(file,{cache:'force-cache'});
      if(!response.ok) throw new Error(`Could not load ${file}`);
      return (await response.text()).trim();
    }));
    const source=`data:image/avif;base64,${parts.join('')}`;
    document.querySelectorAll('.js-approved-hero').forEach(image=>{
      image.src=source;
      image.classList.add('is-loaded');
    });
  }catch(error){
    console.error('Approved Masinloc hero photo failed to load.',error);
  }
})();