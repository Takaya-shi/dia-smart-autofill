"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../daily-report-core.js");
// Synthetic fixture: no actual company project names or work records.
const md = "## Tasks\nサンプル案件A\n- 検証資料の更新\n- テスト画面の修正\n\nサンプル案件B\n- 確認項目の整理\n- サンプルシート作成\n## Due\n- 無関係\n## Notes\n- 推測禁止";
const shift = { id: "one", summary: "シフト_リモート", start: "2026-10-08T10:00:00+09:00", end: "2026-10-08T18:00:00+09:00", status: "confirmed" };
test("Daily-style grouped bullets are candidates, not automatically confirmed accomplishments", () => {
  const result = Core.parseTasks(md);
  assert.equal(result.projects.length, 2);
  assert.equal(result.projects[0].name, "サンプル案件A");
  assert.equal(result.projects[1].tasks.length, 2);
  assert.equal(result.projects[0].tasks[0].completion, "unconfirmed");
  assert.ok(!JSON.stringify(result).includes("推測禁止"));
});
test("unchecked, cancelled, partial, private tasks and fenced examples do not become work facts", () => {
  const result = Core.parseTasks("## Tasks\n仕事\n- [x] 完了 [[リンク|資料]]\n- [ ] 未完了\n- [-] 中止\n- [/] 途中\n- 個人 #private\n```\n- サンプル\n```\n");
  assert.equal(result.projects[0].tasks.length, 1);
  assert.equal(result.projects[0].tasks[0].text, "完了 資料");
  assert.equal(result.projects[0].tasks[0].completion, "checked");
});
test("only verified shift titles with explicit timezone become schedule candidates", () => {
  const result = Core.findShifts([shift, shift, { ...shift, id: "meeting", summary: "会議" },
    { ...shift, id: "block", summary: "ブロック" }, { ...shift, id: "cancelled", status: "cancelled" },
    { ...shift, id: "floating", start: "2026-10-08T10:00:00" }], "2026-10-08");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].spanMinutes, 480);
  assert.equal(result.candidates[0].confirmedActual, false);
  assert.equal(Core.zonedTime("2026-10-08T01:00:00Z").time, "10:00");
});
test("missing notes and shifts stay missing, invalid dates and overnight shifts fail closed", () => {
  assert.equal(Core.validDate("2026-02-30"), false);
  assert.throws(() => Core.buildDraft({ date: "../../private", markdown: md, events: [] }));
  const draft = Core.buildDraft({ date: "2026-10-09", markdown: "## Tasks\n- \n## Notes\n- 実績ではない", events: [] });
  assert.equal(draft.projects.length, 0);
  assert.equal(draft.selectedShift, null);
  assert.equal(Core.validateReady(draft).ready, false);
  assert.equal(Core.findShifts([{ ...shift, end: "2026-10-09T02:00:00+09:00" }], "2026-10-08").candidates.length, 0);
});
test("no automatic allocation or submission; explicit review and matching time totals required", () => {
  const draft = Core.buildDraft({ date: "2026-10-08", markdown: md, events: [shift] });
  assert.equal(draft.submit, false);
  assert.equal(draft.projects[0].minutes, null);
  assert.equal(Core.validateReady(draft).ready, false);
  draft.confirmedWorkTime = true;
  draft.breakMinutes = 60;
  for (let index = 0; index < 2; index++) Object.assign(draft.projects[index], { portalProjectId: `portal-${index}`, minutes: 210, confirmedTasks: true });
  assert.equal(Core.validateReady(draft).ready, true);
  draft.projects[0].minutes = 200;
  assert.equal(Core.validateReady(draft).ready, false);
});
test("third-level project headings work, deferred tasks and top-level Notes are excluded", () => {
  const parsed = Core.parseTasks("## Tasks\n### 案件A\n- [x] 作業\n- [>] 延期\n- [!] 保留\n# Notes\n- 実績にしない");
  assert.equal(parsed.projects.length,1); assert.equal(parsed.projects[0].name,"案件A");
  assert.deepEqual(parsed.projects[0].tasks.map(t=>t.text),["作業"]);
});
test("declined future shifts are not next-work candidates and submission flags fail closed", () => {
  const draft = Core.buildDraft({date:"2026-10-08",markdown:md,events:[shift,{...shift,id:"future",start:"2026-10-13T10:00:00+09:00",end:"2026-10-13T18:00:00+09:00",my_response_status:"declined"}]});
  assert.equal(draft.nextWorkDate,null);
  draft.submit=true; assert.ok(Core.validateReady(draft).errors.some(e=>e.includes("保存・送信")));
});
