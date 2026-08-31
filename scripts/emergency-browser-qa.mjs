import { chromium } from 'playwright';
import fs from 'node:fs';

const baseURL=process.env.QA_BASE_URL||'http://127.0.0.1:8000';
const browser=await chromium.launch({headless:true});
const failures=[];
const fail=m=>failures.push(m);
fs.mkdirSync('artifacts/browser-qa',{recursive:true});

const context=await browser.newContext({
  viewport:{width:390,height:844},
  geolocation:{latitude:15.536321,longitude:119.952441},
  permissions:['geolocation'],
});
const page=await context.newPage();
const pageErrors=[];
page.on('pageerror',e=>pageErrors.push(`pageerror: ${e.message}`));
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))pageErrors.push(`console: ${m.text()}`)});

let serverStatus='received';
const submitted=[];
let agencyReplies=[];
await page.route('**/functions/v1/emergency-response',async route=>{
  const req=route.request();
  let body={};
  try{body=req.postDataJSON()||{}}catch{}
  const action=body.action;
  if(action==='submit'){
    submitted.push(body.report||{});
    const agency=body.report?.target_agency||'pnp';
    await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,reference:`QA-${String(agency).toUpperCase()}-001`,status:'received',received_at:new Date().toISOString()})});
    return;
  }
  if(action==='status'){
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,incident:{client_report_id:body.client_report_id,public_reference:agencyReplies.length?'QA-MDRRMO-001':'QA-PNP-001',target_agency:agencyReplies.length?'mdrrmo':'pnp',lead_agency:agencyReplies.length?'mdrrmo':'pnp',status:serverStatus,priority:'unassessed',incident_type:'qa',received_at:new Date().toISOString(),acknowledged_at:null,assigned_unit:null,resolved_at:null,updated_at:new Date().toISOString()},messages:[{id:'qa-system',sender_kind:'system',sender_agency:null,body:'QA receipt confirmed.',created_at:new Date().toISOString()},...agencyReplies]})});
    return;
  }
  if(action==='message'){
    await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,message_id:'qa-message',created_at:new Date().toISOString()})});
    return;
  }
  await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:'bad qa action'})});
});

const response=await page.goto(`${baseURL}/emergency/`,{waitUntil:'networkidle'});
if(!response||response.status()>=400)fail(`emergency/mobile: HTTP ${response?.status()??'no response'}`);
if(await page.locator('[data-agency]').count()!==2)fail('emergency/mobile: resident must see exactly two agency choices');
if(await page.locator('[data-agency="pnp"]').count()!==1||await page.locator('[data-agency="mdrrmo"]').count()!==1)fail('emergency/mobile: PNP/MDRRMO choices are incomplete');
if(await page.locator('a[href="tel:911"]').count()<1)fail('emergency/mobile: 911 fallback is missing');
let overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
if(overflow>1)fail(`emergency/mobile: horizontal overflow ${overflow}px`);

await page.locator('[data-agency="pnp"]').click();
await page.locator('#reportPanel').waitFor({state:'visible'});
await page.waitForFunction(()=>document.querySelector('#locationCard')?.classList.contains('captured'));
const gpsText=await page.locator('#locationMeta').innerText();
if(!gpsText.includes('15.536321')||!gpsText.includes('119.952441'))fail(`emergency/mobile: GPS coordinates not surfaced: ${gpsText}`);
await page.locator('#incidentType').selectOption('threat');
await page.locator('#description').fill('QA immediate safety report.');
await page.locator('#barangay').fill('QA Barangay');
await page.locator('#reportForm').evaluate(form=>form.requestSubmit());
await page.locator('#activeReport').waitFor({state:'visible'});
await page.waitForFunction(()=>document.querySelector('#statusLabel')?.textContent?.includes('Received by emergency system'));
if((await page.locator('#referenceValue').innerText()).trim()!=='QA-PNP-001')fail('emergency/mobile: confirmed server reference was not shown');
await page.screenshot({path:'artifacts/browser-qa/emergency-mobile-received.png',fullPage:true});

/* --- report mode: intent, and only intent ------------------------------- */

// Emergency must be preselected. Under pressure the default has to be the
// urgent one, and a mis-tap should land on urgent rather than away from it.
if(submitted.length!==1)fail(`emergency/mobile: expected 1 submission, saw ${submitted.length}`);
if(submitted[0].report_mode!=='emergency')fail(`emergency/mobile: default report_mode was '${submitted[0].report_mode}', must be 'emergency'`);

// Intent never carries a priority. The agency decides that, and an intake that
// shipped one would be making an automated triage decision.
if('priority' in submitted[0])fail('emergency/mobile: intake sent a priority — priority is the agency\'s judgement, not the resident\'s');

// Tap targets on the mode choice, measured as painted. Ported from the
// retired assistance suite: this is a one-handed screen, possibly in rain.
await page.locator('#newReportBtn').click();
await page.locator('[data-agency="pnp"]').click();
await page.locator('#modePicker').waitFor({state:'visible'});
const modeBoxes=await page.$$eval('[data-mode]',ns=>ns.map(n=>({mode:n.dataset.mode,h:n.getBoundingClientRect().height,pressed:n.getAttribute('aria-pressed')})));
if(modeBoxes.length!==2)fail(`emergency/mobile: expected 2 report modes, found ${modeBoxes.length}`);
for(const b of modeBoxes){if(b.h<64)fail(`emergency/mobile: ${b.mode} tap target is ${Math.round(b.h)}px, under the 64px floor`)}
if(modeBoxes.find(b=>b.mode==='emergency')?.pressed!=='true')fail('emergency/mobile: emergency is not preselected');

