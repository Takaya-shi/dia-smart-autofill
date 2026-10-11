"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const Vault = require("../card-vault.js");
const sample = { number: "4111 1111 1111 1111", name: "TEST USER", month: "1", year: "2090", cvv: "123" };

test("encrypted vault stores no plaintext card/password/CVV; correct password restores whitelisted data", async () => {
  const vault = await Vault.encrypt(sample, "test-passphrase");
  const text = JSON.stringify(vault);
  assert.ok(!text.includes("4111111111111111"));
  assert.ok(!text.includes("TEST USER"));
  assert.ok(!text.includes("test-passphrase"));
  assert.equal(vault.last4, "1111");
  const decoded = await Vault.decrypt(vault, "test-passphrase");
  assert.deepEqual(decoded, { number: "4111111111111111", name: "TEST USER", month: "01", year: "2090" });
  assert.ok(!Object.hasOwn(decoded, "cvv"));
  await assert.rejects(() => Vault.decrypt(vault, "wrong-password"), /パスワード/);
  const bytes = Uint8Array.from(atob(vault.data), (char) => char.charCodeAt(0));
  bytes[0] ^= 1;
  await assert.rejects(() => Vault.decrypt({ ...vault, data: btoa(String.fromCharCode(...bytes)) }, "test-passphrase"), /パスワード/);
});

test("invalid number, expired date and short password are rejected", async () => {
  assert.throws(() => Vault.validateCard({ ...sample, number: "4111111111111112" }), /カード番号/);
  assert.throws(() => Vault.validateCard({ ...sample, month: "13" }), /有効期限/);
  assert.throws(() => Vault.validateCard({ ...sample, year: "2020" }), /有効期限/);
  await assert.rejects(() => Vault.encrypt(sample, "short"), /8文字/);
});

function harness() {
  class Input {
    constructor(autocomplete, options = {}) {
      this.autocomplete = autocomplete;
      this._value = options.value || "";
      this.type = options.type || "text";
      this.name = this.id = "";
      this.placeholder = options.placeholder || "";
      this.labels = [];
      this.isConnected = true;
      this.maxLength = options.maxLength || -1;
      this.hidden = Boolean(options.hidden);
    }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getAttribute(key) { return key === "type" ? this.type : null; }
    closest() { return null; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    dispatchEvent() {}
  }
  class Select extends Input { constructor(key) { super(key); this.options = [{ value: "", textContent: "月" }, { value: "1", textContent: "01" }]; } }
  const controls = [new Input("cc-number"), new Input("cc-name"), new Select("cc-exp-month"),
    new Input("cc-exp-year", { maxLength: 2 }), new Input("cc-exp"), new Input("cc-csc"),
    new Input("cc-name", { value: "KEEP" }), new Input("cc-number", { hidden: true }),
    new Input("cc-number", { maxLength: 4 })];
  const url = "https://example.test/payment";
  const context = vm.createContext({ document: { querySelectorAll() { return controls; } },
    location: { href: url, protocol: "https:", hostname: "example.test" },
    getComputedStyle() { return { visibility: "visible", display: "block" }; },
    HTMLSelectElement: Select, HTMLInputElement: Input, Event });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../card-fill.js"), "utf8"), context);
  return { context, controls, url, fill(expected = url) {
    return context.fillConfirmedCard(Vault.validateCard(sample), expected);
  } };
}

test("dedicated fill handles expiry select/year while leaving CVV, existing, hidden and split fields alone", () => {
  const page = harness();
  assert.equal(page.fill().filled, 5);
  assert.equal(page.controls[0].value, "4111111111111111");
  assert.equal(page.controls[2].value, "1");
  assert.equal(page.controls[3].value, "90");
  assert.equal(page.controls[4].value, "01/90");
  assert.equal(page.controls[5].value, "");
  assert.equal(page.controls[6].value, "KEEP");
  assert.equal(page.controls[7].value, "");
  assert.equal(page.controls[8].value, "");
});

test("changed URL and non-HTTPS destination block card transfer", () => {
  const page = harness();
  assert.equal(page.fill("https://another.test/payment").filled, 0);
  assert.equal(page.controls[0].value, "");
  page.context.location.protocol = "http:";
  assert.equal(page.fill().filled, 0);
});
