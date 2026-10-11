(function (root) {
  "use strict";
  const PROFILE_KEY = "companyReportProfile";
  const DB_NAME = "known-info-report-sources", STORE_NAME = "handles", HANDLE_KEY = "company-daily";
  const REPORT_URL = "https://reports.example.test/productivity";
  const DEFAULTS = Object.freeze({ schemaVersion: 1, id: "company-report", name: "会社用",
    calendarId: "work@example.test", reportUrl: REPORT_URL, autoLoadDaily: true, weeklyReportUrl: "" });
  const DAILY_HINT = "Obsidian Vault 内の Daily フォルダ";
  function normalizeProfile(value = {}) {
    const name = String(value.name ?? DEFAULTS.name).trim();
    const calendarId = String(value.calendarId ?? DEFAULTS.calendarId).trim();
    if (!name || name.length > 80) throw new Error("会社用の設定名は1〜80文字で入力してください");
    if (calendarId.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(calendarId)) throw new Error("会社カレンダーのIDを確認してください");
    if (value.reportUrl !== undefined && value.reportUrl !== REPORT_URL) throw new Error("確認済みの日報URLだけを使います");
    return { ...DEFAULTS, name, calendarId, autoLoadDaily: value.autoLoadDaily !== false, weeklyReportUrl: normalizeWeeklyUrl(value.weeklyReportUrl || "") };
  }
  function normalizeWeeklyUrl(value) {
    if (!value) return "";
    let url; try { url = new URL(value); } catch (_error) { throw new Error("週報フォームのURLを確認してください"); }
    const pathname = url.pathname.replace(/^\/forms\/u\/\d+\//, "/forms/");
    if (url.origin !== "https://docs.google.com" || url.username || url.password || url.searchParams.has("edit2") || !/^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform$/.test(pathname))
      throw new Error("Googleフォームの回答画面（viewform）のURLだけを登録できます");
    return url.origin + pathname;
  }
  function validDirectory(handle) {
    if (!handle || handle.kind !== "directory" || handle.name !== "Daily") throw new Error("Vault全体やNoteではなく、Dailyフォルダを選んでください");
    return handle;
  }
  function createStore({ storage, indexedDB }) {
    async function handleRequest(operation, value) {
      if (!indexedDB) throw new Error("フォルダの参照を保存できません。Dailyファイルの取り込みを使ってください");
      return new Promise((resolve, reject) => {
        const opening = indexedDB.open(DB_NAME, 1);
        opening.onupgradeneeded = () => {
          const db = opening.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        opening.onerror = () => reject(new Error("Dailyフォルダの参照を開けません"));
        opening.onblocked = () => reject(new Error("Dailyの設定画面を閉じてからもう一度開いてください"));
        opening.onsuccess = () => {
          const db = opening.result;
          let transaction, result;
          try {
            transaction = db.transaction(STORE_NAME, operation === "get" ? "readonly" : "readwrite");
            const store = transaction.objectStore(STORE_NAME);
            const request = operation === "get" ? store.get(HANDLE_KEY) : operation === "put" ? store.put(value, HANDLE_KEY) : store.delete(HANDLE_KEY);
            request.onsuccess = () => { result = request.result; };
            transaction.oncomplete = () => { db.close(); resolve(result || null); };
            transaction.onerror = transaction.onabort = () => { db.close(); reject(new Error("Dailyフォルダの参照を保存・取得できません")); };
          } catch (_error) { db.close(); reject(new Error("Dailyフォルダの参照を保存・取得できません")); }
        };
      });
    }
    return {
      async loadProfile() {
        if (!storage) throw new Error("会社用設定は拡張機能の「日報の下書き」から開いてください");
        const data = await storage.get(PROFILE_KEY);
        const profile = normalizeProfile(data[PROFILE_KEY] || {});
        if (!data[PROFILE_KEY]) await storage.set({ [PROFILE_KEY]: profile });
        return profile;
      },
      async saveProfile(value, { updateWeeklyForm = false } = {}) {
        if (!storage) throw new Error("会社用設定を保存できません");
        const current = normalizeProfile((await storage.get(PROFILE_KEY))[PROFILE_KEY] || {});
        const profile = normalizeProfile({ ...current, ...value, weeklyReportUrl: updateWeeklyForm ? value.weeklyReportUrl : current.weeklyReportUrl });
        await storage.set({ [PROFILE_KEY]: profile });
        return profile;
      },
      async getDirectory() { const handle = await handleRequest("get"); return handle ? validDirectory(handle) : null; },
      async putDirectory(handle) { await handleRequest("put", validDirectory(handle)); return handle; },
      async forgetDirectory() { await handleRequest("delete"); }
    };
  }
  async function chooseDirectory(picker) {
    if (typeof picker !== "function") throw new Error("このブラウザではDailyフォルダを記憶できません。Dailyファイルを選ぶ方式を使ってください");
    // Called directly from a user's button click; never request write permission.
    return validDirectory(await picker({ id: "known-info-company-daily", mode: "read", startIn: "documents" }));
  }
  async function requestReadPermission(handle) {
    validDirectory(handle);
    if (typeof handle.requestPermission !== "function") throw new Error("読み取り許可を確認できません。Dailyフォルダを選び直してください");
    return handle.requestPermission({ mode: "read" });
  }
  function tasksMarkdown(parsed) {
    if (!parsed.projects.length) return "## Tasks\n";
    return "## Tasks\n\n" + parsed.projects.map(project => `### ${project.name}\n\n` +
      project.tasks.map(task => `- ${task.completion === "checked" ? "[x] " : ""}${task.text}`).join("\n")).join("\n\n") + "\n";
  }
  async function readDaily(handle, date, core) {
    validDirectory(handle);
    if (!core?.validDate(date)) throw new Error("Dailyの日付を確認してください");
    if (typeof handle.queryPermission !== "function" || await handle.queryPermission({ mode: "read" }) !== "granted") {
      const error = new Error("Dailyの読み取り許可が必要です。「読み取りを許可」を押してください"); error.permissionRequired = true; throw error;
    }
    try {
      // No enumeration, create:true, write APIs, Vault-root or Note access.
      const month = await handle.getDirectoryHandle(date.slice(0, 7));
      const fileHandle = await month.getFileHandle(`${date}.md`);
      const file = await fileHandle.getFile();
      if (file.name !== `${date}.md` || file.size > 1000000) throw new Error("Dailyの日付・ファイルサイズを確認してください（1MB以下）");
      const parsed = core.parseTasks(await file.text());
      return { date, notePath: `Daily/${date.slice(0, 7)}/${date}.md`, markdown: tasksMarkdown(parsed), warnings: parsed.warnings };
    } catch (error) {
      if (error.name === "NotFoundError") { const missing = new Error(`${date} のDailyがありません。作業内容を推測せず、空欄のままにします`); missing.missingDaily = true; throw missing; }
      if (["NotAllowedError", "SecurityError"].includes(error.name)) {
        const denied = new Error("Dailyを読み取れません。読み取りを許可するか、フォルダを選び直してください"); denied.permissionRequired = true; throw denied;
      }
      throw error;
    }
  }
  root.DailyReportCompany = { PROFILE_KEY, DEFAULTS, DAILY_HINT, normalizeProfile, normalizeWeeklyUrl, validDirectory,
    createStore, chooseDirectory, requestReadPermission, tasksMarkdown, readDaily };
  if (typeof module !== "undefined" && module.exports) module.exports = root.DailyReportCompany;
})(globalThis);