// The 911 line is never withdrawn, in either mode. Asserted after switching to
// assistance, which is exactly where it would be tempting to hide it.
await page.locator('[data-mode="assistance"]').click();
if(await page.locator('a[href="tel:911"]').count()<1)fail('emergency/mobile: 911 fallback disappeared in assistance mode');
/* The assistance note must say the channel is not watched and point at a
   faster route. (An earlier version of this check searched for "watched
   continuously", which the correct copy — "not watched continuously" —
   contains, so it failed on text that was right.) */
const modeNote=(await page.locator('#modeNote').innerText()).toLowerCase();
if(!modeNote.includes('not watched continuously'))fail(`emergency/mobile: assistance mode does not say it is unwatched: "${modeNote}"`);
if(!modeNote.includes('911'))fail('emergency/mobile: assistance mode does not point at a faster route');

await page.locator('#incidentType').selectOption('threat');
await page.locator('#description').fill('QA assistance follow-up, not urgent.');
await page.locator('#barangay').fill('QA Barangay');
await page.locator('#reportForm').evaluate(f=>f.requestSubmit());
await page.locator('#activeReport').waitFor({state:'visible'});
/* Wait on the report actually reaching intake rather than on the status label.
   The label is a proxy, and a proxy that can still read 'Received' from the
   previous report is a proxy that passes before anything was sent. */
for(let i=0;i<60&&submitted.length<2;i++)await page.waitForTimeout(100);
if(submitted.length!==2)fail('emergency/mobile: assistance report did not reach intake');
if(submitted[1].report_mode!=='assistance')fail(`emergency/mobile: assistance report was sent as '${submitted[1].report_mode}'`);
// Same backend, same delivery states — a resident must not meet two systems.
if(!submitted[1].client_report_id||!submitted[1].report_secret)fail('emergency/mobile: assistance report skipped the canonical intake contract');
await page.screenshot({path:'artifacts/browser-qa/emergency-mobile-assistance.png',fullPage:true});

await page.locator('#newReportBtn').click();
await page.locator('[data-agency="mdrrmo"]').click();
await page.locator('#modePicker').waitFor({state:'visible'});

await page.locator('#incidentType').selectOption('flood');
await page.locator('#description').fill('QA flood report created with no network.');
await page.locator('#barangay').fill('QA Offline Barangay');
await context.setOffline(true);
await page.locator('#reportForm').evaluate(form=>form.requestSubmit());
await page.locator('#activeReport').waitFor({state:'visible'});
await page.waitForFunction(()=>document.querySelector('#statusLabel')?.textContent?.includes('Not Yet Received'));
const offlineText=(await page.locator('#statusCard').innerText()).toLowerCase();
if(!offlineText.includes('not yet received'))fail('emergency/mobile: offline report falsely appears delivered');
if((await page.locator('#referenceValue').innerText()).trim()!=='Pending delivery')fail('emergency/mobile: offline report received a server reference before delivery');
await page.screenshot({path:'artifacts/browser-qa/emergency-mobile-offline.png',fullPage:true});

agencyReplies=[{id:'qa-mdrrmo',sender_kind:'mdrrmo',sender_agency:'mdrrmo',body:'QA responder update.',created_at:new Date().toISOString()}];
await context.setOffline(false);
await page.evaluate(()=>window.dispatchEvent(new Event('online')));
await page.waitForFunction(()=>document.querySelector('#statusLabel')?.textContent?.includes('Received by emergency system'),null,{timeout:12000});
if((await page.locator('#referenceValue').innerText()).trim()!=='QA-MDRRMO-001')fail('emergency/mobile: reconnect did not replace pending state with confirmed reference');

for(const path of ['/emergency/pnp.html','/emergency/mdrrmo.html']){
  const r=await page.goto(`${baseURL}${path}`,{waitUntil:'domcontentloaded'});
  if(!r||r.status()>=400)fail(`${path}: HTTP ${r?.status()??'no response'}`);
  const expected=path.includes('pnp')?'pnp':'mdrrmo';
  const actual=await page.locator('body').getAttribute('data-agency');
  if(actual!==expected)fail(`${path}: agency identity mismatch (${actual})`);
  if(!(await page.locator('#loginView').isVisible()))fail(`${path}: authenticated responder gate is not visible`);
  // Ported from the retired desk consoles: a signed-out visitor sees the gate
  // and nothing of the queue.
  if(await page.locator('.incident-row').count())fail(`${path}: incident rows rendered while signed out`);
  // One console carries both kinds of traffic. Separate PNP/MDRRMO assistance
  // consoles are exactly the second system this consolidation removed.
  const views=await page.$$eval('.view-chip',ns=>ns.map(n=>n.dataset.view));
  for(const v of ['all','emergency','assistance','unacknowledged','active','resolved']){
    if(!views.includes(v))fail(`${path}: missing '${v}' view — one console must cover both modes`);
  }
  overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  if(overflow>1)fail(`${path}: horizontal overflow ${overflow}px`);
}

for(const e of pageErrors)fail(`emergency/browser: ${e}`);
await context.close();
await browser.close();

if(failures.length){
  console.error('EMERGENCY BROWSER QA FAILED');
  failures.forEach(f=>console.error(`- ${f}`));
  process.exit(1);
}
console.log('EMERGENCY BROWSER QA PASSED');
console.log('GPS capture, confirmed receipt, offline not-received state, reconnect delivery, mobile layout and both responder gates are healthy.');
