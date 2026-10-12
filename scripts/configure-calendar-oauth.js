#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),Calendar=require("../calendar-sync.js");
function configure(manifest,id) {
  if(!Calendar.clientId({oauth2:{client_id:id}}))throw new Error("GoogleのChrome拡張機能用クライアントIDを指定してください。APIキー・シークレットは使用しません");
  return {...manifest,oauth2:{client_id:id,scopes:[Calendar.SCOPE]}};
}
if(require.main===module) {
  try {
    const filename=path.join(__dirname,"../manifest.json"),manifest=JSON.parse(fs.readFileSync(filename,"utf8"));
    const updated=configure(manifest,process.argv[2]);
    fs.writeFileSync(`${filename}.before-calendar-oauth`,JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
    fs.writeFileSync(filename,JSON.stringify(updated,null,2)+"\n");
    process.stdout.write("読み取り専用のGoogleクライアント設定を反映しました。拡張を再読み込みしてください。認証・取得はまだ実行していません。\n");
  }catch(_error){process.stderr.write("設定できませんでした。クライアントIDの形式、書き込み許可、既存バックアップを確認してください。入力値は表示しません。\n");process.exitCode=1;}
}
module.exports={configure};
