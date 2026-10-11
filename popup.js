"use strict";

const profileSelect = document.getElementById("profileSelect");
const siteAutoFill = document.getElementById("siteAutoFill");
const fillButton = document.getElementById("fillButton");
const status = document.getElementById("status");
let activeOrigin = null;

function requestFill(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "FILL_PAGE" }, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

async function ensurePageScript(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content.css"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["matcher.js", "profile-sheet.js", "content.js"]
  });
}

async function initialize() {
  const stored = await chrome.storage.local.get(["profiles", "activeProfileId", "settings", "jevApiKey"]);
  document.getElementById("aiStatus").textContent = stored.settings?.jevEnabled && stored.jevApiKey
    ? "Jevオン · 登録情報からAIが入力先を選択"
    : "Jev補助オフ · 設定画面で登録できます";
  const profiles = Array.isArray(stored.profiles) ? stored.profiles : [];
  profileSelect.replaceChildren();

  if (!profiles.length) {
    const option = document.createElement("option");
    option.textContent = "プロフィール未作成";
    profileSelect.append(option);
    profileSelect.disabled = true;
    fillButton.disabled = true;
    status.textContent = "先に「保存情報を編集」から登録してください";
  } else {
    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.profileName || "名称未設定";
      profileSelect.append(option);
    }
    profileSelect.value = stored.activeProfileId || profiles[0].id;
    const activeProfile = profiles.find((profile) => profile.id === profileSelect.value) || profiles[0];
    try {
      const entries = ProfileSheet.entriesFor(activeProfile);
      const kinds = new Set(entries.filter((entry) => /^[\u30A0-\u30FF\u3040-\u309F\s]+$/.test(entry.value)).map((entry) => entry.kind));
      if (!kinds.has("fullNameKana") && !(kinds.has("lastNameKana") && kinds.has("firstNameKana"))) {
        status.textContent = "カナが未登録です。「保存情報を編集」から追加できます";
      }
    } catch (_invalidMemo) {
      status.textContent = "情報メモの形式を確認してください。「保存情報を編集」から修正できます";
    }
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url || "");
    activeOrigin = ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch (_error) {
    activeOrigin = null;
  }
  const allowedSites = Array.isArray(stored.settings?.autoFillSites) ? stored.settings.autoFillSites : [];
  siteAutoFill.checked = Boolean(activeOrigin && allowedSites.includes(activeOrigin));
  siteAutoFill.disabled = !activeOrigin;
  document.getElementById("siteLabel").textContent = activeOrigin
    ? new URL(activeOrigin).hostname
    : "このページでは設定できません";
}

profileSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ activeProfileId: profileSelect.value });
  status.textContent = "プロフィールを切り替えました";
});

siteAutoFill.addEventListener("change", async () => {
  if (!activeOrigin) return;
  const { settings = {} } = await chrome.storage.local.get("settings");
  const sites = new Set(Array.isArray(settings.autoFillSites) ? settings.autoFillSites : []);
  if (siteAutoFill.checked) sites.add(activeOrigin);
  else sites.delete(activeOrigin);
  await chrome.storage.local.set({ settings: { ...settings, autoFillSites: Array.from(sites).sort() } });
  status.textContent = siteAutoFill.checked
    ? "このサイトの自動入力をオンにしました"
    : "このサイトの自動入力をオフにしました";
});

fillButton.addEventListener("click", async () => {
  fillButton.disabled = true;
  status.textContent = "入力しています…";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    status.textContent = "現在のページを取得できませんでした";
    fillButton.disabled = false;
    return;
  }
  try {
    let result;
    try {
      result = await requestFill(tab.id);
    } catch (_missingReceiver) {
      await ensurePageScript(tab.id);
      result = await requestFill(tab.id);
    }
    if (result?.error) status.textContent = `入力できませんでした: ${result.error}`;
    else {
      status.textContent = result?.filled
        ? `${result.filled}件を入力しました${result.aiFilled ? `（AI補助 ${result.aiFilled}件）` : ""}`
        : "一致する空欄が見つかりませんでした";
      if (result.aiError) status.textContent += `。AI補助: ${result.aiError}`;
    }
  } catch (_error) {
    status.textContent = "このページでは実行できません";
  } finally {
    fillButton.disabled = false;
  }
});

document.getElementById("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

document.getElementById("openDailyReport").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { status.textContent = "現在のページを取得できませんでした"; return; }
  await chrome.tabs.create({ url: chrome.runtime.getURL(`daily-report.html?tab=${tab.id}`) });
});

document.getElementById("openWeeklyReport").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("現在のページを取得できませんでした");
    await chrome.tabs.create({ url: chrome.runtime.getURL(`weekly-report.html?tab=${tab.id}`) });
  } catch (error) { status.textContent = error.message; }
});

initialize();
