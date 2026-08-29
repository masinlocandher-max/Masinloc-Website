import { createClient } from './assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL='https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY='sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const low=v=>String(v||'').toLowerCase();
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
let context=null;

async function loadContext(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)return {session:null,career:null,resume:null};
  const [{data:career},{data:resume}]=await Promise.all([
    supabase.from('career_profiles').select('mobile,target_roles,skills,education_level,work_experience,training,certifications,profile_completion').eq('user_id',session.user.id).maybeSingle(),
    supabase.from('resume_versions').select('id').eq('user_id',session.user.id).eq('is_primary',true).maybeSingle()
  ]);
  return {session,career:career||null,resume:resume||null};
}

function educationFit(requirements,education){
  const req=low(requirements);const edu=low(education);
  if(!req)return {state:'review',label:'Requirements',copy:'Open the complete vacancy details and compare every requirement before submitting.'};
  if(/college graduate|bachelor|degree/.test(req))return {state:/college graduate|postgraduate/.test(edu)?'ready':'review',label:'Education',copy:/college graduate|postgraduate/.test(edu)?'Your saved education appears consistent with the education shown for this vacancy.':'This vacancy appears to ask for a college degree. Review the exact qualification before applying.'};
  if(/vocational|tesda|nc ii|nc2/.test(req))return {state:/vocational|tesda/.test(edu)?'ready':'review',label:'Education / training',copy:/vocational|tesda/.test(edu)?'Your saved education or training appears relevant to the listed qualification.':'Review whether you have the vocational or TESDA qualification requested.'};
  if(/high school|senior high|secondary/.test(req))return {state:edu?'ready':'review',label:'Education',copy:edu?'You have education information saved. Confirm it meets the employer’s exact requirement.':'Add your education so Masinloc Connect can help you compare it.'};
  return {state:'review',label:'Requirements',copy:'The available listing does not provide enough structured qualification detail for Masinloc Connect to confirm this item.'};
}

function buildReadiness(detail){
  if(!context?.session)return null;
  const career=context.career||{};
  const title=detail.querySelector('h2')?.textContent||'';
  const role=detail.querySelector('.jobs-detail-section p')?.textContent||'';
  const requirementSections=[...detail.querySelectorAll('.jobs-detail-section')];
  const reqSection=requirementSections.find(section=>/requirements/i.test(section.querySelector('h3')?.textContent||''));
  const requirements=reqSection?.querySelector('p')?.textContent||'';
  const hay=low(`${title} ${role} ${requirements}`);
  const skills=(career.skills||[]).filter(skill=>hay.includes(low(skill)));
  const roles=(career.target_roles||[]).filter(item=>hay.includes(low(item)));
  const checks=[
    {state:context.session.user.email?'ready':'review',label:'Contact email',copy:context.session.user.email?'Your application email is ready.':'Add a working email before applying.'},
    {state:career.mobile?'ready':'review',label:'Mobile number',copy:career.mobile?'Your mobile number is saved in My Career.':'Add a mobile number so employers can reach you.'},
    {state:context.resume?'ready':'review',label:'Resume',copy:context.resume?'Your Masinloc Connect resume is ready to use.':'Complete My Career so Masinloc Connect can prepare your resume.'},
    educationFit(requirements,career.education_level),
    {state:(skills.length||roles.length)?'ready':'review',label:'Role and skills',copy:skills.length?`Your profile shares relevant terms such as ${skills.slice(0,2).join(' and ')}.`:roles.length?`This opportunity overlaps with ${roles[0]} in your target roles.`:'No clear role or skill overlap was found in the details currently available. Review the full vacancy before deciding.'}
  ];
  return checks;
}

function enhance(){
  const detail=document.getElementById('jobsDetail');
  const box=detail?.querySelector('.jobs-readiness');
  if(!box||box.dataset.guidance==='1')return;
  const checks=buildReadiness(detail);if(!checks)return;
  const ready=checks.filter(item=>item.state==='ready').length;
  box.dataset.guidance='1';
  box.innerHTML=`<h3>Application readiness: ${ready} of ${checks.length}</h3><p class="jobs-readiness-note">Based on your saved Career Profile and the vacancy details currently available. This is preparation guidance, not an employer decision.</p>${checks.map(item=>`<div class="readiness-row"><span class="readiness-state ${item.state}">${item.state==='ready'?'Ready':'Review'}</span><div><strong>${esc(item.label)}</strong><p>${esc(item.copy)}</p></div></div>`).join('')}`;
}

async function start(){context=await loadContext();enhance();new MutationObserver(enhance).observe(document.getElementById('jobsDetail'),{subtree:true,childList:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
