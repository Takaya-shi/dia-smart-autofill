"use strict";
// Synthetic memory-only Chrome APIs. No browser storage, Google API, or report portal is accessed.
const calendarFixtureProfile={name:"架空の会社用設定",calendarId:"work@example.test",autoLoadDaily:false,weeklyReportUrl:""};
let calendarFixtureConnected=false,calendarFixtureAuto=false;
DailyReportCompany.DAILY_HINT="架空のDailyフォルダ（このデモはファイルを読みません）";
document.getElementById("markdown").value="## Tasks\n### 架空の案件\n- [x] テスト用の資料を確認（実績ではありません）";
document.querySelector(".notice").textContent="架空データの設定デモです。接続・権限許可・取得はすべてメモリ内の模擬処理。Google、実際の拡張の保存情報、会社の日報にはアクセスしません。";
const calendarFixtureData={companyReportProfile:calendarFixtureProfile};
const calendarFixtureResult=date=>({date,calendarSource:"work@example.test",events:[{id:"synthetic",summary:"シフト_リモート",start:{dateTime:`${date}T09:00:00+09:00`},end:{dateTime:`${date}T17:00:00+09:00`}}],fetchedAt:new Date().toISOString(),submit:false,connected:true});
globalThis.chrome={
  runtime:{getURL(file){return file==="daily-report.html"?location.href:new URL(file,document.baseURI).href;},async sendMessage(message){
    if(message.type==="CALENDAR_STATUS")return {configured:true,supported:true,connected:calendarFixtureConnected,autoSync:calendarFixtureAuto,calendarId:"work@example.test"};
    if(message.type==="CALENDAR_CONNECT"){calendarFixtureConnected=true;return calendarFixtureResult(message.date);}
    if(message.type==="CALENDAR_SYNC")return calendarFixtureResult(message.date);
    if(message.type==="CALENDAR_SET_AUTO"){calendarFixtureAuto=message.enabled;return {ok:true};}
    if(message.type==="CALENDAR_CANCEL")return {cancelled:true};
    if(message.type==="CALENDAR_DISCONNECT"){calendarFixtureConnected=false;calendarFixtureAuto=false;return {connected:false};}
    return {error:"デモではこの操作を実行しません"};
  }},
  storage:{local:{async get(key){return {[key]:calendarFixtureData[key]};},async set(value){Object.assign(calendarFixtureData,value);}}},
  permissions:{async request(){return true;}},
  scripting:{async executeScript(){throw new Error("デモは会社フォームを操作しません");}}
};
