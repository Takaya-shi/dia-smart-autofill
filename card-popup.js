"use strict";
(() => {
  const form = document.getElementById("unlockCardForm");
  const status = document.getElementById("cardFillStatus");
  const panel = document.getElementById("cardConfirmPanel");
  let unlocked = null;
  let target = null;
  let timer = null;
  function lock() {
    clearTimeout(timer);
    unlocked = null; target = null; panel.hidden = true;
    document.getElementById("cardPreview").textContent = "";
    document.getElementById("cardDestination").textContent = "";
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    lock();
    const button = document.getElementById("unlockCard");
    button.disabled = true;
    try {
      const { cardVault } = await chrome.storage.local.get("cardVault");
      if (!cardVault) throw new Error("設定画面でカードを登録してください");
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = new URL(tab?.url || "");
      if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
        throw new Error("カード入力はHTTPSのページで使えます");
      }
      unlocked = CardVault.validateCard(await CardVault.decrypt(cardVault, form.elements.unlockPassword.value));
      target = { id: tab.id, url: tab.url };
      document.getElementById("cardDestination").textContent = url.origin;
      document.getElementById("cardPreview").textContent = `末尾 ${unlocked.number.slice(-4)} · ${unlocked.name} · ${unlocked.month}/${unlocked.year}`;
      panel.hidden = false;
      timer = setTimeout(() => { lock(); status.textContent = "カードをロックしました。再度解除してください"; }, 60000);
      status.textContent = "入力先を確認してから実行してください";
    } catch (error) { lock(); status.textContent = error.message; }
    finally { form.elements.unlockPassword.value = ""; button.disabled = false; }
  });
  document.getElementById("confirmCardFill").addEventListener("click", async (event) => {
    if (!unlocked || !target) return;
    event.target.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== target.id || tab.url !== target.url) throw new Error("対象ページが変わりました。もう一度確認してください");
      const results = await chrome.scripting.executeScript({ target: { tabId: target.id, frameIds: [0] },
        func: fillConfirmedCard, args: [unlocked, target.url] });
      const result = results[0]?.result;
      if (result?.error) throw new Error(result.error);
      status.textContent = result?.filled ? `${result.filled}件のカード項目を入力しました` : "対応する空欄がありません。別フレームの決済欄には未対応です";
    } catch (error) { status.textContent = error.message; }
    finally { lock(); event.target.disabled = false; }
  });
  document.getElementById("cancelCardFill").addEventListener("click", () => { lock(); status.textContent = "キャンセルしました"; });
  document.addEventListener("visibilitychange", () => { if (document.hidden) lock(); });
  document.querySelector(".card-tools").addEventListener("toggle", (event) => { if (!event.target.open) lock(); });
})();
