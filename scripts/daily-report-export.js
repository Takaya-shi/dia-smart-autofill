#!/usr/bin/env node
"use strict";
// Read-only CLI. No OAuth credentials, network, Vault writes or portal calls.
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../daily-report-core.js");
const VAULT = process.env.OBSIDIAN_VAULT;
function exportSources(date, calendar = { events: [] }, vault = VAULT) {
  if (!vault) throw new Error("OBSIDIAN_VAULT に自分のVaultパスを設定してください");
  if (!Core.validDate(date)) throw new Error("日付はYYYY-MM-DD形式で指定してください");
  if (!Array.isArray(calendar.events) || calendar.events.length > 500 || calendar.next_page_token || calendar.nextPageToken)
    throw new Error("カレンダーの取得範囲・全ページを確認してください");
  if (calendar.date && calendar.date !== date) throw new Error("カレンダーの対象日が違います");
  const dailyRoot = path.resolve(vault, "Daily");
  const filename = path.join(dailyRoot, date.slice(0, 7), `${date}.md`);
  // Missing files and symlinks out of Daily are never expanded into other notes.
  const real = fs.realpathSync(filename);
  if (!real.startsWith(`${dailyRoot}${path.sep}`) || !fs.statSync(real).isFile() || fs.statSync(real).size > 1000000)
    throw new Error("許可したDailyファイルではありません");
  const parsed = Core.parseTasks(fs.readFileSync(real, "utf8"));
  // Reconstruct only the task section, stripping Notes and unrelated content.
  const markdown = "## Tasks\n" + parsed.projects.map(p => `${p.name}\n` + p.tasks.map(t => `- ${t.completion === "checked" ? "[x] " : ""}${t.text}`).join("\n")).join("\n\n");
  const events = calendar.events.filter(e => e && ["シフト_出社","シフト_リモート"].includes(e.summary)).map(e => ({
    id:e.id || null, summary:e.summary, start:e.start, end:e.end, status:e.status || "confirmed", my_response_status:e.my_response_status || null,
    calendarId:calendar.calendarSource || "" }));
  return { schemaVersion:1, date, notePath:`Daily/${date.slice(0,7)}/${date}.md`, markdown,
    events, calendarSource:calendar.calendarSource || "未取得", fetchedAt:calendar.fetchedAt || null, warnings:parsed.warnings, submit:false };
}
if (require.main === module) {
  try {
    const [date, calendarFile] = process.argv.slice(2);
    const calendar = calendarFile ? JSON.parse(fs.readFileSync(calendarFile,"utf8")) : {events:[]};
    process.stdout.write(JSON.stringify(exportSources(date,calendar),null,2)+"\n");
  } catch(error) { process.stderr.write(`読み取り中止：${error.message}\n`); process.exitCode=1; }
}
module.exports = { exportSources };
