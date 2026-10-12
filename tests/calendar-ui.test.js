"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
async function settle(){for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));}
async function ui({configured=true,connected=false,auto=false,extension=true,permission=true}={}) {
  const elements={},get=id=>elements[id]||={value:"",checked:false,disabled:false,textContent:"",listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}};
  let state={configured,supported:true,connected,autoSync:auto,calendarId:"work@example.test"},pending=null,error=null,epoch=0;
  const calls=[],permissionCalls=[],applied=[],snapshot={generation:0,date:"2026-10-12",calendarId:state.calendarId,busy:false,editing:false,fingerprint:"before"};
  let cleared=0;
  const context={URL,console,location:{protocol:extension?"chrome-extension:":"http:",host:extension?"ext":"127.0.0.1:9999",pathname:"/daily-report.html"},document:{getElementById:get},DailyReportCalendarBridge:{snapshot:()=>({...snapshot}),clearLiveSource(){cleared++;},apply(result,expected){if(expected.generation!==snapshot.generation||expected.fingerprint!==snapshot.fingerprint||snapshot.editing)return false;applied.push(result);return true;}},chrome:{runtime:{getURL:file=>`chrome-extension://ext/${file}`,async sendMessage(message){calls.push(message);if(message.type==="CALENDAR_STATUS")return {...state};if(message.type==="CALENDAR_CANCEL"){epoch++;return {cancelled:true};}if(message.type==="CALENDAR_DISCONNECT"){state.connected=false;state.autoSync=false;return {connected:false};}if(message.type==="CALENDAR_SET_AUTO"){state.autoSync=message.enabled;return {...state};}if(error)return {error};if(pending)return pending;state.connected=true;return {date:snapshot.date,calendarSource:snapshot.calendarId,events:[],fetchedAt:"TEST",submit:false,connected:true};}},permissions:{async request(value){permissionCalls.push(value);return permission;}}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../calendar-ui.js"),"utf8"),context);await settle();
  return {get,calls,permissionCalls,applied,snapshot,controller:context.CalendarReportUI,clearCount:()=>cleared,setPending(value){pending=value;},setError(value){error=value;}};
}
test("unconfigured and nonextension pages never start auth, permissions or Google reads",async()=>{
  const a=await ui({configured:false});assert.equal(a.get("calendarConnect").disabled,true);assert.equal(a.calls.filter(x=>x.type!=="CALENDAR_STATUS").length,0);assert.equal(a.permissionCalls.length,0);
  const b=await ui({extension:false,connected:true,auto:true});assert.equal(b.calls.length,0);assert.equal(b.permissionCalls.length,0);
});
test("explicit consent gates connection; permission refusal never reaches the auth worker",async()=>{
  const a=await ui();await a.get("calendarConnect").listeners.click();assert.equal(a.permissionCalls.length,0);assert.equal(a.applied.length,0);
  const b=await ui({permission:false});b.get("calendarConsent").checked=true;await b.get("calendarConnect").listeners.click();assert.equal(b.permissionCalls.length,1);assert.equal(b.calls.some(x=>x.type==="CALENDAR_CONNECT"),false);assert.match(b.get("calendarFetchStatus").textContent,/許可されません/);
});
test("connect uses a single read-only permission request and adopts only local unconfirmed results",async()=>{
  const a=await ui();a.get("calendarConsent").checked=true;await a.get("calendarConnect").listeners.click();assert.equal(a.applied.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(a.permissionCalls[0])),{permissions:["identity"],origins:["https://www.googleapis.com/*"]});
  assert.equal(a.calls.find(x=>x.type==="CALENDAR_CONNECT").consent,true);assert.equal(a.get("calendarSync").disabled,false);
});
test("automatic sync uses only noninteractive worker messages and is deduplicated for the same snapshot",async()=>{
  const a=await ui({connected:true,auto:true});assert.equal(a.calls.filter(x=>x.type==="CALENDAR_SYNC").length,1);assert.equal(a.permissionCalls.length,0);assert.equal(a.calls.some(x=>x.type==="CALENDAR_CONNECT"),false);
  await a.controller.maybeAuto();assert.equal(a.calls.filter(x=>x.type==="CALENDAR_SYNC").length,1);
  a.snapshot.generation++;a.snapshot.date="2026-10-13";a.controller.cancelPending();await a.controller.maybeAuto();assert.equal(a.calls.filter(x=>x.type==="CALENDAR_SYNC").length,2);
});
test("edits, new day and disconnect during pending reads protect local values and block stale adoption",async()=>{
  for(const action of [async a=>{a.snapshot.editing=true;a.snapshot.fingerprint="edited";},async a=>{a.snapshot.date="2026-10-13";a.snapshot.generation++;a.controller.cancelPending();},async a=>{await a.get("calendarDisconnect").listeners.click();}]) {
    const a=await ui({connected:true});let release;a.setPending(new Promise(resolve=>{release=resolve;}));const running=a.get("calendarSync").listeners.click();await settle();await action(a);release({date:"2026-10-12",calendarSource:a.snapshot.calendarId,events:[],submit:false});await running;assert.equal(a.applied.length,0);
  }
});
test("a failed refresh clears old live candidates and reports the error; reviewed drafts are never re-fetched",async()=>{
  const a=await ui({connected:true});a.setError("認証が切れました");await a.get("calendarSync").listeners.click();assert.equal(a.clearCount(),1);assert.equal(a.applied.length,0);assert.match(a.get("calendarFetchStatus").textContent,/認証/);
  a.snapshot.editing=true;const before=a.calls.length;await a.get("calendarSync").listeners.click();assert.equal(a.calls.length,before);assert.match(a.get("calendarFetchStatus").textContent,/編集中/);
});
