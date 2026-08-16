import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL='https://uwcqvsitjtknxsaypjxj.supabase.co';
const SUPABASE_KEY='sb_publishable_qsC-udp3YoJQFuE-lHPivg_wa8gYMeg';
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const tables={
 business:{table:'business_submissions',label:'Business',statuses:['pending','reviewing','needs_review','approved','rejected','published','archived'],title:r=>r.brand_name,sub:r=>r.short_description,cols:[['Brand','brand_name'],['Contact','contact_number'],['Status','status'],['Submitted','created_at']]},
 story:{table:'story_submissions',label:'Story / History',statuses:['pending','reviewing','needs_review','approved','rejected','published','archived'],title:r=>r.title,sub:r=>r.about,cols:[['Title','title'],['Contributor','contributor_name'],['Status','status'],['Submitted','created_at']]},
 professional:{table:'professional_submissions',label:'Professionals',statuses:['pending','private','reviewing','needs_review','approved','rejected','published','archived'],title:r=>r.full_name,sub:r=>`${r.profession||''}${r.current_location?` · ${r.current_location}`:''}`,cols:[['Name','full_name'],['Profession','profession'],['Visibility','public_profile'],['Status','status'],['Submitted','created_at']]},
 resume:{table:'resume_support_submissions',label:'Resume Support',statuses:['pending','in_progress','completed','declined','archived'],title:r=>r.full_name||r.target_job,sub:r=>r.target_job,cols:[['Name','full_name'],['Target','target_job'],['Status','status'],['Submitted','created_at']]}
};
let activeType='business',rows=[],counts={business:0,story:0,professional:0,resume:0};

function isAdmin(session){return session?.user?.app_metadata?.role==='admin'}
function formatDate(v){if(!v)return '—';return new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v))}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function pretty(k){return k.replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase())}
function statusHTML(s){return `<span class="status ${esc(s)}">${esc((s||'').replace(/_/g,' '))}</span>`}

async function boot(){
 const {data:{session}}=await supabase.auth.getSession();
 if(session&&isAdmin(session)){showApp(session);await loadAll()} else showLogin();
}
function showLogin(){ $('#loginView').hidden=false;$('#appView').hidden=true }
function showApp(session){$('#loginView').hidden=true;$('#appView').hidden=false;$('#adminEmail').textContent=session.user.email||'Admin'}

$('#passwordForm').addEventListener('submit',async e=>{
 e.preventDefault();$('#loginMessage').textContent='Signing in…';
 const email=$('#email').value.trim(),password=$('#password').value;
 const {data,error}=await supabase.auth.signInWithPassword({email,password});
 if(error){$('#loginMessage').textContent=error.message;return}
 if(!isAdmin(data.session)){await supabase.auth.signOut();$('#loginMessage').textContent='This account does not have admin access.';return}
 $('#loginMessage').textContent='';showApp(data.session);await loadAll();
});
$('#magicLinkBtn').addEventListener('click',async()=>{
 const email=$('#email').value.trim();if(!email){$('#loginMessage').textContent='Enter your email first.';return}
 $('#loginMessage').textContent='Sending secure sign-in link…';
 const {error}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:`${location.origin}/admin.html`}});
 $('#loginMessage').textContent=error?error.message:'Check your email for the secure sign-in link.';
});
$('#logoutBtn').addEventListener('click',async()=>{await supabase.auth.signOut();showLogin()});
$('#refreshBtn').addEventListener('click',loadAll);

