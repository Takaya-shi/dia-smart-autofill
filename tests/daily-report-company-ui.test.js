const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const Core = require("../daily-report-core.js");
const Company = require("../daily-report-company.js");

class Element {
  constructor(tag = "input") { this.tagName=tag.toUpperCase(); this.value=""; this.textContent=""; this.checked=false; this.disabled=false; this.hidden=false; this.children=[]; this.listeners={}; this.files=[]; }
  addEventListener(type,fn) { (this.listeners[type] ||= []).push(fn); }
  append(...children) { this.children.push(...children); for(const child of children) if(child && typeof child==="object") child.parentElement=this; }
  replaceChildren(...children) { this.children=[]; this.append(...children); }
  emit(type) { return Promise.all((this.listeners[type] || []).map(fn=>fn({target:this}))); }
  click() { return this.disabled ? Promise.resolve() : this.emit("click"); }
}
function fakeDb(handle) {
  const state = {handle};
  return {state,open() {
    const open = {};
    queueMicrotask(()=> {
      open.result = { objectStoreNames:{contains:()=>true},close(){},transaction() {
        const tx = {};
        const request = operation => {
          const req = {}; queueMicrotask(()=> {req.result=operation();req.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());}); return req;
        };
        tx.objectStore=()=>({get:()=>request(()=>state.handle),put:value=>request(()=>{state.handle=value;return "key";}),delete:()=>request(()=>{state.handle=null;})}); return tx;
      } }; open.onsuccess?.();
    }); return open;
  }};
}
function handleSource({permission="granted",delayed=false}={}) {
  const calls=[], pending=new Map(); let access=permission;
  const handle = {kind:"directory",name:"Daily",
    async queryPermission(options) {calls.push(["query",options]);return access;},
    async requestPermission(options) {calls.push(["request",options]);access="granted";return access;},
    async getDirectoryHandle(month) {calls.push(["month",month]);return {async getFileHandle(name) {
      calls.push(["file",name]);return {async getFile() {return {name,size:200,async text() {
        if(delayed) return new Promise(resolve=>pending.set(name,resolve));
        return "## Tasks\n### 会社サンプル\n- [x] テスト専用の作業\n## Notes\n秘密のNotes";
      }};}};
    } };}
  }; return {handle,calls,pending};
}
async function settle() { for(let i=0;i<3;i++) await new Promise(resolve=>setImmediate(resolve)); }
function ui({handle=null,profile=null,picker=null,loadProfile=null,extension=true}={}) {
  const elements = Object.fromEntries([...fs.readFileSync(path.join(__dirname,"../daily-report.html"),"utf8").matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  elements.autoLoadDaily.checked=true;
  elements.companyProfileName.value="会社用"; elements.companyCalendarId.value="work@example.test";
  elements.fillReport.disabled=true; elements.permitCompanyDaily.hidden=true;
  const data={companyReportProfile:profile}, writes=[], portalCalls=[];
  const storage={async get(key) {if(loadProfile) await loadProfile;return {[key]:data[key]};},async set(value) {writes.push(value);Object.assign(data,value);}};
  const db=fakeDb(handle);
  const context={console,URL,URLSearchParams,Intl,Date,Map,Number,Boolean,String,setTimeout,clearTimeout,
    location:{protocol:extension?"chrome-extension:":"http:",host:extension?"owned-id":"127.0.0.1:8766",origin:extension?"chrome-extension://owned-id":"http://127.0.0.1:8766",pathname:"/daily-report.html",search:""},
    document:{getElementById:id=>elements[id],createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},
    chrome:{runtime:{getURL:file=>`chrome-extension://owned-id/${file}`},storage:{local:storage},scripting:{async executeScript(value) {portalCalls.push(value);throw new Error("Unexpected portal write");}}},
    indexedDB:db,showDirectoryPicker:picker,DailyReportCore:Core,DailyReportCompany:Company
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../daily-report.js"),"utf8"),context);
  return {elements,data,writes,portalCalls,db};
}
test("extension UI restores company profile and builds today's local draft without touching portal or confirming work",async()=> {
  const source=handleSource(), view=ui({handle:source.handle}); await settle();
  assert.match(view.elements.companyStatus.textContent,/記憶済み/);
  assert.match(view.elements.markdown.value,/テスト専用/);
  assert.ok(!view.elements.markdown.value.includes("秘密"));
  assert.equal(view.elements.reviewPanel.hidden,false);
  assert.equal(view.elements.fillReport.disabled,true);
  assert.equal(view.elements.confirmWork.checked,false);
  assert.equal(view.elements.confirmDestination.checked,false);
  assert.equal(view.elements.workStart.value,"");
  assert.equal(view.elements.workEnd.value,"");
  assert.deepEqual(view.portalCalls,[]);
  assert.ok(source.calls.every(c=>c[0]!=="request"));
});
test("no folder means no disk reads; registration is explicitly read-only and remembered separately",async()=> {
  const source=handleSource(); let pickerOptions;
  const view=ui({picker:async options=>{pickerOptions=options;return source.handle;}}); await settle();
  assert.equal(view.elements.loadCompanyDaily.disabled,true);
  assert.equal(view.elements.markdown.value,"");
  await view.elements.chooseDailyDirectory.click(); await settle();
  assert.equal(pickerOptions.mode,"read");
  assert.equal(view.db.state.handle,source.handle);
  assert.match(view.elements.markdown.value,/テスト専用/);
  assert.deepEqual(view.portalCalls,[]);
});
test("revoked permission shows a button, never prompts on startup, then loads after explicit read permission",async()=> {
  const source=handleSource({permission:"prompt"}),view=ui({handle:source.handle}); await settle();
  assert.equal(view.elements.permitCompanyDaily.hidden,false);
  assert.equal(view.elements.markdown.value,"");
  assert.deepEqual(source.calls,[["query",{mode:"read"}]]);
  await view.elements.permitCompanyDaily.click(); await settle();
  assert.match(view.elements.markdown.value,/テスト専用/);
  assert.deepEqual(source.calls.find(c=>c[0]==="request"),["request",{mode:"read"}]);
  assert.deepEqual(view.portalCalls,[]);
});
test("a slower old-date result cannot replace the new date; buttons remain busy until both reads finish",async()=> {
  const source=handleSource({delayed:true}),view=ui({handle:source.handle}); await settle();
  const oldName=source.calls.find(c=>c[0]==="file")[1];
  const nextDate=oldName.slice(0,10)==="2026-10-12"?"2026-10-13":"2026-10-12";
  view.elements.reportDate.value=nextDate; await view.elements.reportDate.emit("change"); await settle();
  source.pending.get(oldName)("## Tasks\n### 古い日\n- [x] 古い候補"); await settle();
  assert.equal(view.elements.markdown.value,"");
  assert.equal(view.elements.loadCompanyDaily.disabled,true);
  source.pending.get(`${nextDate}.md`)("## Tasks\n### 新しい日\n- [x] 新しい候補"); await settle();
  assert.match(view.elements.markdown.value,/新しい候補/);
  assert.ok(!view.elements.markdown.value.includes("古い候補"));
  assert.equal(view.elements.loadCompanyDaily.disabled,false);
  assert.deepEqual(view.portalCalls,[]);
});
test("manual edits made during a pending folder read are never overwritten",async()=> {
  const source=handleSource({delayed:true}),view=ui({handle:source.handle}); await settle();
  const name=source.calls.find(c=>c[0]==="file")[1];
  view.elements.markdown.value="## Tasks\n### 本人入力\n- 手入力の内容";
  await view.elements.markdown.emit("input");
  source.pending.get(name)("## Tasks\n### 古い読取\n- [x] 遅い結果"); await settle();
  assert.match(view.elements.markdown.value,/手入力の内容/);
  assert.ok(!view.elements.markdown.value.includes("遅い結果"));
  assert.deepEqual(view.portalCalls,[]);
});
test("edits before profile initialization suppress auto-loading; a local demo never opens profile storage",async()=> {
  let release; const loading=new Promise(resolve=>{release=resolve;});
  const source=handleSource(),view=ui({handle:source.handle,loadProfile:loading});
  view.elements.markdown.value="## Tasks\n- 本人が入力中"; await view.elements.markdown.emit("input");
  release(); await settle(); assert.deepEqual(source.calls,[]);
  assert.match(view.elements.markdown.value,/本人が入力中/);
  const demo=ui({extension:false,handle:source.handle}); await settle();
  assert.equal(demo.elements.companyPanel.hidden,true);
  assert.deepEqual(demo.writes,[]); assert.deepEqual(demo.portalCalls,[]);
});
test("auto-read off retains settings but does not read on open; changing date clears old source text",async()=> {
  const source=handleSource(),view=ui({handle:source.handle,profile:{...Company.DEFAULTS,autoLoadDaily:false}}); await settle();
  assert.deepEqual(source.calls,[]);
  view.elements.markdown.value="## Tasks\n- 前の日の内容";
  view.elements.reportDate.value="2026-10-15"; await view.elements.reportDate.emit("change"); await settle();
  assert.equal(view.elements.markdown.value,""); assert.deepEqual(source.calls,[]);
});
