import { createClient } from './assets/vendor/supabase.js?v=2.112.3';

const SUPABASE_URL='https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY='sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
const low=v=>clean(v).toLowerCase();
let session=null;
let career=null;
let primaryResume=null;
const jobCache=new Map();
let runningFor='';

function activeJobId(){return document.querySelector('#jobsList [data-job-id][aria-current="true"]')?.dataset.jobId||''}
function educationRank(value){const t=low(value);if(!t)return 0;if(/postgraduate|master|doctor/.test(t))return 7;if(/college graduate|bachelor|four.?year college/.test(t))return 6;if(/college undergraduate|college level/.test(t))return 5;if(/vocational|tesda|technical|nc ii|nc 2/.test(t))return 4;if(/senior high|grade 12/.test(t))return 3;if(/junior high|high school|secondary/.test(t))return 2;if(/elementary/.test(t))return 1;return 0}
function requiredEducation(value){const t=low(value);return [['Postgraduate',7,/postgraduate|master'?s degree|doctorate/],['College graduate',6,/college graduate|bachelor'?s degree|four.?year college/],['College undergraduate',5,/college undergraduate|college level/],['Vocational / TESDA',4,/vocational|tesda|technical course|nc ii|nc 2/],['Senior High School',3,/senior high|grade 12/],['High School',2,/high school graduate|secondary graduate|junior high/],['Elementary',1,/elementary graduate/]].find(([,rank,pattern])=>pattern.test(t))||null}
function profileExperience(){const items=Array.isArray(career?.work_experience)?career.work_experience:[];return items.map(item=>clean(typeof item==='string'?item:item?.summary)).filter(Boolean)}
function matchingSkills(job){const hay=low([job.title,job.description_excerpt,job.requirements_excerpt].filter(Boolean).join(' '));return (career?.skills||[]).map(clean).filter(skill=>skill.length>=3&&hay.includes(low(skill))).slice(0,4)}
function matchingTraining(job){const hay=low([job.title,job.description_excerpt,job.requirements_excerpt].filter(Boolean).join(' '));return [...(career?.training||[]),...(career?.certifications||[])].map(clean).filter(item=>item.length>=3&&hay.includes(low(item))).slice(0,3)}
function requirementYears(job){const match=low(job.requirements_excerpt).match(/(\d+)\s*(?:\+\s*)?(?:year|years|yr|yrs)\b/);return match?Number(match[1]):0}

function readinessRows(job){
  const rows=[];
  const email=clean(session?.user?.email),mobile=clean(career?.mobile);
  rows.push({label:'Resume',state:primaryResume?'ready':'review',tag:primaryResume?'Ready':'Review',copy:primaryResume?'Your reusable Masinloc Connect resume is ready for this application.':'Build your resume before you continue so your application materials are prepared.'});
  rows.push({label:'Contact details',state:email&&mobile?'ready':'review',tag:email&&mobile?'Ready':'Review',copy:email&&mobile?'Your email and mobile number are available in your Career Profile.':email?'Your email is ready. Add a mobile number if this vacancy or agency requires one.':'Add a working email and mobile number before applying.'});
  const skills=matchingSkills(job);
  rows.push(skills.length?{label:'Skills',state:'aligned',tag:'Looks aligned',copy:`Your Career Profile includes ${skills.join(', ')}, which also appear in this opportunity.`}:{label:'Skills',state:'check',tag:'Check',copy:'No direct skill keyword overlap was found in the vacancy summary. Review the complete requirements before applying.'});
  const reqEdu=requiredEducation(`${job.requirements_excerpt||''} ${job.description_excerpt||''}`),userEdu=educationRank(career?.education_level);
  if(reqEdu){const [label,rank]=reqEdu;rows.push(userEdu>=rank?{label:'Education',state:'aligned',tag:'Looks aligned',copy:`The vacancy text mentions ${label}. Your saved education level appears at or above that level.`}:{label:'Education',state:'review',tag:'Review',copy:`The vacancy text mentions ${label}. Compare that requirement with your saved education details before continuing.`})}
  else rows.push({label:'Education',state:'check',tag:'Check',copy:career?.education_level?'Your education is saved. No clear education threshold was detected in the vacancy summary, so review the full listing.':'No clear education threshold was detected in the summary. Review the full listing and add your education to My Career if relevant.'});
  const exp=profileExperience(),years=requirementYears(job),mentionsExperience=/experience|experienced|work background/i.test(`${job.requirements_excerpt||''} ${job.description_excerpt||''}`);
  if(years)rows.push(exp.length?{label:'Experience',state:'check',tag:'Check',copy:`You have experience recorded. Confirm that its duration and duties satisfy the vacancy's ${years}-year experience wording.`}:{label:'Experience',state:'review',tag:'Review',copy:`The vacancy summary mentions ${years} year${years===1?'':'s'} of experience. Add relevant experience to My Career or review the requirement carefully.`});
  else if(mentionsExperience)rows.push(exp.length?{label:'Experience',state:'check',tag:'Check',copy:'Relevant experience is recorded in your Career Profile. Compare the duties with the employer or agency requirement.'}:{label:'Experience',state:'review',tag:'Review',copy:'The vacancy mentions experience, but none is currently saved in your Career Profile.'});
  else rows.push({label:'Experience',state:exp.length?'ready':'check',tag:exp.length?'Ready':'Check',copy:exp.length?'Your relevant experience is already included in your Career Profile.':'No specific experience requirement was detected in the summary. Review the full listing before applying.'});
  const training=matchingTraining(job);if(training.length)rows.push({label:'Training / certificates',state:'aligned',tag:'Looks aligned',copy:`Your saved ${training.join(', ')} also appears in the opportunity details.`});
  return rows;
}

