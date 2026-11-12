// 扩展页面（options / popup）测试台：它们是独立页面，不在内容脚本沙箱里，故单列一套。
// 重点守两件事：① 存储形状与内容脚本一致（bdmSettings 整块）② 只写变化的键，不覆盖玩家内面板的新值。
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const R = [];
const ok = (n, c, d) => { const l = (c ? "PASS" : "FAIL") + " | " + n + (d === undefined ? "" : " | " + d); R.push(l); console.log(l); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));

function fakeEl(id) {
  return { id, value: "", checked: false, style: (function () { var m = {}; m.setProperty = function (k, x) { m[k] = String(x); }; m.getPropertyValue = function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : ""; }; m.removeProperty = function (k) { delete m[k]; }; return m; })(),
    _h: {},
    addEventListener(t, h) { (this._h[t] = this._h[t] || []).push(h); },
    dispatchEvent(ev) { ev.target = ev.target || this; (this._h[ev.type] || []).slice().forEach(h => h(ev)); }
  };
}
function makePage(ids) {
  const els = {};
  ids.forEach(i => { els[i] = fakeEl(i); });
  const body = { _h: {},
    addEventListener(t, h) { (this._h[t] = this._h[t] || []).push(h); },
    dispatchEvent(ev) { (this._h[ev.type] || []).slice().forEach(h => h(ev)); }
  };
  return { els, body, document: { getElementById: (id) => els[id] || null, body } };
}
const store = {};
let openedOptions = 0;
const chromeMock = { storage: { local: {
  get: async (k) => ({ [k]: store[k] }),
  set: async (o) => { Object.assign(store, o); }
} }, runtime: { openOptionsPage: () => { openedOptions++; } } };
function sandboxFor(page) {
  const sb = { document: page.document, chrome: chromeMock, console, setTimeout, clearTimeout,
    parseFloat, parseInt, Object, JSON, Promise, Array, String, Number };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  return vm.createContext(sb);
}

// ---------- options 页 ----------
store.bdmSettings = { dmFont: 30, enabled: true };   // dmFont=30 模拟「玩家内面板刚改过」
const OPT = makePage(["volume", "dmOpacity", "dmFont", "dmSpeed", "enabled", "desktopSkin",
  "profileGuard", "allowExplicitLike", "suppressLoginPopup", "noAutoPause", "debug", "saved"]);
vm.runInContext(fs.readFileSync(path.join(ROOT, "options", "options.js"), "utf8"), sandboxFor(OPT), { filename: "options.js" });
await tick();
ok("options 初始化：存储值写入控件", OPT.els.dmFont.value === 30, String(OPT.els.dmFont.value));
ok("options 初始化：未存储的键回落默认值", OPT.els.volume.value === 0.7 && OPT.els.debug.checked === false,
  "volume=" + OPT.els.volume.value + " debug=" + OPT.els.debug.checked);
store.bdmSettings = Object.assign({}, store.bdmSettings, { dmFont: 12 });   // 设置页打开期间，玩家内把字号改成 12
OPT.els.enabled.checked = false;
OPT.body.dispatchEvent({ type: "change", target: OPT.els.enabled });
await tick();
ok("options 只写变化的那一个键", store.bdmSettings.enabled === false, JSON.stringify(store.bdmSettings));
ok("options 不覆盖玩家内期间改过的键（陈旧快照回归）", store.bdmSettings.dmFont === 12, "dmFont=" + store.bdmSettings.dmFont);
ok("options 保存提示有反馈", OPT.els.saved.style.opacity === 1, String(OPT.els.saved.style.opacity));

// ---------- popup 页 ----------
store.bdmSettings = { enabled: true, dmEnabled: true, autoplayNext: true, desktopSkin: false };
const POP = makePage(["enabled", "desktopSkin", "dmEnabled", "autoplayNext", "suppressLoginPopup",
  "noAutoPause", "profileGuard", "openOptions"]);
vm.runInContext(fs.readFileSync(path.join(ROOT, "popup", "popup.js"), "utf8"), sandboxFor(POP), { filename: "popup.js" });
await tick();
ok("popup 初始化：默认关闭项不被误勾选", POP.els.desktopSkin.checked === false && POP.els.dmEnabled.checked === true,
  "desktopSkin=" + POP.els.desktopSkin.checked + " dmEnabled=" + POP.els.dmEnabled.checked);
store.bdmSettings = Object.assign({}, store.bdmSettings, { dmEnabled: false });   // 玩家内在沉浸流里关掉弹幕
POP.els.autoplayNext.checked = false;
POP.els.autoplayNext.dispatchEvent({ type: "change", target: POP.els.autoplayNext });
await tick();
ok("popup 只写变化的那一个键", store.bdmSettings.autoplayNext === false, JSON.stringify(store.bdmSettings));
ok("popup 不覆盖玩家内改过的键（陈旧快照回归）", store.bdmSettings.dmEnabled === false, "dmEnabled=" + store.bdmSettings.dmEnabled);
POP.els.openOptions.dispatchEvent({ type: "click" });
ok("「更多设置…」能打开选项页", openedOptions === 1, String(openedOptions));

