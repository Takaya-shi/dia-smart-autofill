"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const C=require("../calendar-sync.js"),{configure}=require("../scripts/configure-calendar-oauth.js");
const DATE="2026-10-12",ID="work@example.test",CLIENT="123456-example.apps.googleusercontent.com";
const shift=(changes={})=>({id:"one",summary:"シフト_出社",start:{dateTime:`${DATE}T09:00:00+09:00`},end:{dateTime:`${DATE}T17:00:00+09:00`},...changes});
const response=(value,status=200)=>({ok:status===200,status,async text(){return JSON.stringify(value);}});
function harness({configured=true,permitted=true,authError=false,status=200,auto=false}={}) {
  const data={companyReportProfile:{calendarId:ID},calendarConnection:{connected:false,autoSync:auto}},auth=[],calls=[],removed=[],writes=[];
  let permission=permitted,identityFail=authError,http=status,custom=null;
  const chrome={runtime:{getManifest:()=>configured?{oauth2:{client_id:CLIENT}}:{}},
    storage:{local:{async get(keys){return Object.fromEntries(keys.map(key=>[key,structuredClone(data[key])]));},async set(value){writes.push(structuredClone(value));Object.assign(data,structuredClone(value));}}},
    permissions:{async contains(){return permission;},async remove(){permission=false;return true;}},
    identity:{async getAuthToken(options){auth.push(options);if(identityFail)throw Error("RAW_PRIVATE_AUTH_ERROR");return {token:"TEST_TOKEN_SECRET",grantedScopes:[C.SCOPE]};},async removeCachedAuthToken(value){removed.push(value);}}};
  const fetch=async(url,options)=>{calls.push({url,options});return custom?custom(url,options):response({items:[shift({description:"PRIVATE_DESCRIPTION",attendees:[{self:true,email:"PRIVATE_ATTENDEE",responseStatus:"accepted"}]})]},http);};
  const service=C.createService({chrome,fetch,now:()=>Date.parse(`${DATE}T10:00:00+09:00`)});
  return {service,chrome,data,auth,calls,removed,writes,setHTTP(value){http=value;},setAuthError(value){identityFail=value;},setFetch(fn){custom=fn;},setPermission(value){permission=value;}};
}
test("Tokyo day windows are exclusive and handle month/year boundaries; invalid input never makes URLs",()=>{
  assert.deepEqual(C.windowFor("2026-12-31"),{timeMin:"2026-12-31T00:00:00+09:00",timeMax:"2027-01-01T00:00:00+09:00"});
  for(const date of ["2026-02-30","x",undefined,"2026-1-1"])assert.throws(()=>C.windowFor(date));
  for(const id of ["primary","https://evil.test",`${ID}/other`])assert.throws(()=>C.calendarId(id));
});
test("all pages use GET, limited fields, encoded exact calendar, authorization header and no credentials or redirects",async()=>{
  const calls=[];
  const result=await C.readEvents({token:"TOKEN",id:ID,date:DATE,fetch:async(url,options)=>{
    calls.push([new URL(url),options]);return response(calls.length===1?{items:[shift()],nextPageToken:"next"}:{items:[shift({id:"two",summary:"シフト_リモート"})]});
  }});
  assert.equal(calls.length,2);assert.equal(result.events.length,2);assert.equal(result.submit,false);
  for(const [url,options] of calls){assert.equal(url.origin,"https://www.googleapis.com");assert.ok(url.pathname.includes(encodeURIComponent(ID)));assert.equal(url.searchParams.get("timeZone"),"Asia/Tokyo");assert.equal(url.searchParams.get("timeMax"),"2026-10-13T00:00:00+09:00");assert.ok(!url.href.includes("TOKEN"));assert.equal(options.method,"GET");assert.equal(options.headers.Authorization,"Bearer TOKEN");assert.equal(options.credentials,"omit");assert.equal(options.redirect,"error");assert.ok(!url.searchParams.get("fields").includes("description"));}
  assert.equal(calls[1][0].searchParams.get("pageToken"),"next");
});
test("only shift candidates survive; cancelled, declined, all-day, other-day and unrelated data stay excluded",()=>{
  const events=C.selectEvents([shift(),shift(),shift({id:"cancel",status:"cancelled"}),shift({id:"decline",attendees:[{self:true,responseStatus:"declined"}]}),shift({id:"all",start:{date:DATE},end:{date:"2026-10-13"}}),shift({id:"meeting",summary:"PRIVATE_MEETING"}),shift({id:"old",start:{dateTime:"2026-10-11T09:00:00+09:00"}})],DATE,ID);
  assert.equal(events.length,1);assert.deepEqual(Object.keys(events[0]).sort(),["calendarId","end","id","start","status","summary"]);
});
test("a later page error, repeated page, oversized response or page limit rejects the whole source",async()=>{
  let count=0;
  await assert.rejects(C.readEvents({token:"TOKEN",id:ID,date:DATE,fetch:async()=>response(++count===1?{items:[shift()],nextPageToken:"next"}:null,count===1?200:403)}),/読み取り許可/);
  await assert.rejects(C.readEvents({token:"TOKEN",id:ID,date:DATE,fetch:async()=>response({items:[shift()],nextPageToken:"same"})}),/循環/);
  await assert.rejects(C.readEvents({token:"TOKEN",id:ID,date:DATE,fetch:async()=>({ok:true,async text(){return "x".repeat(1000001);}})}),/サイズ/);
  count=0;await assert.rejects(C.readEvents({token:"TOKEN",id:ID,date:DATE,fetch:async()=>response({items:[],nextPageToken:String(++count)})}),/全ページ/);
});
test("setup, extension permission and explicit consent gates cause no auth or calendar calls",async()=>{
  for(const options of [{configured:false},{permitted:false}]){const h=harness(options);await assert.rejects(h.service.connect(DATE,true));assert.equal(h.auth.length,0);assert.equal(h.calls.length,0);}
  const h=harness();await h.service.status();assert.equal(h.auth.length,0);await assert.rejects(h.service.connect(DATE,false),/確認/);await assert.rejects(h.service.sync(DATE),/まだ接続/);assert.equal(h.auth.length,0);
  delete h.chrome.identity;await assert.rejects(h.service.connect(DATE,true),/Identity/);assert.equal(h.calls.length,0);
});
test("explicit connection verifies a full read, stores no token or events, and repeat sync is noninteractive",async()=>{
  const h=harness({auto:true});const result=await h.service.connect(DATE,true);
  assert.equal(h.auth[0].interactive,true);assert.deepEqual(h.auth[0].scopes,[C.SCOPE]);
  assert.equal((await h.service.status()).connected,true);assert.equal(result.events.length,1);assert.equal(result.fetchedAt,"2026-10-12T01:00:00.000Z");
  for(const secret of ["TEST_TOKEN_SECRET","PRIVATE_DESCRIPTION","PRIVATE_ATTENDEE","シフト_出社"])assert.ok(!JSON.stringify(h.writes).includes(secret));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_DESCRIPTION"));assert.ok(!JSON.stringify(result).includes("PRIVATE_ATTENDEE"));
  await h.service.sync(DATE);assert.equal(h.auth[1].interactive,false);assert.equal(h.data.calendarConnection.autoSync,true);
});
test("expired auth disables automatic sync and evicts only the owned token without disclosing raw Google errors",async()=>{
  const h=harness();await h.service.connect(DATE,true);h.setHTTP(401);
  await assert.rejects(h.service.sync(DATE),/再接続/);assert.equal((await h.service.status()).connected,false);assert.equal(h.removed[0].token,"TEST_TOKEN_SECRET");
  h.setAuthError(true);await assert.rejects(h.service.connect(DATE,true),error=>!error.message.includes("PRIVATE")&&/認証/.test(error.message));
});
test("calendar or client config changes invalidate prior connection; pending result never re-enables a disconnect",async()=>{
  const h=harness();await h.service.connect(DATE,true);h.data.companyReportProfile.calendarId="other@example.test";assert.equal((await h.service.status()).connected,false);await assert.rejects(h.service.sync(DATE),/まだ接続/);
  h.data.companyReportProfile.calendarId=ID;let release;h.setFetch(()=>new Promise(resolve=>{release=resolve;}));
  const pending=h.service.sync(DATE);while(!release)await new Promise(resolve=>setImmediate(resolve));
  await h.service.disconnect();release(response({items:[shift()]}));await assert.rejects(pending,/設定が変わり|解除/);
  assert.equal(h.data.calendarConnection.connected,false);assert.equal(h.data.calendarConnection.autoSync,false);assert.equal((await h.service.status()).connected,false);
});
test("changed calendar while fetching, cancel and concurrent reads discard stale results",async()=>{
  const h=harness();await h.service.connect(DATE,true);let release;h.setFetch(()=>new Promise(resolve=>{release=resolve;}));
  const pending=h.service.sync(DATE);while(!release)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(h.service.sync(DATE),/取得中/);h.data.companyReportProfile.calendarId="changed@example.test";release(response({items:[shift()]}));await assert.rejects(pending,/設定が変わり/);
  h.data.companyReportProfile.calendarId=ID;release=null;const cancelled=h.service.sync(DATE);while(!release)await new Promise(resolve=>setImmediate(resolve));h.service.cancel();release(response({items:[]}));await assert.rejects(cancelled,/設定が変わり/);
});
test("only the exact owned daily-report UI can request calendar actions, including a full-tab options-like sender",async()=>{
  const h=harness();let listener;
  Object.assign(h.chrome.runtime,{id:"ext",getURL:file=>`chrome-extension://ext/${file}`,onMessage:{addListener(fn){listener=fn;}}});h.chrome.storage.local.setAccessLevel=async()=>{};
  const ctx=vm.createContext({URL,console,fetch:async()=>response({items:[]}),chrome:h.chrome,AbortController,setTimeout,clearTimeout});ctx.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,"..",file),"utf8"),ctx);};
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../background.js"),"utf8"),ctx);
  const send=sender=>new Promise(resolve=>{if(!listener({type:"CALENDAR_CONNECT",date:DATE,consent:true},sender,resolve))resolve(null);});
  for(const url of ["https://example.test/form","chrome-extension://ext/options.html","chrome-extension://ext/daily-report.html.evil","chrome-extension://other/daily-report.html"]){const r=await send({id:"ext",tab:{id:1},url});assert.match(r.error,/日報画面/);}
  assert.equal(h.auth.length,0);
  const result=await send({id:"ext",tab:{id:2},url:"chrome-extension://ext/daily-report.html?tab=2"});assert.equal(result.connected,true);assert.equal(h.auth.length,1);
});
test("OAuth configuration accepts only a public client ID and scopes; no credential or unrelated manifest change",()=>{
  const original={version:"0.9.0",permissions:["storage"],oauth2:{scopes:["write-scope"]}};
  const configured=configure(original,CLIENT);assert.deepEqual(configured.oauth2,{client_id:CLIENT,scopes:[C.SCOPE]});assert.equal(configured.permissions,original.permissions);assert.equal(original.oauth2.scopes[0],"write-scope");
  for(const id of ["secret","sk-PRIVATE",undefined])assert.throws(()=>configure(original,id));
});
