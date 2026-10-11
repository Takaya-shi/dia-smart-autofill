"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const Core = require("../jev-core.js");
const Matcher = require("../matcher.js");
const Sheet = require("../profile-sheet.js");

test("request only contains bounded, sanitized field metadata", () => {
  const request = Core.buildRequest([{ label: "連絡先", value: "PRIVATE_VALUE", profile: { email: "PRIVATE_PROFILE" },
    apiKey: "SECRET_KEY", placeholder: "person@example.test 090-1234-5678" }]);
  const json = JSON.stringify(request);
  for (const text of ["PRIVATE_VALUE", "PRIVATE_PROFILE", "SECRET_KEY", "person@example.test", "090-1234-5678"]) assert.ok(!json.includes(text));
  assert.equal(request.questions.field0.type, "choice");
  assert.equal(request.questions.field0.criteria.skip, Core.CRITERIA.skip);
  assert.equal(request.questions.field0.instructions.field.label, "連絡先");
  assert.equal(Core.buildRequest([{ label: "first" }, { label: "second" }]).questions.field1.instructions.field.label, "second");
  assert.equal(Core.buildRequest(Array(30).fill({})).state.length, 20);
});

test("low-confidence and invalid outputs never become fill decisions", () => {
  const answer = { type: "choice", choice: "email", confidence: 0.96, probabilities: { email: 0.98 } };
  assert.equal(Core.parseAnswers({ answers: { field0: answer } }, 1)[0].fieldKey, "email");
  for (const changes of [{ confidence: 0.5 }, { choice: "invented" }, { probabilities: { email: 0.6 } }, { confidence: null }]) {
    assert.equal(Core.parseAnswers({ answers: { field0: { ...answer, ...changes } } }, 1)[0], null);
  }
});

test("AI can't put kanji into pronunciation fields or credentials into sensitive fields", () => {
  const profile = { lastName: "山田", lastNameKana: "ヤマダ", email: "demo@example.test", prefecture: "東京都", city: "調布市", address1: "1-2-3" };
  assert.equal(Matcher.resolveFieldValue("lastName", profile, { label: "名字のヨミ", type: "text" }), null);
  assert.equal(Matcher.resolveFieldValue("lastNameKana", { ...profile, lastNameKana: "山田" }, { label: "セイ", type: "text" }), null);
  assert.equal(Matcher.resolveFieldValue("lastNameKana", profile, { label: "せい（ふりがな）", type: "text" }), "やまだ");
  assert.equal(Matcher.resolveFieldValue("email", profile, { label: "APIキー", type: "text" }), null);
  assert.equal(Matcher.resolveFieldValue("email", profile, { autocomplete: "cc-number", type: "text" }), null);
  assert.equal(Matcher.resolveFieldValue("fullAddress", profile, { label: "所在地", type: "text" }), "東京都調布市1-2-3");
});

function worker() {
  const stored = { jevApiKey: "TEST_SECRET", settings: { jevEnabled: true }, profiles: [{ id: "one", email: "private@example.test" }], activeProfileId: "one" };
  let listener;
  let requests = 0;
  let payload;
  let accessLevel;
  let httpStatus = 200;
  let selectAnswer=()=>({type:"choice",choice:"email",confidence:0.97,probabilities:{email:0.99}});
  const context = vm.createContext({ console, crypto: webcrypto, TextEncoder, URL, AbortController, setTimeout, clearTimeout,
    chrome: {
      storage: { local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])); },
        async set(values) { Object.assign(stored, values); },
        async setAccessLevel(value) { accessLevel = value.accessLevel; }
      } },
      runtime: { id: "ext", getURL: (file) => `chrome-extension://ext/${file}`, onMessage: { addListener(fn) { listener = fn; } } }
    },
    async fetch(url, options) {
      requests++;
      payload = JSON.parse(options.body);
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal(options.headers.Authorization, "Bearer TEST_SECRET");
      assert.ok(!options.body.includes("TEST_SECRET"));
      assert.ok(!options.body.includes("private@example.test"));
      return { ok: httpStatus === 200, status: httpStatus, async json() {
        return { answers: Object.fromEntries(Object.keys(payload.questions).map((key) => [key,
          selectAnswer(key,payload)])), usage: { input_tokens: 300 } };
      } };
    }
  });
  context.importScripts = (...files) => { for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context); };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"), context);
  const page = { id: "ext", tab: { id: 1 }, url: "https://example.test/form?secret=123" };
  return { stored, page,
    send(message, sender = page) { return new Promise((resolve) => { if (!listener(message, sender, resolve)) resolve(null); }); },
    count: () => requests, payload: () => payload, access: () => accessLevel, setStatus: (status) => { httpStatus = status; },setAnswer(fn){selectAnswer=fn;}
  };
}

