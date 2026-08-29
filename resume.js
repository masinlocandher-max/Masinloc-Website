import { createClient } from './assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL='https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY='sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

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
  const clean=(Array.isArray(items)?items:[]).filter(Boolean);
  if(!clean.length)return '';
  return `<section class="resume-section"><h2>${esc(title)}</h2><ul class="resume-skills">${clean.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`;
}

function renderResume(row){
  const r=row.resume_snapshot||{};
  const personal=r.personal||{};
  const target=row.target_role||(r.target_roles||[])[0]||'';
  const contact=[personal.email,personal.mobile,personal.current_location].filter(Boolean);
  const experience=(Array.isArray(r.experience)?r.experience:[]).map(item=>typeof item==='string'?item:item?.summary||'').filter(Boolean);
  const training=[...(r.training||[]),...(r.certifications||[])].filter(Boolean);
  const education=[r.education?.level,r.education?.school].filter(Boolean).join(' · ');
  const doc=$('#resumeDocument');
  doc.innerHTML=`
    <header class="resume-header">
      <h1>${esc(personal.full_name||'Your Name')}</h1>
      ${target?`<p class="resume-target">${esc(target)}</p>`:''}
      ${contact.length?`<div class="resume-contact">${contact.map(v=>`<span>${esc(v)}</span>`).join('')}</div>`:''}
    </header>
    ${r.summary?`<section class="resume-section"><h2>Profile</h2><p>${esc(r.summary)}</p></section>`:''}
    ${listSection('Skills',r.skills)}
    ${experience.length?`<section class="resume-section"><h2>Experience</h2><div class="resume-lines">${experience.map(v=>`<div class="resume-line"><span>${esc(v)}</span></div>`).join('')}</div></section>`:''}
    ${education?`<section class="resume-section"><h2>Education</h2><p>${esc(education)}</p></section>`:''}
    ${listSection('Training & Certifications',training)}
    ${listSection('Languages',r.languages)}
  `;
  doc.hidden=false;
  $('#resumeEmpty').hidden=true;
}

$('#printBtn').addEventListener('click',()=>window.print());
boot();
