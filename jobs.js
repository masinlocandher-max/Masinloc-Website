import { createClient } from './assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL='https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY='sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[m]));
const text=v=>String(v??'').trim();
const low=v=>text(v).toLowerCase();
const queryTokens=v=>low(v).split(/\s+/).map(v=>v.trim()).filter(Boolean);

let jobs=[];
let session=null;
let preferences=null;
let careerProfile=null;
let primaryResume=null;
let savedIds=new Set();
let activityByJob=new Map();
let activeFilter='all';
let activeJobId=null;
let currentActivityId=null;
let quickMatch={role:'',location:'',type:'',experience:''};

function providerOf(job){return Array.isArray(job.provider)?job.provider[0]:job.provider}
function sourceLabel(job){return providerOf(job)?.attribution_label||providerOf(job)?.name||'External source'}
function sourceCode(job){return providerOf(job)?.code||''}
function formatDate(value){if(!value)return '';return new Intl.DateTimeFormat('en-PH',{dateStyle:'medium'}).format(new Date(value))}
function splitTerms(value){return (Array.isArray(value)?value:[]).map(low).filter(Boolean)}
function jobHaystack(job){return low([job.title,job.company,job.location,job.work_setup,job.employment_type,job.description_excerpt,job.requirements_excerpt].filter(Boolean).join(' '))}
function isZambales(job){return /(zambales|masinloc|olongapo|subic|iba|botolan|san marcelino|castillejos)/i.test(`${job.location||''}`)}
function isPampanga(job){return /(pampanga|clark|angeles|mabalacat)/i.test(`${job.location||''}`)}
function isRemote(job){return /remote|work from home|wfh/i.test(`${job.work_setup||''} ${job.location||''} ${job.title||''}`)}
function isAbroad(job){return sourceCode(job)==='dmw'||Boolean(job.provider_metadata?.overseas)||/overseas|abroad/i.test(jobHaystack(job))}
function isEntryLevel(job){return Boolean(job.provider_metadata?.entry_level)||/entry level|no experience|fresh graduate|fresh graduates|junior|trainee|high school graduate|high school diploma/i.test(`${job.requirements_excerpt||''} ${job.description_excerpt||''}`)}
function freshnessLabel(value){
  if(!value)return 'Source check not dated';
  const then=new Date(value).getTime();
  const age=Date.now()-then;
  if(age>=0&&age<24*60*60*1000)return 'Checked today';
  if(age>=0&&age<48*60*60*1000)return 'Checked yesterday';
  return `Checked ${formatDate(value)}`;
}
function displayPay(value){return value?`Pay listed: ${value}`:''}
function latestActivity(jobId){return activityByJob.get(jobId)||null}
function activityLabel(activity){
  if(!activity)return '';
  if(activity.status==='applied_confirmed')return 'Applied';
  if(activity.status==='handed_off')return 'Application started';
  if(activity.status==='ready')return 'Ready to apply';
  return '';
}

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
    $('#savedFilter').hidden=true;
    return;
  }
  $('#careerLink').textContent='My Career';
  $('#savedFilter').hidden=false;
  const userId=session.user.id;
  const [{data:prefs},{data:career},{data:resume},{data:saved},{data:activities}]=await Promise.all([
    supabase.from('job_preferences').select('*').eq('user_id',userId).maybeSingle(),
    supabase.from('career_profiles').select('full_name,mobile,target_roles,skills,education_level,current_location,profile_completion').eq('user_id',userId).maybeSingle(),
    supabase.from('resume_versions').select('id,name,target_role,is_primary,updated_at').eq('user_id',userId).eq('is_primary',true).maybeSingle(),
    supabase.from('saved_jobs').select('external_job_id,created_at').eq('user_id',userId),
    supabase.from('application_activity').select('id,external_job_id,status,job_snapshot,handed_off_at,user_confirmed_applied_at,created_at').eq('user_id',userId).order('created_at',{ascending:false}).limit(100)
  ]);
  preferences=prefs||null;
  careerProfile=career||null;
  primaryResume=resume||null;
  savedIds=new Set((saved||[]).map(row=>row.external_job_id).filter(Boolean));
  activityByJob=new Map();
  (activities||[]).forEach(row=>{if(row.external_job_id&&!activityByJob.has(row.external_job_id))activityByJob.set(row.external_job_id,row)});
}

