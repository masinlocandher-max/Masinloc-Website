import { createClient } from './assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL='https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY='sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();

let jobs=[];
let session=null;
let preferences=null;
let primaryResume=null;
let activeFilter='all';
let activeJobId=null;
let currentActivityId=null;

function providerOf(job){return Array.isArray(job.provider)?job.provider[0]:job.provider}
function sourceLabel(job){return providerOf(job)?.attribution_label||providerOf(job)?.name||'External source'}
function sourceCode(job){return providerOf(job)?.code||''}
function formatDate(value){if(!value)return '';return new Intl.DateTimeFormat('en-PH',{dateStyle:'medium'}).format(new Date(value))}
function splitTerms(value){return (Array.isArray(value)?value:[]).map(low).filter(Boolean)}
function jobHaystack(job){return low([job.title,job.company,job.location,job.work_setup,job.employment_type,job.description_excerpt,job.requirements_excerpt].filter(Boolean).join(' '))}

async function boot(){
  const {data:{session:current}}=await supabase.auth.getSession();
  session=current;
  await loadUserContext();
  bindUI();
  await loadJobs();
}

async function loadUserContext(){
  if(!session){
    $('#careerLink').textContent='Build my resume';
    return;
  }
  $('#careerLink').textContent='My Career';
  const userId=session.user.id;
  const [{data:prefs},{data:resume}]=await Promise.all([
    supabase.from('job_preferences').select('*').eq('user_id',userId).maybeSingle(),
    supabase.from('resume_versions').select('id,name,target_role,is_primary,updated_at').eq('user_id',userId).eq('is_primary',true).maybeSingle()
  ]);
  preferences=prefs||null;
  primaryResume=resume||null;
}

function bindUI(){
  $('#jobSearch').addEventListener('input',renderJobs);
  $$('#jobFilters .jobs-chip').forEach(button=>button.addEventListener('click',()=>{
    $$('#jobFilters .jobs-chip').forEach(b=>b.classList.remove('is-active'));
    button.classList.add('is-active');
    activeFilter=button.dataset.filter||'all';
    renderJobs();
  }));
}

async function loadJobs(){
  $('#jobsStatus').textContent='Loading available opportunities…';
  const {data,error}=await supabase
    .from('external_jobs')
    .select('id,external_job_id,title,company,location,work_setup,employment_type,salary_text,description_excerpt,requirements_excerpt,published_at,expires_at,source_url,apply_url,last_verified_at,provider_metadata,provider:job_providers!inner(code,name,attribution_label,render_mode,application_mode,status)')
    .order('published_at',{ascending:false,nullsFirst:false})
    .limit(200);

  if(error){
    console.error('jobs_load_error',error.message);
    $('#jobsStatus').textContent='Jobs could not be loaded right now. Please try again later.';
    $('#jobsEmpty').hidden=false;
    return;
  }

  jobs=data||[];
  $('#jobsStatus').textContent='';
  if(!jobs.length){
    $('#jobsEmpty').hidden=false;
    $('#jobsWorkspace').hidden=true;
    return;
  }

  $('#jobsEmpty').hidden=true;
  $('#jobsWorkspace').hidden=false;
  const requested=new URLSearchParams(location.search).get('job');
  activeJobId=jobs.some(j=>j.id===requested)?requested:jobs[0].id;
  renderJobs();
}

function scoreJob(job){
  if(!preferences)return 0;
  const hay=jobHaystack(job);
  let score=0;
  const roles=splitTerms(preferences.target_roles);
  const locations=splitTerms(preferences.preferred_locations);
  if(roles.some(role=>hay.includes(role)))score+=45;
  if(locations.some(loc=>low(job.location).includes(loc)||loc.includes(low(job.location))))score+=25;
  if(preferences.remote_ok&&low(job.work_setup).includes('remote'))score+=20;
  const types=splitTerms(preferences.employment_types);
  if(types.some(type=>low(job.employment_type).includes(type)))score+=10;
  return Math.min(score,100);
}