test("background isolates key, disables automatic new calls, caches and accounts for manual calls", async () => {
  const w = worker();
  const state = await w.send({ type: "GET_FILL_STATE" });
  assert.equal(state.profile.email, "private@example.test");
  assert.ok(!JSON.stringify(state).includes("TEST_SECRET"));
  assert.equal(w.access(), "TRUSTED_CONTEXTS");
  const message = { type: "CLASSIFY_FIELDS", fields: [{ label: "電子連絡先", type: "text", value: "private@example.test" }] };
  const automatic = await w.send(message);
  assert.equal(automatic.status, "uncached");
  assert.equal(w.count(), 0);
  const first = await w.send({ ...message, allowNetwork: true });
  assert.equal(first.decisions[0].fieldKey, "email");
  assert.equal(w.count(), 1);
  assert.ok(!JSON.stringify(w.payload()).includes("example.test/form"));
  const cached = await w.send(message);
  assert.equal(cached.cached, true);
  assert.equal(w.count(), 1);
  assert.equal(w.stored.jevUsage.inputTokens, 300);
  w.stored.settings.jevEnabled = false;
  assert.equal((await w.send({ ...message, allowNetwork: true })).status, "disabled");
  assert.equal(w.count(), 1);
});

test("background returns actionable auth failure and doesn't cache failed calls", async () => {
  const w = worker();
  w.setStatus(401);
  const result = await w.send({ type: "CLASSIFY_FIELDS", fields: [{ label: "電子連絡先" }], allowNetwork: true });
  assert.match(result.error, /APIキー/);
  assert.equal(w.stored.jevCache, undefined);
  assert.equal(w.stored.jevUsage, undefined);
  const disallowed = await w.send({ type: "TEST_JEV" });
  assert.match(disallowed.error, /許可/);
});

test("settings connection test uses only a synthetic field, and absent key blocks a paid call", async () => {
  const w = worker();
  const result = await w.send({ type: "TEST_JEV" }, { id: "ext", url: "chrome-extension://ext/options.html" });
  assert.equal(result.ok, true);
  assert.equal(w.count(), 1);
  delete w.stored.jevApiKey;
  const missing = await w.send({ type: "CLASSIFY_FIELDS", fields: [{ label: "連絡先" }], allowNetwork: true });
  assert.match(missing.error, /APIキー/);
  assert.equal(w.count(), 1);
});

test("full-tab options can test Jev while pages and other extension URLs cannot", async () => {
  const w = worker();
  const result = await w.send({ type: "TEST_JEV" }, { id: "ext", tab: { id: 2 }, url: "chrome-extension://ext/options.html" });
  assert.equal(result.ok, true);
  assert.equal(w.count(), 1);
  for (const sender of [w.page,
    { id: "ext", url: "chrome-extension://ext/options.html.evil" },
    { id: "other", url: "chrome-extension://ext/options.html" }]) {
    const denied = await w.send({ type: "TEST_JEV" }, sender);
    assert.ok(denied === null || /許可/.test(denied.error));
  }
  assert.equal(w.count(), 1);
});

