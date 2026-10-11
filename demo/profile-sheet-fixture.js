"use strict";
// Standalone UI fixture. Uses only synthetic in-memory data; never reads extension storage or calls APIs.
const fixtureData={profiles:[{id:"demo",profileName:"架空プロフィール",lastName:"山田",firstName:"太郎",fullName:"山田 太郎",lastNameKana:"ヤマダ",firstNameKana:"タロウ",fullNameKana:"ヤマダ タロウ",email:"demo@example.test",customFields:[]}],activeProfileId:"demo",settings:{jevEnabled:true,jevMode:"primary"}};
globalThis.chrome={storage:{local:{async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(fixtureData[key])]));},async set(value){Object.assign(fixtureData,structuredClone(value));},async remove(key){delete fixtureData[key];}}},runtime:{async sendMessage(){return {error:"この架空デモではJev APIへ接続しません"};}}};
document.addEventListener("DOMContentLoaded",()=>{
  const notice=document.createElement("p");notice.className="field-note";notice.textContent="架空のUIデモです。実際のプロフィール・キーにはアクセスせず、APIへも接続しません。";
  document.querySelector("main").prepend(notice);
});
