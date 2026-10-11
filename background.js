"use strict";
importScripts("matcher.js", "profile-sheet.js", "jev-core.js");

// Keep the API key and all persistent state inaccessible to content-script storage APIs.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const inFlight = new Map();
let queue = Promise.resolve();

function serial(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
function isExtensionUI(sender) {
  // A full-tab options page has sender.tab too. Check exact owned UI URLs,
  // not whether Chrome reports a tab for the sender.
  return ["options.html", "popup.html"].some((file) => sender.url === chrome.runtime.getURL(file));
}
function isPage(sender) {
  try { return Boolean(sender.tab && ["http:", "https:"].includes(new URL(sender.url).protocol)); }
  catch (_error) { return false; }
}
async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function callJev(fields, apiKey, catalog) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST", redirect: "error", credentials: "omit",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(JevCore.buildRequest(fields, catalog)), signal: controller.signal
    });
    if (!response.ok) {
      const messages = { 401: "APIキーを確認してください", 403: "Jevへのアクセス権を確認してください", 402: "Jevの残高を確認してください", 429: "Jevが混雑しています。少し待って再実行してください" };
      throw new Error(messages[response.status] || `Jevに接続できませんでした（${response.status}）`);
    }
    const data = await response.json();
    const tokens = Number(data.usage?.input_tokens);
    const { jevUsage = {} } = await chrome.storage.local.get("jevUsage");
    await chrome.storage.local.set({ jevUsage: {
      requests: (jevUsage.requests || 0) + 1,
      inputTokens: (jevUsage.inputTokens || 0) + (Number.isFinite(tokens) && tokens >= 0 ? tokens : 0)
    } });
    const decisions = JevCore.parseAnswers(data, fields.length, catalog);
    // Only fixed category names and numeric certainty are exposed for diagnosis.
    // Never expose raw API responses, page metadata or credentials.
    const diagnostics = fields.map((_field, index) => {
      const answer = data.answers?.[`field${index}`];
      return {
        fieldKey: Object.hasOwn(JevCore.criteriaFor(catalog), answer?.choice || "") ? answer.choice : "unknown",
        confidence: Number.isFinite(answer?.confidence) ? answer.confidence : null,
        probability: Number.isFinite(answer?.probabilities?.[answer.choice]) ? answer.probabilities[answer.choice] : null
      };
    });
    return { decisions, diagnostics };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Jevの応答が時間切れになりました");
    if (error instanceof TypeError) throw new Error("Jevへ接続できません。ネットワークを確認してください");
    throw error;
  } finally { clearTimeout(timer); }
}

function isWeeklyReportPage(url, profile) {
  try { const page=new URL(url); return Boolean(profile?.weeklyReportUrl && page.origin==="https://docs.google.com" && page.origin+page.pathname.replace(/^\/forms\/u\/\d+\//,"/forms/")===profile.weeklyReportUrl); }
  catch (_error) { return false; }
}
async function fillState(sender) {
  const { profiles = [], activeProfileId, settings = {}, companyReportProfile } = await chrome.storage.local.get(["profiles", "activeProfileId", "settings", "companyReportProfile"]);
  if (isWeeklyReportPage(sender.url,companyReportProfile)) return {reportMode:"weekly-report-only"};
  return { profile: profiles.find((item) => item.id === activeProfileId) || profiles[0] || null,
    settings: { autoFillSites: [], overwriteExisting: false, highlightFilled: true, jevEnabled: false, jevMode: "primary", ...settings } };
}
async function classify(message, sender) {
  const { settings = {}, jevApiKey, jevCache = {}, companyReportProfile, profiles = [], activeProfileId } = await chrome.storage.local.get(["settings", "jevApiKey", "jevCache", "companyReportProfile", "profiles", "activeProfileId"]);
  if (isWeeklyReportPage(sender.url,companyReportProfile)) return {decisions:[],status:"weekly-report-only"};
  if (!settings.jevEnabled) return { decisions: [], status: "disabled" };
  const profile = profiles.find(item => item.id === activeProfileId) || profiles[0];
  if (!profile) return {decisions:[],status:"no-profile"};
  const catalog = ProfileSheet.catalogFor(profile);
  if (!catalog.length) return {decisions:[],status:"no-information"};
  const fields = Array.isArray(message.fields) ? message.fields.slice(0, JevCore.MAX_FIELDS).map(meta =>
    JevCore.sanitizeMeta(Object.fromEntries(Object.entries(JevCore.sanitizeMeta(meta)).map(([key,value]) => [key,ProfileSheet.redact(value,profile)])))) : [];
  if (!fields.length) return { decisions: [] };
  const url = new URL(sender.url);
  const key = await hash(JSON.stringify([JevCore.VERSION, JevCore.MODEL, url.origin, url.pathname, fields, catalog]));
  if (jevCache[key]) return { decisions: jevCache[key].decisions, cached: true };
  if (!message.allowNetwork) return { decisions: [], status: "uncached" };
  if (!jevApiKey) return { decisions: [], error: "設定画面でJevのAPIキーを登録してください" };
  if (inFlight.has(key)) return inFlight.get(key);
  const pending = serial(async () => {
    const { decisions } = await callJev(fields, jevApiKey, catalog);
    const stored = await chrome.storage.local.get("jevCache");
    const cache = stored.jevCache || {};
    cache[key] = { decisions, time: Date.now() };
    const recent = Object.fromEntries(Object.entries(cache).sort((a, b) => b[1].time - a[1].time).slice(0, 300));
    await chrome.storage.local.set({ jevCache: recent });
    return { decisions, cached: false };
  });
  inFlight.set(key, pending);
  try { return await pending; }
  finally { inFlight.delete(key); }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (!["GET_FILL_STATE", "CLASSIFY_FIELDS", "TEST_JEV"].includes(message?.type)) return false;
  (async () => {
    await storageReady;
    if (message.type === "GET_FILL_STATE" && isPage(sender)) return fillState(sender);
    if (message.type === "CLASSIFY_FIELDS" && isPage(sender)) return classify(message, sender);
    if (message.type === "TEST_JEV" && isExtensionUI(sender)) {
      const { jevApiKey } = await chrome.storage.local.get("jevApiKey");
      if (!jevApiKey) throw new Error("APIキーを保存してから確認してください");
      const { decisions, diagnostics } = await serial(() => callJev([{ label: "Email address", type: "email" }], jevApiKey));
      if (decisions[0]?.fieldKey !== "email") {
        const result = diagnostics[0];
        throw new Error(`接続できましたが判定を採用できませんでした（分類: ${result.fieldKey} / 確信度: ${result.confidence ?? "なし"} / 選択確率: ${result.probability ?? "なし"}）`);
      }
      return { ok: true };
    }
    throw new Error("この操作は許可されていません");
  })().then(sendResponse).catch((error) => sendResponse({ error: error.message }));
  return true;
});