function bindUI(){
  $('#jobSearch').addEventListener('input',renderJobs);
  $$('#jobFilters .jobs-chip').forEach(button=>button.addEventListener('click',()=>setFilter(button.dataset.filter||'all')));
  $('#clearJobsBtn').addEventListener('click',()=>{
    $('#jobSearch').value='';
    resetQuickMatch(false);
    setFilter('all');
    $('#jobSearch').focus();
  });
  $('#quickMatchForm').addEventListener('submit',event=>{
    event.preventDefault();
    quickMatch={
      role:text($('#quickRole').value),
      location:$('#quickLocation').value,
      type:$('#quickType').value,
      experience:$('#quickExperience').value
    };
    if(!Object.values(quickMatch).some(Boolean)){
      $('#quickMatchNote').textContent='Choose at least one preference to create a Quick Match.';
      return;
    }
    activeFilter='quick-match';
    $('#jobSearch').value='';
    $$('#jobFilters .jobs-chip').forEach(b=>b.classList.remove('is-active'));
    renderJobs();
    const count=jobs.filter(job=>quickScore(job)>0).length;
    $('#quickMatchNote').textContent=count?`${count} current ${count===1?'opportunity':'opportunities'} matched at least one of your choices. Best matches are shown first.`:'No current checked opportunities match those choices yet. You can adjust them or browse all jobs.';
    $('#jobsWorkspace').scrollIntoView({behavior:'smooth',block:'start'});
  });
  $('#resetQuickMatch').addEventListener('click',()=>resetQuickMatch(true));
}

function resetQuickMatch(render=true){
  quickMatch={role:'',location:'',type:'',experience:''};
  $('#quickMatchForm').reset();
  $('#quickMatchNote').textContent='';
  if(activeFilter==='quick-match'){
    activeFilter='all';
    const all=$('#jobFilters [data-filter="all"]');
    $$('#jobFilters .jobs-chip').forEach(b=>b.classList.toggle('is-active',b===all));
    if(render)renderJobs();
  }
}

function setFilter(filter){
  const button=$(`#jobFilters [data-filter="${CSS.escape(filter)}"]`);
  if(!button||button.hidden)return;
  activeFilter=filter;
  $$('#jobFilters .jobs-chip').forEach(b=>b.classList.toggle('is-active',b===button));
  renderJobs();
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
    $('#jobsSummary').hidden=true;
    $('#jobsEmpty').hidden=false;
    $('#jobsWorkspace').hidden=true;
    return;
  }

  renderSummary();
  $('#jobsEmpty').hidden=true;
  $('#jobsWorkspace').hidden=false;
  const params=new URLSearchParams(location.search);
  const requested=params.get('job');
  const requestedFilter=params.get('filter');
  activeJobId=jobs.some(j=>j.id===requested)?requested:null;
  if(requestedFilter&&$(`#jobFilters [data-filter="${CSS.escape(requestedFilter)}"]`)?.hidden===false)activeFilter=requestedFilter;
  else if(requestedFilter&&$(`#jobFilters [data-filter="${CSS.escape(requestedFilter)}"]`))activeFilter=requestedFilter;
  $$('#jobFilters .jobs-chip').forEach(b=>b.classList.toggle('is-active',b.dataset.filter===activeFilter));
  renderJobs();
}

