(function() {
  "use strict";
  const $=id=>document.getElementById(id),bridge=globalThis.DailyReportCalendarBridge;
  let trusted=false;try{const own=new URL(chrome.runtime.getURL("daily-report.html"));trusted=location.protocol===own.protocol&&location.host===own.host&&location.pathname===own.pathname;}catch(_error){}
  if(!trusted||!bridge)return;
  const permission={permissions:["identity"],origins:["https://www.googleapis.com/*"]};
  let state=null,busy=false,epoch=0,autoPending=false,lastAuto="";
  async function send(type,extra={}) {const result=await chrome.runtime.sendMessage({type,...extra});if(!result||result.error)throw new Error(result?.error||"カレンダー接続を確認できません。拡張を再読み込みしてください");return result;}
  function buttons() {
    $("calendarConnect").disabled=busy||!state?.configured||!$("calendarConsent").checked;
    $("calendarSync").disabled=busy||!state?.connected;
    $("calendarDisconnect").disabled=!state?.connected&&!busy;
    $("calendarAutoSync").disabled=busy;
  }
  async function refresh(auto=false) {
    try {
      state=await send("CALENDAR_STATUS");$("calendarAutoSync").checked=state.autoSync;
      $("companyCalendarStatus").textContent=!state.configured?"初回設定が必要です。Google接続設定ガイドを確認してください。":state.connected?`Google接続済み · ${state.calendarId}（読み取り専用）`:!state.supported?"接続設定済み。読み取り権限を許可後、このブラウザのIdentity API対応を確認します。":"Google未接続。接続ボタンから本人が認証・許可してください。";
      buttons();if(auto)await maybeAuto();
    } catch(error) {$("companyCalendarStatus").textContent=error.message;buttons();}
  }
  function cancelPending() {epoch++;lastAuto="";if(busy)void send("CALENDAR_CANCEL").catch(()=>{});}
  async function retrieve(connect=false) {
    if(busy){autoPending=!connect;return;}
    if(bridge.snapshot().busy){autoPending=!connect;return;}
    if(bridge.snapshot().editing){$("calendarFetchStatus").textContent="編集中の下書きを保持しています。候補の自動反映は止めています。必要な編集を退避して下書きを作り直してから再取得してください。";return;}
    if(connect&&!$("calendarConsent").checked){$("calendarFetchStatus").textContent="Google読み取り接続の確認欄をチェックしてください。";return;}
    bridge.clearLiveSource();const expected=bridge.snapshot(),stamp=epoch;
    busy=true;buttons();$("calendarFetchStatus").textContent=`${expected.date} の勤務予定を読み取っています。実績の確定や日報送信は行いません。`;
    try {
      if(connect) {
        // Request immediately from this click, never from page load or automatic synchronization.
        if(!chrome.permissions?.request)throw new Error("このブラウザでは任意権限の許可を利用できません。");
        const allowed=await chrome.permissions.request(permission);
        if(!allowed)throw new Error("読み取り権限は許可されませんでした。Googleには接続していません。");
      }
      if(stamp!==epoch)return;
      const result=await send(connect?"CALENDAR_CONNECT":"CALENDAR_SYNC",{date:expected.date,consent:connect});
      if(stamp!==epoch)return;
      if(!bridge.apply(result,expected)){$("calendarFetchStatus").textContent="対象日・設定・編集中の内容が変わりました。取得結果は反映せず、本人の入力を保持しています。";return;}
      $("calendarFetchStatus").textContent=`${result.events.length}件のシフト候補を取得（${result.fetchedAt}）。全ページ取得済み。実績・休憩は本人確認が必要です。`;
    } catch(error) {if(stamp===epoch)$("calendarFetchStatus").textContent=error.message;}
    finally {busy=false;await refresh();if(autoPending){autoPending=false;void maybeAuto();}}
  }
  async function maybeAuto() {
    if(busy){autoPending=true;return;}
    if(!state?.connected||!state?.autoSync)return;
    const snapshot=bridge.snapshot();if(snapshot.busy||snapshot.editing||!snapshot.calendarId)return;
    const key=JSON.stringify([snapshot.date,snapshot.generation,snapshot.calendarId]);if(lastAuto===key)return;
    lastAuto=key;await retrieve(false);
  }
  $("calendarConsent").addEventListener("change",buttons);
  $("calendarConnect").addEventListener("click",()=>retrieve(true));
  $("calendarSync").addEventListener("click",()=>retrieve(false));
  $("calendarAutoSync").addEventListener("change",async()=>{try{await send("CALENDAR_SET_AUTO",{enabled:$("calendarAutoSync").checked});lastAuto="";await refresh(true);}catch(error){$("calendarFetchStatus").textContent=error.message;}});
  $("calendarDisconnect").addEventListener("click",async()=>{
    cancelPending();autoPending=false;bridge.clearLiveSource();
    try{await send("CALENDAR_DISCONNECT");$("calendarConsent").checked=false;$("calendarFetchStatus").textContent="拡張の接続と任意権限を解除しました。予定は変更していません。Google側の許可取消はGoogleアカウントで行ってください。";}catch(error){$("calendarFetchStatus").textContent=error.message;}
    await refresh();
  });
  globalThis.CalendarReportUI={refresh,maybeAuto,cancelPending};
  void refresh(true);
})();
