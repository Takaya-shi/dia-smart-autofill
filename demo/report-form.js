"use strict";
const fixtureIds = ["start","end","hours1","hours2","notes1","notes2"];
let submitted = 0;
document.addEventListener("submit", event => { event.preventDefault(); document.getElementById("submitCount").textContent = String(++submitted); });
document.getElementById("fakeSave").addEventListener("click", () => { document.getElementById("submitCount").textContent = String(++submitted); });
function resetFixture() {
  fixtureIds.forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("date").value = "2026-10-08";
  document.getElementById("project1").value = "社内サンプル"; document.getElementById("project2").value = "検証サンプル";
  document.getElementById("notes1").disabled = false;
}
document.getElementById("resetFixture").addEventListener("click", resetFixture);
document.getElementById("runSafetyTests").addEventListener("click", async () => {
  const results = [];
  const inspect = () => DailyReportAdapter.run({operation:"inspect",allowFixture:true});
  const fill = plan => DailyReportAdapter.run({operation:"fill",plan,allowFixture:true});
  const planFor = state => ({ date:state.date, fingerprint:state.fingerprint, start:"10:00", end:"18:00", breakMinutes:60, reviewed:true, submit:false,
    rows:state.rows.map(row=>({...row,minutes:210,notes:`${row.name}の架空作業`})) });
  const values = () => fixtureIds.map(id=>document.getElementById(id).value).join("|");
  async function rejects(name, mutate, useOldFingerprint = false) {
    resetFixture(); let state = await inspect(); let plan = planFor(state); mutate(plan);
    if (!useOldFingerprint) plan.fingerprint = (await inspect()).fingerprint;
    const before = values(); let rejected = false;
    try { await fill(plan); } catch { rejected = true; }
    results.push({name,passed:rejected && before === values() && submitted === 0});
  }
  try {
    resetFixture(); const result = await fill(planFor(await inspect()));
    results.push({name:"空欄6欄を入力・送信0回",passed:result.written===6 && result.submitted===false && document.getElementById("hours1").value==="3.5" && document.getElementById("notes2").value==="検証サンプルの架空作業" && submitted===0});
    await rejects("既存内容を上書きしない",()=>{document.getElementById("notes1").value="既存の作業";});
    await rejects("日付が違えば書かない",plan=>{plan.date="2026-10-09";});
    await rejects("プレビュー後の案件変更を拒否",()=>{document.getElementById("project1").value="別案件";},true);
    await rejects("時間合計の不一致を拒否",plan=>{plan.rows[0].minutes=180;});
    await rejects("30分未満への自動丸めなし",plan=>{plan.rows[0].minutes=200; plan.rows[1].minutes=220;});
    await rejects("送信ありの要求を拒否",plan=>{plan.submit=true;});
    await rejects("作業内容が空なら拒否",plan=>{plan.rows[0].notes="";});
    resetFixture(); document.getElementById("project2").value="社内サンプル";
    let duplicateRejected = false; try { await inspect(); } catch { duplicateRejected = true; }
    results.push({name:"同名案件を勝手に対応させない",passed:duplicateRejected});
    resetFixture(); document.getElementById("notes1").disabled=true;
    let structureRejected=false; try { await inspect(); } catch { structureRejected=true; }
    results.push({name:"欄の構造が変われば中止",passed:structureRejected});
    resetFixture(); const htmlPlan=planFor(await inspect()); htmlPlan.rows[0].notes='<img src="https://invalid.example/x">';
    await fill(htmlPlan); results.push({name:"HTMLを実行せず文字として入力",passed:document.getElementById("notes1").value===htmlPlan.rows[0].notes && !document.querySelector('img[src="https://invalid.example/x"]')});
  } catch(error) { results.push({name:error.message,passed:false}); }
  document.getElementById("safetyResult").textContent=results.map(test=>`${test.passed?"PASS":"FAIL"} ${test.name}`).join("\n")+`\n${results.filter(test=>test.passed).length}/${results.length} 成功 / 保存・送信 ${submitted}回`;
  resetFixture();
});
