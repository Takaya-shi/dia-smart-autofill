(function(root) {
  "use strict";
  async function run(request) {
    function normalizeUrl(value) {
      const u = new URL(value), path = u.pathname.replace(/^\/forms\/u\/\d+\//,"/forms/");
      if (u.origin!=="https://docs.google.com" || u.username || u.password || u.searchParams.has("edit2") || !/^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform$/.test(path)) throw new Error("週報のGoogleフォーム回答画面以外では実行しません");
      return u.origin+path;
    }
    const url = normalizeUrl(location.href);
    if (request.expectedUrl && normalizeUrl(request.expectedUrl)!==url) throw new Error("登録した週報と入力先が違います");
    if (request.operation!=="inspect" && !request.expectedUrl) throw new Error("先に入力先の週報を登録してください");
    const norm = value => String(value || "").normalize("NFKC").replace(/\s+/g,"").replace(/[＊*]$/,"");
    const visible = el => el?.isConnected && !el.disabled && !el.readOnly && !el.closest('[aria-hidden="true"]') && el.getClientRects().length>0;
    const single = list => {if(list.length!==1) throw new Error("週報の入力欄を一意に確認できません。画面が変わった可能性があります");return list[0];};
    function inspect() {
      const form = single(Array.from(document.querySelectorAll("form")).filter(visible));
      if (!Array.from(form.querySelectorAll('[role="heading"],h1,h2')).some(h=>norm(h.textContent)==="週報")) throw new Error("週報の画面を確認できません。資料投稿フォームなどには入力しません");
      const questions = Array.from(form.querySelectorAll('[role="listitem"]')).filter(visible);
      const question = title => single(questions.filter(q=>Array.from(q.querySelectorAll('[role="heading"],h2,h3,h4')).some(h=>norm(h.textContent)===title)));
      const date = single(Array.from(question("投稿日").querySelectorAll("input")).filter(el=>visible(el)&&el.type==="date"));
      const work = single(Array.from(question("今週の業務と成果報告").querySelectorAll("textarea,input")).filter(el=>visible(el)&&(el.tagName==="TEXTAREA"||el.type==="text")));
      const mode = work.tagName==="TEXTAREA"?"multi-line":"single-line";
      // No contact/name/checkbox values or existing work text are returned.
      const accountMatched = form.textContent.includes("work@example.test");
      const snapshot = {url,title:"週報",dateValue:date.value,workEmpty:work.value==="",workMode:mode,maxLength:work.maxLength>0?work.maxLength:20000,accountMatched};
      return {date,work,snapshot,fingerprint:JSON.stringify(snapshot)};
    }
    const initial = inspect();
    if (request.operation==="inspect") return {...initial.snapshot,fingerprint:initial.fingerprint};
    if (request.operation!=="fill") throw new Error("未対応の週報操作です");
    const plan = request.plan;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(p=>[p.type,p.value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    if (!plan || plan.submit!==false || plan.reviewed!==true || plan.allowGoogleDraftSave!==true || plan.fingerprint!==initial.fingerprint || plan.postingDate!==today) throw new Error("下書き・入力先・投稿日・Googleの下書き自動保存の確認が必要です");
    if (!initial.snapshot.accountMatched) throw new Error("会社アカウントの表示を確認できないため入力しません");
    if (initial.snapshot.dateValue && initial.snapshot.dateValue!==today) throw new Error("既存の投稿日は上書きしません");
    if (plan.includeWork!==false && (!initial.snapshot.workEmpty || typeof plan.text!=="string" || !plan.text.trim())) throw new Error("業務内容が空欄でないか、確認したTasksがありません");
    const text = plan.includeWork===false?"":initial.snapshot.workMode==="single-line"?plan.text.replace(/\r?\n+/g," / "):plan.text;
    if (text.length>initial.snapshot.maxLength || text.length>20000) throw new Error("業務欄の文字数制限を超えています。切り捨てずに入力を中止します");
    const writes = [];
    if (!initial.snapshot.dateValue) writes.push({key:"date",value:today});
    if (plan.includeWork!==false) writes.push({key:"work",value:text});
    const expectedDate = initial.date.value, expectedWork = initial.work.value;
    let dateValue=expectedDate, workValue=expectedWork, written=0;
    function verify() {
      if (normalizeUrl(location.href)!==url) throw new Error("入力中に週報のページが変わりました");
      const current=inspect();
      if (!current.snapshot.accountMatched || current.snapshot.workMode!==initial.snapshot.workMode || current.snapshot.maxLength!==initial.snapshot.maxLength || current.date.value!==dateValue || current.work.value!==workValue) throw new Error("入力中に画面や値が変わりました。送信せず確認してください");
      return current;
    }
    for(const write of writes) {
      const current=verify(),el=current[write.key];
      const prototype=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,"value").set.call(el,write.value);
      if(write.key==="date")dateValue=write.value;else workValue=write.value;
      el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));
      written++; await new Promise(resolve=>setTimeout(resolve,0));
    }
    verify();
    // Never click submit, clear, account selection or any other button. Google may autosave a draft.
    return {written,submitted:false,googleDraftSavePossible:true};
  }
  root.WeeklyReportAdapter={run};
  if(typeof module!=="undefined"&&module.exports)module.exports=root.WeeklyReportAdapter;
})(globalThis);
