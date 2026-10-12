(function(root) {
  "use strict";
  const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
  const ORIGIN = "https://www.googleapis.com/*";
  const KEY = "calendarConnection";
  const PERMISSIONS = {permissions:["identity"],origins:[ORIGIN]};
  const MAX_PAGES = 10, MAX_ITEMS = 2000;
  const TITLES = new Set(["シフト_出社", "シフト_リモート"]);
  function failure(code,message) { const error=new Error(message);error.code=code;return error; }
  function validDate(date) {
    return typeof date==="string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)===date;
  }
  function windowFor(date) {
    if(!validDate(date))throw failure("invalid-date","対象日はYYYY-MM-DD形式で指定してください");
    const next=new Date(Date.parse(`${date}T00:00:00Z`)+86400000).toISOString().slice(0,10);
    return {timeMin:`${date}T00:00:00+09:00`,timeMax:`${next}T00:00:00+09:00`};
  }
  function calendarId(value) {
    if(typeof value!=="string" || value.length>200 || !/^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/.test(value))
      throw failure("invalid-calendar","会社用設定のカレンダーIDを確認してください");
    return value;
  }
  function clientId(manifest) {
    const id=manifest?.oauth2?.client_id;
    return typeof id==="string" && /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id) ? id : null;
  }
  function selectEvents(items,date,id) {
    const seen=new Set(), selected=[];
    for(const item of items) {
      if(!item||!TITLES.has(item.summary)||item.status==="cancelled"||item.attendees?.some(a=>a.self===true&&a.responseStatus==="declined"))continue;
      const start=item.start?.dateTime,end=item.end?.dateTime;
      const zoned=value=>typeof value==="string"&&/T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
      if(!zoned(start)||!zoned(end)||Date.parse(end)<=Date.parse(start))continue;
      const day=value=>new Date(Date.parse(value)+9*3600000).toISOString().slice(0,10);
      if(day(start)!==date)continue;
      const key=typeof item.id==="string"?item.id:JSON.stringify([item.summary,start,end]);
      if(seen.has(key))continue;seen.add(key);
      // No description, attendee identities, attachments, links, or arbitrary API objects leave this module.
      selected.push({id:typeof item.id==="string"?item.id:null,summary:item.summary,start:{dateTime:start},end:{dateTime:end},status:"confirmed",calendarId:id});
      if(selected.length>500)throw failure("too-many-shifts","勤務候補が多すぎます。カレンダーを確認してください");
    }
    return selected;
  }
  async function readEvents({fetch,token,id,date,signal}) {
    id=calendarId(id); const window=windowFor(date),items=[],seen=new Set();let pageToken="";
    for(let page=0;page<MAX_PAGES;page++) {
      const url=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events`);
      const params={...window,timeZone:"Asia/Tokyo",singleEvents:"true",orderBy:"startTime",showDeleted:"false",maxResults:"250",fields:"items(id,summary,status,start,end,attendees(self,responseStatus)),nextPageToken"};
      for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
      if(pageToken)url.searchParams.set("pageToken",pageToken);
      let response;
      try { response=await fetch(url.href,{method:"GET",headers:{Authorization:`Bearer ${token}`},credentials:"omit",redirect:"error",signal}); }
      catch(_error) { throw failure(signal?.aborted?"cancelled":"network",signal?.aborted?"カレンダー取得を中止しました":"Googleへ接続できません。ネットワークを確認してください"); }
      const messages={401:["auth-expired","Googleの認証が切れました。接続ボタンから再接続してください"],403:["access-denied","Googleの読み取り許可、管理者の制限、Calendar APIの有効化を確認してください"],404:["not-found","指定カレンダーを読み取れません。IDと共有権限を確認してください"],429:["rate-limit","Googleへの取得が混雑しています。時間を置いて再取得してください"]};
      if(!response.ok) { const [code,message]=messages[response.status]||["api-error",`Googleから取得できませんでした（${Number(response.status)||0}）`];throw failure(code,message); }
      let data;
      try { const text=await response.text();if(text.length>1000000)throw new Error();data=JSON.parse(text); }
      catch(_error) { throw failure("invalid-response","Googleの応答形式・サイズを確認できません。部分データは採用しません"); }
      if(!data||typeof data!=="object"||Array.isArray(data)||data.error|| (data.items!==undefined&&!Array.isArray(data.items)))throw failure("invalid-response","Googleの応答形式を確認できません。部分データは採用しません");
      if(items.length+(data.items?.length||0)>MAX_ITEMS)throw failure("too-many-events","対象日の予定が多すぎます。部分データは採用しません");
      items.push(...(data.items||[]));
      if(data.nextPageToken===undefined)return {date,calendarSource:id,events:selectEvents(items,date,id),submit:false};
      if(typeof data.nextPageToken!=="string"||!data.nextPageToken||data.nextPageToken.length>2048||seen.has(data.nextPageToken))throw failure("invalid-page","Googleのページ取得が循環・不正です。部分データは採用しません");
      pageToken=data.nextPageToken;seen.add(pageToken);
    }
    throw failure("too-many-pages","Googleの全ページを取得できません。部分データは採用しません");
  }
  function createService({chrome,fetch,now=Date.now}) {
    let epoch=0,knownToken=null,busy=false;const controllers=new Set();
    const configured=()=>clientId(chrome.runtime.getManifest?.());
    const supported=()=>typeof chrome.identity?.getAuthToken==="function"&&typeof chrome.permissions?.contains==="function";
    async function state() {
      const data=await chrome.storage.local.get([KEY,"companyReportProfile"]);
      return {connection:data[KEY]||{},id:data.companyReportProfile?.calendarId||null};
    }
    async function status() {
      const config=configured(),available=supported();
      const {connection,id}=await state();
      const permitted=available&&await chrome.permissions.contains(PERMISSIONS);
      return {configured:Boolean(config),supported:available,connected:Boolean(config&&permitted&&connection.connected&&connection.clientId===config&&connection.calendarId===id),autoSync:connection.autoSync===true,calendarId:id};
    }
    async function save(value) { await chrome.storage.local.set({[KEY]:value}); }
    function cancel() {epoch++;for(const controller of controllers)controller.abort();}
    async function discard(token) {
      if(token&&chrome.identity?.removeCachedAuthToken)try{await chrome.identity.removeCachedAuthToken({token});}catch(_error){}
      if(knownToken===token)knownToken=null;
    }
    async function run(date,interactive,consent) {
      windowFor(date);if(busy)throw failure("busy","カレンダー取得中です。完了後に操作してください");
      if(interactive&&consent!==true)throw failure("consent-required","Googleの読み取り専用接続を確認してください");
      const config=configured();
      if(!config)throw failure("needs-setup","この拡張用のGoogle OAuthクライアント設定が必要です。接続ガイドを確認してください");
      if(!supported())throw failure("unsupported","このブラウザではGoogleのIdentity APIを利用できません。Diaの対応確認が必要です");
      if(!await chrome.permissions.contains(PERMISSIONS))throw failure("permission-required","接続ボタンからGoogle読み取り用の拡張権限を許可してください");
      const initial=await state(),stamp=epoch;calendarId(initial.id);
      if(busy)throw failure("busy","カレンダー取得中です。完了後に操作してください");
      if(!interactive&&!(initial.connection.connected&&initial.connection.clientId===config&&initial.connection.calendarId===initial.id))throw failure("not-connected","Googleへまだ接続していません。接続ボタンを押してください");
      busy=true;let token,controller;
      async function unchanged() {
        const latest=await state();
        if(stamp!==epoch||initial.id!==latest.id||config!==configured()||!await chrome.permissions.contains(PERMISSIONS))throw failure("stale","接続やカレンダー設定が変わりました。取得結果は採用しません");
        return latest;
      }
      try {
        let auth;
        try { auth=await chrome.identity.getAuthToken({interactive,scopes:[SCOPE],enableGranularPermissions:true}); }
        catch(_error) { throw failure("auth-required",interactive?"Googleの認証・許可が完了しませんでした。ブラウザ対応とOAuth設定を確認してください":"Googleの認証が必要です。接続ボタンから再接続してください"); }
        token=typeof auth==="string"?auth:auth?.token;
        if(!token||typeof token!=="string")throw failure("auth-required","Googleの認証が完了しませんでした");
        if(Array.isArray(auth?.grantedScopes)&&!auth.grantedScopes.includes(SCOPE))throw failure("scope-denied","カレンダーイベントの読み取り許可がありません");
        await unchanged();knownToken=token;
        controller=new AbortController();controllers.add(controller);
        const timer=setTimeout(()=>controller.abort(),20000);
        let result;try{result=await readEvents({fetch,token,id:initial.id,date,signal:controller.signal});}finally{clearTimeout(timer);}
        const latest=await unchanged();
        await save({connected:true,clientId:config,calendarId:initial.id,autoSync:latest.connection.autoSync===true});
        // A disconnect during the storage write must never re-enable synchronization.
        if(stamp!==epoch){await save({connected:false,autoSync:false});throw failure("stale","接続を解除したため取得結果は採用しません");}
        return {...result,fetchedAt:new Date(now()).toISOString(),connected:true};
      } catch(error) {
        if(stamp!==epoch)await discard(token);
        if(["auth-required","auth-expired","scope-denied"].includes(error.code)&&stamp===epoch){const latest=await state();await save({...latest.connection,connected:false});await discard(token);}
        throw error;
      } finally {if(controller)controllers.delete(controller);busy=false;}
    }
    async function disconnect() {
      cancel(); const token=knownToken; knownToken=null;
      await save({connected:false,autoSync:false});await discard(token);
      // This removes this extension's optional access, not events or the user's Google account grant.
      if(chrome.permissions?.remove)await chrome.permissions.remove(PERMISSIONS);
      return {connected:false};
    }
    async function setAuto(value) {
      if(typeof value!=="boolean")throw failure("invalid-preference","自動取得の設定を確認してください");
      const {connection}=await state();await save({...connection,autoSync:value});return status();
    }
    return {status,connect:(date,consent)=>run(date,true,consent),sync:date=>run(date,false,false),disconnect,setAuto,cancel:()=>{cancel();return {cancelled:true};}};
  }
  root.CalendarSync={SCOPE,KEY,PERMISSIONS,windowFor,calendarId,clientId,selectEvents,readEvents,createService};
  if(typeof module!=="undefined"&&module.exports)module.exports=root.CalendarSync;
})(globalThis);