function matchesFilter(job){
  const hay=jobHaystack(job);
  const q=low($('#jobSearch').value);
  if(q&&!hay.includes(q))return false;
  const code=sourceCode(job);
  if(activeFilter==='all')return true;
  if(activeFilter==='for-you')return Boolean(preferences)&&scoreJob(job)>0;
  if(activeFilter==='near')return /(zambales|masinloc|iba|botolan|subic|olongapo|clark|pampanga)/i.test(`${job.location||''}`);
  if(activeFilter==='remote')return /remote|work from home|wfh/i.test(`${job.work_setup||''} ${job.location||''} ${job.title||''}`);
  if(activeFilter==='government')return code==='csc'||/government|government agency|municipal|national agency/i.test(hay);
  if(activeFilter==='abroad')return code==='dmw'||Boolean(job.provider_metadata?.overseas)||/overseas|abroad/i.test(hay);
  if(activeFilter==='entry')return Boolean(job.provider_metadata?.entry_level)||/entry level|no experience|fresh graduate|junior|trainee/i.test(hay);
  return true;
}

function renderJobs(){
  const filtered=jobs.filter(matchesFilter);
  $('#jobsCount').textContent=`${filtered.length} ${filtered.length===1?'opportunity':'opportunities'}`;
  if(activeFilter==='for-you'&&!preferences){
    $('#jobsStatus').innerHTML='Create your <a href="career.html">career profile</a> first so Masinloc Connect can explain which opportunities may fit you.';
  }else if(!filtered.length){
    $('#jobsStatus').textContent='No current opportunities match this filter. Try another option.';
  }else{
    $('#jobsStatus').textContent='';
  }

  $('#jobsList').innerHTML=filtered.map(job=>{
    const meta=[job.location,job.employment_type,job.work_setup,job.salary_text].filter(Boolean);
    return `<li class="job-row"><button type="button" data-job-id="${esc(job.id)}" aria-current="${job.id===activeJobId?'true':'false'}"><span class="job-row-title">${esc(job.title)}</span><span class="job-row-company">${esc(job.company||'Employer')}</span><span class="job-row-meta">${meta.map(v=>`<span>${esc(v)}</span>`).join('')}</span><span class="job-source">${esc(sourceLabel(job))}</span></button></li>`;
  }).join('');

  $$('#jobsList [data-job-id]').forEach(button=>button.addEventListener('click',()=>{
    activeJobId=button.dataset.jobId;
    renderJobs();
    renderDetail(jobs.find(j=>j.id===activeJobId));
    if(matchMedia('(max-width:820px)').matches)$('#jobsDetail').scrollIntoView({behavior:'smooth',block:'start'});
  }));

  const active=filtered.find(j=>j.id===activeJobId)||filtered[0];
  if(active){activeJobId=active.id;renderDetail(active)}
  else $('#jobsDetail').innerHTML='<div class="jobs-detail-empty">Choose another filter to see available jobs.</div>';
}

function matchReasons(job){
  if(!preferences)return [];
  const reasons=[];
  const hay=jobHaystack(job);
  const role=splitTerms(preferences.target_roles).find(r=>hay.includes(r));
  if(role)reasons.push(`The role matches “${role}” in your job preferences.`);
  const loc=splitTerms(preferences.preferred_locations).find(l=>low(job.location).includes(l));
  if(loc)reasons.push(`${job.location||'This location'} matches where you said you can work.`);
  if(preferences.remote_ok&&/remote|work from home|wfh/i.test(`${job.work_setup||''} ${job.location||''}`))reasons.push('You said you are open to work-from-home opportunities.');
  return reasons.slice(0,3);
}

