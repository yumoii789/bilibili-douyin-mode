// 一条命令跑完全部测试：内容脚本全链路 + 扩展页面
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const suites = ["preflight.mjs", "vm-test.mjs", "pages-test.mjs"];   // 装包前自检也纳入全量：改完代码顺带验「装得起来」
let bad = 0;
for (const f of suites) {
  console.log("\n########## " + f + " ##########");
  const r = spawnSync(process.execPath, [path.join(here, f)], { stdio: "inherit" });
  if (r.status !== 0) bad++;
}
console.log("\n########## 总计： " + (suites.length - bad) + "/" + suites.length + " 套件通过 ##########");
process.exit(bad ? 1 : 0);
