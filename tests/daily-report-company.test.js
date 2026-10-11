const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../daily-report-core.js");
const Company = require("../daily-report-company.js");

function directory({ permission = "granted", markdown = "## Tasks\n### 案件A\n- [x] テスト作業 #internship\n## Notes\n秘密のNotes", size = 128, missing = false, readError = null } = {}) {
  const calls = [];
  const handle = { kind:"directory", name:"Daily",
    async queryPermission(options) { calls.push(["query",options]); return permission; },
    async requestPermission(options) { calls.push(["request",options]); return permission; },
    async getDirectoryHandle(month, options) {
      calls.push(["directory",month,options]);
      if (missing) throw Object.assign(new Error("missing"),{name:"NotFoundError"});
      return { async getFileHandle(name, options) {
        calls.push(["file",name,options]);
        return { async getFile() {
          if (readError) throw readError;
          return {name,size,async text() { calls.push(["text"]); return markdown; }};
        } };
      } };
    } };
  return {handle,calls};
}
function storage(initial = {}) {
  const data = structuredClone(initial), writes = [];
  return { data,writes,
    async get(key) { return { [key]:data[key] }; },
    async set(value) { writes.push(value); Object.assign(data,value); } };
}
function indexedDb(initialHandle = null) {
  let saved = initialHandle;
  const calls = [];
  return {calls,open(name,version) {
    calls.push(["open",name,version]); const request = {};
    queueMicrotask(() => {
      request.result = { objectStoreNames:{contains:()=>true},close(){ calls.push(["close"]); },
        transaction(storeName,mode) {
          calls.push(["transaction",storeName,mode]); const tx = {};
          tx.objectStore = () => {
            const operation = (name,key,value) => {
              const req = {}; calls.push([name,key]);
              queueMicrotask(() => {
                if (name === "put") saved = value;
                if (name === "delete") saved = null;
                req.result = name === "get" ? saved : key;
                req.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.());
              });
              return req;
            };
            return {get:key=>operation("get",key),put:(value,key)=>operation("put",key,value),delete:key=>operation("delete",key)};
          };
          return tx;
        } };
      request.onsuccess?.();
    });
    return request;
  }};
}
test("company preset persists only preferences, leaving ordinary profiles, cards and secrets untouched", async () => {
  const original = {profiles:[{id:"personal",email:"personal@example.test"}],cardVault:"encrypted",jevApiKey:"secret"};
  const local = storage(original), store = Company.createStore({storage:local});
  const profile = await store.loadProfile();
  assert.equal(profile.calendarId,"work@example.test");
  assert.equal(profile.autoLoadDaily,true);
  await store.saveProfile({...profile,name:"会社用",markdown:"never persist",apiKey:"never persist",cardNumber:"never persist",start:"10:00"});
  assert.deepEqual(local.data.profiles,original.profiles);
  assert.equal(local.data.cardVault,original.cardVault);
  assert.equal(local.data.jevApiKey,original.jevApiKey);
  assert.deepEqual(Object.keys(local.data.companyReportProfile).sort(),["schemaVersion","id","name","calendarId","reportUrl","autoLoadDaily","weeklyReportUrl"].sort());
  assert.ok(local.writes.every(value=>Object.keys(value).join()===Company.PROFILE_KEY));
  assert.equal((await store.loadProfile()).name,"会社用");
});
test("invalid names, calendar IDs and unverified report URLs cannot replace a preset", () => {
  for(const value of [{name:""},{name:"a".repeat(81)},{calendarId:"not-email"},{calendarId:"a b@example.test"},{reportUrl:"https://evil.test/productivity"}])
    assert.throws(()=>Company.normalizeProfile(value));
  assert.equal(Company.normalizeProfile({autoLoadDaily:false}).autoLoadDaily,false);
});
test("folder picker asks only for read access; Note/Vault/month folders and unsupported pickers fail closed", async () => {
  const {handle} = directory(); let options;
  assert.equal(await Company.chooseDirectory(async value=>{options=value;return handle;}),handle);
  assert.equal(options.mode,"read");
  for(const name of ["Note","MyVault","2026-10"])
    await assert.rejects(Company.chooseDirectory(async()=>({...handle,name})),/Daily/);
  await assert.rejects(Company.chooseDirectory(null),/このブラウザ/);
});
test("remembered directory handle survives reopening and can be forgotten without touching disk", async () => {
  const {handle,calls:disk} = directory(), db = indexedDb();
  const store = Company.createStore({storage:storage(),indexedDB:db});
  assert.equal(await store.getDirectory(),null);
  await store.putDirectory(handle);
  const reopened = Company.createStore({storage:storage(),indexedDB:db});
  assert.equal(await reopened.getDirectory(),handle);
  await reopened.forgetDirectory(); assert.equal(await store.getDirectory(),null);
  assert.deepEqual(disk,[]);
  assert.ok(db.calls.some(c=>c[0]==="transaction"&&c[2]==="readonly"));
});
test("missing IndexedDB and corrupt saved handles never fall back to Vault or arbitrary paths", async () => {
  await assert.rejects(Company.createStore({storage:storage()}).getDirectory(),/保存できません/);
  await assert.rejects(Company.createStore({storage:storage(),indexedDB:indexedDb({kind:"directory",name:"Note"})}).getDirectory(),/Daily/);
});
test("Daily reader opens only one exact month/date file, omits Notes and keeps confirmations false", async () => {
  const {handle,calls} = directory();
  const result = await Company.readDaily(handle,"2026-10-11",Core);
  assert.equal(result.notePath,"Daily/2026-10/2026-10-11.md");
  assert.ok(!result.markdown.includes("秘密"));
  assert.deepEqual(calls.filter(c=>["directory","file"].includes(c[0])),[["directory","2026-10",undefined],["file","2026-10-11.md",undefined]]);
  assert.ok(!calls.some(c=>c[0]==="request"));
  const draft = Core.buildDraft({date:result.date,markdown:result.markdown,events:[]});
  assert.equal(draft.projects.length,1);
  assert.equal(draft.projects[0].confirmedTasks,false);
  assert.equal(draft.submit,false); assert.equal(Core.validateReady(draft).ready,false);
});
test("permission is never requested automatically, denial reads nothing; explicit request remains read-only", async () => {
  for(const permission of ["prompt","denied"]) {
    const {handle,calls} = directory({permission});
    await assert.rejects(Company.readDaily(handle,"2026-10-11",Core),error=>error.permissionRequired===true);
    assert.deepEqual(calls,[["query",{mode:"read"}]]);
    await Company.requestReadPermission(handle);
    assert.deepEqual(calls.at(-1),["request",{mode:"read"}]);
  }
});
test("invalid dates and protected directories cause zero file access", async () => {
  const {handle,calls} = directory();
  for(const date of ["../../Note","2026-02-30","2026-10-11/evil","2026-13-01"]) await assert.rejects(Company.readDaily(handle,date,Core));
  await assert.rejects(Company.readDaily({...handle,name:"Note"},"2026-10-11",Core));
  assert.deepEqual(calls,[]);
});
test("missing, oversized and unreadable files fail rather than reuse another day or fabricate work", async () => {
  await assert.rejects(Company.readDaily(directory({missing:true}).handle,"2026-10-11",Core),/Dailyがありません/);
  const large = directory({size:1000001});
  await assert.rejects(Company.readDaily(large.handle,"2026-10-11",Core),/1MB/);
  assert.ok(!large.calls.some(c=>c[0]==="text"));
  await assert.rejects(Company.readDaily(directory({readError:Object.assign(new Error(),{name:"NotAllowedError"})}).handle,"2026-10-11",Core),e=>e.permissionRequired);
});
test("automatic extraction excludes unchecked, cancelled, private tasks and fenced examples", async () => {
  const markdown = "## Tasks\n### 案件A\n- [ ] 未完了\n- [-] 中止\n- [x] 私用 #private\n- [x] 確認用テスト #internship\n- 未確認の候補\n```md\n- [x] フェンス内\n```\n## Notes\n- [x] Notes内";
  const result = await Company.readDaily(directory({markdown}).handle,"2026-10-11",Core);
  const parsed = Core.parseTasks(result.markdown);
  assert.deepEqual(parsed.projects[0].tasks.map(t=>t.text),["確認用テスト","未確認の候補"]);
  assert.equal(parsed.projects[0].tasks[1].completion,"unconfirmed");
});
