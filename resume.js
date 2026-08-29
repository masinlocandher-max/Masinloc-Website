import { createClient } from './assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL='https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY='sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();

async function boot(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){location.href='career.html';return}
  const {data,error}=await supabase.from('resume_versions').select('id,name,target_role,resume_snapshot,updated_at').eq('user_id',session.user.id).eq('is_primary',true).maybeSingle();
  if(error){console.error('resume_load_error',error.message);showEmpty();return}
  if(!data?.resume_snapshot){showEmpty();return}
  renderResume(data);
}

function showEmpty(){
  $('#resumeDocument').hidden=true;
  $('#resumeEmpty').hidden=false;
  $('#printBtn').disabled=true;
}

function listSection(title,items){
  const cleanItems=(Array.isArray(items)?items:[]).map(clean).filter(Boolean);
  if(!cleanItems.length)return '';
  return `<section class="resume-section"><h2>${esc(title)}</h2><ul class="resume-skills">${cleanItems.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`;
}

function experienceBullets(value){
  return clean(value).split(/(?:\n|[•]|\.\s+(?=[A-Z]))/).map(clean).filter(Boolean).slice(0,8);
}

function generatedSummary(r,target){
  if(clean(r.summary))return clean(r.summary);
  const skills=(r.skills||[]).map(clean).filter(Boolean).slice(0,4);
  const experience=(r.experience||[]).map(item=>clean(typeof item==='string'?item:item?.summary)).filter(Boolean);
  const education=clean(r.education?.level);
  const parts=[];
  if(target)parts.push(`Applicant interested in ${target}`);
  else parts.push('Motivated applicant ready to contribute in a professional work environment');
  if(skills.length)parts.push(`with strengths in ${skills.join(', ')}`);
  if(experience.length)parts.push('bringing practical experience from work, training, school, volunteer, or community responsibilities');
  else if(education)parts.push(`with ${education.toLowerCase()} education and readiness to learn`);
  return `${parts.join(', ')}.`;
}

function renderResume(row){
  const r=row.resume_snapshot||{};
  const personal=r.personal||{};
  const target=row.target_role||(r.target_roles||[])[0]||'';
  const contact=[personal.email,personal.mobile,personal.current_location].map(clean).filter(Boolean);
  const experience=(Array.isArray(r.experience)?r.experience:[]).flatMap(item=>experienceBullets(typeof item==='string'?item:item?.summary||'')).filter(Boolean);
  const training=[...(r.training||[]),...(r.certifications||[])].map(clean).filter(Boolean);
  const education=[r.education?.level,r.education?.school].map(clean).filter(Boolean).join(' · ');
  const summary=generatedSummary(r,target);
  const doc=$('#resumeDocument');
  doc.innerHTML=`
    <header class="resume-header">
      <h1>${esc(personal.full_name||'Your Name')}</h1>
      ${target?`<p class="resume-target">${esc(target)}</p>`:''}
      ${contact.length?`<div class="resume-contact">${contact.map(v=>`<span>${esc(v)}</span>`).join('')}</div>`:''}
    </header>
    <section class="resume-section"><h2>Professional Profile</h2><p>${esc(summary)}</p></section>
    ${listSection('Core Skills',r.skills)}
    ${experience.length?`<section class="resume-section"><h2>Relevant Experience</h2><ul class="resume-experience">${experience.map(v=>`<li>${esc(v.replace(/[.]+$/,''))}</li>`).join('')}</ul></section>`:''}
    ${education?`<section class="resume-section"><h2>Education</h2><p>${esc(education)}</p></section>`:''}
    ${listSection('Training & Certifications',training)}
    ${listSection('Languages',r.languages)}
  `;
  doc.hidden=false;
  $('#resumeEmpty').hidden=true;
}

$('#printBtn').addEventListener('click',()=>window.print());
boot();