function renderDetail(job){
  if(!job)return;
  const provider=providerOf(job)||{};
  const meta=[job.location,job.employment_type,job.work_setup,job.salary_text,job.published_at?`Posted ${formatDate(job.published_at)}`:''].filter(Boolean);
  const reasons=matchReasons(job);
  const resumeReady=Boolean(primaryResume);
  const applyLabel=!session?'Apply for this job':resumeReady?`Continue to ${provider.name||'source'}`:'Prepare my resume to apply';
  $('#jobsDetail').innerHTML=`
    <h2>${esc(job.title)}</h2>
    <p class="jobs-detail-company">${esc(job.company||'Employer')}</p>
    <div class="jobs-detail-meta">${meta.map(v=>`<span>${esc(v)}</span>`).join('')}</div>
    ${job.description_excerpt?`<section class="jobs-detail-section"><h3>What the job is about</h3><p>${esc(job.description_excerpt)}</p></section>`:''}
    ${job.requirements_excerpt?`<section class="jobs-detail-section"><h3>What they are looking for</h3><p>${esc(job.requirements_excerpt)}</p></section>`:''}
    ${reasons.length?`<div class="jobs-match"><strong>Why this may fit you</strong><ul>${reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul></div>`:''}
    <div class="jobs-actions">
      <button type="button" class="jobs-primary" id="applyJobBtn">${esc(applyLabel)}</button>
      <button type="button" class="jobs-secondary" id="saveJobBtn">Save job</button>
      <a class="jobs-secondary" href="${esc(job.source_url)}" target="_blank" rel="noopener noreferrer">View source</a>
    </div>
    <p class="jobs-source-note">${esc(sourceLabel(job))}. Masinloc Connect explains and prepares the application, but the source remains responsible for the vacancy. We never mark an external application as submitted unless you confirm it or an authorized integration confirms it.</p>
    <div id="handoffConfirmation"></div>`;
  $('#applyJobBtn').addEventListener('click',()=>startApply(job));
  $('#saveJobBtn').addEventListener('click',()=>saveJob(job));
}

async function saveJob(job){
  if(!session){
    localStorage.setItem('mc_pending_job',job.id);
    location.href=`career.html?return_job=${encodeURIComponent(job.id)}&action=save`;
    return;
  }
  const {error}=await supabase.from('saved_jobs').upsert({user_id:session.user.id,external_job_id:job.id},{onConflict:'user_id,external_job_id'});
  $('#jobsStatus').textContent=error?'We could not save this job right now.':'Saved to My Career.';
}

async function startApply(job){
  localStorage.setItem('mc_pending_job',job.id);
  if(!session||!primaryResume){
    location.href=`career.html?return_job=${encodeURIComponent(job.id)}&action=apply`;
    return;
  }
  await handoff(job);
}

async function handoff(job){
  const provider=providerOf(job)||{};
  const snapshot={title:job.title,company:job.company,location:job.location,provider:provider.code||null,source_label:sourceLabel(job),apply_url:job.apply_url};
  const {data,error}=await supabase.from('application_activity').insert({
    user_id:session.user.id,
    external_job_id:job.id,
    resume_version_id:primaryResume.id,
    status:'handed_off',
    handed_off_at:new Date().toISOString(),
    job_snapshot:snapshot
  }).select('id').single();
  if(error){
    $('#jobsStatus').textContent='We could not start the application handoff. Please try again.';
    return;
  }
  currentActivityId=data.id;
  const opened=window.open(job.apply_url,'_blank','noopener,noreferrer');
  const target=$('#handoffConfirmation');
  target.innerHTML=`<div class="jobs-match"><strong>${opened?'The application source opened in a new tab.':'Open the application source to continue.'}</strong><ul><li>Use the resume prepared in My Career.</li><li>Complete any questions asked by ${esc(provider.name||'the source')}.</li><li>Come back here and tell us when you have submitted it.</li></ul><div class="jobs-actions"><button type="button" class="jobs-primary" id="confirmAppliedBtn">Yes, I applied</button>${opened?'':`<a class="jobs-secondary" href="${esc(job.apply_url)}" target="_blank" rel="noopener noreferrer">Open application</a>`}</div></div>`;
  $('#confirmAppliedBtn').addEventListener('click',confirmApplied);
}

async function confirmApplied(){
  if(!session||!currentActivityId)return;
  const {error}=await supabase.from('application_activity').update({status:'applied_confirmed',user_confirmed_applied_at:new Date().toISOString()}).eq('id',currentActivityId).eq('user_id',session.user.id);
  const target=$('#handoffConfirmation');
  if(error){target.insertAdjacentHTML('beforeend','<p class="jobs-status">We could not update your application status.</p>');return}
  target.innerHTML='<div class="jobs-match"><strong>Application marked as applied.</strong><ul><li>You can review it later in My Career.</li></ul></div>';
}

boot();
