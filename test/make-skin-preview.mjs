// 由「抓取到的页面快照」生成皮肤预览页：剥离脚本、远程图换占位、注入我们的样式与自检脚本。
// 用法：node test/make-skin-preview.mjs 逆向资料/网页源码/home-live.html test/skin-preview-live.html
// 注意：生成物含 B站 的页面结构，已在 .gitignore 里排除，不要提交。
import fs from "node:fs";

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.log("用法：node test/make-skin-preview.mjs <抓取的html> <输出html>"); process.exit(1); }
const PIX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

let html = fs.readFileSync(src, "utf8");
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
fs.writeFileSync(out, html, "utf8");
console.log("已生成 " + out + "（" + Math.round(html.length / 1024) + " KB）");