function pageHarness(onClassify, options = {}) {
  class Input {
    constructor(name, label, attrs = {}) {
      this.attrs = { name, ...attrs };
      this.tagName = "INPUT";
      this.id = "";
      this.isConnected = true;
      this.value = attrs.value || "";
      const node = { cloneNode() { return { textContent: label, querySelectorAll() { return []; } }; } };
      this.labels = [node];
      this.wrapper = node;
      this.dataset = {};
      this.classList = { add() {}, remove() {} };
    }
    getAttribute(name) { return this.attrs[name] || null; }
    closest(selector) { return selector === "label" ? this.wrapper : null; }
    getBoundingClientRect() { return { width: 100, height: 30 }; }
    dispatchEvent() {}
  }
  const controls = options.fields ? options.fields.map(field=>new Input(field.name||"field",field.label,field)) : [new Input("f_01", "電子連絡先", { placeholder: "private@example.test" }),
    new Input("password", "パスワード", { type: "password" }),
    new Input("card_number", "カード番号"),
    new Input("existing", "Email", { type: "email", value: "existing@example.test" })];
  let listener;
  let sent;
  const listeners = new Set();
  const timers = new Map();
  let timerId = 0;
  let observerDisconnected = false;
  let messageCount = 0;
  const context = vm.createContext({ AutoFillMatcher: Matcher, ProfileSheet:Sheet, console, Event,
    HTMLInputElement: Input, HTMLTextAreaElement: class {}, HTMLSelectElement: class {},
    MutationObserver: class { observe() {} disconnect() { observerDisconnected = true; } },
    location: { origin: "https://example.test", href: "https://example.test/form" },
    document: { documentElement: {}, querySelectorAll() { return controls; }, getElementById() { return null; } },
    window: { getComputedStyle() { return { display: "block", visibility: "visible" }; },
      clearTimeout(id) { timers.delete(id); }, setTimeout(fn) { timers.set(++timerId, fn); return timerId; } },
    chrome: {
      storage: { onChanged: { addListener() {} } },
      runtime: {
        id: "ext",
        onMessage: { addListener(fn) { listener = fn; listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); } },
        async sendMessage(message) {
          messageCount++;
          if (options.missingResponse) return undefined;
          if (options.invalidatedError) throw new Error("Extension context invalidated.");
          if(options.worker) {
            if(message.type==="CLASSIFY_FIELDS"){sent=message;if(onClassify)onClassify(controls);}
            return options.worker.send(message);
          }
          if (message.type === "GET_FILL_STATE") return {
            profile: { id: "one", email: "private@example.test" },
            settings: { jevEnabled: true, autoFillSites: [], overwriteExisting: false, highlightFilled: false }
          };
          sent = message;
          if (onClassify) onClassify(controls);
          return { decisions: [{ fieldKey: "email", confidence: 0.99 }] };
        }
      }
    }
  });
  if (options.noStorage) delete context.chrome.storage;
  if (options.noRuntime) delete context.chrome;
  const script = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
  vm.runInContext(script, context);
  return { controls, context, script, sent: () => sent,
    listenerCount: () => listeners.size, messageCount: () => messageCount,
    disconnected: () => observerDisconnected, timerCount: () => timers.size,
    async fireTimers() {
      const pending = [...timers.values()]; timers.clear();
      for (const fn of pending) await fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
    fill() { return new Promise((resolve) => listener({ type: "FILL_PAGE" }, {}, resolve)); } };
}

