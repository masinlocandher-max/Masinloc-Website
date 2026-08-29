import { createClient } from './assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL='https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY='sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const PRIVACY_VERSION='2026-08-29-career-v1';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

const $=s=>document.querySelector(s);
const splitList=value=>String(value||'').split(/[,\n]/).map(v=>v.trim()).filter(Boolean).slice(0,50);
const selectedValues=selector=>[...document.querySelectorAll(selector)].filter(el=>el.checked).map(el=>el.value);
const text=v=>String(v??'').trim();

let session=null;
let career=null;
let preferences=null;
let primaryResume=null;
const params=new URLSearchParams(location.search);
const returnJob=params.get('return_job')||localStorage.getItem('mc_pending_job')||'';
const requestedAction=params.get('action')||'';

async function boot(){
  renderReturnNotice();
  const {data:{session:current}}=await supabase.auth.getSession();
  session=current;
  if(!session){showAuth();return}
  await recordPendingPrivacyConsent();
  await showCareer();
}

function renderReturnNotice(){
  if(!returnJob)return;
  const notice=$('#returnNotice');
  notice.hidden=false;
  notice.textContent=requestedAction==='save'
    ?'You were saving a job. Sign in or finish your career profile and we will take you back to that opportunity.'
    :'You were applying for a job. Finish your career profile and resume first. We will take you back to the same opportunity when you are ready.';
}

function showAuth(){
  $('#authView').hidden=false;
  $('#careerView').hidden=true;
}

async function recordPendingPrivacyConsent(){
  const pending=localStorage.getItem('mc_privacy_ack_pending');
  if(pending!==PRIVACY_VERSION)return;
  await supabase.from('member_profiles').upsert({
    user_id:session.user.id,
    privacy_policy_version:PRIVACY_VERSION,
    privacy_accepted_at:new Date().toISOString()
  },{onConflict:'user_id'});
  localStorage.removeItem('mc_privacy_ack_pending');
}

async function showCareer(){
  $('#authView').hidden=true;
  $('#careerView').hidden=false;
  $('#accountEmail').textContent=session.user.email||'Masinloc Connect account';
  $('#careerMessage').textContent='Loading your career profile…';
  const userId=session.user.id;
  const [{data:member},{data:careerData},{data:prefsData},{data:resumeData}]=await Promise.all([
    supabase.from('member_profiles').select('*').eq('user_id',userId).maybeSingle(),
    supabase.from('career_profiles').select('*').eq('user_id',userId).maybeSingle(),
    supabase.from('job_preferences').select('*').eq('user_id',userId).maybeSingle(),
    supabase.from('resume_versions').select('*').eq('user_id',userId).eq('is_primary',true).maybeSingle()
  ]);
  career=careerData||null;
  preferences=prefsData||null;
  primaryResume=resumeData||null;
  fillForm(member||{},career||{},preferences||{});
  $('#viewResumeLink').hidden=!primaryResume;
  if(returnJob)$('#saveCareerBtn').textContent='Save resume and continue application';
  $('#careerMessage').textContent='';
}

function fillForm(member,profile,prefs){
  $('#fullName').value=profile.full_name||member.display_name||'';
  $('#mobile').value=profile.mobile||member.mobile||'';
  $('#currentLocation').value=profile.current_location||member.current_location||'';
  $('#targetRoles').value=(profile.target_roles||prefs.target_roles||[]).join(', ');
  $('#skills').value=(profile.skills||[]).join(', ');
  $('#educationLevel').value=profile.education_level||'';
  $('#school').value=profile.school||'';
  const exp=Array.isArray(profile.work_experience)?profile.work_experience:[];
  $('#workExperience').value=exp.map(item=>typeof item==='string'?item:item?.summary||'').filter(Boolean).join('\n\n');
  $('#training').value=(profile.training||[]).join(', ');
  $('#languages').value=(profile.languages||[]).join(', ');
  $('#availability').value=profile.availability||'';
  $('#salaryMin').value=prefs.expected_salary_min??'';
  $('#remoteOk').checked=Boolean(prefs.remote_ok);
  $('#relocationOk').checked=Boolean(prefs.relocation_ok);
  $('#abroadOk').checked=Boolean(prefs.abroad_ok);
  const locations=new Set(prefs.preferred_locations||[]);
  [...document.querySelectorAll('#locationChecks input')].forEach(input=>input.checked=locations.has(input.value));
  const types=new Set(prefs.employment_types||[]);
  [...document.querySelectorAll('#employmentChecks input')].forEach(input=>input.checked=types.has(input.value));
}

