"use strict";
(() => {
  const form = document.getElementById("cardForm");
  const status = document.getElementById("cardSaveStatus");
  async function refresh() {
    const { cardVault } = await chrome.storage.local.get("cardVault");
    document.getElementById("cardSavedState").textContent = cardVault
      ? `登録済み · 末尾 ${cardVault.last4}（変更するときだけ入力）` : "カードは未登録です";
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("saveCard");
    button.disabled = true;
    try {
      const password = form.elements.cardPassword.value;
      if (password !== form.elements.cardPasswordConfirm.value) throw new Error("保存用パスワードが一致しません");
      const cardVault = await CardVault.encrypt({ number: form.elements.cardNumber.value, name: form.elements.cardName.value,
        month: form.elements.cardMonth.value, year: form.elements.cardYear.value }, password);
      await chrome.storage.local.set({ cardVault });
      form.reset();
      status.textContent = "カードを暗号化して保存しました";
      await refresh();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.getElementById("deleteCard").addEventListener("click", async () => {
    await chrome.storage.local.remove("cardVault");
    form.reset();
    status.textContent = "保存したカードを削除しました";
    await refresh();
  });
  refresh();
})();