function renderSummary(){
  $('#jobsSummary').hidden=false;
  $('#summaryTotal').textContent=String(jobs.length);
  $('#summaryZambales').textContent=String(jobs.filter(isZambales).length);
  $('#summaryEntry').textContent=String(jobs.filter(isEntryLevel).length);
  const dates=jobs.map(j=>j.last_verified_at).filter(Boolean).map(v=>new Date(v).getTime()).filter(Number.isFinite);
  $('#summaryChecked').textContent=dates.length?freshnessLabel(new Date(Math.min(...dates)).toISOString()).replace(/^Checked\s*/,''):'—';
}

function scoreJob(job){
  if(!preferences&&!careerProfile)return 0;
  const hay=jobHaystack(job);
  let score=0;
  const roles=splitTerms(preferences?.target_roles||careerProfile?.target_roles);
  const skills=splitTerms(careerProfile?.skills);
  const locations=splitTerms(preferences?.preferred_locations);
  if(roles.some(role=>hay.includes(role)))score+=35;
  const skillMatches=skills.filter(skill=>hay.includes(skill)).slice(0,2).length;
  score+=Math.min(skillMatches*10,20);
  if(locations.some(loc=>low(job.location).includes(loc)||loc.includes(low(job.location))))score+=20;
  if(preferences?.remote_ok&&isRemote(job))score+=10;
  const types=splitTerms(preferences?.employment_types);
  if(types.some(type=>low(job.employment_type).includes(type)))score+=10;
  if(isEntryLevel(job)&&careerProfile?.education_level)score+=5;
  return Math.min(score,100);
}

function quickScore(job){
  if(!Object.values(quickMatch).some(Boolean))return 0;
  let score=0;
  const hay=jobHaystack(job);
  const roleTokens=queryTokens(quickMatch.role);
  if(roleTokens.length){
    const matches=roleTokens.filter(token=>hay.includes(token)).length;
    if(matches)score+=Math.min(45,20+(matches*12));
  }
  if(quickMatch.location==='zambales'&&isZambales(job))score+=30;
  if(quickMatch.location==='pampanga'&&isPampanga(job))score+=30;
  if(quickMatch.location==='remote'&&isRemote(job))score+=30;
  if(quickMatch.location==='abroad'&&isAbroad(job))score+=30;
  if(quickMatch.location==='philippines'&&!isAbroad(job))score+=12;
  if(quickMatch.type&&low(job.employment_type).includes(quickMatch.type.replace('full-time','full').replace('part-time','part')))score+=20;
  if(quickMatch.experience==='entry'&&isEntryLevel(job))score+=25;
  if(quickMatch.experience==='experienced'&&!isEntryLevel(job))score+=10;
  return Math.min(score,100);
}

function matchesCategory(job,filter){
  const hay=jobHaystack(job);
  const code=sourceCode(job);
  if(filter==='all')return true;
  if(filter==='quick-match')return quickScore(job)>0;
  if(filter==='for-you')return Boolean(preferences||careerProfile)&&scoreJob(job)>0;
  if(filter==='zambales')return isZambales(job);
  if(filter==='pampanga')return isPampanga(job);
  if(filter==='remote')return isRemote(job);
  if(filter==='government')return code==='csc'||/government|government agency|municipal|national agency/i.test(hay);
  if(filter==='abroad')return isAbroad(job);
  if(filter==='entry')return isEntryLevel(job);
  if(filter==='saved')return savedIds.has(job.id);
  return true;
}

function matchesFilter(job){
  const hay=jobHaystack(job);
  const tokens=queryTokens($('#jobSearch').value);
  if(tokens.some(token=>!hay.includes(token)))return false;
  return matchesCategory(job,activeFilter);
}