async function loadAll(){
 await Promise.all(Object.entries(tables).map(async([key,cfg])=>{const {count}=await supabase.from(cfg.table).select('*',{count:'exact',head:true});counts[key]=count||0}));
 renderMetrics();await loadRows();
}
function renderMetrics(){
 $('#metrics').innerHTML=Object.entries(tables).map(([k,c])=>`<div class="metric"><span>${esc(c.label)}</span><strong>${counts[k]||0}</strong></div>`).join('');
}
async function loadRows(){
 const cfg=tables[activeType];
 const {data,error}=await supabase.from(cfg.table).select('*').order('created_at',{ascending:false}).limit(500);
 if(error){if(error.code==='PGRST301'||/JWT|permission/i.test(error.message)){await supabase.auth.signOut();showLogin();return}alert(error.message);return}
 rows=data||[];renderStatusFilter();renderTable();
}
function renderStatusFilter(){const s=$('#statusFilter');const current=s.value;s.innerHTML='<option value="">All statuses</option>'+tables[activeType].statuses.map(v=>`<option value="${v}">${pretty(v)}</option>`).join('');if(tables[activeType].statuses.includes(current))s.value=current}
function filteredRows(){const q=$('#searchInput').value.trim().toLowerCase(),status=$('#statusFilter').value;return rows.filter(r=>(!status||r.status===status)&&(!q||JSON.stringify(r).toLowerCase().includes(q)))}
function cellValue(r,key){if(key==='created_at')return formatDate(r[key]);if(key==='status')return statusHTML(r[key]);if(key==='public_profile')return r[key]?'Public':'Private';const v=r[key];return v===null||v===undefined||v===''?'—':esc(v)}
function renderTable(){
 const cfg=tables[activeType],filtered=filteredRows();
 $('#tableHead').innerHTML='<tr>'+cfg.cols.map(([label])=>`<th>${label}</th>`).join('')+'<th></th></tr>';
 $('#tableBody').innerHTML=filtered.map(r=>'<tr>'+cfg.cols.map(([label,key],i)=>`<td>${i===0?`<span class="row-title">${esc(cfg.title(r)||'Untitled')}</span><span class="row-sub">${esc(cfg.sub(r)||'')}</span>`:cellValue(r,key)}</td>`).join('')+`<td><button class="view-btn" data-id="${r.id}">Open</button></td></tr>`).join('');
 $('#emptyState').hidden=filtered.length>0;
 $$('.view-btn').forEach(b=>b.addEventListener('click',()=>openDetail(b.dataset.id)));
}
$$('#tabs button').forEach(b=>b.addEventListener('click',async()=>{$$('#tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeType=b.dataset.type;$('#searchInput').value='';$('#statusFilter').value='';await loadRows()}));
$('#searchInput').addEventListener('input',renderTable);$('#statusFilter').addEventListener('change',renderTable);

function fieldPairs(r){
 const skip=new Set(['id','internal_notes','verification_notes','status','updated_at']);
 return Object.entries(r).filter(([k])=>!skip.has(k));
}
async function openDetail(id){
 const r=rows.find(x=>x.id===id);if(!r)return;const cfg=tables[activeType];
 let attachments='';
 if(activeType==='business'&&r.brand_logo_path) attachments=await attachmentButtons('masinloc-business-assets',[r.brand_logo_path]);
 if(activeType==='story'&&r.attachment_paths?.length) attachments=await attachmentButtons('masinloc-story-assets',r.attachment_paths);
 const fields=fieldPairs(r).map(([k,v])=>{
   let display=v;
   if(k==='created_at')display=formatDate(v);else if(Array.isArray(v))display=v.join(', ');else if(typeof v==='boolean')display=v?'Yes':'No';
   return `<div class="detail-field ${(String(display||'').length>100||['story','short_description','professional_description','skills','work_experience','training','achievements'].includes(k))?'full':''}"><span>${pretty(k)}</span><p>${esc(display??'—')}</p></div>`;
 }).join('');
 $('#detailContent').innerHTML=`<p class="detail-kicker">${esc(cfg.label)}</p><h2 class="detail-title">${esc(cfg.title(r)||'Submission')}</h2><p class="detail-ref">${esc(r.reference_code||'')} · ${formatDate(r.created_at)}</p><div class="detail-grid">${fields}</div>${attachments?`<div class="detail-field full" style="margin-top:12px"><span>Private attachments</span><div class="attachment-list">${attachments}</div></div>`:''}<div class="admin-editor"><label>Status<select id="editStatus">${cfg.statuses.map(s=>`<option value="${s}" ${r.status===s?'selected':''}>${pretty(s)}</option>`).join('')}</select></label>${activeType==='story'?`<label>Verification notes<textarea id="verificationNotes" placeholder="Sources checked, unresolved details, verification status…">${esc(r.verification_notes||'')}</textarea></label>`:''}<label>Internal notes<textarea id="internalNotes" placeholder="Private notes for the Masinloc team…">${esc(r.internal_notes||'')}</textarea></label><div class="editor-actions"><span id="saveMessage" class="muted"></span><button id="saveRecord">Save changes</button></div></div>`;
 $('#detailModal').hidden=false;
 $('#saveRecord').addEventListener('click',()=>saveRecord(r));
 $$('.attachment-list button').forEach(b=>b.addEventListener('click',()=>window.open(b.dataset.url,'_blank','noopener')));
}
async function attachmentButtons(bucket,paths){const out=[];for(const path of paths){const {data,error}=await supabase.storage.from(bucket).createSignedUrl(path,300);if(!error&&data?.signedUrl)out.push(`<button data-url="${esc(data.signedUrl)}">${esc(path.split('/').pop()||'Attachment')}</button>`)}return out.join('')}
async function saveRecord(r){
 const cfg=tables[activeType],patch={status:$('#editStatus').value,internal_notes:$('#internalNotes').value.trim()||null,updated_at:new Date().toISOString()};
 if(activeType==='story')patch.verification_notes=$('#verificationNotes').value.trim()||null;
 $('#saveMessage').textContent='Saving…';
 const {error}=await supabase.from(cfg.table).update(patch).eq('id',r.id);
 if(error){$('#saveMessage').textContent=error.message;return}
 $('#saveMessage').textContent='Saved';await loadAll();const fresh=rows.find(x=>x.id===r.id);if(fresh)await openDetail(fresh.id);
}
$('#closeModal').addEventListener('click',()=>$('#detailModal').hidden=true);$('#detailModal').addEventListener('click',e=>{if(e.target===$('#detailModal'))$('#detailModal').hidden=true});

$('#exportBtn').addEventListener('click',()=>{
 const data=filteredRows();if(!data.length)return;const keys=[...new Set(data.flatMap(Object.keys))];const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;const csv=[keys.map(q).join(','),...data.map(r=>keys.map(k=>q(Array.isArray(r[k])?r[k].join(' | '):r[k])).join(','))].join('\n');const blob=new Blob([csv],{type:'text/csv'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`masinloc-${activeType}-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
});

supabase.auth.onAuthStateChange(async(event,session)=>{if(event==='SIGNED_IN'&&session){if(isAdmin(session)){showApp(session);await loadAll()}else{await supabase.auth.signOut();showLogin()}}});
boot();