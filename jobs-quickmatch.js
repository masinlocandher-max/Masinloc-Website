const $=selector=>document.querySelector(selector);
const text=value=>String(value||'').trim();

const form=$('#quickMatchForm');
const role=$('#quickRole');
const locationField=$('#quickLocation');
const typeField=$('#quickType');
const experienceField=$('#quickExperience');
const note=$('#quickMatchNote');
const reset=$('#resetQuickMatch');
const search=$('#jobSearch');
const filters=$('#jobFilters');
const workspace=$('#jobsWorkspace');

function filterButton(name){return filters?.querySelector(`[data-filter="${name}"]`)}
function chooseFilter(name){
  const button=filterButton(name)||filterButton('all');
  if(button&&!button.hidden)button.click();
}
function searchTerms(){
  const terms=[];
  if(text(role?.value))terms.push(text(role.value));
  const type=typeField?.value||'';
  if(type==='full-time')terms.push('full');
  if(type==='part-time')terms.push('part');
  if(type==='freelance')terms.push('freelance');
  if(type==='contract')terms.push('contract');
  return terms.join(' ');
}
function selectedFilter(){
  const place=locationField?.value||'';
  const experience=experienceField?.value||'';
  if(experience==='entry')return 'entry';
  if(place==='zambales')return 'zambales';
  if(place==='pampanga')return 'pampanga';
  if(place==='remote')return 'remote';
  if(place==='abroad')return 'abroad';
  return 'all';
}
function describe(){
  const parts=[];
  if(text(role?.value))parts.push(`work related to “${text(role.value)}”`);
  if(locationField?.selectedIndex>0)parts.push(locationField.options[locationField.selectedIndex].text.toLowerCase());
  if(typeField?.selectedIndex>0)parts.push(typeField.options[typeField.selectedIndex].text.toLowerCase());
  if(experienceField?.selectedIndex>0)parts.push(experienceField.options[experienceField.selectedIndex].text.toLowerCase());
  return parts;
}

form?.addEventListener('submit',event=>{
  event.preventDefault();
  if(search){
    search.value=searchTerms();
    search.dispatchEvent(new Event('input',{bubbles:true}));
  }
  chooseFilter(selectedFilter());
  const parts=describe();
  if(note)note.textContent=parts.length?`Showing current opportunities around ${parts.join(', ')}.`:'Showing all current checked opportunities.';
  setTimeout(()=>workspace?.scrollIntoView({behavior:'smooth',block:'start'}),80);
});

reset?.addEventListener('click',()=>{
  form?.reset();
  if(search){search.value='';search.dispatchEvent(new Event('input',{bubbles:true}))}
  chooseFilter('all');
  if(note)note.textContent='';
});
