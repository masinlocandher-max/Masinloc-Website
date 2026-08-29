import { createClient } from './assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL='https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY='sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const text=v=>String(v??'').trim();
const iso=v=>v?new Date(v).toISOString():null;
const localValue=value=>{if(!value)return '';const d=new Date(value);const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`};
const fmt=value=>value?new Intl.DateTimeFormat('en-PH',{dateStyle:'medium'}).format(new Date(value)):'';
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[m]));
const DAY=24*60*60*1000;

let session=null;
let providers=[];
let jobs=[];
let editingJob=null;

function isAdmin(user){return user?.app_metadata?.role==='admin'}
function freshnessDefaults(base=new Date()){
  return {
    recheck:new Date(base.getTime()+3*DAY),
    cache:new Date(base.getTime()+7*DAY)
  };
}
function setDefaultDates(){const now=new Date();const {recheck,cache}=freshnessDefaults(now);$('#sourceCheckedAt').value=localValue(now);$('#staleAfter').value=localValue(recheck);$('#cacheExpiresAt').value=localValue(cache)}

async function boot(){
  const {data:{user}}=await supabase.auth.getUser();
  if(!user){showAuth();return}
  session={user};
  if(!isAdmin(user)){showDenied();return}
  await showDesk();
}

function showAuth(){$('#authView').hidden=false;$('#deniedView').hidden=true;$('#deskView').hidden=true}
function showDenied(){$('#authView').hidden=true;$('#deniedView').hidden=false;$('#deskView').hidden=true}

async function showDesk(){
  $('#authView').hidden=true;$('#deniedView').hidden=true;$('#deskView').hidden=false;$('#adminAccount').textContent=session.user.email||'Admin';
  setDefaultDates();
  await loadProviders();
  await loadJobs();
}

async function loadProviders(){
  const {data,error}=await supabase.from('job_providers').select('id,code,name,status,attribution_label').order('name');
  if(error){$('#formMessage').textContent='Could not load providers.';return}
  providers=data||[];
  $('#providerId').innerHTML=providers.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.status)})</option>`).join('');
}

async function loadJobs(){
  const {data,error}=await supabase.from('external_jobs').select('*,provider:job_providers(id,code,name,attribution_label)').order('updated_at',{ascending:false}).limit(500);
  if(error){$('#jobCount').textContent='Could not load records';return}
  jobs=data||[];
  renderStats();renderList();
}

function renderStats(){
  const count=status=>jobs.filter(j=>j.verification_status===status).length;
  $('#draftCount').textContent=count('draft');$('#verifiedCount').textContent=count('verified');$('#liveCount').textContent=count('live');$('#recheckCount').textContent=count('needs_recheck');$('#expiredCount').textContent=count('expired');
}

function renderList(){
  const filter=$('#statusFilter').value;
  const list=filter==='all'?jobs:jobs.filter(j=>j.verification_status===filter);
  $('#jobCount').textContent=`${list.length} ${list.length===1?'record':'records'}`;
  $('#jobsList').innerHTML=list.length?list.map(job=>`<article class="desk-row" data-id="${esc(job.id)}"><div class="desk-row-top"><div><h3>${esc(job.title)}</h3><div class="desk-row-meta"><span>${esc(job.company||'Employer')}</span><span>${esc(job.location||'No location')}</span><span>${esc(job.provider?.name||'Provider')}</span>${job.closing_date?`<span>Closes ${esc(fmt(job.closing_date))}</span>`:''}</div></div><span class="desk-status ${esc(job.verification_status)}">${esc(job.verification_status.replaceAll('_',' '))}</span></div>${job.curator_note?`<p>${esc(job.curator_note)}</p>`:''}<div class="desk-row-actions"><button type="button" data-action="edit">Edit</button>${job.verification_status!=='live'?'<button type="button" data-action="live">Publish live</button>':''}<button type="button" data-action="recheck">Needs recheck</button><button type="button" data-action="expired">Expire</button><a href="${esc(job.source_url)}" target="_blank" rel="noopener noreferrer">Source</a></div></article>`).join(''):'<div class="desk-row-empty">No vacancies in this status.</div>';
  $$('#jobsList [data-action]').forEach(button=>button.addEventListener('click',()=>handleRowAction(button.closest('.desk-row').dataset.id,button.dataset.action)));
}

