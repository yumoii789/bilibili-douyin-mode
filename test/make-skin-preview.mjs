// 由「抓取到的页面快照」生成皮肤预览页：剥离脚本、远程图换占位、注入我们的样式与自检脚本。
// 用法：node test/make-skin-preview.mjs 逆向资料/网页源码/home-live.html test/skin-preview-live.html
// 注意：生成物含 B站 的页面结构，已在 .gitignore 里排除，不要提交。
import fs from "node:fs";

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.log("用法：node test/make-skin-preview.mjs <抓取的html> <输出html>"); process.exit(1); }
const PIX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const raw = fs.readFileSync(src, "utf8");
const rawHasHeader = /class="[^"]*(bili-header__bar|left-entry)/.test(raw);   // 必须在注入任何东西**之前**判
let html = raw;
html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
html = html.replace(/\ssrcset="[^"]*"/gi, "");
html = html.replace(/\ssrc="(https?:)?\/\/[^"]*"/gi, ' src="' + PIX + '"');
html = html.replace(/\sdata-src="[^"]*"/gi, "");
html = html.replace(/\s(onload|onerror|onclick)="[^"]*"/gi, "");
html = html.replace(/(href|src)="\/\//gi, '$1="https://');
html = html.replace(/<html[^>]*>/, (m) => m.replace(/<html/, '<html class="bdm-skin"'));

const stamp = Date.now();
const head = [
  '<link rel="stylesheet" href="../src/content/douyin-mode.css?v=' + stamp + '">',
  '<link rel="stylesheet" href="../src/content/desktop-skin.css?v=' + stamp + '">',
  "<style>*,*::before,*::after{animation:none !important;transition:none !important;background-image:none !important}video{display:none !important}</style>",
  "<script>" + fs.readFileSync(new URL("./skin-preview-check.js", import.meta.url), "utf8") + "<\/script>",
].join("\n");
html = html.replace("</head>", head + "\n</head>");

// 警告：这几类页面（番剧索引 / 排行榜 / 专栏 / 视频页…）是 **JS 渲染** 的，抓下来的 HTML 里
// 根本没有 .bili-header__bar 等头部容器 —— 拿它生成的预览页会**看起来像「皮肤不生效」**，
// 但那只是没渲染。真实验证只能靠：① 真浏览器取 DOM 快照做静态审计；② 真机看观感。
// ⚠️ 判据必须基于**原始快照**：我第一版判的是注入后的 html，而注入进去的自检脚本本身含
//    `.bili-header__bar` / `.left-entry` 这两个字符串 → 条件永远不成立，警告从未打过。
if (!rawHasHeader) {
  console.log("⚠️  这份快照里没有 .bili-header__bar/.left-entry —— 该页面是 JS 渲染的，");
  console.log("    生成物只能验「CSS 有没有泄漏」，不能用来判断「皮肤在这页生不生效」。");
}

fs.writeFileSync(out, html, "utf8");
console.log("已生成 " + out + "（" + Math.round(html.length / 1024) + " KB）");