async function loadJob(id){if(jobCache.has(id))return jobCache.get(id);const {data}=await supabase.from('external_jobs').select('id,title,company,location,description_excerpt,requirements_excerpt,provider_metadata').eq('id',id).maybeSingle();if(data)jobCache.set(id,data);return data||null}
function render(section,job,rows){
  const prepared=rows.filter(row=>row.state==='ready'||row.state==='aligned').length,total=rows.length,target=encodeURIComponent(job.title||''),jobId=encodeURIComponent(job.id||'');
  section.dataset.guidanceJob=job.id;
  section.innerHTML=`<div class="readiness-heading"><div><h3>Application readiness</h3><p><strong>${prepared} of ${total}</strong> preparation items are ready or look aligned.</p></div><a class="readiness-resume-link" href="${primaryResume?`resume.html?target=${target}&job=${jobId}`:'career.html'}">${primaryResume?'Review resume for this job':'Build my resume'}</a></div><div class="readiness-list">${rows.map(item=>`<div class="readiness-row"><span class="readiness-state ${esc(item.state)}">${esc(item.tag)}</span><div><strong>${esc(item.label)}</strong><p>${esc(item.copy)}</p></div></div>`).join('')}</div><p class="readiness-disclaimer">This is a preparation check based on the information you saved and the vacancy text available to Masinloc Connect. It is not an employer or agency eligibility decision.</p>`;
}
async function enhance(){if(!session)return;const section=document.querySelector('.jobs-readiness'),id=activeJobId();if(!section||!id||section.dataset.guidanceJob===id||runningFor===id)return;runningFor=id;const job=await loadJob(id);runningFor='';if(!job||activeJobId()!==id)return;const current=document.querySelector('.jobs-readiness');if(current)render(current,job,readinessRows(job))}
async function start(){
  const {data:{session:current}}=await supabase.auth.getSession();session=current;if(!session)return;
  const userId=session.user.id;
  const [{data:careerData},{data:resumeData}]=await Promise.all([supabase.from('career_profiles').select('mobile,skills,education_level,work_experience,training,certifications,languages').eq('user_id',userId).maybeSingle(),supabase.from('resume_versions').select('id,target_role,is_primary').eq('user_id',userId).eq('is_primary',true).maybeSingle()]);
  career=careerData||null;primaryResume=resumeData||null;
  const detail=document.getElementById('jobsDetail');if(!detail)return;
  new MutationObserver(()=>queueMicrotask(enhance)).observe(detail,{subtree:true,childList:true});await enhance();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