function completionScore(payload,prefs){
  let score=0;
  if(payload.full_name)score+=20;
  if(payload.preferred_email)score+=10;
  if(payload.mobile)score+=10;
  if(payload.current_location)score+=10;
  if(payload.target_roles.length)score+=15;
  if(payload.skills.length)score+=15;
  if(payload.education_level)score+=10;
  if(prefs.preferred_locations.length||prefs.remote_ok||prefs.abroad_ok)score+=5;
  if(prefs.employment_types.length)score+=5;
  return Math.min(score,100);
}

function buildPayload(){
  const experienceText=text($('#workExperience').value);
  const profile={
    user_id:session.user.id,
    full_name:text($('#fullName').value)||null,
    preferred_email:session.user.email||null,
    mobile:text($('#mobile').value)||null,
    current_location:text($('#currentLocation').value)||null,
    target_roles:splitList($('#targetRoles').value),
    skills:splitList($('#skills').value),
    education_level:text($('#educationLevel').value)||null,
    school:text($('#school').value)||null,
    work_experience:experienceText?[{summary:experienceText}]:[],
    training:splitList($('#training').value),
    certifications:career?.certifications||[],
    languages:splitList($('#languages').value),
    profile_summary:career?.profile_summary||null,
    availability:text($('#availability').value)||null
  };
  const prefs={
    user_id:session.user.id,
    target_roles:profile.target_roles,
    preferred_locations:selectedValues('#locationChecks input'),
    remote_ok:$('#remoteOk').checked,
    relocation_ok:$('#relocationOk').checked,
    abroad_ok:$('#abroadOk').checked,
    employment_types:selectedValues('#employmentChecks input'),
    expected_salary_min:$('#salaryMin').value?Number($('#salaryMin').value):null,
    expected_salary_max:preferences?.expected_salary_max??null,
    notify_new_matches:preferences?.notify_new_matches??false
  };
  profile.profile_completion=completionScore(profile,prefs);
  profile.completed_at=profile.profile_completion>=70?(career?.completed_at||new Date().toISOString()):null;
  return {profile,prefs};
}

function resumeSnapshot(profile,prefs){
  return {
    version:1,
    generated_by:'Masinloc Connect',
    personal:{
      full_name:profile.full_name,
      email:profile.preferred_email,
      mobile:profile.mobile,
      current_location:profile.current_location
    },
    target_roles:profile.target_roles,
    skills:profile.skills,
    education:{level:profile.education_level,school:profile.school},
    experience:profile.work_experience,
    training:profile.training,
    certifications:profile.certifications,
    languages:profile.languages,
    summary:profile.profile_summary,
    availability:profile.availability,
    job_preferences:{
      preferred_locations:prefs.preferred_locations,
      remote_ok:prefs.remote_ok,
      relocation_ok:prefs.relocation_ok,
      abroad_ok:prefs.abroad_ok,
      employment_types:prefs.employment_types
    }
  };
}

