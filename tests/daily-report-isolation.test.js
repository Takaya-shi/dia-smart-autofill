"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path"), vm=require("node:vm");
test("daily-report site never uses ordinary profile fields or sends metadata to AI",async()=>{
  let listener, timer, calls=0, reads=0;
  const context=vm.createContext({console,location:{origin:"https://reports.example.test",pathname:"/productivity"},
    document:{documentElement:{},querySelectorAll(){reads++;throw Error("Must not inspect report fields");}},
    window:{setTimeout(fn){timer=fn;return 1;},clearTimeout(){}},
    MutationObserver:class{observe(){}disconnect(){}},
    chrome:{runtime:{id:"ext",onMessage:{addListener(fn){listener=fn;},removeListener(){}},async sendMessage(){calls++;throw Error("Must not load profiles or invoke AI");}}}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../content.js"),"utf8"),context);
  const result=await new Promise(resolve=>listener({type:"FILL_PAGE"},{},resolve));
  assert.equal(result.filled,0);assert.equal(result.reason,"daily-report-only");
  timer();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,0);assert.equal(reads,0);
});
