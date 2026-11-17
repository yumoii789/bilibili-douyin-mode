// 装载顺序与全局冲突回归（第 4 套件）：离线把 manifest 声明的 content_scripts 真装一遍。
// 与 vm-test 的差异：vm-test 用一副厚夹具跑全链路交互；这里换一副**独立薄夹具**，专门守
// 「按 manifest 顺序装载零异常 + __BDM__ 模块键不冲突 + 全局顶层键不冲突」，多一层夹具多样性。
// 断言失败的判定纪律与 vm-test 相同：先区分「产品缺陷」与「测试台工件」，查到根因再改。
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CS = path.join(ROOT, "src", "content");
const R = [];
let fails = 0;
const ok = (name, cond, detail) => {
  const line = (cond ? "PASS" : "FAIL") + " | " + name + (detail === undefined ? "" : " | " + detail);
  if (!cond) fails++;
  R.push(line); console.log(line);
};

// ---------- 薄夹具：只为「装载」服务，够用即止（缺什么按探针输出补，不猜）----------
function mkEl(tag) {
  const e = {};
  e.tagName = String(tag || "div").toUpperCase();
  e.children = []; e.parentNode = null; e.attrs = {}; e._s = new Set(); e._handlers = {};
  e.style = { setProperty(){}, getPropertyValue(){ return ""; }, removeProperty(){} };
  e.value = ""; e.title = ""; e.placeholder = ""; e.disabled = false; e.id = "";
  e.paused = true; e.currentTime = 0; e.duration = 0; e.volume = 1; e.playbackRate = 1; e.muted = false;
  e.clientWidth = 1400; e.clientHeight = 800;
  Object.defineProperty(e, "className", {
    get() { return [...e._s].join(" "); },
    set(v) { e._s = new Set(String(v || "").split(/\s+/).filter(Boolean)); },
  });
  e.classList = { add(...c) { c.forEach(x => e._s.add(x)); }, remove(...c) { c.forEach(x => e._s.delete(x)); },
    contains(c) { return e._s.has(c); }, toggle(c, f) { const on = f === undefined ? !e._s.has(c) : !!f; on ? e._s.add(c) : e._s.delete(c); return on; } };
  e.setAttribute = (k, v) => { e.attrs[k] = v; if (k === "class") e.className = v; };
  e.getAttribute = k => (k in e.attrs ? e.attrs[k] : null);
  e.removeAttribute = k => { delete e.attrs[k]; };
  e.appendChild = c => { e.children.push(c); c.parentNode = e; return c; };
  e.insertBefore = (c, ref) => { e.appendChild(c); return c; };
  e.removeChild = c => { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); c.parentNode = null; return c; };
  e.remove = () => { if (e.parentNode) e.parentNode.removeChild(e); };
  e.addEventListener = (t, h) => { (e._handlers[t] = e._handlers[t] || []).push(h); };
  e.removeEventListener = () => {};
  e.dispatchEvent = () => true;
  e.querySelector = () => null;
  e.querySelectorAll = () => [];
  e.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1400, height: 800, right: 1400, bottom: 800 });
  e.focus = () => {}; e.blur = () => {}; e.click = () => {};
  e.play = () => Promise.resolve(); e.pause = () => {};
  return e;
}

function mkCtx(overrides) {
  const g = {};   // 沙箱全局（window 即它）
  const document = {
    createElement: t => mkEl(t),
    body: mkEl("body"), documentElement: mkEl("html"), head: mkEl("head"),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: "visible", hidden: false, readyState: "complete", activeElement: null,
    exitFullscreen() {}, fullscreenElement: null, pictureInPictureElement: null,
  };
  g.window = g; g.self = g; g.globalThis = g; g.document = document;
  g.console = console;
  g.setTimeout = (fn, ms) => setTimeout(fn, 0);   // 装载验证不真等：回调即刻跑、不留活定时器
  g.clearTimeout = () => {}; g.clearInterval = () => {};
  g.setInterval = () => 0;
  g.requestAnimationFrame = fn => setTimeout(fn, 0); g.cancelAnimationFrame = () => {};
  const store = {};
  g.chrome = {
    runtime: { getManifest: () => ({ version: "boot-test" }), onMessage: { addListener() {} }, sendMessage() {}, getURL: p => "chrome-extension://boot/" + p },
    storage: {
      local: { get: (k, cb) => { if (cb) cb({}); return Promise.resolve({}); },
               set: (o, cb) => { if (cb) cb(); return Promise.resolve(); },
               remove: (k, cb) => { if (cb) cb(); return Promise.resolve(); } },
      onChanged: { addListener() {}, removeListener() {} },
    },
    i18n: { getMessage: k => k },
  };
  g.fetch = () => Promise.resolve({ ok: false, status: 0, json: () => Promise.resolve({ code: -404 }), text: () => Promise.resolve("") });
  g.navigator = { userAgent: "Mozilla/5.0 boot-test", clipboard: { writeText: () => Promise.resolve() } };
  g.location = { href: "https://www.bilibili.com/", origin: "https://www.bilibili.com", pathname: "/", search: "", protocol: "https:", host: "www.bilibili.com" };
  g.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, addListener() {} });
  g.getComputedStyle = () => ({ getPropertyValue: () => "", setProperty() {}, removeProperty() {}, width: "0px", height: "0px" });
  g.MutationObserver = class { observe() {} disconnect() {} };
  // window 级监听器（desktop-skin.js 装载期即注册）；XHR 空壳（douyin-mode.js 装载期即用）。真浏览器皆有，此前缺 = 测试台工件。
  g.addEventListener = (t, h) => { (g._wh = g._wh || {}); (g._wh[t] = g._wh[t] || []).push(h); };
  g.removeEventListener = (t, h) => { const a = (g._wh[t] || []); const i = a.indexOf(h); if (i >= 0) a.splice(i, 1); };
  function XHR() {}
  XHR.prototype.open = function () {}; XHR.prototype.send = function () {}; XHR.prototype.setRequestHeader = function () {};
  g.XMLHttpRequest = XHR;
  g.URL = URL;
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.performance = { now: () => Date.now() };
  g.Event = class Event { constructor(t) { this.type = t; } };
  g.CustomEvent = class CustomEvent { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
  g.URLSearchParams = URLSearchParams;
  g.AbortController = AbortController;
  g.requestIdleCallback = fn => setTimeout(fn, 0);
  Object.assign(g, overrides || {});
  return g;
}

