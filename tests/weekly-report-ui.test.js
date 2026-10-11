const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const Core=require("../daily-report-core.js"),Weekly=require("../weekly-report-core.js"),Company=require("../daily-report-company.js");
const FORM="https://docs.google.com/forms/d/e/weekly-test-id/viewform";
class Element{constructor(){this.value="";this.textContent="";this.checked=false;this.disabled=false;this.hidden=false;this.children=[];this.listeners={};}addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}replaceChildren(){this.children=[];}append(child){this.children.push(child);}emit(type){return Promise.all((this.listeners[type]||[]).map(fn=>fn({target:this})));}click(){return this.disabled?Promise.resolve():this.emit("click");}}
async function settle(){for(let n=0;n<3;n++)await new Promise(r=>setImmediate(r));}
function setup({registered=true,delayed=false}={}){
  const elements=Object.fromEntries([...fs.readFileSync(path.join(__dirname,"../weekly-report.html"),"utf8").matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const profile={...Company.DEFAULTS,weeklyReportUrl:registered?FORM:""},handle={kind:"directory",name:"Daily"};const reads=[],portal=[],saved=[];let resolveRead;
  const target={url:FORM,title:"週報",dateValue:"",workEmpty:true,workMode:"multi-line",maxLength:20000,accountMatched:true,fingerprint:"snapshot"};
  const company={...Company,createStore(){return{async loadProfile(){return profile;},async getDirectory(){return handle;},async saveProfile(value,options){saved.push({value,options});return Object.assign(profile,value);}};},async readDaily(_handle,date){reads.push(date);if(delayed&&reads.length===1)await new Promise(r=>{resolveRead=r;});return{date,markdown:"## Tasks\n### サンプル案件\n- [x] 動作確認用の記録\n## Notes\n秘密"};}};
  const context={URL,URLSearchParams,Intl,Date,Map,Number,Boolean,String,console,setTimeout,
    DailyReportCore:Core,DailyReportCompany:company,WeeklyReportCore:Weekly,
    location:{protocol:"chrome-extension:",host:"owned",pathname:"/weekly-report.html",search:"?tab=1"},
    document:{getElementById:id=>elements[id],createElement:()=>new Element()},
    chrome:{runtime:{getURL:file=>`chrome-extension://owned/${file}`},storage:{local:{}},scripting:{async executeScript(value){if(value.files)return[];const request=value.args[0];portal.push(request);return[{result:request.operation==="inspect"?target:{written:2,submitted:false,googleDraftSavePossible:true}}];}}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../weekly-report.js"),"utf8"),context);
  return{elements,profile,reads,portal,saved,resolve:()=>resolveRead?.()};
}
test("opening weekly UI builds local previous-seven-days preview with no portal writes or confirmations",async()=>{
  const view=setup();await settle();
  assert.deepEqual(view.reads,Weekly.datesBefore(Weekly.todayTokyo(),Core));
  assert.match(view.elements.weeklyText.value,/動作確認用/);assert.ok(!view.elements.weeklyText.value.includes("秘密"));
  assert.equal(view.elements.weeklyReview.checked,false);assert.equal(view.elements.weeklyDestination.checked,false);assert.equal(view.elements.weeklyGoogleDraft.checked,false);
  assert.equal(view.elements.weeklyFill.disabled,true);assert.deepEqual(view.portal,[]);
});
test("input requires source review, registered destination and explicit Google draft acknowledgement; repeat fills remain disabled",async()=>{
  const view=setup();await settle();await view.elements.weeklyInspect.click();
  view.elements.weeklyReview.checked=true;await view.elements.weeklyReview.emit("change");
  view.elements.weeklyDestination.checked=true;await view.elements.weeklyDestination.emit("change");
  assert.equal(view.elements.weeklyFill.disabled,true);
  view.elements.weeklyGoogleDraft.checked=true;await view.elements.weeklyGoogleDraft.emit("change");assert.equal(view.elements.weeklyFill.disabled,false);
  await view.elements.weeklyFill.click();assert.equal(view.portal.at(-1).operation,"fill");assert.equal(view.portal.at(-1).plan.submit,false);
  assert.equal(view.elements.weeklyFill.disabled,true);assert.equal(view.elements.weeklyGoogleDraft.checked,false);
});
test("unregistered weekly destination cannot fill; remembering it writes only the URL to company settings",async()=>{
  const view=setup({registered:false});await settle();await view.elements.weeklyInspect.click();
  view.elements.weeklyReview.checked=true;await view.elements.weeklyReview.emit("change");
  for(const id of ["weeklyDestination","weeklyGoogleDraft"]){view.elements[id].checked=true;await view.elements[id].emit("change");}
  assert.equal(view.elements.weeklyFill.disabled,true);
  await view.elements.weeklyRemember.click();assert.equal(view.saved.length,1);assert.deepEqual(Object.keys(view.saved[0].value),["weeklyReportUrl"]);
  assert.equal(view.profile.weeklyReportUrl,FORM);assert.equal(view.elements.weeklyDestination.checked,false);
});
test("manual editing during a pending week load cannot be overwritten by the late result",async()=>{
  const view=setup({delayed:true});await settle();view.elements.weeklyText.value="本人の手入力";await view.elements.weeklyText.emit("input");view.resolve();await settle();
  assert.equal(view.elements.weeklyText.value,"本人の手入力");assert.deepEqual(view.portal,[]);assert.equal(view.elements.weeklyFill.disabled,true);
});