function sortedJobs(list){
  return [...list].sort((a,b)=>{
    if(activeFilter==='quick-match'){
      const diff=quickScore(b)-quickScore(a);
      if(diff)return diff;
    }
    if(activeFilter==='for-you'){
      const scoreDiff=scoreJob(b)-scoreJob(a);
      if(scoreDiff)return scoreDiff;
    }
    if(activeFilter==='all'){
      const placeA=isZambales(a)?2:isPampanga(a)?1:0;
      const placeB=isZambales(b)?2:isPampanga(b)?1:0;
      if(placeA!==placeB)return placeB-placeA;
    }
    return new Date(b.published_at||b.last_verified_at||0)-new Date(a.published_at||a.last_verified_at||0);
  });
}

function updateFilterCounts(){
  const hayTokens=queryTokens($('#jobSearch').value);
  const queryMatches=job=>{
    const hay=jobHaystack(job);
    return hayTokens.every(token=>hay.includes(token));
  };
  $$('#jobFilters .jobs-chip').forEach(button=>{
    const filter=button.dataset.filter||'all';
    const count=jobs.filter(job=>queryMatches(job)&&matchesCategory(job,filter)).length;
    const node=button.querySelector('[data-count]');
    if(node)node.textContent=`${count}`;
  });
}

function renderJobs(){
  updateFilterCounts();
  const filtered=sortedJobs(jobs.filter(matchesFilter));
  $('#jobsCount').textContent=`${filtered.length} ${filtered.length===1?'opportunity':'opportunities'}`;
  $('#jobsListTitle').textContent=activeFilter==='quick-match'?'Your Quick Match':activeFilter==='for-you'?'For you':'Opportunities';

  if(activeFilter==='for-you'&&!preferences&&!careerProfile){
    $('#jobsStatus').innerHTML='For a saved, ongoing match, create your <a href="career.html">Career Profile</a>. You can also use Quick Match above without signing in.';
  }else if(activeFilter==='saved'&&!session){
    $('#jobsStatus').innerHTML='Sign in through <a href="career.html">My Career</a> to see saved jobs.';
  }else if(!filtered.length){
    $('#jobsStatus').textContent=activeFilter==='quick-match'?'No current checked opportunities match those choices yet.':'No current opportunities match this search or filter.';
  }else{
    $('#jobsStatus').textContent='';
  }

  $('#jobsEmpty').hidden=Boolean(filtered.length);
  $('#jobsWorkspace').hidden=!filtered.length;
  if(!filtered.length)return;

  if(!filtered.some(j=>j.id===activeJobId))activeJobId=filtered[0].id;
  $('#jobsList').innerHTML=filtered.map(job=>{
    const meta=[job.location,job.employment_type,job.work_setup,displayPay(job.salary_text)].filter(Boolean);
    const state=activityLabel(latestActivity(job.id));
    const saved=savedIds.has(job.id);
    const match=activeFilter==='quick-match'?quickScore(job):activeFilter==='for-you'?scoreJob(job):0;
    return `<li class="job-row"><button type="button" data-job-id="${esc(job.id)}" aria-current="${job.id===activeJobId?'true':'false'}"><span class="job-row-top"><span class="job-row-title">${esc(job.title)}</span>${state?`<span class="job-state">${esc(state)}</span>`:saved?'<span class="job-state">Saved</span>':match?`<span class="job-state">${match}% match</span>`:''}</span><span class="job-row-company">${esc(job.company||'Employer')}</span><span class="job-row-meta">${meta.map(v=>`<span>${esc(v)}</span>`).join('')}</span><span class="job-row-source"><span>${esc(sourceLabel(job))}</span><span>${esc(freshnessLabel(job.last_verified_at))}</span></span></button></li>`;
  }).join('');

  $$('#jobsList [data-job-id]').forEach(button=>button.addEventListener('click',()=>{
    activeJobId=button.dataset.jobId;
    renderJobs();
    if(matchMedia('(max-width:820px)').matches)$('#jobsDetail').scrollIntoView({behavior:'smooth',block:'start'});
  }));

  renderDetail(filtered.find(j=>j.id===activeJobId)||filtered[0]);
}