function fillForm(job){
  editingJob=job;$('#jobId').value=job.id;$('#formTitle').textContent='Edit vacancy';$('#providerId').value=job.provider_id;$('#externalJobId').value=job.external_job_id||'';$('#sourceUrl').value=job.source_url||'';$('#applyUrl').value=job.apply_url||'';$('#verificationMethod').value=job.verification_method||'official_source';$('#sourceCheckedAt').value=localValue(job.source_checked_at);$('#title').value=job.title||'';$('#company').value=job.company||'';$('#location').value=job.location||'';$('#employmentType').value=job.employment_type||'';$('#workSetup').value=job.work_setup||'';$('#salaryText').value=job.salary_text||'';$('#publishedAt').value=localValue(job.published_at);$('#closingDate').value=localValue(job.closing_date);$('#descriptionExcerpt').value=job.description_excerpt||'';$('#requirementsExcerpt').value=job.requirements_excerpt||'';$('#curatorNote').value=job.curator_note||'';$('#staleAfter').value=localValue(job.stale_after);$('#cacheExpiresAt').value=localValue(job.cache_expires_at);$('#formMessage').textContent='';window.scrollTo({top:0,behavior:'smooth'});
}

function resetForm(){editingJob=null;$('#jobForm').reset();$('#jobId').value='';$('#formTitle').textContent='Add vacancy';setDefaultDates();if(providers[0])$('#providerId').value=providers[0].id;$('#formMessage').textContent=''}

async function handleRowAction(id,action){
  const job=jobs.find(j=>j.id===id);if(!job)return;
  if(action==='edit'){fillForm(job);return}
  const nowDate=new Date();const now=nowDate.toISOString();const patch={updated_at:now};
  if(action==='live'){
    const defaults=freshnessDefaults(nowDate);
    const currentStale=job.stale_after?new Date(job.stale_after):null;
    const currentCache=job.cache_expires_at?new Date(job.cache_expires_at):null;
    Object.assign(patch,{
      verification_status:'live',
      is_active:true,
      source_checked_at:now,
      last_verified_at:now,
      last_seen_active_at:now,
      verified_by_user_id:session.user.id,
      stale_after:!currentStale||currentStale<=nowDate?defaults.recheck.toISOString():job.stale_after,
      cache_expires_at:!currentCache||currentCache<=nowDate?defaults.cache.toISOString():job.cache_expires_at
    });
  }
  if(action==='recheck')Object.assign(patch,{verification_status:'needs_recheck',is_active:false});
  if(action==='expired')Object.assign(patch,{verification_status:'expired',is_active:false});
  const {error}=await supabase.from('external_jobs').update(patch).eq('id',id);
  if(error){alert('Could not update vacancy.');return}
  await loadJobs();
}

async function stableExternalId(providerId,sourceUrl){
  const raw=`${providerId}|${sourceUrl}`;const bytes=new TextEncoder().encode(raw);const hash=await crypto.subtle.digest('SHA-256',bytes);return `curated-${[...new Uint8Array(hash)].slice(0,12).map(b=>b.toString(16).padStart(2,'0')).join('')}`;
}

function validateUrl(value){try{const u=new URL(value);return u.protocol==='https:'||u.protocol==='http:'}catch{return false}}