// 增量记录：装载一个脚本前后，全局顶层键 + __BDM__ 命名空间键各新增了什么
function snap(g) {
  const B = g.__BDM__ || null;
  return { top: new Set(Object.keys(g)), bdm: new Set(B ? Object.keys(B) : []) };
}
function added(after, before) {
  const t = [...after.top].filter(k => !before.top.has(k));
  const b = [...after.bdm].filter(k => !before.bdm.has(k));
  return { top: t, bdm: b };
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const jsList = manifest.content_scripts[0].js;   // 源头是 manifest，不是这里硬编码

// ---------- A. 按 manifest 顺序装载：零异常 + 模块齐全 ----------
const gA = mkCtx();
const ctxA = vm.createContext(gA);
const incA = [];
let bootErr = null;
for (const rel of jsList) {
  const f = path.basename(rel);
  const before = snap(gA);
  try {
    vm.runInContext(fs.readFileSync(path.join(CS, f), "utf8"), ctxA, { filename: f });
    const inc = added(snap(gA), before);
    incA.push({ f, top: inc.top, bdm: inc.bdm });
    ok("按 manifest 顺序装载 " + f, true, "顶层+=" + inc.top.join(",") + " __BDM__+=" + inc.bdm.join(","));
  } catch (e) {
    if (!bootErr) bootErr = f + ": " + (e && e.message);
    incA.push({ f, top: [], bdm: [] });
    ok("按 manifest 顺序装载 " + f, false, String(e && e.message).slice(0, 160));
  }
}
ok("装载零异常（全部六个脚本）", !bootErr, bootErr || "无");
const B = gA.__BDM__ || {};
ok("__BDM__ 模块齐全：settings/api/ui/Player/douyin/skin/dialogs（实得全集见上）",
  !!(B.settings && B.api && B.ui && B.Player && B.douyin && B.skin && B.dialogs),
  "实得=" + Object.keys(B).join(","));

// ---------- B. 全局冲突：模块键与顶层键两两无重叠 ----------
let dupBdm = [], dupTop = [];
for (let i = 0; i < incA.length; i++) {
  for (let j = i + 1; j < incA.length; j++) {
    for (const k of incA[i].bdm) if (incA[j].bdm.includes(k)) dupBdm.push(k + "(" + incA[i].f + "&" + incA[j].f + ")");
    for (const k of incA[i].top) if (incA[j].top.includes(k)) dupTop.push(k + "(" + incA[i].f + "&" + incA[j].f + ")");
  }
}
ok("__BDM__ 模块键无冲突（六个脚本两两比较）", dupBdm.length === 0, dupBdm.join(" ") || "无冲突");
ok("全局顶层键无冲突（__BDM__ 命名空间之外的收敛）", dupTop.length === 0, dupTop.join(" ") || "无冲突");

// ---------- C. 乱序探针（先出诊断，行为确认后再收成断言）----------
const gC = mkCtx();
const ctxC = vm.createContext(gC);
const rev = [...jsList].reverse();
const revErrs = [];
for (const rel of rev) {
  const f = path.basename(rel);
  try { vm.runInContext(fs.readFileSync(path.join(CS, f), "utf8"), ctxC, { filename: f }); }
  catch (e) { revErrs.push(f + ": " + String(e && e.message).slice(0, 80)); }
}
console.log("[探针] 乱序（倒序）装载诊断：" + (revErrs.length ? "抛错 " + revErrs.length + " 处 -> " + revErrs.join(" ; ") : "全部脚本防御式，乱序也不抛错"));
// 探针已定行为（v1 实跑）：倒序首装 douyin-mode.js 时裸引用 settings 未挂的 startLoginSuppression 抛错——
// manifest 顺序不可调换的直接证据。锁「乱序至少 1 处异常，且按序 0 处」这一对比，不锁具体报错文案（脚本重构会换）。
ok("乱序装载暴露依赖缺失（manifest 顺序不可调换），与按序 0 异常形成对比", revErrs.length >= 1 && !bootErr,
  revErrs.length ? revErrs[0].slice(0, 100) : "乱序不抛错（若脚本变防御式，此断言应连同注释一起重审）");

// ---------- 汇总 ----------
console.log("\n===== 装载测试汇总：断言 " + R.length + " 条，失败 " + fails + " 条 =====");
process.exit(fails ? 1 : 0);