async function saveCareer(event){
  event.preventDefault();
  if(!session)return;
  const fullName=text($('#fullName').value);
  if(!fullName){$('#careerMessage').textContent='Please enter your full name first.';$('#fullName').focus();return}
  const {profile,prefs}=buildPayload();
  const button=$('#saveCareerBtn');
  button.disabled=true;
  button.textContent='Saving…';
  $('#careerMessage').textContent='';

  const memberPayload={
    user_id:session.user.id,
    display_name:profile.full_name,
    mobile:profile.mobile,
    current_location:profile.current_location,
    onboarding_status:profile.profile_completion>=70?'career_ready':'career_started'
  };

  const [memberResult,profileResult,prefsResult]=await Promise.all([
    supabase.from('member_profiles').upsert(memberPayload,{onConflict:'user_id'}),
    supabase.from('career_profiles').upsert(profile,{onConflict:'user_id'}),
    supabase.from('job_preferences').upsert(prefs,{onConflict:'user_id'})
  ]);
  const firstError=memberResult.error||profileResult.error||prefsResult.error;
  if(firstError){
    console.error('career_save_error',firstError.message);
    $('#careerMessage').textContent='We could not save your career profile right now. Please try again.';
    button.disabled=false;
    button.textContent=returnJob?'Save resume and continue application':'Save and build my resume';
    return;
  }

  const snapshot=resumeSnapshot(profile,prefs);
  let resumeError=null;
  if(primaryResume){
    const result=await supabase.from('resume_versions').update({name:'My Resume',target_role:profile.target_roles[0]||null,resume_snapshot:snapshot}).eq('id',primaryResume.id).eq('user_id',session.user.id);
    resumeError=result.error;
  }else{
    const result=await supabase.from('resume_versions').insert({user_id:session.user.id,name:'My Resume',target_role:profile.target_roles[0]||null,resume_snapshot:snapshot,is_primary:true}).select('*').single();
    resumeError=result.error;
    if(result.data)primaryResume=result.data;
  }

  if(resumeError){
    console.error('resume_save_error',resumeError.message);
    $('#careerMessage').textContent='Your career profile was saved, but the resume could not be generated yet.';
    button.disabled=false;
    button.textContent=returnJob?'Save resume and continue application':'Save and build my resume';
    return;
  }

  career=profile;
  preferences=prefs;
  $('#viewResumeLink').hidden=false;
  $('#careerMessage').textContent=`Saved. Your career profile is ${profile.profile_completion}% ready.`;
  button.disabled=false;
  button.textContent=returnJob?'Save resume and continue application':'Save and build my resume';

  if(returnJob){
    localStorage.removeItem('mc_pending_job');
    location.href=`jobs.html?job=${encodeURIComponent(returnJob)}&resume_ready=1`;
  }
}

$('#sendLinkBtn').addEventListener('click',async()=>{
  const email=text($('#authEmail').value).toLowerCase();
  if(!email||!email.includes('@')){$('#authMessage').textContent='Enter a valid email address first.';return}
  if(!$('#privacyConsent').checked){$('#authMessage').textContent='Please read and accept the Privacy Notice before creating your account.';return}
  const button=$('#sendLinkBtn');
  button.disabled=true;
  button.textContent='Sending…';
  localStorage.setItem('mc_privacy_ack_pending',PRIVACY_VERSION);
  if(returnJob)localStorage.setItem('mc_pending_job',returnJob);
  const query=new URLSearchParams();
  if(returnJob)query.set('return_job',returnJob);
  if(requestedAction)query.set('action',requestedAction);
  const redirect=`${location.origin}/career.html${query.toString()?`?${query}`:''}`;
  const {error}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:redirect}});
  if(error){
    localStorage.removeItem('mc_privacy_ack_pending');
    $('#authMessage').textContent='We could not send the sign-in link. Please try again.';
    console.error('career_auth_error',error.message);
  }else{
    $('#authMessage').textContent='Check your email. Tap the secure Masinloc Connect sign-in link, then you can continue here.';
  }
  button.disabled=false;
  button.textContent='Send secure sign-in link';
});

$('#signOutBtn').addEventListener('click',async()=>{await supabase.auth.signOut();location.href='career.html'});
$('#careerForm').addEventListener('submit',saveCareer);

boot();
