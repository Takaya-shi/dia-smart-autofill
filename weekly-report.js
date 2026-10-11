(function() {
  "use strict";
  const $=id=>document.getElementById(id), tabId=Number(new URLSearchParams(location.search).get("tab"));
  let store=null,profile=null,handle=null,target=null,draft=null,generation=0,busy=0,consumed=false;
  function today() { $("weeklyPostingDate").value=WeeklyReportCore.todayTokyo(); const dates=WeeklyReportCore.datesBefore($("weeklyPostingDate").value,DailyReportCore); $("weeklyRange").textContent=`対象：${dates[0]}〜${dates[6]}（当日は含みません）`; }
  function revoke() { generation++;consumed=false;$("weeklyDestination").checked=false;$("weeklyGoogleDraft").checked=false;$("weeklyFill").disabled=true; }
  function controls() { for(const id of ["weeklyLoad","weeklyChooseDirectory","weeklyPermitDirectory","weeklyInspect","weeklyRemember"]) $(id).disabled=Boolean(busy)||!store; $("weeklyRemember").disabled=Boolean(busy)||!store||!target?.accountMatched; }
  function refresh() {
    const includeWork=!$("weeklyDateOnly").checked,text=target?WeeklyReportCore.formatWork($("weeklyText").value,target.workMode):$("weeklyText").value;
    $("weeklyPreview").textContent=`投稿日：${$("weeklyPostingDate").value}\n${$("weeklyRange").textContent}\n\n${includeWork?text:"投稿日だけ入力。業務欄は変更しません。"}`;
    const errors=[];
    if(!target)errors.push("週報の入力欄を読み取ってください");
    if(target&&!target.accountMatched)errors.push("会社アカウントを確認できません");
    if(target&&profile?.weeklyReportUrl!==target.url)errors.push("入力先の週報を会社用に記憶してください");
    if(target?.dateValue&&target.dateValue!==$("weeklyPostingDate").value)errors.push("既存の投稿日は上書きしません");
    if(includeWork&&(!draft||!text.trim()))errors.push("対象期間のTasksがありません。投稿日だけの入力は選択できます");
    if(includeWork&&!$("weeklyReview").checked)errors.push("実際に行った業務か確認してください");
    if(includeWork&&target&&!target.workEmpty)errors.push("既存の業務内容は上書きしません");
    if(includeWork&&target&&text.length>Math.min(target.maxLength,20000))errors.push("業務欄の文字数制限を超えています。短く編集して確認し直してください");
    $("weeklyValidation").textContent=consumed?"入力済みです。回答は送信していません。Googleの下書き保存は発生する可能性があります。":errors.join("。");
    $("weeklyFill").disabled=consumed||Boolean(busy)||!target||!target.accountMatched||profile?.weeklyReportUrl!==target.url||!$("weeklyDestination").checked||!$("weeklyGoogleDraft").checked||
      (Boolean(target.dateValue)&&target.dateValue!==$("weeklyPostingDate").value)||
      (includeWork&&(!draft||!$("weeklyReview").checked||!text.trim()||!target.workEmpty||text.length>Math.min(target.maxLength,20000)));
  }
  async function loadWeek() {
    if(!store||!handle)return;
    today();revoke();const stamp=generation,date=$("weeklyPostingDate").value,source=handle;
    draft=null;$("weeklyText").value="";$("weeklyReview").checked=false;$("weeklyWarnings").replaceChildren();busy++;controls();refresh();
    try {
      const result=await WeeklyReportCore.readWeek(source,date,DailyReportCompany,DailyReportCore);
      if(stamp!==generation||source!==handle)return;
      draft=result;$("weeklyText").value=result.text;$("weeklyPermitDirectory").hidden=true;
      const warnings=[...result.warnings];
      if(result.missingDates.length)warnings.push(`Dailyなし：${result.missingDates.join("、")}。実績なしとは断定しません。`);
      if(result.emptyDates.length)warnings.push(`Tasks候補なし：${result.emptyDates.join("、")}。Notesから補いません。`);
      for(const warning of warnings){const li=document.createElement("li");li.textContent=warning;$("weeklyWarnings").append(li);}
      $("weeklySourceStatus").textContent=`${result.start}〜${result.end} の7日を確認し、${result.days.length}日分のTasks候補を連結しました。完了・成果を推測しません。`;
    }catch(error){if(stamp!==generation)return;$("weeklySourceStatus").textContent=error.message;$("weeklyPermitDirectory").hidden=!error.permissionRequired;}
    finally{busy--;controls();refresh();}
  }
  async function operate(operation,plan) {
    if(!globalThis.chrome?.scripting||!Number.isSafeInteger(tabId)||tabId<=0)throw new Error("週報を開いた状態で、拡張の「会社用の週報」から開いてください");
    await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:["weekly-report-adapter.js"]});
    const results=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:async request=>{
      try{return await globalThis.WeeklyReportAdapter.run(request);}catch(error){return {error:error?.message||"週報の入力を中止しました"};}
    },args:[{operation,plan,expectedUrl:profile?.weeklyReportUrl||""}]});
    if(results.length!==1||!results[0].result)throw new Error("週報の入力先を確認できませんでした");
    if(results[0].result.error)throw new Error(results[0].result.error);
    return results[0].result;
  }
  async function init() {
    today();$("weeklyFolderHint").textContent=DailyReportCompany.DAILY_HINT;controls();
    try{
      if(!globalThis.chrome?.runtime?.getURL)throw new Error("拡張機能の「会社用の週報」から開いてください");
      const own=new URL(chrome.runtime.getURL("weekly-report.html"));
      if(location.protocol!==own.protocol||location.host!==own.host||location.pathname!==own.pathname)throw new Error("拡張機能の週報画面から開いてください");
      store=DailyReportCompany.createStore({storage:chrome.storage.local,indexedDB:globalThis.indexedDB});
      const stamp=generation;profile=await store.loadProfile();handle=await store.getDirectory();
      $("weeklyRegisteredUrl").textContent=`週報URL：${profile.weeklyReportUrl||"未登録（読み取ってから会社用に記憶してください）"}`;
      if(!handle)$("weeklySourceStatus").textContent="会社用設定のDailyフォルダが未登録です。Dailyフォルダを選んでください。";
      controls();if(handle&&stamp===generation&&!$("weeklyText").value)await loadWeek();
    }catch(error){$("weeklySourceStatus").textContent=error.message;controls();}
  }
  $("weeklyLoad").addEventListener("click",()=>{if(!busy)void loadWeek();});
  $("weeklyChooseDirectory").addEventListener("click",async()=>{
    if(!store||busy)return;revoke();const stamp=generation;busy++;controls();
    try{const selected=await DailyReportCompany.chooseDirectory(typeof globalThis.showDirectoryPicker==="function"?o=>globalThis.showDirectoryPicker(o):null);await store.putDirectory(selected);handle=selected;if(stamp===generation)await loadWeek();}
    catch(error){$("weeklySourceStatus").textContent=error.name==="AbortError"?"フォルダ選択をキャンセルしました":error.message;}
    finally{busy--;controls();refresh();}
  });
  $("weeklyPermitDirectory").addEventListener("click",async()=>{
    if(!handle||busy)return;const source=handle,stamp=generation;busy++;controls();
    try{if(await DailyReportCompany.requestReadPermission(source)!=="granted")throw new Error("読み取りは許可されませんでした");if(stamp===generation&&source===handle)await loadWeek();}
    catch(error){$("weeklySourceStatus").textContent=error.message;}finally{busy--;controls();refresh();}
  });
  $("weeklyInspect").addEventListener("click",async()=>{
    if(busy)return;revoke();target=null;const stamp=generation;busy++;controls();
    try{const result=await operate("inspect");if(stamp!==generation)return;target=result;
      $("weeklyTargetStatus").textContent=`週報の投稿日・業務欄を確認しました。会社アカウント：${result.accountMatched?"表示確認済み":"未確認（入力しません）"}。業務欄：${result.workEmpty?"空欄":"既存の回答あり（上書きしません）"}。${result.workMode==="single-line"?"1行の欄なので改行を / でつなぎます。":"改行付きで入力します。"}`;
    }catch(error){$("weeklyTargetStatus").textContent=error.message;}finally{busy--;controls();refresh();}
  });
  $("weeklyRemember").addEventListener("click",async()=>{
    if(!store||!target?.accountMatched||busy)return;revoke();const snapshot=target;busy++;controls();
    try{profile=await store.saveProfile({weeklyReportUrl:snapshot.url},{updateWeeklyForm:true});$("weeklyRegisteredUrl").textContent=`週報URL：${profile.weeklyReportUrl}`;$("weeklyTargetStatus").textContent="週報の入力先を会社用設定に記憶しました。回答は保存・送信していません。";}
    catch(error){$("weeklyTargetStatus").textContent=error.message;}finally{busy--;controls();refresh();}
  });
  $("weeklyText").addEventListener("input",()=>{revoke();$("weeklyReview").checked=false;refresh();});
  for(const id of ["weeklyReview","weeklyDateOnly"])$(id).addEventListener("change",()=>{revoke();refresh();});
  for(const id of ["weeklyDestination","weeklyGoogleDraft"])$(id).addEventListener("change",refresh);
  $("weeklyFill").addEventListener("click",async()=>{
    refresh();if($("weeklyFill").disabled)return;
    const plan={postingDate:$("weeklyPostingDate").value,text:$("weeklyText").value,includeWork:!$("weeklyDateOnly").checked,fingerprint:target.fingerprint,reviewed:true,allowGoogleDraftSave:true,submit:false};
    busy++;controls();refresh();
    try{const result=await operate("fill",plan);consumed=true;$("weeklyFillStatus").textContent=`${result.written}欄を入力しました。回答の送信はしていません。Googleによる下書き自動保存は発生する可能性があります。`;}
    catch(error){target=null;$("weeklyFillStatus").textContent=`入力を中止しました：${error.message}。送信せず画面を確認してください。`;}
    finally{busy--;$("weeklyDestination").checked=false;$("weeklyGoogleDraft").checked=false;controls();refresh();}
  });
  void init();
})();
