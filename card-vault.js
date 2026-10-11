(function (root) {
  "use strict";
  const encoder = new TextEncoder();
  function bytesToBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
  function base64ToBytes(text) { return Uint8Array.from(atob(text), (c) => c.charCodeAt(0)); }
  function validateCard(input, now = new Date()) {
    const number = String(input.number || "").replace(/[ -]/g, "");
    if (!/^\d{12,19}$/.test(number)) throw new Error("カード番号を確認してください");
    let sum = 0;
    for (let i = number.length - 1, double = false; i >= 0; i--, double = !double) {
      let digit = Number(number[i]);
      if (double) { digit *= 2; if (digit > 9) digit -= 9; }
      sum += digit;
    }
    if (sum % 10 !== 0 || /^0+$/.test(number)) throw new Error("カード番号を確認してください");
    const name = String(input.name || "").trim();
    if (!name || name.length > 100) throw new Error("カード名義を入力してください");
    const month = String(input.month || "").padStart(2, "0");
    const year = String(input.year || "");
    if (!/^(0[1-9]|1[0-2])$/.test(month) || !/^20\d{2}$/.test(year)) throw new Error("有効期限を確認してください");
    if (Number(year) < now.getFullYear() || (Number(year) === now.getFullYear() && Number(month) < now.getMonth() + 1)) {
      throw new Error("有効期限が過ぎています");
    }
    // Whitelist fields: CVV and any other supplied values must never be saved.
    return { number, name, month, year };
  }
  async function derive(password, salt) {
    const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, material,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(input, password) {
    if (String(password).length < 8) throw new Error("保存用パスワードは8文字以上にしてください");
    const card = validateCard(input);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await derive(password, salt);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(card)));
    return { version: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)), last4: card.number.slice(-4) };
  }
  async function decrypt(vault, password) {
    try {
      if (vault?.version !== 1) throw new Error("unsupported");
      const key = await derive(password, base64ToBytes(vault.salt));
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(vault.iv) }, key, base64ToBytes(vault.data));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (_error) { throw new Error("保存用パスワードが違うか、カード情報を読み込めません"); }
  }
  root.CardVault = { validateCard, encrypt, decrypt };
  if (typeof module !== "undefined" && module.exports) module.exports = root.CardVault;
})(globalThis);
