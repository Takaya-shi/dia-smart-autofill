(function () {
  "use strict";
  const version = "0.8.0";
  const previous = globalThis.__knownInfoAutofill;
  if (previous?.version === version && previous.isActive()) return;
  previous?.dispose();
  const runtime = globalThis.chrome?.runtime;
  const storageChanges = globalThis.chrome?.storage?.onChanged;
  let scheduled = null;
  let running = null;
  let observer = null;
  let disposed = false;
  const reloadMessage = "拡張機能との接続が切れました。ページを再読み込みしてください。";

  function isActive() {
    try { return !disposed && Boolean(runtime?.id); } catch { return false; }
  }
  function dispose() {
    disposed = true;
    window.clearTimeout(scheduled);
    observer?.disconnect();
    try { runtime?.onMessage?.removeListener(onMessage); } catch {}
    try { storageChanges?.removeListener(onStorageChanged); } catch {}
  }
  async function sendToExtension(message) {
    if (!isActive()) { dispose(); throw new Error(reloadMessage); }
    let response;
    try { response = await runtime.sendMessage(message); }
    catch (error) {
      if (!isActive() || /extension context invalidated/i.test(error?.message || "")) {
        dispose(); throw new Error(reloadMessage);
      }
      throw error;
    }
    if (!isActive()) { dispose(); throw new Error(reloadMessage); }
    if (!response || typeof response !== "object") throw new Error("拡張機能から応答がありません。ページを再読み込みしてください。");
    return response;
  }
  if (!isActive()) return;
  globalThis.__knownInfoAutofill = { version, isActive, dispose };

  function labelText(node) {
    const clone = node.cloneNode(true);
    for (const child of clone.querySelectorAll("input, textarea, select, button, .expectation")) child.remove();
    return clone.textContent || "";
  }
  function textOfLabels(element) {
    const nodes = new Set(element.labels ? Array.from(element.labels) : []);
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) nodes.add(wrappingLabel);
    for (const id of (element.getAttribute("aria-labelledby") || "").split(/\s+/)) {
      const node = document.getElementById(id);
      if (node) nodes.add(node);
    }
    return Array.from(nodes, labelText).join(" ").replace(/\s+/g, " ").trim();
  }
  function metadataFor(element) {
    const description = (element.getAttribute("aria-describedby") || "").split(/\s+/)
      .map((id) => document.getElementById(id)).filter(Boolean).map(labelText).join(" ");
    return {
      name: element.getAttribute("name") || "", id: element.id || "",
      type: element.getAttribute("type") || (element.tagName === "INPUT" ? "text" : element.tagName.toLowerCase()),
      autocomplete: element.getAttribute("autocomplete") || "",
      placeholder: element.getAttribute("placeholder") || "",
      ariaLabel: element.getAttribute("aria-label") || "", label: textOfLabels(element), description,
      maxLength: element.getAttribute("maxlength") === null ? -1 : Number(element.getAttribute("maxlength"))
    };
  }
  function isUsable(element) {
    if (!element.isConnected || element.disabled || element.readOnly || element.closest('[aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }
  function setNativeValue(element, value) {
    if (element instanceof HTMLSelectElement) {
      const option = Array.from(element.options).find((item) =>
        [item.value, item.textContent].some((text) => AutoFillMatcher.normalize(text) === AutoFillMatcher.normalize(value)));
      if (!option) return false;
      element.value = option.value;
    } else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, value); else element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return element.value === value || element instanceof HTMLSelectElement;
  }
  function markFilled(element, fieldKey, settings) {
    element.dataset.knownInfoAutofill = fieldKey;
    if (!settings.highlightFilled) return;
    element.classList.add("known-info-autofill-filled");
    window.setTimeout(() => element.classList.remove("known-info-autofill-filled"), 1600);
  }
  function redactMeta(meta, profile) {
    if (globalThis.ProfileSheet) return Object.fromEntries(Object.entries(meta).map(([key,value]) => [key,ProfileSheet.redact(value,profile)]));
    const values = Object.values(profile).filter((value) => typeof value === "string" && value.length >= 2);
    for (const custom of profile.customFields || []) if (custom.value?.length >= 2) values.push(custom.value);
    return Object.fromEntries(Object.entries(meta).map(([key, value]) => {
      let text = String(value || "");
      for (const saved of values) text = text.split(saved).join("[saved value]");
      return [key, text];
    }));
  }
  async function performFill({ automatic = false } = {}) {
    if (location.origin === "https://reports.example.test")
      return { filled: 0, reason: "daily-report-only", error: "日報は専用の下書き確認画面から入力してください。通常の自動入力・AI補助は使いません。" };
    if (location.origin === "https://docs.google.com" && /^\/forms\//.test(location.pathname) &&
        Array.from(document.querySelectorAll('[role="heading"],h1,h2')).some(h => String(h.textContent || "").normalize("NFKC").replace(/\s+/g, "") === "週報"))
      return { filled: 0, reason: "weekly-report-only", error: "週報は専用の下書き確認画面から入力してください。通常の自動入力・AI補助は使いません。" };
    const state = await sendToExtension({ type: "GET_FILL_STATE" });
    if (state?.error) throw new Error(state.error);
    if (state?.reportMode === "weekly-report-only") return { filled:0, reason:"weekly-report-only", error:"会社用の週報画面から入力してください。通常の自動入力・AI補助は使いません。" };
    const { profile, settings } = state;
    if (!profile) return { filled: 0, reason: "no-profile" };
    if (!settings) throw new Error("設定を取得できませんでした。ページを再読み込みしてください。");
    if (automatic && !settings.autoFillSites.includes(location.origin)) return { filled: 0, reason: "site-not-allowed" };
    const candidates = [];
    const primary = settings.jevEnabled && settings.jevMode === "primary";
    const profileSnapshot = JSON.stringify(profile);
    const sheet = globalThis.ProfileSheet;
    if (sheet) sheet.entriesFor(profile); // Reject invalid stored notes before any writes or paid calls.
    let filled = 0;
    let aiFilled = 0;
    let skipped = 0;
    const threshold = automatic || settings.jevEnabled ? 100 : 70;
    for (const element of document.querySelectorAll("input, select, textarea")) {
      if (!isActive()) { dispose(); throw new Error(reloadMessage); }
      if (!isUsable(element)) continue;
      if (!settings.overwriteExisting && String(element.value || "").trim()) { skipped++; continue; }
      const meta = metadataFor(element);
      const keyForType = { email: "email", tel: "phone", url: "website", date: "birthDate" }[meta.type] || "custom";
      if (!(sheet ? sheet.metaAllows(meta,keyForType) : AutoFillMatcher.fieldTypeAllows(meta, keyForType))) continue;
      const match = primary ? null : sheet ? sheet.fallback(meta,profile,profile.sheetEnabled || profile.sheetText?.trim() ? 105 : threshold) : AutoFillMatcher.findBestField(meta, profile, threshold);
      if (match) {
        if (setNativeValue(element, match.value)) { filled++; markFilled(element, match.fieldKey, settings); }
      } else if (settings.jevEnabled) {
        candidates.push({ element, meta, value: element.value });
      }
    }
    if (!candidates.length) return { filled, skipped, aiFilled };
    const startURL = location.href;
    let aiError;
    // Bounded explicit operation: at most five requests, 20 fields each. Automatic runs are cache-only.
    for (let offset=0;offset<Math.min(candidates.length,100);offset+=20) {
      const batch=candidates.slice(offset,offset+20);
      const response = await sendToExtension({type:"CLASSIFY_FIELDS",allowNetwork:!automatic,
        fields:batch.map(({meta})=>redactMeta(meta,profile))});
      const latest=await sendToExtension({type:"GET_FILL_STATE"});
      if(location.href!==startURL||JSON.stringify(latest?.profile)!==profileSnapshot||!latest?.settings?.jevEnabled||
          latest.settings.jevMode!==settings.jevMode||(automatic&&!latest.settings.autoFillSites.includes(location.origin)))
        return {filled,skipped,aiFilled,reason:"state-changed"};
      if(response.error)aiError=response.error;
      for(const [index,candidate] of batch.entries()) {
        if(!isActive()){dispose();throw new Error(reloadMessage);}
        if(location.href!==startURL) return {filled,skipped,aiFilled,reason:"state-changed"};
        if(!isUsable(candidate.element)||candidate.element.value!==candidate.value||JSON.stringify(metadataFor(candidate.element))!==JSON.stringify(candidate.meta))continue;
        const decision=response.decisions?.[index];
        // A valid skip / low-confidence response is never overridden by heuristic guessing.
        const fallback=sheet&&(response.error||response.status==="uncached")?sheet.fallback(candidate.meta,latest.profile,105):null;
        if((!decision||decision.fieldKey==="skip")&&!fallback)continue;
        const key=decision?.fieldKey&&decision.fieldKey!=="skip"?decision.fieldKey:fallback.fieldKey;
        const value=sheet?sheet.resolve(key,latest.profile,candidate.meta):AutoFillMatcher.resolveFieldValue(key,latest.profile,candidate.meta);
        if(!value)continue;
        if(setNativeValue(candidate.element,value)) {
          filled++; if(decision&&decision.fieldKey!=="skip")aiFilled++;
          markFilled(candidate.element,key,latest.settings);
        }
      }
      if(aiError)break;
    }
    return {filled,skipped,aiFilled,aiError,unresolved:Math.max(0,candidates.length-aiFilled)};
  }
  async function fillPage(options) {
    if (running) {
      if (options.automatic) return { filled: 0, reason: "busy" };
      await running.catch(() => {});
    }
    running = performFill(options);
    try { return await running; } finally { running = null; }
  }
  function scheduleAutomaticFill() {
    if (!isActive()) { dispose(); return; }
    window.clearTimeout(scheduled);
    scheduled = window.setTimeout(() => fillPage({ automatic: true }).catch(() => {}), 350);
  }
  function onMessage(message, _sender, sendResponse) {
    if (message?.type !== "FILL_PAGE") return undefined;
    fillPage({ automatic: false }).then(
      (result) => { try { sendResponse(result); } catch {} },
      (error) => { try { sendResponse({ filled: 0, error: error.message }); } catch {} }
    );
    return true;
  }
  function onStorageChanged(changes, areaName) {
    if (areaName === "local" && (changes.profiles || changes.settings || changes.activeProfileId)) scheduleAutomaticFill();
  }
  runtime.onMessage.addListener(onMessage);
  storageChanges?.addListener(onStorageChanged);
  scheduleAutomaticFill();
  observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length > 0)) scheduleAutomaticFill();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
