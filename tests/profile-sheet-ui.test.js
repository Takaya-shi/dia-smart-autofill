"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const Matcher=require("../matcher.js"),Sheet=require("../profile-sheet.js"),{webcrypto}=require("node:crypto");
async function ui() {
  class Element {
    constructor(){this.value="";this.checked=false;this.disabled=false;this.textContent="";this.listeners={};this.children=[];}
    addEventListener(event,fn){this.listeners[event]=fn;}append(...items){this.children.push(...items);}replaceChildren(){this.children=[];}
    querySelectorAll(){return [];}focus(){}
  }
  const elements={},get=id=>elements[id]||=(new Element());
  get("profileForm").elements=Object.fromEntries(["profileName","lastName","firstName","lastNameKana","firstNameKana","email","phone","birthDate","website","postalCode","prefecture","city","address1","address2","company","department","jobTitle"].map(key=>[key,new Element()]));
  const data={profiles:[{id:"one",profileName:"旧プロフィール",lastName:"山田",firstName:"太郎",email:"old@example.test",customFields:[],extraPreference:"keep"}],activeProfileId:"one",settings:{jevEnabled:true,jevMode:"primary",autoFillSites:[]},jevApiKey:"SECRET",cardVault:"ENCRYPTED"};
  const writes=[];
  const context=vm.createContext({console,crypto:webcrypto,AutoFillMatcher:Matcher,ProfileSheet:Sheet,document:{getElementById:get,createElement:()=>new Element()},window:{setTimeout(){}},chrome:{storage:{local:{async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(data[key])]));},async set(value){writes.push(structuredClone(value));Object.assign(data,structuredClone(value));}}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../options.js"),"utf8"),context);
  await new Promise(resolve=>setImmediate(resolve));return {elements,get,data,writes};
}
test("legacy profiles remain intact until explicit memo activation; local import and save preserve separate keys",async()=>{
  const view=await ui();assert.equal(view.get("sheetEnabled").checked,false);assert.equal(view.data.profiles[0].sheetText,undefined);assert.equal(view.writes.length,0);
  view.get("importLegacySheet").listeners.click();assert.equal(view.get("sheetEnabled").checked,true);assert.ok(view.get("profileSheet").value.includes("old@example.test"));
  assert.equal(view.get("profileForm").elements.email.disabled,true);
  view.get("profileSheet").value="会社メール：work@example.test\n得意分野：テスト";
  await view.get("profileForm").listeners.submit({preventDefault(){}});
  assert.equal(view.data.profiles[0].sheetEnabled,true);assert.equal(view.data.profiles[0].email,"old@example.test");assert.equal(view.data.profiles[0].extraPreference,"keep");
  assert.equal(view.data.jevApiKey,"SECRET");assert.equal(view.data.cardVault,"ENCRYPTED");assert.equal(view.data.settings.jevMode,"primary");
});
test("invalid or sensitive memo cannot be saved; copy/template never overwrite an existing draft",async()=>{
  const view=await ui();view.get("sheetEnabled").checked=true;view.get("profileSheet").value="APIキー：PRIVATE";
  await view.get("profileForm").listeners.submit({preventDefault(){}});assert.equal(view.writes.length,0);assert.match(view.get("saveStatus").textContent,/登録できません/);
  view.get("profileSheet").value="氏名：架空 太郎";view.get("sheetTemplate").listeners.click();assert.equal(view.get("profileSheet").value,"氏名：架空 太郎");assert.match(view.get("saveStatus").textContent,/上書きしません/);
});
test("cleared active memo saves as empty authoritative source; disabling restores legacy input without deleting the memo",async()=>{
  const view=await ui();view.get("sheetEnabled").checked=true;view.get("profileSheet").value="";
  await view.get("profileForm").listeners.submit({preventDefault(){}});assert.equal(Sheet.entriesFor(view.data.profiles[0]).length,0);
  view.get("profileSheet").value="会社メール：work@example.test";view.get("sheetEnabled").checked=false;view.get("sheetEnabled").listeners.change();
  assert.equal(view.get("profileForm").elements.email.disabled,false);await view.get("profileForm").listeners.submit({preventDefault(){}});
  assert.equal(view.data.profiles[0].sheetText,"会社メール：work@example.test");assert.ok(Sheet.entriesFor(view.data.profiles[0]).some(entry=>entry.value==="old@example.test"));
});
test("popup kana notice uses the active memo, not stale legacy fields",async()=>{
  async function popup(profile) {
    const elements={},get=id=>elements[id]||={value:"",textContent:"",append(){},replaceChildren(){},addEventListener(){}};
    const context=vm.createContext({URL,console,ProfileSheet:Sheet,document:{getElementById:get,createElement:()=>({})},chrome:{storage:{local:{async get(){return {profiles:[{id:"one",...profile}],activeProfileId:"one",settings:{}};}}},tabs:{async query(){return [{id:1,url:"https://example.test/form"}];}}}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../popup.js"),"utf8"),context);
    await new Promise(resolve=>setImmediate(resolve));return get("status").textContent;
  }
  assert.equal(await popup({sheetEnabled:true,sheetText:"ふりがな：ヤマダ タロウ"}),"");
  assert.match(await popup({sheetEnabled:true,sheetText:"氏名：山田 太郎",lastNameKana:"ヤマダ",firstNameKana:"タロウ"}),/カナが未登録/);
  assert.match(await popup({sheetEnabled:true,sheetText:"不正なメモ"}),/情報メモの形式/);
});