async function save(status){
  const providerId=$('#providerId').value;const sourceUrl=text($('#sourceUrl').value);const applyUrl=text($('#applyUrl').value);const title=text($('#title').value);
  if(!providerId||!title||!validateUrl(sourceUrl)||!validateUrl(applyUrl)){$('#formMessage').textContent='Provider, job title, official source URL, and application URL are required.';return}
  const closingDate=iso($('#closingDate').value);const staleAfter=iso($('#staleAfter').value);const cacheExpiresAt=iso($('#cacheExpiresAt').value);
  if(!cacheExpiresAt){$('#formMessage').textContent='Set a cache expiry before saving.';return}
  if(status==='live'&&!$('#sourceCheckedAt').value){$('#formMessage').textContent='A live vacancy must have a source check time.';return}
  if(status==='live'&&!staleAfter){$('#formMessage').textContent='A live vacancy must have a recheck date.';return}
  if(status==='live'&&new Date(staleAfter)<=new Date()){$('#formMessage').textContent='The recheck date must be in the future before publishing.';return}
  if(status==='live'&&new Date(cacheExpiresAt)<=new Date()){$('#formMessage').textContent='The cache expiry must be in the future before publishing.';return}
  if(status==='live'&&closingDate&&new Date(closingDate)<=new Date()){$('#formMessage').textContent='This closing date has already passed. Save it as expired instead.';return}
  const externalJobId=text($('#externalJobId').value)||await stableExternalId(providerId,sourceUrl);
  const now=new Date().toISOString();
  const payload={provider_id:providerId,external_job_id:externalJobId,title,company:text($('#company').value)||null,location:text($('#location').value)||null,work_setup:text($('#workSetup').value)||null,employment_type:text($('#employmentType').value)||null,salary_text:text($('#salaryText').value)||null,description_excerpt:text($('#descriptionExcerpt').value)||null,requirements_excerpt:text($('#requirementsExcerpt').value)||null,published_at:iso($('#publishedAt').value),expires_at:closingDate,source_url:sourceUrl,apply_url:applyUrl,canonical_key:`${providerId}:${externalJobId}`,last_verified_at:iso($('#sourceCheckedAt').value)||now,cache_expires_at:cacheExpiresAt,provider_metadata:editingJob?.provider_metadata||{},is_active:status==='live',verification_status:status,source_checked_at:iso($('#sourceCheckedAt').value),verification_method:$('#verificationMethod').value||null,closing_date:closingDate,stale_after:staleAfter,curator_note:text($('#curatorNote').value)||null,last_seen_active_at:status==='live'?now:(editingJob?.last_seen_active_at||null),curator_user_id:editingJob?.curator_user_id||session.user.id,verified_by_user_id:['verified','live'].includes(status)?session.user.id:(editingJob?.verified_by_user_id||null),updated_at:now};
  const button=$(`[data-save-status="${status}"]`);button.disabled=true;$('#formMessage').textContent='Saving…';
  let result;
  if(editingJob)result=await supabase.from('external_jobs').update(payload).eq('id',editingJob.id).select('id').single();
  else result=await supabase.from('external_jobs').insert(payload).select('id').single();
  button.disabled=false;
  if(result.error){console.error('source_desk_save_error',result.error.message);$('#formMessage').textContent=result.error.code==='23505'?'This source listing is already in the system.':'Could not save this vacancy.';return}
  $('#formMessage').textContent=status==='live'?'Published. This vacancy can now appear in Masinloc Connect Jobs.':'Saved.';
  await loadJobs();
  if(!editingJob)resetForm();
}

$('#sendLinkBtn').addEventListener('click',async()=>{
  const email=text($('#adminEmail').value).toLowerCase();if(!email||!email.includes('@')){$('#authMessage').textContent='Enter a valid email address.';return}
  const button=$('#sendLinkBtn');button.disabled=true;button.textContent='Sending…';
  const {error}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:`${location.origin}/jobs-source-desk.html`}});
  $('#authMessage').textContent=error?'Could not send sign-in link.':'Check your email for the secure sign-in link.';button.disabled=false;button.textContent='Send secure sign-in link';
});
$('#signOutBtn').addEventListener('click',async()=>{await supabase.auth.signOut();location.reload()});
$('#deniedSignOutBtn').addEventListener('click',async()=>{await supabase.auth.signOut();location.reload()});
$('#resetBtn').addEventListener('click',resetForm);
$('#statusFilter').addEventListener('change',renderList);
$$('[data-save-status]').forEach(button=>button.addEventListener('click',()=>save(button.dataset.saveStatus)));

boot();