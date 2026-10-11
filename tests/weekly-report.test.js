const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const Core=require("../daily-report-core.js"),Weekly=require("../weekly-report-core.js"),Company=require("../daily-report-company.js");
const FORM="https://docs.google.com/forms/d/e/weekly-test-id/viewform";
test("posting day is Tokyo today; preceding seven days exclude today and span months/years correctly",()=>{
  assert.equal(Weekly.todayTokyo(new Date("2026-10-10T15:00:00Z")),"2026-10-11");
  assert.deepEqual(Weekly.datesBefore("2026-10-11",Core),["2026-10-04","2026-10-05","2026-10-06","2026-10-07","2026-10-08","2026-10-09","2026-10-10"]);
  assert.equal(Weekly.datesBefore("2027-01-03",Core)[0],"2026-12-27");
  assert.throws(()=>Weekly.datesBefore("2026-02-30",Core));
});
test("weekly text is chronological and limited to Tasks; missing days, unconfirmed work and synthetic non-work stay explicit",()=>{
  const draft=Weekly.buildDraft("2026-10-11",[{date:"2026-10-08",markdown:"## Tasks\n### 案件B\n- 実績確認前の候補\n- [ ] 未完了\n- [x] 私用 #private\n- [x] 【テスト用・実績ではありません】架空業務\n## Notes\n- 秘密"},{date:"2026-10-06",markdown:"## Tasks\n### 案件A\n- [x] テスト作業 #internship"},{date:"2026-10-09",markdown:"## Tasks\n## Notes\n- 推測しない"}],Core);
  assert.ok(draft.text.indexOf("2026-10-06")<draft.text.indexOf("2026-10-08"));
  for(const excluded of ["未完了","私用","秘密","架空業務","推測しない"])assert.ok(!draft.text.includes(excluded));
  assert.equal(draft.missingDates.length,4);assert.deepEqual(draft.emptyDates,["2026-10-09"]);
  assert.equal(draft.reviewed,false);assert.equal(draft.submit,false);assert.equal(draft.warnings.length,1);
  assert.throws(()=>Weekly.buildDraft("2026-10-11",[{date:"2026-10-11",markdown:"## Tasks"}],Core));
  assert.throws(()=>Weekly.buildDraft("2026-10-11",[{date:"2026-10-08",markdown:""},{date:"2026-10-08",markdown:""}],Core));
});
test("reader asks for exactly seven dates, skips only missing Daily, and stops on permission/error rather than silently omitting data",async()=>{
  const dates=[];const reader={async readDaily(_handle,date){dates.push(date);if(date==="2026-10-04")throw Object.assign(new Error(),{missingDaily:true});return {date,markdown:"## Tasks\n### 案件\n- [x] 検証用の記録"};}};
  const draft=await Weekly.readWeek({},"2026-10-11",reader,Core);
  assert.deepEqual(dates,Weekly.datesBefore("2026-10-11",Core));assert.equal(draft.days.length,6);
  const denied={async readDaily(){throw Object.assign(new Error("permission"),{permissionRequired:true});}};
  await assert.rejects(Weekly.readWeek({},"2026-10-11",denied,Core),e=>e.permissionRequired);
});
test("only a canonical response-form URL can be remembered; ordinary profile edits preserve its registration",async()=>{
  assert.equal(Company.normalizeWeeklyUrl(FORM+"?usp=sf_link"),FORM);
  assert.equal(Company.normalizeWeeklyUrl(FORM.replace("/forms/","/forms/u/1/")),FORM);
  for(const url of [FORM.replace("viewform","edit"),FORM+"?edit2=token","https://evil.test/forms/d/e/id/viewform","https://docs.google.com.evil.test/forms/d/e/id/viewform","https://docs.google.com/forms/d/e/id/formResponse"])
    assert.throws(()=>Company.normalizeWeeklyUrl(url));
  let saved={companyReportProfile:{...Company.DEFAULTS,weeklyReportUrl:FORM}};
  const store=Company.createStore({storage:{async get(){return saved;},async set(data){saved={...saved,...data};}}});
  await store.saveProfile({name:"会社用更新",weeklyReportUrl:""});
  assert.equal(saved.companyReportProfile.weeklyReportUrl,FORM);
});

