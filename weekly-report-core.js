(function(root) {
  "use strict";
  function todayTokyo(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now).map(p=>[p.type,p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function datesBefore(postingDate, core) {
    if (!core.validDate(postingDate)) throw new Error("投稿日を確認してください");
    const time = Date.parse(`${postingDate}T00:00:00Z`);
    return Array.from({length:7},(_v,index)=>new Date(time-(7-index)*86400000).toISOString().slice(0,10));
  }
  async function readWeek(handle, postingDate, company, core) {
    const sources = [];
    for (const date of datesBefore(postingDate,core)) {
      try { sources.push(await company.readDaily(handle,date,core)); }
      catch (error) { if (!error.missingDaily) throw error; sources.push({date,missing:true}); }
    }
    return buildDraft(postingDate,sources,core);
  }
  function buildDraft(postingDate,sources,core) {
    const dates = datesBefore(postingDate,core), found = new Map();
    for (const source of sources) {
      if (!dates.includes(source.date) || found.has(source.date)) throw new Error("週報の対象外の日付か、重複したDailyがあります");
      found.set(source.date,source);
    }
    const days = [], missingDates = [], emptyDates = [], warnings = [];
    for (const date of dates) {
      const source = found.get(date);
      if (!source || source.missing) { missingDates.push(date); continue; }
      if (typeof source.markdown !== "string") throw new Error("DailyのTasksを確認できません");
      const parsed = core.parseTasks(source.markdown);
      const projects = parsed.projects.map(p=>({...p,tasks:p.tasks.filter(t=>!t.text.includes("テスト用・実績ではありません"))})).filter(p=>p.tasks.length);
      if (!projects.length) { emptyDates.push(date); continue; }
      const day = {date,projects}; days.push(day);
      if (projects.some(p=>p.tasks.some(t=>t.completion!=="checked"))) warnings.push(`${date}：完了印のない候補があります。実際に行った作業か確認してください。`);
    }
    const text = days.map(day=>`【${day.date}】\n`+day.projects.map(p=>`${p.name}\n`+p.tasks.map(t=>`・${t.text}`).join("\n")).join("\n\n")).join("\n\n");
    return {postingDate,start:dates[0],end:dates[6],dates,days,missingDates,emptyDates,warnings,text,reviewed:false,submit:false};
  }
  function formatWork(text, mode) { return mode === "single-line" ? text.replace(/\r?\n+/g," / ") : text; }
  root.WeeklyReportCore = {todayTokyo,datesBefore,readWeek,buildDraft,formatWork};
  if (typeof module !== "undefined" && module.exports) module.exports = root.WeeklyReportCore;
})(globalThis);