test("content-to-worker flow fills from local profile while omitting values and excluded fields", async () => {
  const page = pageHarness();
  const result = await page.fill();
  assert.equal(result.aiFilled, 1);
  assert.equal(page.controls[0].value, "private@example.test");
  assert.equal(page.controls[1].value, "");
  assert.equal(page.controls[2].value, "");
  assert.equal(page.controls[3].value, "existing@example.test");
  const sent = page.sent();
  assert.equal(sent.fields.length, 1);
  assert.ok(!JSON.stringify(sent).includes("private@example.test"));
  assert.equal(sent.fields[0].label, "電子連絡先");
  assert.equal(sent.allowNetwork, true);
  // Reinjection must not register duplicate handlers/observers.
  vm.runInContext(page.script, page.context);
  assert.equal(page.listenerCount(), 1);
});

test("a user's edit during AI latency is never overwritten", async () => {
  const page = pageHarness((controls) => { controls[0].value = "user-edit@example.test"; });
  const result = await page.fill();
  assert.equal(result.aiFilled, 0);
  assert.equal(page.controls[0].value, "user-edit@example.test");
});

test("content can operate without storage API and exits cleanly without runtime", async () => {
  const page = pageHarness(undefined, { noStorage: true });
  assert.equal((await page.fill()).aiFilled, 1);
  const unavailable = pageHarness(undefined, { noRuntime: true });
  assert.equal(unavailable.listenerCount(), 0);
  assert.equal(unavailable.timerCount(), 0);
});

test("old page stops timers and observation when extension context is lost", async () => {
  const page = pageHarness();
  delete page.context.chrome.runtime.id;
  await page.fireTimers();
  assert.equal(page.messageCount(), 0);
  assert.equal(page.listenerCount(), 0);
  assert.equal(page.disconnected(), true);
  assert.equal(page.timerCount(), 0);
  assert.ok(page.controls.every((field, index) => index === 3 || field.value === ""));
});

test("context invalidation rejection is handled and directs the user to reload", async () => {
  const page = pageHarness(undefined, { invalidatedError: true });
  const result = await page.fill();
  assert.match(result.error, /再読み込み/);
  assert.equal(page.listenerCount(), 0);
  assert.equal(page.disconnected(), true);
  assert.equal(page.timerCount(), 0);
});

test("late AI response cannot fill after extension reload", async () => {
  let page;
  page = pageHarness(() => { delete page.context.chrome.runtime.id; });
  const result = await page.fill();
  assert.match(result.error, /再読み込み/);
  assert.equal(page.controls[0].value, "");
  assert.equal(page.disconnected(), true);
});

test("missing worker response does not cause an undefined property error", async () => {
  const page = pageHarness(undefined, { missingResponse: true });
  const result = await page.fill();
  assert.match(result.error, /応答がありません/);
});

