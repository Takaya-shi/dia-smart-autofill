(function (root) {
  "use strict";
  const SHIFT_TITLES = ["シフト_出社", "シフト_リモート"];
  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
      Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  }
  function cleanText(text) {
    return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => label || target)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*`]/g, "")
      .replace(/(?:^|\s)#[\w\p{L}/-]+/gu, "").replace(/\s+/g, " ").trim();
  }
  function parseTasks(markdown) {
    const groups = [];
    let section = false, fenced = false, current = null;
    const warnings = [];
    const lines = String(markdown || "").split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
      if (/^#\s+/.test(line)) { section = false; current = null; continue; }
      if (/^##\s+/.test(line)) {
        section = /^##\s+(?:Tasks|TASK|やったこと)\s*$/i.test(line);
        current = null;
        continue;
      }
      if (!section || !line.trim()) continue;
      const item = line.match(/^\s*[-*+]\s+(?:\[([^\]])\]\s*)?(.+)$/);
      if (item) {
        const [, check, text] = item;
        if (check !== undefined && !/[xX]/.test(check)) continue;
        if (/(?:^|\s)#(?:private|study|university|freelance)(?:\b|\/)/.test(text)) continue;
        const clean = cleanText(text);
        if (!clean) continue;
        if (!current) {
          current = { name: "未分類", tasks: [] };
          groups.push(current);
          warnings.push("案件名がないタスクがあります。案件を確認してください。");
        }
        current.tasks.push({ text: clean, line: index + 1,
          completion: /[xX]/.test(check || "") ? "checked" : "unconfirmed" });
      } else {
        // Plain lines or third-level headings are project labels, never work facts.
        const name = cleanText(line.replace(/^###\s+/, ""));
        if (!name || (/^#/.test(line) && !/^###\s+/.test(line)) || /^>/.test(line)) continue;
        current = { name, tasks: [] };
        groups.push(current);
      }
    }
    const projects = groups.filter(group => group.tasks.length);
    if (projects.some(group => group.tasks.some(task => task.completion === "unconfirmed")))
      warnings.push("箇条書きには完了印がありません。実際に行った作業か確認してください。");
    if (!projects.length) warnings.push("Tasksに日報候補がありません。Notesや未完了タスクから実績を推測しません。");
    return { projects, warnings };
  }
  function zonedTime(value) {
    if (typeof value !== "string" || !/T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(time)).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, timestamp: time };
  }
  function findShifts(events, date) {
    if (!validDate(date)) throw new Error("日付が正しくありません");
    const seen = new Set(), shifts = [], warnings = [];
    for (const event of events || []) {
      if (!SHIFT_TITLES.includes(event.summary) || event.status === "cancelled" || event.my_response_status === "declined") continue;
      const key = event.id ? `${event.calendarId || ""}:${event.id}` : JSON.stringify([event.summary, event.start, event.end]);
      if (seen.has(key)) continue;
      seen.add(key);
      const start = zonedTime(event.start?.dateTime || event.start);
      const end = zonedTime(event.end?.dateTime || event.end);
      if (!start || !end || end.timestamp <= start.timestamp) continue;
      if (start.date !== date) continue;
      if (end.date !== date) { warnings.push("日付をまたぐ勤務予定は自動採用しません。"); continue; }
      shifts.push({ eventId: event.id || null, title: event.summary, start: start.time, end: end.time,
        spanMinutes: (end.timestamp - start.timestamp) / 60000, source: "calendar-schedule", confirmedActual: false });
    }
    if (!shifts.length) warnings.push("この日の勤務シフトを取得できませんでした。会議やブロックを勤務時間に置き換えません。");
    if (shifts.length > 1) warnings.push("勤務シフトが複数あります。候補を確認してください。");
    return { candidates: shifts, warnings };
  }
  function buildDraft({ date, markdown, events, notePath = "", calendarSource = "", fetchedAt = null }) {
    if (!validDate(date)) throw new Error("日付が正しくありません");
    const tasks = parseTasks(markdown);
    const shifts = findShifts(events, date);
    const nextDates = (events || []).filter(event => SHIFT_TITLES.includes(event.summary) && event.status !== "cancelled" && event.my_response_status !== "declined")
      .map(event => zonedTime(event.start?.dateTime || event.start)?.date).filter(value => value && value > date).sort();
    return { schemaVersion: 1, date, notePath, calendarSource, fetchedAt,
      projects: tasks.projects.map((project, index) => ({ id: `project-${index}`, sourceName: project.name,
        tasks: project.tasks, notes: project.tasks.map(task => `・${task.text}`).join("\n"),
        portalProjectId: null, minutes: null, confirmedTasks: false })),
      shiftCandidates: shifts.candidates, selectedShift: shifts.candidates.length === 1 ? shifts.candidates[0] : null,
      confirmedWorkTime: false, breakMinutes: null, nextWorkDate: nextDates[0] || null,
      optional: { good: "", bad: "", nextGoals: "", remarks: "" },
      warnings: [...tasks.warnings, ...shifts.warnings,
        "カレンダーは勤務予定です。実績時間・休憩時間・案件別の時間は本人確認が必要です。"],
      submit: false };
  }
  function validateReady(draft) {
    const errors = [];
    if (draft?.submit !== false) errors.push("保存・送信しない下書きだけを扱います");
    if (!validDate(draft?.date)) errors.push("日付を確認してください");
    if (!draft?.confirmedWorkTime) errors.push("業務開始・終了を実績として確認してください");
    const shift = draft?.selectedShift;
    const start = shift?.start?.match(/^(\d{2}):(\d{2})$/);
    const end = shift?.end?.match(/^(\d{2}):(\d{2})$/);
    const minute = match => match && Number(match[1]) <= 23 && Number(match[2]) <= 59 ? Number(match[1]) * 60 + Number(match[2]) : NaN;
    const span = minute(end) - minute(start);
    if (!Number.isFinite(span) || span <= 0) errors.push("業務時間が正しくありません");
    if (!Number.isInteger(draft?.breakMinutes) || draft.breakMinutes < 0 || draft.breakMinutes >= span) errors.push("休憩時間を確認してください");
    if (!Array.isArray(draft?.projects) || !draft.projects.length) errors.push("案件が1件以上必要です");
    const assigned = new Set();
    for (const project of draft?.projects || []) {
      if (!project.portalProjectId || assigned.has(project.portalProjectId)) errors.push("案件の選択が未確定か重複しています");
      assigned.add(project.portalProjectId);
      if (!project.confirmedTasks || !project.notes?.trim()) errors.push("今日行った作業を案件ごとに確認してください");
      if (!Number.isInteger(project.minutes) || project.minutes <= 0) errors.push("案件別の作業時間を入力してください");
      if (project.minutes > 1440) errors.push("案件別の時間が24時間を超えています");
    }
    const total = (draft?.projects || []).reduce((sum, project) => sum + (Number.isInteger(project.minutes) ? project.minutes : 0), 0);
    if (Number.isFinite(span) && Number.isInteger(draft?.breakMinutes) && total !== span - draft.breakMinutes)
      errors.push("案件別の時間合計が業務時間から休憩を引いた時間と一致しません");
    return { ready: errors.length === 0, errors: [...new Set(errors)], totalMinutes: total };
  }
  root.DailyReportCore = { validDate, parseTasks, zonedTime, findShifts, buildDraft, validateReady };
  if (typeof module !== "undefined" && module.exports) module.exports = root.DailyReportCore;
})(globalThis);