function adapter({url=FORM,title="週報",dateValue="",workValue="",multiline=true,account=true,maxLength=20000,onEvent=null,duplicate=false}={}){
  const date="2026-10-11",events=[],other={name:"unchanged",department:"unchanged",ftp:"unchanged",checkbox:true};
  class Input {constructor(type,value){this.type=type;this.tagName="INPUT";this._value=value;this.isConnected=true;this.maxLength=maxLength;}get value(){return this._value;}set value(v){this._value=String(v);}closest(){return null;}getClientRects(){return [{}];}dispatchEvent(e){events.push([this.type,e.type]);onEvent?.(this,e);}}
  class Textarea extends Input {constructor(value){super("textarea",value);this.tagName="TEXTAREA";}get value(){return this._value;}set value(v){this._value=String(v);}}
  const dateInput=new Input("date",dateValue),workInput=multiline?new Textarea(workValue):new Input("text",workValue);
  function question(heading,input){return {isConnected:true,textContent:heading,closest(){return null;},getClientRects(){return [{}];},querySelectorAll(selector){return selector.includes("heading")?[{textContent:heading}]:[input];}};}
  const questions=[question("投稿日",dateInput),question("今週の業務と成果報告",workInput)];
  if(duplicate)questions.push(question("投稿日",new Input("date","")));
  const form={isConnected:true,textContent:account?"週報 work@example.test":"週報 other@example.test",closest(){return null;},getClientRects(){return [{}];},querySelectorAll(selector){return selector.includes("listitem")?questions:[{textContent:title}];}};
  class FakeDate extends Date{constructor(...args){super(...(args.length?args:["2026-10-11T03:00:00Z"]));}}
  const context={URL,Intl,Date:FakeDate,Event,HTMLInputElement:Input,HTMLTextAreaElement:Textarea,setTimeout,location:{href:url},document:{querySelectorAll:()=>[form]}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../weekly-report-adapter.js"),"utf8"),context);
  return {run:context.WeeklyReportAdapter.run,date,dateInput,workInput,events,other,context};
}
async function planFor(a,overrides={}){const snapshot=await a.run({operation:"inspect",expectedUrl:FORM});return {postingDate:a.date,text:"【2026-10-08】\n会社サンプル\n・架空の確認用記録",fingerprint:snapshot.fingerprint,reviewed:true,allowGoogleDraftSave:true,submit:false,...overrides};}
test("weekly fill writes only today's date and reviewed text, never clicks buttons; all unrelated fields remain unchanged",async()=>{
  const a=adapter(),plan=await planFor(a),result=await a.run({operation:"fill",expectedUrl:FORM,plan});
  assert.equal(a.dateInput.value,a.date);assert.equal(a.workInput.value,plan.text);assert.equal(result.written,2);assert.equal(result.submitted,false);assert.equal(result.googleDraftSavePossible,true);
  assert.deepEqual(a.other,{name:"unchanged",department:"unchanged",ftp:"unchanged",checkbox:true});
  assert.deepEqual(a.events,[["date","input"],["date","change"],["textarea","input"],["textarea","change"]]);
});
test("inspection alone returns no existing work/contact values and performs no writes",async()=>{
  const a=adapter({workValue:"PRIVATE EXISTING WORK"}),snapshot=await a.run({operation:"inspect",expectedUrl:FORM});
  assert.equal(snapshot.workEmpty,false);assert.ok(!JSON.stringify(snapshot).includes("PRIVATE EXISTING WORK"));assert.deepEqual(a.events,[]);
});
test("unregistered/different form, title, duplicate date field, missing account, stale fingerprint and stale posting date all stop before writes",async()=>{
  for(const options of [{url:FORM.replace("weekly-test-id","other-id")},{title:"資料投稿フォーム"},{duplicate:true}]){
    const a=adapter(options);await assert.rejects(a.run({operation:"inspect",expectedUrl:FORM}));assert.deepEqual(a.events,[]);
  }
  for(const overrides of [{postingDate:"2026-10-10"},{fingerprint:"stale"},{allowGoogleDraftSave:false},{submit:true},{reviewed:false}]){
    const a=adapter(),plan=await planFor(a,overrides);await assert.rejects(a.run({operation:"fill",expectedUrl:FORM,plan}));assert.deepEqual(a.events,[]);
  }
  const unregistered=adapter();await assert.rejects(unregistered.run({operation:"fill",plan:await planFor(unregistered)}));assert.deepEqual(unregistered.events,[]);
  const wrongAccount=adapter({account:false});await assert.rejects(wrongAccount.run({operation:"fill",expectedUrl:FORM,plan:await planFor(wrongAccount)}));assert.deepEqual(wrongAccount.events,[]);
});
test("existing answers are not overwritten; same-day date is preserved, and date-only leaves existing work untouched",async()=>{
  for(const options of [{dateValue:"2026-10-10"},{workValue:"existing"}]){
    const a=adapter(options);await assert.rejects(a.run({operation:"fill",expectedUrl:FORM,plan:await planFor(a)}));assert.deepEqual(a.events,[]);
  }
  const same=adapter({dateValue:"2026-10-11"});assert.equal((await same.run({operation:"fill",expectedUrl:FORM,plan:await planFor(same)})).written,1);
  const dateOnly=adapter({workValue:"existing"});const result=await dateOnly.run({operation:"fill",expectedUrl:FORM,plan:await planFor(dateOnly,{includeWork:false,text:""})});
  assert.equal(result.written,1);assert.equal(dateOnly.workInput.value,"existing");
});
test("single-line business field uses explicit separators; length limits never silently truncate",async()=>{
  const a=adapter({multiline:false}),plan=await planFor(a);await a.run({operation:"fill",expectedUrl:FORM,plan});
  assert.equal(a.workInput.value,Weekly.formatWork(plan.text,"single-line"));
  const short=adapter({maxLength:2});await assert.rejects(short.run({operation:"fill",expectedUrl:FORM,plan:await planFor(short)}));assert.deepEqual(short.events,[]);
});
test("concurrent user edits stop later writes without erasing their value",async()=>{
  let a;a=adapter({onEvent:(el,event)=>{if(el.type==="date"&&event.type==="change")a.workInput.value="user edit";}});
  await assert.rejects(a.run({operation:"fill",expectedUrl:FORM,plan:await planFor(a)}),/値が変わりました/);
  assert.equal(a.workInput.value,"user edit");assert.equal(a.dateInput.value,a.date);
});
test("known weekly form skips ordinary profiles and AI before reading input metadata",async()=>{
  let listener,timer,calls=0;
  const context={console,location:{origin:"https://docs.google.com",pathname:"/forms/d/e/weekly-test-id/viewform"},
    document:{documentElement:{},querySelectorAll(selector){assert.equal(selector,'[role="heading"],h1,h2');return [{textContent:"週報"}];}},
    window:{setTimeout(fn){timer=fn;return 1;},clearTimeout(){}},MutationObserver:class{observe(){}disconnect(){}},
    chrome:{runtime:{id:"ext",onMessage:{addListener(fn){listener=fn;},removeListener(){}},async sendMessage(){calls++;throw Error("unexpected profile/AI access");}}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../content.js"),"utf8"),context);
  const result=await new Promise(resolve=>listener({type:"FILL_PAGE"},{},resolve));assert.equal(result.reason,"weekly-report-only");
  timer();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
});
test("registered weekly URL is also isolated in the worker, which exposes no personal profile or AI call",async()=>{
  let listener,requests=0;
  const data={profiles:[{id:"personal",email:"private@example.test"}],activeProfileId:"personal",settings:{jevEnabled:true},jevApiKey:"secret",companyReportProfile:{weeklyReportUrl:FORM}};
  const context={URL,console,importScripts(){},fetch(){requests++;throw Error("No weekly AI calls");},
    chrome:{runtime:{id:"ext",getURL:file=>`chrome-extension://ext/${file}`,onMessage:{addListener(fn){listener=fn;}}},storage:{local:{async setAccessLevel(){},async get(){return data;}}}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../background.js"),"utf8"),context);
  const sender={id:"ext",tab:{id:1},url:FORM+"?usp=sf_link"};
  const state=await new Promise(resolve=>listener({type:"GET_FILL_STATE"},sender,resolve));
  assert.equal(state.reportMode,"weekly-report-only");assert.equal(state.profile,undefined);assert.ok(!JSON.stringify(state).includes("secret"));
  const classification=await new Promise(resolve=>listener({type:"CLASSIFY_FIELDS",fields:[{label:"weekly business"}],allowNetwork:true},sender,resolve));
  assert.equal(classification.status,"weekly-report-only");assert.equal(requests,0);
});