function memoWorker() {
  const w=worker(); w.stored.profiles=[{id:"one",sheetEnabled:true,sheetText:"氏名：架空 太郎\n会社メール：work@example.test\n得意分野：PRIVATE_SKILL"}];
  w.stored.settings={jevEnabled:true,jevMode:"primary",autoFillSites:["https://example.test"],overwriteExisting:false,highlightFilled:false};
  w.setAnswer((key,payload)=>{
    const label=payload.questions[key].instructions.field.label;
    const choice=label==="氏名"?"sheet:0":label==="会社メール"?"sheet:1":label==="得意分野"?"sheet:2":"skip";
    return {type:"choice",choice,confidence:0.97,probabilities:{[choice]:0.99}};
  }); return w;
}
test("AI-primary chooses even exact standard fields and independent memo entries while omitting all registered values",async()=>{
  const w=memoWorker(),page=pageHarness(null,{worker:w,fields:[{label:"氏名"},{label:"会社メール",type:"email"},{label:"得意分野"},{label:"新しい質問"},{label:"パスワード",type:"password"}]});
  const result=await page.fill();assert.equal(result.aiFilled,3);assert.equal(result.filled,3);
  assert.deepEqual(page.controls.map(c=>c.value),["架空 太郎","work@example.test","PRIVATE_SKILL","",""]);
  const request=JSON.stringify(w.payload());
  for(const value of ["架空 太郎","work@example.test","PRIVATE_SKILL",w.stored.profiles[0].sheetText,"TEST_SECRET"])assert.ok(!request.includes(value));
  assert.equal(page.sent().fields.length,4);
});
test("primary batches beyond twenty fields, bounds manual calls, and automatic runs reuse cache without paid requests",async()=>{
  const w=memoWorker(),page=pageHarness(null,{worker:w,fields:Array.from({length:41},()=>({label:"会社メール",type:"email"}))});
  assert.equal((await page.fill()).aiFilled,41);assert.equal(w.count(),2); // Equal 20-field batches share a cache entry.
  for(const control of page.controls)control.value="";
  await page.fireTimers();assert.equal(w.count(),2);assert.ok(page.controls.every(c=>c.value==="work@example.test"));
  const huge=pageHarness(null,{worker:w,fields:Array.from({length:101},()=>({label:"氏名"}))});
  assert.equal((await huge.fill()).aiFilled,100);assert.equal(huge.controls[100].value,"");
});
test("changed memo descriptors invalidate cache; changed values alone stay local; stale profiles prevent in-flight writes",async()=>{
  const w=memoWorker(),message={type:"CLASSIFY_FIELDS",fields:[{type:"email",label:"会社メール"}],allowNetwork:true};
  await w.send(message);assert.equal(w.count(),1);
  w.stored.profiles[0].sheetText=w.stored.profiles[0].sheetText.replace("work@example.test","changed@example.test");
  assert.equal((await w.send(message)).cached,true);assert.equal(w.count(),1);
  w.stored.profiles[0].sheetText=w.stored.profiles[0].sheetText.replace("会社メール","業務メール");
  await w.send(message);assert.equal(w.count(),2);
  const page=pageHarness(()=>{w.stored.profiles[0].sheetText+="\n部署：検証";},{worker:w,fields:[{label:"氏名"}]});
  assert.equal((await page.fill()).filled,0);assert.equal(page.controls[0].value,"");
});
test("low-confidence or skip is never overridden; API failure has only unambiguous exact fallback",async()=>{
  const w=memoWorker(),page=pageHarness(null,{worker:w,fields:[{label:"氏名"}]});
  w.setAnswer(()=>({type:"choice",choice:"sheet:0",confidence:0.5,probabilities:{"sheet:0":0.99}}));
  assert.equal((await page.fill()).filled,0);
  delete w.stored.jevCache;
  w.setStatus(401);const result=await page.fill();assert.equal(result.filled,1);assert.equal(result.aiFilled,0);assert.match(result.aiError,/APIキー/);
  const ambiguous=memoWorker();ambiguous.stored.profiles[0].sheetText="個人メール：home@example.test\n会社メール：work@example.test";ambiguous.setStatus(401);
  assert.equal((await pageHarness(null,{worker:ambiguous,fields:[{label:"メール",type:"email"}]}).fill()).filled,0);
});
test("invalid or cleared authoritative memo makes no requests and no writes; malicious messages cannot provide their own entries",async()=>{
  const w=memoWorker();w.stored.profiles[0].sheetText="APIキー：SHOULD_NOT_SEND";
  const page=pageHarness(null,{worker:w,fields:[{label:"氏名"}]});assert.match((await page.fill()).error,/登録できません/);assert.equal(w.count(),0);
  w.stored.profiles[0].sheetText="";assert.equal((await page.fill()).filled,0);assert.equal(w.count(),0);
  w.stored.profiles[0].sheetText="氏名：PRIVATE_NAME";
  await w.send({type:"CLASSIFY_FIELDS",allowNetwork:true,fields:[{label:"PRIVATE_NAME"}],catalog:[{key:"hack",label:"PRIVATE_LABEL",value:"PRIVATE_VALUE"}]});
  assert.ok(!JSON.stringify(w.payload()).includes("PRIVATE_NAME"));assert.ok(!JSON.stringify(w.payload()).includes("PRIVATE_LABEL"));
});
