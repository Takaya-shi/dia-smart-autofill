(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const demo = location.origin === "http://127.0.0.1:8766" && params.get("demo") === "1";
  const tabId = Number(params.get("tab"));
  let events = [], metadata = {}, draft = null, target = null, generation = 0, consumed = false;
  let companyProfile = null, dailyDirectory = null, companyStore = null, companyReadBusy = 0;
  const controls = new Map();
  $("reportDate").value = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
  if (demo) {
    $("demoData").hidden = false; $("fixturePanel").hidden = false; $("fixture").src = "demo/report-form.html";
    $("confirmDestination").parentElement.lastChild.textContent = "架空の作業内容と時間を、ローカルの検証用フォームへ入力することを確認した";
  }
  function invalidate() {
    generation++; target = null; draft = null; consumed = false; controls.clear();
    $("confirmDestination").checked = false;
    $("fillReport").disabled = true;
    $("reviewPanel").hidden = true; $("targetPanel").hidden = true;
  }
  $("reportDate").addEventListener("change", () => {
    events = []; metadata = {}; $("markdown").value = ""; $("dailyFile").value = ""; $("sourcesFile").value = "";
    invalidate(); $("sourceStatus").textContent = "日付を変更しました。前の日の内容は使いません。その日のDaily・カレンダーを取り込み直してください。";
    if (companyProfile?.autoLoadDaily && dailyDirectory) void readCompanyDaily();
  });
  $("markdown").addEventListener("input", invalidate);
  async function loadFile(input, handler) {
    invalidate(); const stamp = generation;
    try {
      const file = input.files[0]; if (!file) return;
      if (file.size > 1000000) throw new Error("1MB以下のファイルを選んでください");
      const text = await file.text(); if (stamp !== generation) return;
      handler(file, text);
    } catch (error) { $("sourceStatus").textContent = error.message; }
  }
  $("dailyFile").addEventListener("change", () => loadFile($("dailyFile"), (file, text) => {
    if (file.name !== `${$("reportDate").value}.md`) throw new Error("選んだDailyの日付と対象日が一致していません");
    $("markdown").value = text; metadata.notePath = file.name; $("sourceStatus").textContent = `${file.name} を端末内に取り込みました。Tasksだけを使います。`;
  }));
  $("sourcesFile").addEventListener("change", () => {
    events = []; metadata = {};
    return loadFile($("sourcesFile"), (_file, text) => {
      const data = JSON.parse(text);
      if (data.date !== $("reportDate").value || !Array.isArray(data.events) || data.events.length > 500 || data.next_page_token || data.nextPageToken) throw new Error("日付・イベント数・ページ取得が確認できないJSONです");
      events = data.events; metadata = { notePath: data.notePath || "", calendarSource: data.calendarSource || "取り込みデータ", fetchedAt: data.fetchedAt || null };
      if (typeof data.markdown === "string") $("markdown").value = data.markdown;
      $("sourceStatus").textContent = `カレンダー候補を取り込みました（${data.fetchedAt || "取得日時不明"}）。取得済みデータであり継続同期ではありません。`;
    });
  });
  $("demoData").addEventListener("click", () => {
    invalidate(); $("reportDate").value = "2026-10-08";
    $("markdown").value = "## Tasks\n社内サンプル\n- 資料の更新\n- 画面の確認\n検証サンプル\n- テストケース作成\n## Notes\nこれは実績に含めない";
    events = [{ id:"demo-shift", summary:"シフト_リモート", start:"2026-10-08T10:00:00+09:00", end:"2026-10-08T18:00:00+09:00" }];
    metadata = { notePath:"架空Daily", calendarSource:"架空シフト", fetchedAt:null };
    $("sourceStatus").textContent = "架空のデータです。会社・Vault・Googleへは送信しません。";
  });
  function field(parent, title, type, value) {
    const label = document.createElement("label"), el = document.createElement(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
    label.append(document.createTextNode(title)); if (el.tagName === "INPUT") el.type = type;
    el.value = value || ""; label.append(el); parent.append(label); return el;
  }
  function showProjects() {
    $("projects").replaceChildren(); controls.clear();
    for (const project of draft.projects) {
      const group = document.createElement("article"); group.className = "report-project";
      const heading = document.createElement("h3"); heading.textContent = project.sourceName; group.append(heading);
      const includeLabel = document.createElement("label"); includeLabel.className = "check";
      const included = document.createElement("input"); included.type = "checkbox"; included.checked = project.include !== false;
      includeLabel.append(included, document.createTextNode("この作業候補を日報に含める")); group.append(includeLabel);
      const grid = document.createElement("div"); grid.className = "form-grid"; group.append(grid);
      const mapping = field(grid, "日報側で選択した案件", "select", "");
      const minutes = field(grid, "この案件の実働時間（分・30分単位）", "number", ""); minutes.min = "30"; minutes.step = "30";
      const notes = field(group, "この案件で今日やったこと", "textarea", project.notes); notes.rows = 3;
      const check = document.createElement("label"); check.className = "check";
      const confirmed = document.createElement("input"); confirmed.type = "checkbox";
      check.append(confirmed, document.createTextNode("この内容を実際に行ったことを確認した")); group.append(check);
      notes.addEventListener("input", () => { confirmed.checked = false; update(); });
      for (const el of [mapping, minutes, confirmed, included]) el.addEventListener("change", update);
      minutes.addEventListener("input", update);
      controls.set(project.id, { mapping, minutes, notes, confirmed, included }); $("projects").append(group);
    }
    populateMappings();
  }
  function populateMappings() {
    for (const control of controls.values()) {
      const saved = control.mapping.value; control.mapping.replaceChildren();
      const empty = document.createElement("option"); empty.value = ""; empty.textContent = "入力先を読み取り、本人が選択"; control.mapping.append(empty);
      for (const row of target?.rows || []) { const option = document.createElement("option"); option.value = row.key; option.textContent = row.name; control.mapping.append(option); }
      if (target?.rows.some(row => row.key === saved)) control.mapping.value = saved;
    }
  }
  $("buildDraft").addEventListener("click", () => {
    try {
      draft = DailyReportCore.buildDraft({ date:$("reportDate").value, markdown:$("markdown").value, events, ...metadata });
      target = null; consumed = false; $("confirmWork").checked = false; $("confirmDestination").checked = false;
      $("workStart").value = draft.selectedShift?.start || ""; $("workEnd").value = draft.selectedShift?.end || ""; $("breakMinutes").value = "";
      $("shiftSelect").replaceChildren();
      const none = document.createElement("option"); none.value = ""; none.textContent = "手入力・未確認"; $("shiftSelect").append(none);
      draft.shiftCandidates.forEach((shift, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = `${shift.start}〜${shift.end} ${shift.title}（予定）`; $("shiftSelect").append(option); });
      if (draft.selectedShift) $("shiftSelect").value = "0";
      $("warnings").replaceChildren(); for (const warning of draft.warnings) { const li = document.createElement("li"); li.textContent = warning; $("warnings").append(li); }
      $("nextWork").textContent = draft.nextWorkDate ? `次回勤務予定の候補：${draft.nextWorkDate}（任意項目には自動入力しません）` : "次回勤務日は未確認です。";
      $("targetStatus").textContent = "入力先はまだ確認していません。";
      $("fillStatus").textContent = ""; $("reviewPanel").hidden = false; $("targetPanel").hidden = false;
      showProjects(); update();
    } catch (error) { $("sourceStatus").textContent = error.message; }
  });
  $("addDraftProject").addEventListener("click", () => {
    if (!draft || draft.projects.length >= 20) return;
    draft.projects.push({ id:`manual-${draft.projects.length}`, sourceName:"本人記入の作業", notes:"", tasks:[], portalProjectId:null, minutes:null, confirmedTasks:false });
    // Preserve reviewed entries when a manual row is added.
    readControls(); const saved = draft.projects.map(p => ({...p})); showProjects();
    saved.forEach(p => { const c = controls.get(p.id); c.mapping.value = p.portalProjectId || ""; c.minutes.value = p.minutes ?? ""; c.notes.value = p.notes; c.confirmed.checked = p.confirmedTasks; }); update();
  });
  function readControls() {
    if (!draft) return;
    draft.selectedShift = { start:$("workStart").value, end:$("workEnd").value };
    draft.breakMinutes = $("breakMinutes").value === "" ? null : Number($("breakMinutes").value);
    draft.confirmedWorkTime = $("confirmWork").checked;
    for (const project of draft.projects) { const c = controls.get(project.id); if (!c) continue;
      project.portalProjectId = c.mapping.value || null; project.minutes = c.minutes.value === "" ? null : Number(c.minutes.value); project.notes = c.notes.value; project.confirmedTasks = c.confirmed.checked; project.include = c.included.checked;
    }
  }
  function prepare() {
    readControls(); const includedProjects = draft.projects.filter(p => p.include !== false);
    const check = DailyReportCore.validateReady({...draft,projects:includedProjects}); const errors = [...check.errors];
    if (!target || target.date !== draft.date) errors.push("日付が一致する入力先を確認してください");
    if (target && (target.start || target.end || target.rows.some(row => !row.hoursEmpty || !row.noteEmpty))) errors.push("入力先に既存の値があるため上書きしません");
    if (target?.rows.length !== includedProjects.length) errors.push("下書きの案件数と日報の案件数を一致させてください");
    if (includedProjects.some(p => p.minutes !== null && p.minutes % 30)) errors.push("案件別時間は30分単位で確認してください（自動で丸めません）");
    const rows = includedProjects.map(p => ({ key:p.portalProjectId, name:target?.rows.find(row => row.key === p.portalProjectId)?.name || "未選択", minutes:p.minutes, notes:p.notes }));
    return { errors:[...new Set(errors)], plan:{ date:draft.date, start:draft.selectedShift.start, end:draft.selectedShift.end, breakMinutes:draft.breakMinutes,
      rows, fingerprint:target?.fingerprint, reviewed:true, submit:false } };
  }
  function update() {
    if (!draft) return; $("confirmDestination").checked = false; refresh();
  }
  function refresh() {
    if (!draft) return;
    if (consumed) { $("validation").textContent = "入力済みです。保存・送信はしていません。再入力せず、日報画面の内容を確認してください。"; $("fillReport").disabled = true; return; }
    const {errors,plan} = prepare();
    $("validation").textContent = errors.length ? errors.join("。") : "内容と入力先を確認できました。保存・送信せずに空欄だけ入力できます。";
    $("preview").textContent = `${plan.date} ${plan.start || "未確認"}〜${plan.end || "未確認"} / 休憩 ${plan.breakMinutes ?? "未確認"}分\n\n` + plan.rows.map(row => `${row.name} · ${row.minutes ?? "未確認"}分\n${row.notes}`).join("\n\n");
    $("fillReport").disabled = Boolean(errors.length) || !$("confirmDestination").checked;
  }
  for (const id of ["workStart","workEnd","breakMinutes"]) $(id).addEventListener("input", () => { $("confirmWork").checked = false; update(); });
  $("confirmWork").addEventListener("change", update); $("confirmDestination").addEventListener("change", refresh);
  $("shiftSelect").addEventListener("change", () => { const shift = draft?.shiftCandidates[$("shiftSelect").value]; if (shift) { $("workStart").value = shift.start; $("workEnd").value = shift.end; } $("confirmWork").checked = false; update(); });
  async function operate(operation, plan) {
    if (demo) return $("fixture").contentWindow.DailyReportAdapter.run({operation,plan,allowFixture:true});
    if (!globalThis.chrome?.scripting || !Number.isSafeInteger(tabId) || tabId <= 0) throw new Error("日報画面を開いた状態で、拡張機能の「日報の下書き」から開いてください");
    await chrome.scripting.executeScript({ target:{tabId,frameIds:[0]}, files:["daily-report-adapter.js"] });
    const results = await chrome.scripting.executeScript({ target:{tabId,frameIds:[0]}, func:async request => {
      try { return await globalThis.DailyReportAdapter.run(request); }
      catch (error) { return {error:error?.message || "日報入力を中止しました"}; }
    }, args:[{operation,plan}] });
    if (results.length !== 1 || !results[0].result) throw new Error("入力先の確認に失敗しました");
    if (results[0].result.error) throw new Error(results[0].result.error);
    return results[0].result;
  }
  $("inspectTarget").addEventListener("click", async () => {
    target = null; consumed = false; update(); const stamp = generation; $("inspectTarget").disabled = true;
    try { const result = await operate("inspect"); if (stamp !== generation || !draft) return; target = result;
      $("targetStatus").textContent = `${target.date} / ${target.rows.length}案件を読み取りました。案件の対応を選んでください。`;
      populateMappings(); update();
    } catch (error) { $("targetStatus").textContent = error.message; }
    finally { $("inspectTarget").disabled = false; }
  });
  $("fillReport").addEventListener("click", async () => {
    const {errors,plan} = prepare(); if (errors.length || !$("confirmDestination").checked) return;
    $("fillReport").disabled = true;
    try { const result = await operate("fill",plan); consumed = true; $("fillStatus").textContent = `${result.written}欄を入力しました。保存・送信はしていません。${demo ? "架空フォーム" : "日報画面"}で内容を確認してください。`; }
    catch (error) { $("fillStatus").textContent = `入力を中止しました：${error.message}。保存せず、画面の内容を確認してください。`; target = null; }
    finally { $("confirmDestination").checked = false; refresh(); }
  });
  function companyButtons() {
    const busy = Boolean(companyReadBusy);
    $("loadCompanyDaily").disabled = !dailyDirectory || busy;
    $("permitCompanyDaily").disabled = !dailyDirectory || busy;
    $("chooseDailyDirectory").disabled = !companyStore || busy;
    $("forgetDailyDirectory").disabled = !dailyDirectory || busy;
    $("forgetDailyDirectory").hidden = !dailyDirectory;
  }
  async function readCompanyDaily() {
    if (!dailyDirectory || !companyStore) return;
    // Invalidate every pending source read, and never keep another date's Tasks or Calendar.
    invalidate(); const stamp = generation, date = $("reportDate").value, handle = dailyDirectory;
    events = []; metadata = {}; $("markdown").value = ""; $("dailyFile").value = ""; $("sourcesFile").value = "";
    companyReadBusy++; companyButtons();
    $("sourceStatus").textContent = `${date} のTasksを端末内で読み取っています。`;
    try {
      const source = await DailyReportCompany.readDaily(handle, date, DailyReportCore);
      if (stamp !== generation || handle !== dailyDirectory || date !== $("reportDate").value) return;
      $("markdown").value = source.markdown; metadata = { notePath:source.notePath };
      $("permitCompanyDaily").hidden = true;
      $("companyDailyStatus").textContent = `Dailyフォルダ：登録済み / ${source.notePath} を読み取りました。Notesは取り込みません。`;
      $("sourceStatus").textContent = `${source.notePath} のTasksを端末内に取り込みました。カレンダーの継続取得は未接続です。`;
      // Local preview only. No confirmations, project mapping, time allocation or portal writes.
      $("buildDraft").click();
    } catch (error) {
      if (stamp !== generation || handle !== dailyDirectory) return;
      $("companyDailyStatus").textContent = error.message;
      $("sourceStatus").textContent = error.message;
      $("permitCompanyDaily").hidden = !error.permissionRequired;
    } finally { companyReadBusy--; companyButtons(); }
  }
  async function setupCompany() {
    // This persistent profile is extension-owned, separate from ordinary profile/card/AI data.
    let trusted = false;
    try { const owned = new URL(chrome.runtime.getURL("daily-report.html")); trusted = location.protocol === owned.protocol && location.host === owned.host && location.pathname === owned.pathname; } catch (_error) {}
    if (!trusted || !globalThis.chrome?.storage?.local) { $("companyPanel").hidden = true; return; }
    $("saveCompanyProfile").disabled = true; $("chooseDailyDirectory").disabled = true;
    $("dailyPathHint").textContent = DailyReportCompany.DAILY_HINT;
    companyStore = DailyReportCompany.createStore({ storage:chrome.storage.local, indexedDB:globalThis.indexedDB });
    const startup = generation;
    try {
      companyProfile = await companyStore.loadProfile();
      $("companyProfileName").value = companyProfile.name; $("companyName").textContent = companyProfile.name;
      $("companyCalendarId").value = companyProfile.calendarId; $("autoLoadDaily").checked = companyProfile.autoLoadDaily;
      $("companyStatus").textContent = "会社用設定：端末内に記憶済み。個人用プロフィール・カード・APIキーは変更しません。";
      try { dailyDirectory = await companyStore.getDirectory(); }
      catch (error) { $("companyDailyStatus").textContent = error.message; }
      if (dailyDirectory) $("companyDailyStatus").textContent = "Dailyフォルダ：登録済み。読み取り許可を確認します。";
      if (typeof globalThis.showDirectoryPicker !== "function") $("companyDailyStatus").textContent = "このブラウザではフォルダの登録が使えません。下のDailyファイル取り込みを利用してください。";
      $("saveCompanyProfile").disabled = false; companyButtons();
      if (companyProfile.autoLoadDaily && dailyDirectory && startup === generation && !$("markdown").value.trim()) await readCompanyDaily();
    } catch (error) { companyStore = null; $("companyStatus").textContent = error.message; companyButtons(); }
  }
  $("saveCompanyProfile").addEventListener("click", async () => {
    if (!companyStore) return;
    $("saveCompanyProfile").disabled = true;
    try {
      const candidate = DailyReportCompany.normalizeProfile({ name:$("companyProfileName").value, calendarId:$("companyCalendarId").value, autoLoadDaily:$("autoLoadDaily").checked });
      invalidate(); events = []; metadata = {};
      companyProfile = await companyStore.saveProfile(candidate); $("companyName").textContent = companyProfile.name;
      $("companyStatus").textContent = "会社用設定を端末内に記憶しました。会社の日報を保存したわけではありません。カレンダーは未接続です。";
    } catch (error) { $("companyStatus").textContent = error.message; }
    finally { $("saveCompanyProfile").disabled = false; }
  });
  $("chooseDailyDirectory").addEventListener("click", async () => {
    if (!companyStore || companyReadBusy) return;
    invalidate(); const stamp = generation;
    companyReadBusy++; companyButtons();
    try {
      const selected = await DailyReportCompany.chooseDirectory(typeof globalThis.showDirectoryPicker === "function" ? options => globalThis.showDirectoryPicker(options) : null);
      await companyStore.putDirectory(selected); dailyDirectory = selected;
      $("companyDailyStatus").textContent = "Dailyフォルダを端末内に登録しました。読み取り専用です。";
      $("permitCompanyDaily").hidden = true;
      if (stamp === generation) await readCompanyDaily();
    } catch (error) { $("companyDailyStatus").textContent = error.name === "AbortError" ? "フォルダ選択をキャンセルしました。登録済みのフォルダは変更していません。" : error.message; }
    finally { companyReadBusy--; companyButtons(); }
  });
  $("loadCompanyDaily").addEventListener("click", () => { if (!companyReadBusy) void readCompanyDaily(); });
  $("permitCompanyDaily").addEventListener("click", async () => {
    if (!dailyDirectory || companyReadBusy) return;
    const handle = dailyDirectory, stamp = generation; companyReadBusy++; companyButtons();
    try {
      // Call immediately while the user's click is active; never auto-request permission.
      const permission = await DailyReportCompany.requestReadPermission(handle);
      if (handle !== dailyDirectory || stamp !== generation) return;
      if (permission !== "granted") throw new Error("読み取りは許可されませんでした。Dailyは読み込まず、日報も変更しません。");
      await readCompanyDaily();
    } catch (error) { $("companyDailyStatus").textContent = error.message; }
    finally { companyReadBusy--; companyButtons(); }
  });
  $("forgetDailyDirectory").addEventListener("click", async () => {
    if (!companyStore || companyReadBusy) return;
    companyReadBusy++; invalidate(); companyButtons();
    try {
      await companyStore.forgetDirectory(); dailyDirectory = null; $("permitCompanyDaily").hidden = true;
      $("markdown").value = ""; events = []; metadata = {};
      $("companyDailyStatus").textContent = "拡張側のフォルダ登録を解除しました。Dailyファイルは削除・変更していません。ブラウザの許可自体は自動解除しません。";
      $("sourceStatus").textContent = "Dailyフォルダ：未登録。取り込んだ下書きはクリアしました。";
    } catch (error) { $("companyDailyStatus").textContent = error.message; }
    finally { companyReadBusy--; companyButtons(); }
  });
  void setupCompany();
})();
