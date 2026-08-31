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
let agencyReplies=[];
await page.route('**/functions/v1/emergency-response',async route=>{
  const req=route.request();
  let body={};
  try{body=req.postDataJSON()||{}}catch{}
  const action=body.action;
  if(action==='submit'){
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
await page.waitForFunction(()=>document.querySelector('#statusLabel')?.textContent?.includes('Received'));
if((await page.locator('#referenceValue').innerText()).trim()!=='QA-PNP-001')fail('emergency/mobile: confirmed server reference was not shown');
await page.screenshot({path:'artifacts/browser-qa/emergency-mobile-received.png',fullPage:true});

await page.locator('#newReportBtn').click();
await page.locator('[data-agency="mdrrmo"]').click();
await page.locator('#reportPanel').waitFor({state:'visible'});
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
await page.waitForFunction(()=>document.querySelector('#statusLabel')?.textContent?.includes('Received'),null,{timeout:12000});
if((await page.locator('#referenceValue').innerText()).trim()!=='QA-MDRRMO-001')fail('emergency/mobile: reconnect did not replace pending state with confirmed reference');

for(const path of ['/emergency/pnp.html','/emergency/mdrrmo.html']){
  const r=await page.goto(`${baseURL}${path}`,{waitUntil:'domcontentloaded'});
  if(!r||r.status()>=400)fail(`${path}: HTTP ${r?.status()??'no response'}`);
  const expected=path.includes('pnp')?'pnp':'mdrrmo';
  const actual=await page.locator('body').getAttribute('data-agency');
  if(actual!==expected)fail(`${path}: agency identity mismatch (${actual})`);
  if(!(await page.locator('#loginView').isVisible()))fail(`${path}: authenticated responder gate is not visible`);
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
