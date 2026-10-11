// Self-contained: executes in the isolated world only after explicit popup confirmation.
function fillConfirmedCard(card, expectedUrl) {
  if (location.href !== expectedUrl || (location.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(location.hostname))) {
    return { filled: 0, error: "ページが変わりました。対象ページを確認してやり直してください" };
  }
  const normalize = (text) => String(text || "").normalize("NFKC").toLowerCase().replace(/[\s_\-()（）:]+/g, "");
  const rules = {
    "cc-number": ["cardnumber", "creditcardnumber", "カード番号", "クレジットカード番号"],
    "cc-name": ["cardholder", "cardholdername", "cardname", "カード名義", "カード名義人", "カード名義人名"],
    "cc-exp-month": ["cardexpmonth", "expirymonth", "有効期限月"],
    "cc-exp-year": ["cardexpyear", "expiryyear", "有効期限年"],
    "cc-exp": ["cardexpiry", "cardexpiration", "expirydate", "有効期限"]
  };
  const values = { "cc-number": card.number, "cc-name": card.name, "cc-exp-month": card.month, "cc-exp-year": card.year,
    "cc-exp": `${card.month}/${card.year.slice(-2)}` };
  let filled = 0;
  for (const element of document.querySelectorAll("input, select")) {
    if (element.disabled || element.readOnly || element.value || !element.isConnected) continue;
    if (!element.getClientRects().length || element.closest('[aria-hidden="true"]')) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const type = (element.getAttribute("type") || "text").toLowerCase();
    if (!["text", "tel", "number", "month"].includes(type)) continue;
    const label = Array.from(element.labels || []).map((node) => {
      const clone = node.cloneNode(true);
      for (const child of clone.querySelectorAll("input, select, textarea, .expectation")) child.remove();
      return clone.textContent;
    }).join(" ").trim();
    const tokens = (element.autocomplete || "").toLowerCase().split(/\s+/);
    const hints = [element.name, element.id, label, element.getAttribute("aria-label")].map(normalize);
    if (/cvv|cvc|securitycode|セキュリティコード|暗証番号|cc-csc/.test(normalize(`${tokens.join(" ")} ${hints.join(" ")}`))) continue;
    const standard = tokens.find((token) => Object.hasOwn(rules, token));
    const matched = Object.keys(rules).filter((key) => rules[key].some((alias) => hints.includes(normalize(alias))));
    const key = standard || (matched.length === 1 ? matched[0] : null);
    if (!key) continue;
    let value = values[key];
    if (key === "cc-exp-year" && element.maxLength === 2) value = card.year.slice(-2);
    if (key === "cc-exp") {
      if (type === "month") value = `${card.year}-${card.month}`;
      else if (/yyyy|年.*4桁/i.test(`${element.placeholder || ""} ${label}`)) value = `${card.month}/${card.year}`;
    }
    if (element instanceof HTMLSelectElement) {
      const option = Array.from(element.options).find((item) => {
        if (item.disabled || !item.value) return false;
        const candidates = [item.value, item.textContent].map((text) => normalize(text).replace(/[年月]/g, ""));
        if (key === "cc-exp-month") return candidates.some((text) => /^\d{1,2}$/.test(text) && Number(text) === Number(card.month));
        if (key === "cc-exp-year") return candidates.some((text) => text === card.year || text === card.year.slice(-2));
        return candidates.includes(normalize(value));
      });
      if (!option) continue;
      element.value = option.value;
    } else {
      if (element.maxLength > 0 && value.length > element.maxLength) continue;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    filled++;
  }
  return { filled };
}
if (typeof module !== "undefined" && module.exports) module.exports = fillConfirmedCard;
