"use strict";
(() => {
  const keyInput = document.getElementById("jevApiKey");
  const toggle = document.getElementById("jevEnabled");
  const status = document.getElementById("jevStatus");
  async function refresh() {
    const { jevApiKey, settings = {}, jevUsage = {} } = await chrome.storage.local.get(["jevApiKey", "settings", "jevUsage"]);
    toggle.checked = settings.jevEnabled === true;
    document.getElementById("jevMode").value = settings.jevMode || "primary";
    document.getElementById("jevKeyState").textContent = jevApiKey
      ? "キーは登録済みです。変更するときだけ入力してください。端末内に保存されます。"
      : "キーは未登録です。チャットには貼り付けず、この欄に入力してください。";
    const requests = jevUsage.requests || 0;
    const tokens = jevUsage.inputTokens || 0;
    document.getElementById("jevUsage").textContent = requests
      ? `${requests.toLocaleString()}回 · ${tokens.toLocaleString()}入力トークン · 推定 $${(tokens * 0.042 / 1000000).toFixed(6)}`
      : "まだ利用していません";
  }
  document.getElementById("jevForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { settings = {}, jevApiKey } = await chrome.storage.local.get(["settings", "jevApiKey"]);
      const entered = keyInput.value.trim();
      if (toggle.checked && !(entered || jevApiKey)) throw new Error("APIキーを入力してください");
      const updates = { settings: { ...settings, jevEnabled: toggle.checked, jevMode: document.getElementById("jevMode").value === "hybrid" ? "hybrid" : "primary" } };
      if (entered) updates.jevApiKey = entered;
      await chrome.storage.local.set(updates);
      keyInput.value = "";
      status.textContent = "AI設定を保存しました";
      await refresh();
    } catch (error) { status.textContent = error.message; }
  });
  document.getElementById("testJev").addEventListener("click", async (event) => {
    const button = event.target;
    button.disabled = true;
    status.textContent = "Jevとの接続とサンプル項目の判定を確認しています…";
    try {
      const result = await chrome.runtime.sendMessage({ type: "TEST_JEV" });
      if (result?.error) throw new Error(result.error);
      if (!result?.ok) throw new Error("接続確認に失敗しました");
      status.textContent = "接続できました。AI入力補助を使えます";
      await refresh();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.getElementById("clearJevKey").addEventListener("click", async () => {
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.remove("jevApiKey");
    await chrome.storage.local.set({ settings: { ...settings, jevEnabled: false } });
    keyInput.value = "";
    status.textContent = "APIキーを削除し、AI補助をオフにしました";
    await refresh();
  });
  document.getElementById("clearJevCache").addEventListener("click", async () => {
    await chrome.storage.local.remove("jevCache");
    status.textContent = "保存したAI判定を消去しました。次回の手動実行で再判定します";
  });
  refresh().catch(() => { status.textContent = "設定を読み込めませんでした"; });
})();
