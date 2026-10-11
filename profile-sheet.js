(function(root) {
  "use strict";
  const Matcher = root.AutoFillMatcher || (typeof require === "function" ? require("./matcher.js") : null);
  const LIMITS = Object.freeze({characters:20000,entries:80,label:80,value:2000});
  const TEMPLATE = "氏名：\nふりがな：\n個人メール：\n会社メール：\n電話番号：\n住所：\n会社名：\n部署：\n役職：\n得意分野：\n";
  function sensitive(text) {
    return /cc-|one-time-code|password|passwd|credit.?card|card.?number|cvv|cvc|otp|api.?key|token|secret|カード|口座|暗証|認証コード|パスワード|APIキー|マイナンバー|social.?security|\bssn\b/i.test(String(text).normalize("NFKC"));
  }
  function forbiddenValue(value) {
    if(/(?:sk-|gh[pousr]_|AIza)[A-Za-z0-9_-]{20,}|-----BEGIN .*PRIVATE KEY-----/i.test(value))return true;
    return Array.from(value.matchAll(/(?:\d[ -]?){13,19}/g)).some(match=>{
      const digits=match[0].replace(/\D/g,"");
      if(digits.length<13||digits.length>19)return false;
      let sum=0; for(let i=digits.length-1,double=false;i>=0;i--,double=!double){let digit=Number(digits[i]);if(double){digit*=2;if(digit>9)digit-=9;}sum+=digit;}
      return sum%10===0;
    });
  }
  function kindOf(label) {
    const normalized=Matcher.normalize(label);
    if(["住所","全住所","フル住所","fulladdress"].includes(normalized))return "fullAddress";
    if(/メール|email|mailaddress/i.test(label))return "email";
    if(/電話|携帯番号|phone|telephone/i.test(label))return "phone";
    for(const [kind,rule] of Object.entries(Matcher.FIELD_RULES))
      if([kind,...rule.aliases].some(alias=>Matcher.normalize(alias)===normalized))return kind;
    return "custom";
  }
  function parse(text) {
    if(typeof text!=="string"||text.length>LIMITS.characters)throw new Error("情報メモは20,000文字以内で入力してください");
    const entries=[],labels=new Set(); let current=null;
    for(const [index,line] of text.split(/\r?\n/).entries()) {
      if(!line.trim()||/^\s*#/.test(line))continue;
      if(/^\s{2,}\S/.test(line)&&current) {
        current.value+="\n"+line.trim();
        if(current.value.length>LIMITS.value)throw new Error(`${index+1}行目：1項目は2,000文字以内です`);
        continue;
      }
      const match=line.match(/^\s*(?:[-*]\s+)?([^：:]+)[：:]\s*(.*)$/);
      if(!match)throw new Error(`${index+1}行目：「項目名：内容」で入力してください。続きは2文字以上字下げします`);
      const label=match[1].trim(),value=match[2].trim(),normalized=Matcher.normalize(label);
      if(!normalized||label.length>LIMITS.label)throw new Error(`${index+1}行目：項目名は1〜80文字で入力してください`);
      if(sensitive(label))throw new Error(`${index+1}行目：カード・認証情報などは情報メモに登録できません`);
      if(labels.has(normalized))throw new Error(`${index+1}行目：同じ項目名が重複しています`);
      if(value.length>LIMITS.value)throw new Error(`${index+1}行目：1項目は2,000文字以内です`);
      labels.add(normalized); current={key:`sheet:${entries.length}`,label,kind:kindOf(label),value}; entries.push(current);
      if(entries.length>LIMITS.entries)throw new Error("情報メモは80項目以内で入力してください");
    }
    if(entries.some(entry=>forbiddenValue(entry.value)))throw new Error("APIキー・カード番号らしき値はメモに登録できません。専用の設定を使ってください");
    return entries.filter(entry=>entry.value);
  }
  function entriesFor(profile={}) {
    if(profile.sheetEnabled === true || (profile.sheetEnabled !== false && profile.sheetText?.trim())) {
      const entries=parse(profile.sheetText || "");
      for(const [kind,parts,label] of [["fullName",["lastName","firstName"],"氏名（姓と名）"],["fullNameKana",["lastNameKana","firstNameKana"],"フリガナ（姓と名）"]]) {
        if(entries.some(entry=>entry.kind===kind))continue;
        const values=parts.map(part=>entries.filter(entry=>entry.kind===part));
        if(values.every(items=>items.length===1))entries.push({key:`sheet:${kind}`,kind,label,value:values.map(items=>items[0].value).join(" ")});
      }
      return entries;
    }
    const entries=[];
    for(const kind of [...Object.keys(Matcher.FIELD_RULES),"fullAddress"]) {
      const value=kind==="fullAddress"?[profile.prefecture,profile.city,profile.address1,profile.address2].filter(Boolean).join(""):profile[kind];
      if(typeof value==="string"&&value.trim())entries.push({key:kind,kind,label:Matcher.FIELD_RULES[kind]?.aliases.find(alias=>/[\u3000-\u9fff]/.test(alias))||kind,value});
    }
    for(const [index,custom] of (profile.customFields||[]).entries()) {
      if(custom?.aliases&&custom?.value&&!sensitive(custom.aliases))entries.push({key:`custom:${index}`,kind:"custom",label:String(custom.aliases).slice(0,LIMITS.label),value:String(custom.value)});
    }
    return entries.slice(0,100);
  }
  function redact(text,profile) {
    let result=String(text||"");
    const values=[...Object.entries(profile).filter(([key,value])=>key!=="id"&&key!=="sheetText"&&typeof value==="string").map(([,value])=>value),...entriesFor(profile).map(entry=>entry.value),...(profile.customFields||[]).map(entry=>entry.value)].filter(value=>typeof value==="string"&&value.length>0).sort((a,b)=>b.length-a.length);
    for(const value of values)result=result.split(value).join("[saved value]");
    return result.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[email]").replace(/(?:\+?\d[\d ()-]{6,}\d)/g,"[number]");
  }
  function catalogFor(profile) {
    return entriesFor(profile).map(({key,label,kind})=>({key,label:redact(label,profile),kind}));
  }
  function metaAllows(meta,kind) {
    const hint=[meta.name,meta.id,meta.label,meta.ariaLabel,meta.description,meta.autocomplete].join(" ");
    if(sensitive(hint)||/tel-(?:country-code|area-code|local|extension)|bday-(?:day|month|year)/i.test(meta.autocomplete||""))return false;
    return Matcher.fieldTypeAllows(meta,kind)&&Matcher.fieldSemanticsAllow(meta,kind);
  }
  function resolve(key,profile,meta) {
    const entry=entriesFor(profile).find(item=>item.key===key);
    if(!entry||!metaAllows(meta,entry.kind))return null;
    const autocomplete=String(meta.autocomplete||"").toLowerCase().split(/\s+/);
    const requested=Object.entries(Matcher.FIELD_RULES).filter(([,rule])=>(rule.autocomplete||[]).some(token=>autocomplete.includes(token))).map(([kind])=>kind);
    if(requested.length&&!requested.includes(entry.kind)&&!(entry.kind.endsWith("Kana")&&requested.includes(entry.kind.replace(/Kana$/,"")))&&!(entry.kind==="fullAddress"&&requested.includes("address1")))return null;
    const scope=text=>/会社|業務|勤務先|仕事|\b(?:work|business|company)\b/i.test(text)?"work":/個人|私用|\b(?:personal|private|home)\b/i.test(text)?"personal":null;
    const targetScope=scope([meta.label,meta.ariaLabel,meta.name].join(" ")),sourceScope=scope(entry.label);
    if(targetScope&&sourceScope&&targetScope!==sourceScope)return null;
    let value=entry.value;
    if(entry.kind.endsWith("Kana")) {
      value=value.normalize("NFKC");
      if(!/^[ぁ-ゖァ-ヶー・\s]+$/.test(value))return null;
      value=Matcher.adaptKanaValue(value,meta);
    }
    if(/カナ|ふりがな|フリガナ|phonetic|furigana|kana|ヨミ/i.test([meta.label,meta.name,meta.id,meta.ariaLabel].join(" "))&&!entry.kind.endsWith("Kana"))return null;
    const type=String(meta.type||"text").toLowerCase();
    if(type!=="textarea"&&/[\r\n]/.test(value))return null;
    if(type==="email"&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return null;
    if(type==="url"&&!/^https?:\/\/\S+$/i.test(value))return null;
    if(type==="number"&&!/^[+-]?\d+(?:\.\d+)?$/.test(value))return null;
    if(type==="date"&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))return null;
    if(Number.isFinite(meta.maxLength)&&meta.maxLength>=0&&value.length>meta.maxLength)return null;
    return value;
  }
  function fallback(meta,profile,threshold=105) {
    const candidates=entriesFor(profile).map(entry=>{
      const exact=String(entry.label).split(/[,、]/).some(label=>[meta.name,meta.id,meta.label,meta.ariaLabel].some(text=>Matcher.normalize(text)===Matcher.normalize(label)));
      return {fieldKey:entry.key,value:resolve(entry.key,profile,meta),score:Math.max(exact?110:0,Matcher.scoreCandidate(meta,entry.kind))};
    }).filter(entry=>entry.value&&entry.score>=threshold).sort((a,b)=>b.score-a.score);
    return candidates.length&&(!candidates[1]||candidates[0].score-candidates[1].score>=10)?candidates[0]:null;
  }
  function toMemo(profile={}) {
    return entriesFor({...profile,sheetEnabled:false,sheetText:""}).filter(entry=>entry.kind!=="fullAddress"||!profile.address1).map(entry=>`${entry.label}：${entry.value.replace(/\n/g,"\n  ")}`).join("\n");
  }
  root.ProfileSheet={LIMITS,TEMPLATE,sensitive,kindOf,parse,entriesFor,redact,catalogFor,metaAllows,resolve,fallback,toMemo};
  if(typeof module!=="undefined"&&module.exports)module.exports=root.ProfileSheet;
})(globalThis);
