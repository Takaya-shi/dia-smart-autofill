(function (root) {
  "use strict";
  // Self-contained so Chrome can serialize this function into its isolated world.
  async function run(request) {
    const supported = location.origin === "https://reports.example.test" && location.pathname === "/productivity";
    const fixture = request.allowFixture === true && location.origin === "http://127.0.0.1:8766" && location.pathname === "/demo/report-form.html";
    if (!supported && !fixture) throw new Error("確認済みの日報画面以外には入力しません");
    const visible = el => el?.isConnected && !el.disabled && !el.readOnly && !el.closest('[aria-hidden="true"]') && el.getClientRects().length > 0;
    const label = el => Array.from(el.labels || []).map(node => node.textContent.replace(/\s*\*\s*$/, "").trim()).join(" ") || el.getAttribute("aria-label") || "";
    const single = items => { if (items.length !== 1) throw new Error("入力欄の構造が変わっています。入力を中止しました"); return items[0]; };
    function inspect() {
      const dialog = single(Array.from(document.querySelectorAll('[role="dialog"]')).filter(node => visible(node) && Array.from(node.querySelectorAll("h1,h2,h3,h4,h5,h6")).some(h => h.textContent.trim() === "実績を登録")));
      const fields = Array.from(dialog.querySelectorAll("input,textarea")).filter(visible);
      const named = name => single(fields.filter(el => label(el) === name));
      const date = named("日付"), start = named("業務開始時刻"), end = named("業務終了時刻");
      if (date.type !== "date" || start.type !== "time" || end.type !== "time") throw new Error("日付・時刻の入力欄が確認できません");
      const hours = fields.filter(el => el.type === "number" && label(el) === "時間");
      if (!hours.length || hours.length > 20) throw new Error("先に案件を追加・選択してください（最大20件）");
      const rows = hours.map((hour, index) => {
        let container = hour.parentElement;
        while (container && container !== dialog) {
          const inputs = Array.from(container.querySelectorAll("input,textarea")).filter(visible);
          const combos = inputs.filter(el => el.getAttribute("role") === "combobox" && label(el) === "案件");
          const notes = inputs.filter(el => label(el) === "この案件で今日やったこと");
          if (combos.length === 1 && notes.length === 1 && inputs.filter(el => el.type === "number" && label(el) === "時間").length === 1) {
            if (notes[0].tagName !== "TEXTAREA" || !combos[0].value.trim()) throw new Error("案件の選択と詳細入力欄の表示を確認してください");
            return { key: `row-${index}`, name: combos[0].value.trim(), hour, note: notes[0] };
          }
          container = container.parentElement;
        }
        throw new Error("案件行を特定できません。詳細入力欄を開いてください");
      });
      if (new Set(rows.map(row => row.name)).size !== rows.length) throw new Error("同じ名前の案件があるため安全に区別できません");
      const snapshot = { date: date.value, start: start.value, end: end.value,
        rows: rows.map(row => ({ key: row.key, name: row.name.slice(0, 200), hoursEmpty: row.hour.value === "", noteEmpty: row.note.value === "" })) };
      return { dialog, date, start, end, rows, snapshot, fingerprint: JSON.stringify(snapshot) };
    }
    const state = inspect();
    if (request.operation === "inspect") return { ...state.snapshot, fingerprint: state.fingerprint };
    if (request.operation !== "fill") throw new Error("未対応の操作です");
    const plan = request.plan;
    if (!plan || plan.submit !== false || plan.reviewed !== true || plan.fingerprint !== state.fingerprint || plan.date !== state.snapshot.date) throw new Error("入力先や日付が変わったか、下書きが未確認です。再確認してください");
    if (state.snapshot.start || state.snapshot.end || state.snapshot.rows.some(row => !row.hoursEmpty || !row.noteEmpty)) throw new Error("既存の入力があるため上書きしません");
    const timeMinutes = text => /^([01]\d|2[0-3]):[0-5]\d$/.test(text || "") ? Number(text.slice(0, 2)) * 60 + Number(text.slice(3)) : NaN;
    const span = timeMinutes(plan.end) - timeMinutes(plan.start);
    if (!Number.isFinite(span) || span <= 0 || !Number.isInteger(plan.breakMinutes) || plan.breakMinutes < 0 || plan.breakMinutes >= span) throw new Error("実績時間・休憩が正しくありません");
    if (!Array.isArray(plan.rows) || plan.rows.length !== state.rows.length || new Set(plan.rows.map(row => row.key)).size !== plan.rows.length) throw new Error("案件の対応が変わっています");
    const writes = [{ target: "start", value: plan.start }, { target: "end", value: plan.end }];
    for (const row of state.rows) {
      const entry = plan.rows.find(entry => entry.key === row.key && entry.name === row.name);
      if (!entry || !Number.isInteger(entry.minutes) || entry.minutes <= 0 || entry.minutes > 1440 || typeof entry.notes !== "string" || !entry.notes.trim() || entry.notes.length > 10000) throw new Error("案件の時間・作業内容が未確認です");
      // The inspected UI offers half-hour steps. Never round silently.
      if (entry.minutes % 30) throw new Error("日報の時間欄に合わせ、案件別時間は30分単位で確認してください");
      writes.push({ key: row.key, target: "hour", value: String(entry.minutes / 60) }, { key: row.key, target: "note", value: entry.notes });
    }
    if (plan.rows.reduce((sum, row) => sum + row.minutes, 0) !== span - plan.breakMinutes) throw new Error("案件別時間の合計が実働時間と一致しません");
    let written = 0;
    const expected = new Map();
    function verifyCurrent(current) {
      if (current.snapshot.date !== plan.date || current.rows.length !== state.rows.length || current.rows.some((row, i) => row.name !== state.rows[i].name)) throw new Error("入力途中に画面が変わりました。保存せず内容を確認してください");
      for (const write of writes) {
        const el = write.key ? current.rows.find(row => row.key === write.key)?.[write.target] : current[write.target];
        const key = `${write.key || ""}:${write.target}`;
        if (!el || el.value !== (expected.get(key) || "")) throw new Error("入力途中に値が変わりました。保存せず内容を確認してください");
      }
    }
    for (const write of writes) {
      const current = inspect();
      verifyCurrent(current);
      const el = write.key ? current.rows.find(row => row.key === write.key)[write.target] : current[write.target];
      const prototype = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, write.value);
      expected.set(`${write.key || ""}:${write.target}`, write.value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      written++;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    verifyCurrent(inspect());
    // No buttons, submit(), requestSubmit(), backend calls, or keyboard events.
    return { written, submitted: false, message: "空欄へ入力しました。保存・送信はしていません。" };
  }
  root.DailyReportAdapter = { run };
  if (typeof module !== "undefined" && module.exports) module.exports = root.DailyReportAdapter;
})(globalThis);
