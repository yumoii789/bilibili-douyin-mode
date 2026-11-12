// 装包前自检：这份「装起来能不能用」的问题，行为测试是测不到的。
// 覆盖：manifest 合法性与版本、引用的文件是否都在、JS 可解析、CSS 花括号平衡、
// i18n 键齐全、文档版本号一致、以及 manifest 不引用 test/ 产物。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const R = [];
const ok = (n, c, d) => { const l = (c ? "PASS" : "FAIL") + " | " + n + (d === undefined ? "" : " | " + d); R.push(l); console.log(l); };
const P = (rel) => path.join(ROOT, rel.replace(/\//g, path.sep));

let m = null;
try { m = JSON.parse(fs.readFileSync(P("manifest.json"), "utf8")); ok("manifest 可解析", true); }
catch (e) { ok("manifest 可解析", false, e.message); }

if (m) {
  ok("manifest version = " + m.version, /^\d+\.\d+\.\d+$/.test(String(m.version || "")), String(m.version));
  const refs = [];
  for (const cs of m.content_scripts || []) { (cs.js || []).forEach((f) => refs.push(f)); (cs.css || []).forEach((f) => refs.push(f)); }
  if (m.background && m.background.service_worker) refs.push(m.background.service_worker);
  if (m.action && m.action.default_popup) refs.push(m.action.default_popup);
  if (m.options_page) refs.push(m.options_page);
  if (m.options_ui && m.options_ui.page) refs.push(m.options_ui.page);
  Object.values(m.icons || {}).forEach((f) => refs.push(f));
  const uniq = [...new Set(refs)];
  const missing = uniq.filter((f) => !fs.existsSync(P(f)));
  ok("manifest 引用的 " + uniq.length + " 个文件都存在", missing.length === 0, missing.join(", ") || "无缺失");

  const jsFiles = uniq.filter((f) => f.endsWith(".js"));
  const badJs = [];
  for (const f of jsFiles) {
    try { new Function(fs.readFileSync(P(f), "utf8")); } catch (e) { badJs.push(f + ": " + e.message); }
  }
  ok("所有 JS 语法可解析（" + jsFiles.length + " 个）", badJs.length === 0, badJs.join("; ") || "全部通过");

  const cssFiles = uniq.filter((f) => f.endsWith(".css"));
  const badCss = [];
  for (const f of cssFiles) {
    const s = fs.readFileSync(P(f), "utf8");
    const o = (s.match(/\{/g) || []).length, c = (s.match(/\}/g) || []).length;
    if (o !== c) badCss.push(f + " {=" + o + " }=" + c);
  }
  ok("所有 CSS 花括号平衡（" + cssFiles.length + " 个）", badCss.length === 0, badCss.join("; ") || "全部平衡");

  const msgs = [...new Set([...JSON.stringify(m).matchAll(/__MSG_(\w+)__/g)].map((x) => x[1]))];
  const badI18n = [];
  for (const loc of ["zh_CN", "en"]) {
    const p = P("_locales/" + loc + "/messages.json");
    if (!fs.existsSync(p)) { badI18n.push(loc + " 缺文件"); continue; }
    let j = null;
    try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { badI18n.push(loc + " JSON 错"); continue; }
    msgs.forEach((k) => { if (!j[k]) badI18n.push(loc + " 缺 " + k); });
  }
  ok("manifest 用到的 i18n 键两种语言都有（" + msgs.join(",") + "）", badI18n.length === 0, badI18n.join("; ") || "齐全");

  ok("manifest 不引用 test/ 里的产物", !uniq.some((f) => f.indexOf("test/") === 0 || f.indexOf("test\\") === 0));

  // 文档版本号一致（只查存在的文档，缺了不算失败）
  const docs = ["交付说明.md", "真机复测清单.md"].filter((f) => fs.existsSync(P(f)));
  const drift = docs.filter((f) => fs.readFileSync(P(f), "utf8").indexOf(String(m.version)) < 0);
  ok("文档里的版本号与 manifest 一致（" + docs.join(" / ") + "）", drift.length === 0, drift.join(", ") || "一致");
}

const fails = R.filter((x) => x.startsWith("FAIL"));
console.log("\n===== 装包前自检汇总：检查 " + R.length + " 项，失败 " + fails.length + " 项 =====");
process.exit(fails.length ? 1 : 0);
