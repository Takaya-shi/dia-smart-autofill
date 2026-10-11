"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const Sheet=require("../profile-sheet.js"),Jev=require("../jev-core.js");
test("one memo handles scopes, independent custom entries and indented multiline values without guessing",()=>{
  const profile={sheetEnabled:true,sheetText:"# プロフィール\n氏名：架空 太郎\nふりがな：カクウ タロウ\n個人メール：home@example.test\n会社メール：work@example.test\n得意分野：テスト設計\n自己紹介：一行目\n  二行目\n空欄：",email:"old@example.test"};
  const entries=Sheet.entriesFor(profile);
  assert.equal(entries.length,6);assert.equal(entries[2].kind,"email");assert.equal(entries[3].kind,"email");
  assert.equal(entries[5].value,"一行目\n二行目");
  assert.ok(!entries.some(entry=>entry.value.includes("old@example.test")));
  assert.equal(Sheet.fallback({type:"email",autocomplete:"email"},profile),null);
  assert.equal(Sheet.resolve("sheet:3",profile,{type:"email",label:"会社メール"}),"work@example.test");
  assert.equal(Sheet.resolve("sheet:1",profile,{type:"text",label:"ふりがな"}),"かくう たろう");
  assert.equal(Sheet.resolve("sheet:0",profile,{type:"text",label:"ふりがな"}),null);
  assert.equal(Sheet.resolve("sheet:5",profile,{type:"text"}),null);
  assert.equal(Sheet.resolve("sheet:5",profile,{type:"textarea"}),"一行目\n二行目");
});
test("invalid notes, duplicates, limits and known sensitive entries fail closed without printing values",()=>{
  for(const memo of ["文章だけ", "氏名：A\n氏名：B","APIキー：PRIVATE", "カード名義：PRIVATE", "銀行口座：PRIVATE", "普通の項目：4111111111111111", "普通の項目：sk-"+"a".repeat(30), "#".repeat(20001),"項目："+"a".repeat(2001),Array.from({length:81},(_,i)=>`項目${i}：値`).join("\n")])assert.throws(()=>Sheet.parse(memo));
  try{Sheet.parse("APIキー：VERY_PRIVATE_VALUE");}catch(error){assert.ok(!error.message.includes("VERY_PRIVATE_VALUE"));}
});
test("memo mode is authoritative even when cleared; legacy data survives and conversion never infers name readings",()=>{
  const legacy={lastName:"架空",firstName:"太郎",email:"sample@example.test",customFields:[{aliases:"得意分野",value:"検証"}]};
  assert.ok(Sheet.toMemo(legacy).includes("sample@example.test"));
  assert.ok(!Sheet.toMemo(legacy).includes("カナ"));
  assert.equal(Sheet.entriesFor({...legacy,sheetEnabled:true,sheetText:""}).length,0);
  assert.ok(Sheet.entriesFor({...legacy,sheetEnabled:false,sheetText:"氏名：別人"}).some(entry=>entry.value==="架空"));
  const split={sheetEnabled:true,sheetText:"姓：架空\n名：太郎\nセイ：カクウ\nメイ：タロウ"};
  assert.equal(Sheet.resolve("sheet:fullName",split,{type:"text"}),"架空 太郎");
  assert.equal(Sheet.resolve("sheet:fullNameKana",split,{type:"text",label:"ふりがな"}),"かくう たろう");
});
test("catalog and Jev payload expose descriptors only, registered choices only and strict uncertainty checks",()=>{
  const profile={id:"p",sheetEnabled:true,sheetText:"会社メール：work@example.test\n得意分野：PRIVATE_SKILL"};
  const catalog=Sheet.catalogFor(profile),request=Jev.buildRequest([{label:"PRIVATE_SKILL",value:"PRIVATE_VALUE"}],catalog);
  // The worker redacts field text before building a request; the catalogue itself never has values.
  assert.ok(!JSON.stringify(catalog).includes("PRIVATE_SKILL"));assert.ok(!JSON.stringify(catalog).includes("work@example.test"));
  assert.equal(request.questions.field0.criteria["sheet:0"].label,"会社メール");
  assert.ok(!Object.hasOwn(request.questions.field0.criteria,"email"));
  const answer={type:"choice",choice:"sheet:0",confidence:0.97,probabilities:{"sheet:0":0.99}};
  assert.equal(Jev.parseAnswers({answers:{field0:answer}},1,catalog)[0].fieldKey,"sheet:0");
  for(const changed of [{choice:"invented"},{choice:"email"},{confidence:0.84},{probabilities:{"sheet:0":0.9}}])assert.equal(Jev.parseAnswers({answers:{field0:{...answer,...changed}}},1,catalog)[0],null);
});
test("local guards constrain Jev decisions by type, length, sensitive hints and split fields",()=>{
  const p={sheetEnabled:true,sheetText:"会社メール：work@example.test\nふりがな：漢字\nURL：javascript:alert(1)\n生年月日：2026-02-30"};
  for(const meta of [{type:"password"},{type:"text",label:"カード"},{type:"text",ariaLabel:"APIキー"},{type:"text",description:"銀行口座"},{type:"text",maxLength:4},{type:"tel"},{type:"text",autocomplete:"tel-local-prefix"}])assert.equal(Sheet.resolve("sheet:0",p,meta),null);
  assert.equal(Sheet.resolve("sheet:1",p,{type:"text",label:"フリガナ"}),null);
  assert.equal(Sheet.resolve("sheet:2",p,{type:"url"}),null);
  assert.equal(Sheet.resolve("sheet:3",p,{type:"date"}),null);
  assert.equal(Sheet.resolve("sheet:0",p,{type:"text",autocomplete:"given-name"}),null);
  assert.equal(Sheet.resolve("sheet:0",p,{type:"email",label:"個人メール"}),null);
});