// ---------- 两页与内容脚本的存储形状一致性 ----------
const contentSettings = fs.readFileSync(path.join(ROOT, "content", "settings.js"), "utf8");
const optSrc = fs.readFileSync(path.join(ROOT, "options", "options.js"), "utf8");
const popSrc = fs.readFileSync(path.join(ROOT, "popup", "popup.js"), "utf8");
ok("存储形状一致：内容脚本 key = bdmSettings",
  /get\("bdmSettings"\)/.test(contentSettings) && /get\("bdmSettings"\)/.test(optSrc) && /get\("bdmSettings"\)/.test(popSrc));
ok("两页都做读改写（不整块覆盖）",
  /const cur = \(await chrome\.storage\.local\.get\("bdmSettings"\)\)\.bdmSettings \|\| \{\}/.test(optSrc) &&
  /const cur = \(await chrome\.storage\.local\.get\("bdmSettings"\)\)\.bdmSettings \|\| \{\}/.test(popSrc));

// ---------- 文案诚实性 ----------
const oh = fs.readFileSync(path.join(ROOT, "options", "options.html"), "utf8");
ok("弹幕速度标签已改为诚实表述（不再是误导性的「秒/屏」）", oh.indexOf("数值越大越快") >= 0 && oh.indexOf("秒/屏") < 0);
ok("选项页指向播放器内面板（用户知道更多设置在哪）", oh.indexOf("在播放器内") >= 0);

// ---------- 后台中转白名单（安全边界，必须与 manifest 的 *://*.hdslb.com/* 一致）----------
// 这是给用户承诺过的边界（「后台只放行 hdslb.com，不做通用代理」），必须挡住差一个字符的假域。
const sw = fs.readFileSync(path.join(ROOT, "background", "service-worker.js"), "utf8");
const mRe = sw.match(/if \(!\s*(\/\^https[^;]*?\/i)\.test\(u\)\)/);
const allow = mRe ? eval(mRe[1]) : null;
ok("后台中转白名单只放行 *.hdslb.com（挡住 evil-hdslb.com 这类假域）",
  !!allow && allow.test("https://aisubtitle.hdslb.com/bfs/subtitle/x.json") &&
  !allow.test("https://evil-hdslb.com/bfs/subtitle/x.json") &&
  !allow.test("http://aisubtitle.hdslb.com/x.json") && !allow.test("https://hdslb.com.evil.com/x.json"),
  allow ? "正则=" + mRe[1] : "未匹配到白名单正则");

// ---------- 样式守卫（几何审计的回归线）----------
// 依据：真机窗口 1389×628 必然命中 max-height:720px 矮窗分支，而该分支曾长期零覆盖（预览页测错了断点）。
// 这几条不是「样式应该长这样」，而是「矮窗不能滚出去」和「悬停展开不能被当成重叠缺陷删掉」。
const css = fs.readFileSync(path.join(ROOT, "content", "douyin-mode.css"), "utf8");
function cssBlock(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  const s = src.indexOf("{", i);
  if (s < 0) return null;
  let d = 0;
  for (let k = s; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (d === 0) return src.slice(s + 1, k); }
  }
  return null;
}
const flat = (s) => (s || "").replace(/\s+/g, " ");
const shortWin = flat(cssBlock(css, "@media (max-height: 720px)"));
ok("矮窗分支存在：操作栏紧凑（gap 12）并为两行底栏让位（bottom 104）",
  /\.bdm-rail\s*\{[^}]*gap:\s*12px[^}]*bottom:\s*104px/.test(shortWin), shortWin ? "块内 " + shortWin.length + " 字符" : "未找到 max-height:720px 块");
ok("矮窗分支同时上移信息块(108) / 控制条(46) / 进度条(88)",
  /\.bdm-info\s*\{[^}]*bottom:\s*108px/.test(shortWin) &&
  /\.bdm-ctrl\s*\{[^}]*bottom:\s*46px/.test(shortWin) &&
  /\.bdm-seek\s*\{[^}]*bottom:\s*88px/.test(shortWin));
// 两行底栏是 B站 实测结构（控制条 35px + 独立 46px 弹幕发送行），钉住它别被合并回一行
ok("底部是两行：弹幕发送行 46px 贴底（bottom 0），控制条从 46px 起",
  /\.bdm-dm-row\s*\{[^}]*bottom:\s*0[^}]*height:\s*46px/.test(flat(css)) &&
  /\.bdm-ctrl\s*\{[^}]*bottom:\s*46px/.test(flat(css)));
