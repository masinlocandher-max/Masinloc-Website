import { createClient } from './assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL='https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY='sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[m]));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const params=new URLSearchParams(location.search);
const requestedTarget=clean(params.get('target'));
const requestedJob=clean(params.get('job'));
let resumeRow=null;
let currentFocus='';

async function boot(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){location.href='career.html';return}
  const {data,error}=await supabase.from('resume_versions').select('id,user_id,name,target_role,resume_snapshot,updated_at').eq('user_id',session.user.id).eq('is_primary',true).maybeSingle();
  if(error){console.error('resume_load_error',error.message);showEmpty();return}
  if(!data?.resume_snapshot){showEmpty();return}
  resumeRow=data;
  setupFocus();
  renderResume();
  renderGuide();
}

function showEmpty(){
  $('#resumeDocument').hidden=true;
  $('#resumeEmpty').hidden=false;
  $('#printBtn').disabled=true;
  $('#resumeFocus').disabled=true;
}

function unique(values){return [...new Set(values.map(clean).filter(Boolean))]}
function naturalList(items){
  const cleanItems=unique(items);
  if(!cleanItems.length)return '';
  if(cleanItems.length===1)return cleanItems[0];
  if(cleanItems.length===2)return `${cleanItems[0]} and ${cleanItems[1]}`;
  return `${cleanItems.slice(0,-1).join(', ')}, and ${cleanItems.at(-1)}`;
}

function setupFocus(){
  const r=resumeRow.resume_snapshot||{};
  const options=unique([requestedTarget,resumeRow.target_role,...(r.target_roles||[])]);
  currentFocus=requestedTarget||resumeRow.target_role||options[0]||'';
  const select=$('#resumeFocus');
  select.innerHTML=options.length
    ?options.map(value=>`<option value="${esc(value)}"${value===currentFocus?' selected':''}>${esc(value)}</option>`).join('')
    :'<option value="">General resume</option>';
  select.disabled=false;
  $('#saveFocusBtn').hidden=!currentFocus||currentFocus===clean(resumeRow.target_role);
}

function renderGuide(message=''){
  const guide=$('#resumeGuide');
  const title=$('#resumeGuideTitle');
  const copy=$('#resumeGuideCopy');
  if(message){
    guide.hidden=false;
    title.textContent=message;
    copy.textContent='';
    return;
  }
  if(requestedTarget){
    guide.hidden=false;
    title.textContent=`Preparing this resume for ${currentFocus || requestedTarget}.`;
    copy.textContent=requestedJob?'This changes the resume focus for this application preview. Save the focus only if you want it to become your primary resume target.':'You can preview a different target role without changing your Career Profile.';
    return;
  }
  guide.hidden=true;
}

function listSection(title,items){
  const cleanItems=unique(Array.isArray(items)?items:[]);
  if(!cleanItems.length)return '';
  return `<section class="resume-section"><h2>${esc(title)}</h2><ul class="resume-list">${cleanItems.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`;
}

function experienceItems(value){
  const raw=String(value||'').trim();
  if(!raw)return [];
  const blocks=raw.split(/\n{2,}|(?:\r?\n)(?=[A-Z0-9])/).map(clean).filter(Boolean);
  if(blocks.length>1)return blocks.slice(0,8);
  return raw.split(/(?:[•]|\.\s+(?=[A-Z]))/).map(clean).filter(Boolean).slice(0,8);
}

function generatedSummary(r,target){
  if(clean(r.summary))return clean(r.summary);
  const skills=unique(r.skills||[]).slice(0,4);
  const experience=(Array.isArray(r.experience)?r.experience:[]).flatMap(item=>experienceItems(typeof item==='string'?item:item?.summary||''));
  const education=clean(r.education?.level);
  const first=target?`Candidate pursuing ${target} opportunities`:'Candidate ready to contribute in a professional work environment';
  const parts=[first];
  if(skills.length)parts.push(`with skills in ${naturalList(skills)}`);
  if(experience.length)parts.push('and practical experience recorded in the Career Profile');
  else if(education)parts.push(`with a ${education.toLowerCase()} background and readiness to learn`);
  return `${parts.join(' ')}.`;
}

function renderResume(){
  const r=resumeRow.resume_snapshot||{};
  const personal=r.personal||{};
  const target=currentFocus||resumeRow.target_role||(r.target_roles||[])[0]||'';
  const contact=[personal.email,personal.mobile,personal.current_location].map(clean).filter(Boolean);
  const experience=(Array.isArray(r.experience)?r.experience:[]).flatMap(item=>experienceItems(typeof item==='string'?item:item?.summary||'')).filter(Boolean);
  const training=unique([...(r.training||[]),...(r.certifications||[])]);
  const education=[r.education?.level,r.education?.school].map(clean).filter(Boolean).join(' · ');
  const languages=unique(r.languages||[]);
  const references=unique((r.references||[]).map(item=>typeof item==='string'?item:item?.summary||''));
  const summary=generatedSummary(r,target);
  const availability=clean(r.availability);
  const doc=$('#resumeDocument');
  doc.innerHTML=`
    <header class="resume-header">
      <h1>${esc(personal.full_name||'Your Name')}</h1>
      ${target?`<p class="resume-target">${esc(target)}</p>`:''}
      ${contact.length?`<div class="resume-contact">${contact.map(v=>`<span>${esc(v)}</span>`).join('')}</div>`:''}
    </header>
    <section class="resume-section"><h2>Professional Profile</h2><p>${esc(summary)}</p></section>
    ${experience.length?`<section class="resume-section"><h2>Relevant Experience</h2><div class="resume-experience">${experience.map(v=>`<div class="resume-experience-item"><p>${esc(v.replace(/[.]+$/,''))}</p></div>`).join('')}</div></section>`:''}
    ${education?`<section class="resume-section"><h2>Education</h2><p>${esc(education)}</p></section>`:''}
    ${listSection('Core Skills',r.skills)}
    ${listSection('Training & Certifications',training)}
    ${listSection('Languages',languages)}
    ${listSection('References',references)}
    ${availability?`<section class="resume-section"><h2>Availability</h2><p>${esc(availability)}</p></section>`:''}
  `;
  doc.hidden=false;
  $('#resumeEmpty').hidden=true;
}

$('#resumeFocus').addEventListener('change',event=>{
  currentFocus=clean(event.target.value);
  $('#saveFocusBtn').hidden=!currentFocus||currentFocus===clean(resumeRow?.target_role);
  renderResume();
  if(requestedTarget)renderGuide();
});

$('#saveFocusBtn').addEventListener('click',async()=>{
  if(!resumeRow||!currentFocus)return;
  const button=$('#saveFocusBtn');
  button.disabled=true;
  button.textContent='Saving…';
  const {error}=await supabase.from('resume_versions').update({target_role:currentFocus}).eq('id',resumeRow.id).eq('user_id',resumeRow.user_id);
  if(error){
    console.error('resume_focus_save_error',error.message);
    button.disabled=false;
    button.textContent='Use this focus';
    renderGuide('We could not save this resume focus right now.');
    return;
  }
  resumeRow.target_role=currentFocus;
  button.hidden=true;
  button.disabled=false;
  button.textContent='Use this focus';
  renderGuide('Resume focus saved.');
});

$('#printBtn').addEventListener('click',()=>window.print());
boot();