function quickReasons(job){
  if(activeFilter!=='quick-match')return [];
  const reasons=[];
  const hay=jobHaystack(job);
  const role=queryTokens(quickMatch.role).find(token=>hay.includes(token));
  if(role)reasons.push(`The role details include “${role}”, which you entered in Quick Match.`);
  if(quickMatch.location==='zambales'&&isZambales(job))reasons.push(`${job.location||'The listed location'} matches your Zambales preference.`);
  if(quickMatch.location==='pampanga'&&isPampanga(job))reasons.push(`${job.location||'The listed location'} matches your Pampanga / Clark preference.`);
  if(quickMatch.location==='remote'&&isRemote(job))reasons.push('The vacancy is listed as remote or work from home.');
  if(quickMatch.location==='abroad'&&isAbroad(job))reasons.push('The vacancy is an overseas opportunity.');
  if(quickMatch.experience==='entry'&&isEntryLevel(job))reasons.push('The vacancy appears suitable for applicants starting out.');
  if(quickMatch.type&&low(job.employment_type).includes(quickMatch.type.replace('full-time','full').replace('part-time','part')))reasons.push(`${job.employment_type||'The work type'} matches the work type you selected.`);
  return reasons.slice(0,3);
}

function matchReasons(job){
  const quick=quickReasons(job);
  if(quick.length)return quick;
  if(!preferences&&!careerProfile)return [];
  const reasons=[];
  const hay=jobHaystack(job);
  const role=splitTerms(preferences?.target_roles||careerProfile?.target_roles).find(r=>hay.includes(r));
  if(role)reasons.push(`The vacancy matches “${role}” in your Career Profile.`);
  const skill=splitTerms(careerProfile?.skills).find(s=>hay.includes(s));
  if(skill)reasons.push(`Your “${skill}” skill appears in the vacancy details.`);
  const loc=splitTerms(preferences?.preferred_locations).find(l=>low(job.location).includes(l)||l.includes(low(job.location)));
  if(loc)reasons.push(`${job.location||'This location'} matches a location you selected.`);
  if(preferences?.remote_ok&&isRemote(job))reasons.push('Work from home is included in your Career Profile preferences.');
  const type=splitTerms(preferences?.employment_types).find(t=>low(job.employment_type).includes(t));
  if(type)reasons.push(`${job.employment_type||'The work type'} matches one of your work preferences.`);
  return reasons.slice(0,3);
}

function readiness(job){
  if(!session)return [
    {label:'Career Profile',state:'optional',copy:'Create one if you want Masinloc Connect to remember your details.'},
    {label:'Resume',state:'review',copy:'You can build a reusable resume before continuing.'},
    {label:'Requirements',state:'review',copy:'Review the official requirements before submitting.'}
  ];
  return [
    {label:'Email',state:session.user.email?'ready':'review',copy:session.user.email?'Available for your application.':'Add a working email before applying.'},
    {label:'Mobile',state:careerProfile?.mobile?'ready':'review',copy:careerProfile?.mobile?'Available in your Career Profile.':'Add a mobile number if the application requires one.'},
    {label:'Resume',state:primaryResume?'ready':'review',copy:primaryResume?'Your primary resume is ready.':'Build your resume before handoff.'},
    {label:'Requirements',state:'review',copy:job.requirements_excerpt?'Compare your experience and education with the vacancy requirements.':'Review the complete requirements on the official source.'}
  ];
}