ok("矮窗下发送行压到 42px（628 高要省空间）", /\.bdm-dm-row\s*\{\s*height:\s*42px/.test(shortWin));
ok("发送行左右分组都在（左 开关/设置，右 发送）", /\.bdm-dm-row-left,\s*\.bdm-dm-row-right\s*\{/.test(flat(css)));
ok("音量是悬停展开（宽度 0 的滑块与右侧按钮盒相交属设计，不是重叠缺陷）",
  /\.bdm-vol:hover\s+\.bdm-vol-slide\s*\{[^}]*width:\s*72px/.test(flat(css)) &&
  /\.bdm-vol-slide\s*\{[^}]*width:\s*0[^}]*overflow:\s*hidden/.test(flat(css)));

// B站 实测度量（真浏览器量的 bpx-player-* 节点盒），对齐后必须钉住：
// 控制条 35px / 按钮 36×22（边框盒）/ 右段间距 0 / 进度条 4px。
ok("控制条高度 35px（B站 bpx-player-control-bottom 实测）", /\.bdm-ctrl\s*\{[^}]*height:\s*35px/.test(flat(css)));
ok("控制条按钮 36×22 且为边框盒（B站 的 36×22 是边框盒，content-box 会多出 12px 内边距）",
  /\.bdm-ctrl-btn\s*\{[^}]*box-sizing:\s*border-box[^}]*height:\s*22px[^}]*min-width:\s*36px/.test(flat(css)));
ok("右段按钮紧邻（间距 0）", /\.bdm-ctrl-left,\s*\.bdm-ctrl-right\s*\{[^}]*gap:\s*0/.test(flat(css)));
ok("进度条 4px（B站 bpx-player-progress 实测）", /\.bdm-seek-track\s*\{[^}]*height:\s*4px/.test(flat(css)));

// 两行底栏把底部占高了，浮层必须一起上移，否则会压住发送行/进度条
ok("浮层都让开两行底栏（设置 112 / 菜单 112 / 评论面板 112）",
  /\.bdm-settings\s*\{[^}]*bottom:\s*112px/.test(flat(css)) &&
  /\.bdm-menu\s*\{[^}]*bottom:\s*112px/.test(flat(css)) &&
  /\.bdm-panel\s*\{[^}]*bottom:\s*112px/.test(flat(css)));
ok("设置面板高度公式同步收缩（100% - 178px），矮窗下不被裁顶", /\.bdm-settings\s*\{[^}]*max-height:\s*calc\(100% - 178px\)/.test(flat(css)));

ok("写操作提交中的样式在（按钮变暗且不吃点击）",
  /\.bdm-ctrl-btn\.bdm-sending\s*\{[^}]*pointer-events:\s*none/.test(flat(css)) &&
  /\.bdm-act\.bdm-sending\s*\{[^}]*pointer-events:\s*none/.test(flat(css)));

// 压在画面上的白色文字：靠描边兜底可读性（这是裸白字在亮画面上唯一的救命绳）
ok("压画面的白字都有描边：UP名 + 标题 + 数据行 + 右栏数字 + 字幕",
  /\.bdm-upname\s*\{[^}]*text-shadow/.test(flat(css)) &&   // 白字是 .bdm-upname，.bdm-info-author 只是 flex 容器
  /\.bdm-info-title\s*\{[^}]*text-shadow/.test(flat(css)) &&
  /\.bdm-info-meta\s*\{[^}]*text-shadow/.test(flat(css)) &&
  /\.bdm-act-num\s*\{[^}]*text-shadow/.test(flat(css)) &&
  /\.bdm-sub\s*\{[^}]*text-shadow/.test(flat(css)));
// 遮罩高度是有理由的：我们的信息块/右栏压在画面上，需要比 B站 那条 100px（占播放器 19.8%）更宽；
// 但也不能宽到把画面压灰。留一个 30%~50% 的合理带。
ok("底部遮罩高度在 30%~50% 的合理带内",
  /\.bdm-slide::after\s*\{[^}]*height:\s*(3[0-9]|4[0-9])%/.test(flat(css)));

// 皮肤侧栏的两条布局修复（靠真渲染快照发现的，见 开发记录 §73）：
// ① 搜索容器带 min-height（100% 量级）会把导航项推到视口外 → 必须给 max-height
// ② 行高挂在 item 包裹层（B站 64px）→ 必须连包裹层一起压，否则「桌面客户端行高」的声明不生效
const skin = fs.readFileSync(path.join(ROOT, "content", "desktop-skin.css"), "utf8");
const skinFlat = flat(skin);
ok("皮肤：搜索容器有高度上限（否则 min-height 会把导航项推到视口外）",
  /\.center-search-container\.menu-center\s*\{[^}]*max-height:\s*56px/.test(skinFlat));
