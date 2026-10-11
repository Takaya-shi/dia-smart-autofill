"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {exportSources} = require("../scripts/daily-report-export.js");
const fs = require("node:fs");
// Stub filesystem reads instead of writing to an actual Vault.
test("exporter limits reads to one Daily file and omits Notes and event details", () => {
  const original = { realpathSync:fs.realpathSync, statSync:fs.statSync, readFileSync:fs.readFileSync };
  const paths = [];
  fs.realpathSync = p => {paths.push(p);return p;};
  fs.statSync = () => ({isFile:()=>true,size:120});
  fs.readFileSync = p => { paths.push(p);return "## Tasks\n案件\n- 作業\n## Notes\n個人情報・内緒のメモ";};
  try {
    const output = exportSources("2026-10-08",{events:[{id:"shift",summary:"シフト_リモート",start:"2026-10-08T10:00:00+09:00",end:"2026-10-08T18:00:00+09:00",description:"内緒",location:"私的住所"},{summary:"会議"}],fetchedAt:"2026-10-11T00:00:00Z"},"/test/vault");
    assert.equal(output.submit,false);assert.equal(output.events.length,1);
    assert.equal(output.markdown,"## Tasks\n案件\n- 作業");
    assert.ok(paths.every(p=>p==="/test/vault/Daily/2026-10/2026-10-08.md"));
    assert.equal(JSON.stringify(output).includes("内緒"),false);
    assert.equal(JSON.stringify(output).includes("私的住所"),false);
    assert.throws(()=>exportSources("../../Note/private",{events:[]},"/test/vault"));
    assert.throws(()=>exportSources("2026-10-08",{events:[],next_page_token:"more"},"/test/vault"));
    fs.realpathSync=()=>"/test/vault/Note/secret.md";
    assert.throws(()=>exportSources("2026-10-08",{events:[]},"/test/vault"));
  } finally {Object.assign(fs,original);}
});