function providerGuidance(provider){
  const code=provider?.code||'';
  if(code==='philjobnet')return ['Confirm that the position and employer match the vacancy you selected.','Follow the application instructions shown on PhilJobNet.','Return to Masinloc Connect after submission if you want to record it in My Career.'];
  if(code==='csc')return ['Review the qualification standards and documentary requirements.','Submit the application to the hiring government agency as instructed in the posting.','CSC lists the vacancy, but the concerned agency receives the application.'];
  if(code==='dmw')return ['Check that the agency and job order remain active before applying.','Follow only the licensed agency or official DMW instructions.','Do not pay or send documents outside the verified recruitment process.'];
  if(code==='indeed')return ['Confirm the employer and vacancy details on Indeed.','Use the official application path shown there.','Return to Masinloc Connect after submission if you want to record it.'];
  return [`Confirm that the employer and position match before continuing.`,`Follow the instructions required by ${provider?.name||'the official source'}.`,'Return to Masinloc Connect after submission if you want to keep your application history accurate.'];
}

function renderDetail(job){
  if(!job)return;
  const provider=providerOf(job)||{};
  const activity=latestActivity(job.id);
  const status=activityLabel(activity);
  const saved=savedIds.has(job.id);
  const meta=[job.location,job.employment_type,job.work_setup,displayPay(job.salary_text),job.published_at?`Posted ${formatDate(job.published_at)}`:''].filter(Boolean);
  const reasons=matchReasons(job);
  const ready=readiness(job);
  const resumeReady=Boolean(primaryResume);
  const destination=job.apply_url||job.source_url;
  let applyLabel=!session?'Prepare and apply':resumeReady?`Continue to ${provider.name||'official source'}`:'Prepare my resume to apply';
  let applyDisabled='';
  if(status==='Applied'){applyLabel='Applied';applyDisabled='disabled aria-disabled="true"'}
  else if(status==='Application started'&&resumeReady)applyLabel=`Continue on ${provider.name||'official source'}`;
  const badges=[isEntryLevel(job)?'Entry-level friendly':'',status,saved?'Saved':'',freshnessLabel(job.last_verified_at)].filter(Boolean);
  $('#jobsDetail').innerHTML=`
    <div class="jobs-detail-badges">${badges.map(v=>`<span>${esc(v)}</span>`).join('')}</div>
    <h2>${esc(job.title)}</h2>
    <p class="jobs-detail-company">${esc(job.company||'Employer')}</p>
    <div class="jobs-detail-meta">${meta.map(v=>`<span>${esc(v)}</span>`).join('')}</div>
    ${job.description_excerpt?`<section class="jobs-detail-section"><h3>Role</h3><p>${esc(job.description_excerpt)}</p></section>`:''}
    ${job.requirements_excerpt?`<section class="jobs-detail-section"><h3>Requirements</h3><p>${esc(job.requirements_excerpt)}</p></section>`:''}
    ${reasons.length?`<div class="jobs-match"><strong>Why this may fit you</strong><ul>${reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul></div>`:''}
    <section class="jobs-readiness" aria-label="Application readiness"><h3>Before you continue</h3>${ready.map(item=>`<div class="readiness-row"><span class="readiness-state ${item.state}">${item.state==='ready'?'Ready':'Review'}</span><div><strong>${esc(item.label)}</strong><p>${esc(item.copy)}</p></div></div>`).join('')}</section>
    <div class="jobs-actions">
      <button type="button" class="jobs-primary" id="applyJobBtn" ${applyDisabled}>${esc(applyLabel)}</button>
      <button type="button" class="jobs-secondary${saved?' is-saved':''}" id="saveJobBtn">${saved?'Saved ✓':'Save job'}</button>
      ${job.source_url?`<a class="jobs-secondary" href="${esc(job.source_url)}" target="_blank" rel="noopener noreferrer">View official listing</a>`:''}
    </div>
    <p class="jobs-source-note"><strong>${esc(sourceLabel(job))}</strong> · ${esc(freshnessLabel(job.last_verified_at))}. Masinloc Connect helps you organize and prepare. The official source controls the vacancy details and final application.</p>
    <div id="handoffConfirmation"></div>`;
  $('#applyJobBtn').addEventListener('click',()=>startApply(job));
  $('#saveJobBtn').addEventListener('click',()=>toggleSaved(job));
  if(!destination&&!applyDisabled)$('#applyJobBtn').disabled=true;
}

async function toggleSaved(job){
  if(!session){
    localStorage.setItem('mc_pending_job',job.id);
    location.href=`career.html?return_job=${encodeURIComponent(job.id)}&action=save`;
    return;
  }
  const isSaved=savedIds.has(job.id);
  let error=null;
  if(isSaved){
    ({error}=await supabase.from('saved_jobs').delete().eq('user_id',session.user.id).eq('external_job_id',job.id));
  }else{
    ({error}=await supabase.from('saved_jobs').upsert({user_id:session.user.id,external_job_id:job.id},{onConflict:'user_id,external_job_id'}));
  }
  if(error){$('#jobsStatus').textContent='We could not update your saved jobs right now.';return}
  if(isSaved)savedIds.delete(job.id);else savedIds.add(job.id);
  $('#jobsStatus').textContent=isSaved?'Removed from saved jobs.':'Saved to My Career.';
  renderJobs();
}

async function startApply(job){
  if(activityLabel(latestActivity(job.id))==='Applied')return;
  localStorage.setItem('mc_pending_job',job.id);
  if(!session||!primaryResume){
    location.href=`career.html?return_job=${encodeURIComponent(job.id)}&action=apply`;
    return;
  }
  await handoff(job);
}

async function handoff(job){
  const provider=providerOf(job)||{};
  const destination=job.apply_url||job.source_url;
  if(!destination){$('#jobsStatus').textContent='This vacancy does not currently have an application link.';return}
  const existing=latestActivity(job.id);
  if(existing?.status==='handed_off'){
    currentActivityId=existing.id;
  }else{
    const snapshot={title:job.title,company:job.company,location:job.location,provider:provider.code||null,source_label:sourceLabel(job),apply_url:destination};
    const {data,error}=await supabase.from('application_activity').insert({
      user_id:session.user.id,
      external_job_id:job.id,
      resume_version_id:primaryResume.id,
      status:'handed_off',
      handed_off_at:new Date().toISOString(),
      job_snapshot:snapshot
    }).select('id,external_job_id,status,job_snapshot,handed_off_at,user_confirmed_applied_at,created_at').single();
    if(error){
      $('#jobsStatus').textContent='We could not start the application handoff. Please try again.';
      return;
    }
    currentActivityId=data.id;
    activityByJob.set(job.id,data);
  }
  const opened=window.open(destination,'_blank','noopener,noreferrer');
  const target=$('#handoffConfirmation');
  const guidance=providerGuidance(provider);
  target.innerHTML=`<div class="jobs-match"><strong>${opened?'The official application opened in a new tab.':'Open the official application to continue.'}</strong><ul>${guidance.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><div class="jobs-actions"><button type="button" class="jobs-primary" id="confirmAppliedBtn">I submitted my application</button>${opened?'':`<a class="jobs-secondary" href="${esc(destination)}" target="_blank" rel="noopener noreferrer">Open official application</a>`}</div></div>`;
  $('#confirmAppliedBtn').addEventListener('click',()=>confirmApplied(job.id));
}

async function confirmApplied(jobId){
  if(!session||!currentActivityId)return;
  const {data,error}=await supabase.from('application_activity').update({status:'applied_confirmed',user_confirmed_applied_at:new Date().toISOString()}).eq('id',currentActivityId).eq('user_id',session.user.id).select('id,external_job_id,status,job_snapshot,handed_off_at,user_confirmed_applied_at,created_at').single();
  const target=$('#handoffConfirmation');
  if(error){target.insertAdjacentHTML('beforeend','<p class="jobs-status">We could not update your application status.</p>');return}
  activityByJob.set(jobId,data);
  target.innerHTML='<div class="jobs-match"><strong>Application recorded.</strong><ul><li>It will now appear in My Career under Applications.</li></ul></div>';
  renderJobs();
}

boot();
