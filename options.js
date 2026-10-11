"use strict";

const PROFILE_FIELDS = [
  "profileName", "lastName", "firstName", "lastNameKana", "firstNameKana", "email",
  "phone", "birthDate", "website", "postalCode", "prefecture", "city", "address1",
  "address2", "company", "department", "jobTitle"
];
const DEFAULT_SETTINGS = { autoFillSites: [], overwriteExisting: false, highlightFilled: true };

const form = document.getElementById("profileForm");
const picker = document.getElementById("profilePicker");
const customFields = document.getElementById("customFields");
const saveStatus = document.getElementById("saveStatus");
let profiles = [];
let activeProfileId = null;
let settingsState = { ...DEFAULT_SETTINGS };

function uid() {
  return globalThis.crypto?.randomUUID?.() || `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function blankProfile(name = "個人用") {
  return { id: uid(), profileName: name, customFields: [], sheetEnabled:true, sheetText:"" };
}

function addCustomRow(custom = {}) {
  const fragment = document.getElementById("customFieldTemplate").content.cloneNode(true);
  const row = fragment.querySelector(".custom-row");
  row.dataset.id = custom.id || uid();
  row.querySelector('[data-role="aliases"]').value = custom.aliases || "";
  row.querySelector('[data-role="value"]').value = custom.value || "";
  row.querySelector('[data-role="remove"]').addEventListener("click", () => row.remove());
  customFields.append(fragment);
}

function collectForm() {
  const profile = { ...profiles.find(item=>item.id===activeProfileId), id: activeProfileId, customFields: [] };
  profile.sheetEnabled=document.getElementById("sheetEnabled").checked;
  profile.sheetText=document.getElementById("profileSheet").value;
  profile.sheetSchemaVersion=1;
  if(profile.sheetEnabled) ProfileSheet.parse(profile.sheetText);
  for (const key of PROFILE_FIELDS) profile[key] = form.elements[key].value.trim();
  profile.lastNameKana = AutoFillMatcher.toKatakana(profile.lastNameKana);
  profile.firstNameKana = AutoFillMatcher.toKatakana(profile.firstNameKana);
  profile.fullName = [profile.lastName, profile.firstName].filter(Boolean).join(" ");
  profile.fullNameKana = [profile.lastNameKana, profile.firstNameKana].filter(Boolean).join(" ");
  for (const row of customFields.querySelectorAll(".custom-row")) {
    const aliases = row.querySelector('[data-role="aliases"]').value.trim();
    const value = row.querySelector('[data-role="value"]').value.trim();
    if (aliases && value) profile.customFields.push({ id: row.dataset.id, aliases, value });
  }
  return profile;
}

for (const key of ["lastNameKana", "firstNameKana"]) {
  form.elements[key].addEventListener("blur", (event) => {
    event.target.value = AutoFillMatcher.toKatakana(event.target.value.normalize("NFKC"));
  });
}

function renderPicker() {
  picker.replaceChildren();
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.profileName || "名称未設定";
    picker.append(option);
  }
  picker.value = activeProfileId;
  document.getElementById("deleteProfile").disabled = profiles.length <= 1;
}

function renderProfile() {
  const profile = profiles.find((item) => item.id === activeProfileId) || profiles[0];
  if (!profile) return;
  activeProfileId = profile.id;
  for (const key of PROFILE_FIELDS) form.elements[key].value = profile[key] || "";
  customFields.replaceChildren();
  for (const custom of profile.customFields || []) addCustomRow(custom);
  document.getElementById("sheetEnabled").checked=profile.sheetEnabled===true || (profile.sheetEnabled!==false&&Boolean(profile.sheetText?.trim()));
  document.getElementById("profileSheet").value=profile.sheetText || "";
  renderSheetStatus();
  renderPicker();
}

function renderSheetStatus() {
  const enabled=document.getElementById("sheetEnabled").checked;
  for(const key of PROFILE_FIELDS)if(key!=="profileName")form.elements[key].disabled=enabled;
  for(const row of customFields.querySelectorAll(".custom-row"))for(const input of row.querySelectorAll("input"))input.disabled=enabled;
  document.getElementById("addCustom").disabled=enabled;
  try {
    const entries=ProfileSheet.parse(document.getElementById("profileSheet").value);
    document.getElementById("sheetStatus").textContent=`${entries.length}項目。${enabled?"このメモだけを入力元にします。":"従来の登録を使用しています。"}`;
  } catch(error) { document.getElementById("sheetStatus").textContent=error.message; }
}
document.getElementById("sheetEnabled").addEventListener("change",renderSheetStatus);
document.getElementById("profileSheet").addEventListener("input",renderSheetStatus);
function replaceEmptyMemo(text) {
  if(document.getElementById("profileSheet").value.trim()) {saveStatus.textContent="メモは上書きしません。必要な内容をコピーしてから手動で編集してください";return;}
  document.getElementById("profileSheet").value=text;
  document.getElementById("sheetEnabled").checked=true;
  renderSheetStatus(); saveStatus.textContent="変更は保存で反映されます";
}
document.getElementById("importLegacySheet").addEventListener("click",()=>{
  try { const current=collectForm(); replaceEmptyMemo(ProfileSheet.toMemo(current)); }
  catch(error){saveStatus.textContent=error.message;}
});
document.getElementById("sheetTemplate").addEventListener("click",()=>replaceEmptyMemo(ProfileSheet.TEMPLATE));

function renderTrustedSites() {
  const list = document.getElementById("trustedSiteList");
  list.replaceChildren();
  const sites = Array.isArray(settingsState.autoFillSites) ? settingsState.autoFillSites : [];
  if (!sites.length) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "まだ許可したサイトはありません";
    list.append(empty);
    return;
  }
  for (const site of sites) {
    const row = document.createElement("div");
    row.className = "site-row";
    const label = document.createElement("span");
    label.textContent = site;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "解除";
    remove.addEventListener("click", () => {
      settingsState.autoFillSites = settingsState.autoFillSites.filter((item) => item !== site);
      renderTrustedSites();
      saveStatus.textContent = "許可を解除しました。保存すると確定します";
    });
    row.append(label, remove);
    list.append(row);
  }
}

async function initialize() {
  const stored = await chrome.storage.local.get(["profiles", "activeProfileId", "settings"]);
  profiles = Array.isArray(stored.profiles) && stored.profiles.length ? stored.profiles : [blankProfile()];
  activeProfileId = profiles.some((item) => item.id === stored.activeProfileId)
    ? stored.activeProfileId
    : profiles[0].id;
  settingsState = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  document.getElementById("settingOverwrite").checked = settingsState.overwriteExisting;
  document.getElementById("settingHighlight").checked = settingsState.highlightFilled;
  renderTrustedSites();
  renderProfile();
}

picker.addEventListener("change", () => {
  try {
  const currentIndex = profiles.findIndex((item) => item.id === activeProfileId);
  if (currentIndex >= 0) profiles[currentIndex] = collectForm();
  activeProfileId = picker.value;
  renderProfile();
  } catch(error){picker.value=activeProfileId;saveStatus.textContent=error.message;}
});

document.getElementById("addProfile").addEventListener("click", () => {
  try {
  const currentIndex = profiles.findIndex((item) => item.id === activeProfileId);
  if (currentIndex >= 0) profiles[currentIndex] = collectForm();
  const profile = blankProfile(`プロフィール ${profiles.length + 1}`);
  profiles.push(profile);
  activeProfileId = profile.id;
  renderProfile();
  form.elements.profileName.focus();
  } catch(error){saveStatus.textContent=error.message;}
});

document.getElementById("deleteProfile").addEventListener("click", () => {
  if (profiles.length <= 1) return;
  profiles = profiles.filter((item) => item.id !== activeProfileId);
  activeProfileId = profiles[0].id;
  renderProfile();
  saveStatus.textContent = "プロフィールを削除しました。保存すると確定します";
});

document.getElementById("addCustom").addEventListener("click", () => addCustomRow());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
  const currentIndex = profiles.findIndex((item) => item.id === activeProfileId);
  profiles[currentIndex] = collectForm();
  const { settings: currentSettings = {} } = await chrome.storage.local.get("settings");
  const settings = {
    ...currentSettings,
    autoFillSites: Array.isArray(settingsState.autoFillSites) ? settingsState.autoFillSites : [],
    overwriteExisting: document.getElementById("settingOverwrite").checked,
    highlightFilled: document.getElementById("settingHighlight").checked
  };
  await chrome.storage.local.set({ profiles, activeProfileId, settings });
  renderPicker();
  saveStatus.textContent = "保存しました";
  window.setTimeout(() => { saveStatus.textContent = "変更は「保存」で反映されます"; }, 2400);
  } catch(error) {saveStatus.textContent=error.message;}
});

initialize().catch(()=>{saveStatus.textContent="設定を読み込めませんでした。ページを再読み込みしてください";});