ok("皮肤：导航行高连 item 包裹层一起压（B站 的 64px 挂在包裹层上）",
  /\.left-entry__item,\s*html\.bdm-skin \.v-popover-wrap\.left-entry__item\s*\{[^}]*height:\s*40px\s*!important/.test(skinFlat));

ok("皮肤：内容列的头也压掉了 min-width（否则首页会出现 20px 横向滚动条）",
  /\.bili-header,\s*html\.bdm-skin \.bili-header--large\s*\{[^}]*min-width:\s*0\s*!important/.test(skinFlat));

// 侧栏里的「刷B站」入口：真渲染验证这一轮没做成（探针把预览页弄坏了，已撤），
// 先用文本级守卫钉住它**声明**的尺寸，并如实标注「真渲染未验」。
ok("皮肤：侧栏入口按钮与其它导航行同形（整行、40px、flex 左对齐）",
  /\.left-entry > #bdm-nav-btn\s*\{[^}]*width:\s*100%[^}]*height:\s*40px[^}]*display:\s*flex/.test(skinFlat));
// 真渲染实测（§94）：B站 给 .left-entry/.left-entry-main 钉了 64px 高，导致跟随其后的
// 「刷B站」按钮被排到导航中间 —— 必须把高度交还给内容。
ok("皮肤：导航容器高度交还内容（否则注入的入口会插到导航项中间）",
  /\.left-entry,\s*html\.bdm-skin \.left-entry-main\s*\{[^}]*height:\s*auto\s*!important/.test(skinFlat));

// 真因（§95）：B站 给图标元素自己设了 color:#fff，而 fill:currentColor 取的是**元素自己的 color** →
// 只改 fill 没用，必须把 color 也收回成 inherit。
ok("皮肤：侧栏图标把 color 收回并跟随文字色（只改 fill 无效）",
  /\.left-entry__item-trigger svg path[^{]*\{[^}]*color:\s*inherit\s*!important[^}]*fill:\s*currentColor/.test(skinFlat));

// 「完全接管」层（§96）：隐藏网页特有元素、头部重排、频道条吸顶、胶囊限宽
ok("皮肤：接管层——隐藏 footer 与网页特有入口",
  /footer,[\s\S]{0,200}display:\s*none\s*!important/.test(skinFlat) &&
  /\.channel-items__right,[\s\S]{0,80}\.channel-link__right\s*\{\s*display:\s*none/.test(skinFlat));
ok("皮肤：接管层——头部竖排 + 频道条在 banner 之前（order）",
  /\.bili-header\s*\{\s*display:\s*flex\s*!important[\s\S]{0,80}flex-direction:\s*column/.test(skinFlat) &&
  /\.bili-header__channel\s*\{\s*order:\s*1\s*!important/.test(skinFlat));
ok("皮肤：接管层——频道条吸顶 + 胶囊限宽（实测与右搜索框不重叠的组合）",
  /\.bili-header__channel\s*\{[^}]*position:\s*fixed/.test(skinFlat) &&
  /\.right-channel-container\s*\{\s*max-width:\s*calc\(100% - 320px\)/.test(skinFlat));

ok("皮肤：搜索下拉面板补足宽度（容器被搬成 fixed 后它只有 200px）",
  /\.search-panel\s*\{\s*min-width:\s*268px\s*!important/.test(skinFlat));

ok("皮肤：body 让位用 :has() 守住（只在页面真有头部容器时才加 200px）",
  /body:has\(\.bili-header__bar\)\s*\{\s*padding-left/.test(skinFlat));
// 无条件的 body padding-left **只允许**出现在 @supports 兜底块里（那里的出现是刻意的）
const flatUncond = skinFlat.indexOf("html.bdm-skin body { padding-left");
const flatSupports = skinFlat.indexOf("@supports not selector(:has(*)");
ok("皮肤：无条件让位只出现在 :has() 的 @supports 兜底里",
  flatUncond < 0 || (flatSupports >= 0 && flatUncond > flatSupports),
  "无条件处=" + flatUncond + " 兜底块=" + flatSupports);

// 滚动实测：sticky 吸不住（粘性范围被父容器限制）→ 必须 fixed；让位高度用脚本量出的变量
ok("皮肤：频道条是 fixed（sticky 实测吸不住）且让位用 --bdm-channel-h",
  /\.bili-header__channel\s*\{[^}]*position:\s*fixed\s*!important/.test(skinFlat) &&
  /body:has\(\.bili-header__channel\)\s*\{\s*padding-top:\s*var\(--bdm-channel-h/.test(skinFlat));

const fails = R.filter((x) => x.startsWith("FAIL"));
console.log("\n===== 页面测试汇总：断言 " + R.length + " 条，失败 " + fails.length + " 条 =====");
if (fails.length) console.log(fails.join("\n"));
process.exit(fails.length ? 1 : 0);
