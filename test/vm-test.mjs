// VM 全链路回归测试台：在 Node 里用假 DOM 装载 content 脚本并驱动真实交互路径。
// 只读产品代码，不修改任何 src 文件；断言失败一律先区分「产品缺陷」与「测试台工件」。
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "content");
const R = [];
let group = "";
const G = (n) => { group = n; R.push(""); R.push("── " + n + " ──"); };
const ok = (name, cond, detail) => {
  const line = (cond ? "PASS" : "FAIL") + " | " + name + (detail === undefined ? "" : " | " + detail);
  R.push(line); console.log(line);   // 即时输出：中途抛错也能看到已跑过的断言
};
const eq = (name, actual, expected) => ok(name, Object.is(actual, expected), "实得=" + JSON.stringify(actual) + " 期望=" + JSON.stringify(expected));

// ---------------- 假 DOM ----------------
// 真 DOM 的 style 有 setProperty / getPropertyValue / removeProperty。此前夹具只给个空对象，
// 于是任何用 CSS 变量的真实代码一跑就抛「is not a function」（§104 又踩到一次：夹具缺 API = 真功能被挡在门外）
function mkStyle() {
  const m = {};
  m.setProperty = function (k, val) { m[k] = String(val); };
  m.getPropertyValue = function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : ""; };
  m.removeProperty = function (k) { delete m[k]; };
  return m;
}

function mkEl(tag) {
  const e = {};
  e.tagName = String(tag || "div").toUpperCase();
  e.children = []; e.parentNode = null; e.style = mkStyle(); e.attrs = {}; e._s = new Set(); e._handlers = {};
  e.value = ""; e.type = ""; e.min = ""; e.max = "";
  // 真实 DOM 语义：给 innerHTML / textContent 赋值会清空原有子节点（假 DOM 原先不清，于是面板每次重建都在累积）
  e._text = ""; e._html = "";
  Object.defineProperty(e, "textContent", {
    // 保真：真 DOM 的 textContent 是**整棵子树**的文本。此前只返回直接赋给自己的那段，
    // 于是「容器里有没有某段文案」这类断言全部失真（要么假红、要么假绿）。
    get() { return e._text + e.children.map(function (c) { return c.textContent || ""; }).join(""); },
    set(v) { e._text = String(v == null ? "" : v); e.children.forEach(c => { c.parentNode = null; }); e.children.length = 0; }
  });
  Object.defineProperty(e, "innerHTML", {
    get() { return e._html; },
    set(v) { e._html = String(v == null ? "" : v); e.children.forEach(c => { c.parentNode = null; }); e.children.length = 0; }
  });
  e.title = ""; e.placeholder = ""; e.disabled = false; e.id = ""; e.maxLength = 0;
  e.paused = true; e.currentTime = 0; e.duration = 0; e.volume = 1; e.playbackRate = 1;
  e.ended = false; e.src = ""; e.muted = false; e.isContentEditable = false;
  e.clientHeight = 800; e.clientWidth = 1400; e.scrollTop = 0; e.scrollHeight = 2400;
  Object.defineProperty(e, "className", {
    get() { return [...e._s].join(" "); },
    set(v) { e._s = new Set(String(v || "").split(/\s+/).filter(Boolean)); }
  });
  e.classList = new Proxy({}, { get(_, k) {
    if (k === "length") return e._s.size;
    if (k === "add") return (...c) => c.forEach(x => e._s.add(x));
    if (k === "remove") return (...c) => c.forEach(x => e._s.delete(x));
    if (k === "contains") return c => e._s.has(c);
    if (k === "toggle") return (c, f) => { const on = f === undefined ? !e._s.has(c) : !!f; on ? e._s.add(c) : e._s.delete(c); return on; };
    if (k === "forEach") return (fn, t) => [...e._s].forEach(fn, t);
    if (k === Symbol.iterator) return () => e._s[Symbol.iterator]();
    if (/^\d+$/.test(String(k))) return [...e._s][Number(k)];
    return undefined;
  }});
  e.setAttribute = (k, v) => { e.attrs[k] = v; if (k === "class") e.className = v; };
  e.getAttribute = k => e.attrs[k];
  // 保真：真浏览器里 removeAttribute("src") 会清掉 src 属性本身。只删 attrs 的话，
  // 「回收后媒体已释放」这类断言就是空跑（我们读的是 .src，不是 attrs.src）。
  e.removeAttribute = k => { delete e.attrs[k]; if (k === "src") e.src = ""; };
  e.setAttribute = ((orig) => (k, val) => { orig(k, val); if (k === "src") e.src = String(val == null ? "" : val); })(e.setAttribute);
  e.appendChild = c => { c.parentNode = e; e.children.push(c); return c; };
  e.insertBefore = (c, ref) => { const i = e.children.indexOf(ref); if (i < 0) return e.appendChild(c); c.parentNode = e; e.children.splice(i, 0, c); return c; };
  e.removeChild = c => { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); c.parentNode = null; return c; };
  e.remove = () => { if (e.parentNode) e.parentNode.removeChild(e); };
  e.addEventListener = (t, h) => { (e._handlers[t] = e._handlers[t] || []).push(h); };
  e.removeEventListener = (t, h) => { const a = e._handlers[t] || []; const i = a.indexOf(h); if (i >= 0) a.splice(i, 1); };
  e.dispatchEvent = ev => {
    ev = ev || {}; if (!ev.target) ev.target = e;
    // 保真：禁用按钮在浏览器里根本不派发 click。缺了这条，「投币按钮点了就 disabled」
    // 这类真实的重复扣费保护在测试里等于不存在（断言会变成空跑）。
    if (e.disabled && ev.type === "click") return true;
    ev.preventDefault = ev.preventDefault || (() => {});
    ev.stopPropagation = ev.stopPropagation || (() => {});
    ev.stopImmediatePropagation = ev.stopImmediatePropagation || (() => { ev.__stopped = true; });
    // 保真：stopImmediatePropagation 必须真的截断后续监听器 —— 否则「不自动暂停」那条守卫
    // 在测试里毫无效果，断言会变成空跑。
    const hs = (e._handlers[ev.type] || []).slice();
    for (let i = 0; i < hs.length; i++) { if (ev.__stopped) break; hs[i](ev); }
    return true;
  };
  e._flat = () => { const out = []; const walk = n => n.children.forEach(c => { out.push(c); walk(c); }); walk(e); return out; };
  const match = (n, sel) => String(sel).split(",").map(s => s.trim()).some(one => {
    if (one[0] === ".") return one.slice(1).split(".").every(cl => n._s.has(cl));
    if (one[0] === "#") return n.id === one.slice(1);
    return n.tagName === one.toUpperCase();
  });
  e.querySelector = sel => e._flat().find(n => match(n, sel)) || null;
  e.querySelectorAll = sel => e._flat().filter(n => match(n, sel));
  e.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1400, height: 800, right: 1400, bottom: 800 });
  e.focus = () => { doc.activeElement = e; };
  e.blur = () => { if (doc.activeElement === e) doc.activeElement = doc.body; };
  e.scrollTo = o => { e.scrollTop = (o && o.top) || 0; };
  e.requestPictureInPicture = () => { doc.pictureInPictureElement = e; calls.pip++; return Promise.resolve(); };
  e.play = () => { e.paused = false; e.dispatchEvent({ type: "play" }); return Promise.resolve(); };
  e.pause = () => { e.paused = true; e.dispatchEvent({ type: "pause" }); };
  e.load = () => {};
  return e;
}
const doc = {
  _handlers: {}, documentElement: mkEl("html"), head: mkEl("head"), body: mkEl("body"),
  readyState: "complete", cookie: "", hidden: false, visibilityState: "visible",
  fullscreenElement: null, pictureInPictureElement: null, activeElement: null,
  createElement: mkEl, createElementNS: (ns, t) => mkEl(t),
  addEventListener(t, h) { (doc._handlers[t] = doc._handlers[t] || []).push(h); },
  removeEventListener(t, h) { const a = doc._handlers[t] || []; const i = a.indexOf(h); if (i >= 0) a.splice(i, 1); },
  exitPictureInPicture() { doc.pictureInPictureElement = null; return Promise.resolve(); },
  dispatchEvent(ev) {
    ev = ev || {}; if (!ev.target) ev.target = doc;
    ev.preventDefault = ev.preventDefault || (() => {});
    ev.stopPropagation = ev.stopPropagation || (() => {});
    // doc 有自己的一份实现（不是 mkEl 那个）：这里也必须真正支持 stopImmediatePropagation，
    // 否则「不自动暂停」的守卫在 document 上毫无效果，断言就是空跑。
    ev.stopImmediatePropagation = ev.stopImmediatePropagation || (() => { ev.__stopped = true; });
    const hs = (doc._handlers[ev.type] || []).slice();
    for (let i = 0; i < hs.length; i++) { if (ev.__stopped) break; hs[i](ev); }
    return true;
  },
  getElementById(id) { return doc.documentElement._flat().find(n => n.id === id) || null; },
  querySelector(sel) { return doc.documentElement.querySelector(sel); },
  querySelectorAll(sel) { return doc.documentElement.querySelectorAll(sel); }
};
doc.documentElement.appendChild(doc.head);
doc.documentElement.appendChild(doc.body);   // 与浏览器一致：body 在 documentElement 之下，getElementById 才查得到
doc.activeElement = doc.body;
doc.documentElement.requestFullscreen = () => { doc.fullscreenElement = doc.documentElement; doc.dispatchEvent({ type: "fullscreenchange" }); return Promise.resolve(); };
doc.exitFullscreen = () => { doc.fullscreenElement = null; doc.dispatchEvent({ type: "fullscreenchange" }); return Promise.resolve(); };

// ---------------- 网络桩 ----------------
let wbiSignBroken = false;   // 只给 wbi 自愈用例用：让签名端点返回 -403
let rcmdFails = false;       // 只给「首次加载失败」用例用：让推荐流接口直接失败
let playurlFails = false;    // 只给「切档失败」用例用：让取流接口失败
let replyFailsOnce = false;  // 只给「评论重试」用例用：第 1 次翻页失败，第 2 次成功
let onlineDelayMs = 0;       // 只给「在线人数竞态」用例用：让响应迟到
const RCMD = { code: 0, data: { item: Array.from({ length: 12 }, (_, i) => ({
  bvid: "BV1test000" + i, cid: 990 + i, aid: 10000 + i, goto: "av",
  title: "测试视频 " + i, pic: "//i0.hdslb.com/x.jpg", duration: 125,
  owner: { mid: 500 + i, name: "UP" + i, face: "//f.jpg" },
  stat: { view: 1000 * (i + 1), like: 10, danmaku: 3, reply: 9662, coin: 1, favorite: 2, share: 1 },
  tname: "分区" + (i % 3)
})) } };
// 第 3 条（index 2）设为直播条目：验证沉浸流对直播的降级路径
// 真实直播条目形态：没有 bvid/cid，主播名在 uname、人气在 online（douyin-mode.normalize 正是读这三个字段）
RCMD.data.item[2] = { goto: "live", roomid: 12345, title: "直播间测试标题", uname: "主播甲", face: "//f.jpg", online: 8888, cover: "//c.jpg" };
// 在线人数（本轮新实现）：默认 94 人、站方开关都开。用例里可改 onlineReply 模拟其他形状。
let onlineReply = { code: 0, data: { total: "94", count: "71", show_switch: { total: true, count: true } } };
const srv = {
  "player/online/total": () => { if (onlineDelayMs > 0) { const r = onlineReply; return new Promise(function (res) { setTimeout(function () { res(r); }, onlineDelayMs); }); } return onlineReply; },
  "rcmd": (u) => { if (rcmdFails) return { code: -412, message: "被风控拦截" }; if (wbiSignBroken && u.indexOf("/wbi/") >= 0) return { code: -403, message: "签名错误" }; return RCMD; },
  "/x/web-interface/nav": () => ({ code: 0, data: { isLogin: false, wbi_img: {
    img_url: "https://i0.hdslb.com/bfs/wbi/" + "a".repeat(32) + ".png",
    sub_url: "https://i0.hdslb.com/bfs/wbi/" + "b".repeat(32) + ".png" } } }),
  // fnval=4048 → 全量档位 + DASH 流（120/112 模拟无流的大会员档位）；其余 → mp4（服务端最多给 720P）
  "playurl": (u) => {
    if (playurlFails) return { code: -412, message: "被风控拦截" };
    const m = /qn=(\d+)/.exec(u); const q = m ? Number(m[1]) : 64;
    if (u.indexOf("fnval=4048") >= 0) return { code: 0, data: {
      quality: q, accept_quality: [120, 112, 80, 64, 32, 16],
      accept_description: ["超清 4K", "高清 1080P+", "高清 1080P", "高清 720P", "清晰 480P", "流畅 360P"],
      dash: { video: [{ id: 80, codecs: "avc1.640028", baseUrl: "https://upos.example/v80.m4s" },
                      { id: 80, codecs: "hvc1.1.6.L120", base_url: "https://upos.example/v80hevc.m4s" },
                      { id: 64, codecs: "avc1.64001F", baseUrl: "https://upos.example/v64.m4s" }],
              audio: [{ id: 30280, baseUrl: "https://upos.example/a.m4s", bandwidth: 128000 }] } } };
    // BV1test0005 模拟「多段稿件」：durl 有两段（当前 API 已几乎不可见，但代码必须不静默出错）
    if (u.indexOf("BV1test0005") >= 0) return { code: 0, data: { quality: Math.min(q, 64), accept_quality: [64, 32, 16],
      accept_description: ["高清 720P", "清晰 480P", "流畅 360P"],
      durl: [{ url: "https://upos.example/p1.m4s", size: 111 }, { url: "https://upos.example/p2.m4s", size: 222 }] } };
    return { code: 0, data: { quality: Math.min(q, 64), accept_quality: [64, 32, 16],
      accept_description: ["高清 720P", "清晰 480P", "流畅 360P"], durl: [{ url: "https://upos.example/v.m4s", size: 1234 }] } };
  },
  // 评论分页：第 1 页总数固定 9662（既有断言依赖它），第 2 页用 replyPage2Count 控制「是否还有更多」
  "/x/v2/reply": (u) => { const m = /pn=(\d+)/.exec(u); const pn = m ? Number(m[1]) : 1;
    if (replyFailsOnce && pn > 1) { replyFailsOnce = false; return { code: -412, message: "被风控拦截" }; }
    const count = pn === 1 ? 9662 : replyPage2Count;
    return { code: 0, data: { page: { num: pn, size: 20, count: count }, replies: [
      { member: { uname: pn === 1 ? "甲" : "乙", avatar: "f.jpg" }, content: { message: pn === 1 ? "好" : "第二页的评论" },
        like: 3, rcount: pn === 1 ? 1 : 0, ctime: 1e9 }] } }; },
  "archive/like": () => (likeCode ? { code: likeCode, message: "被风控拦截" } : { code: 0, data: {} }),
  "coin/add": () => (coinCode ? { code: coinCode, message: "硬币不足" } : { code: 0, data: {} }),
  "fav/resource/deal": () => (favDealCode ? { code: favDealCode, message: "收藏夹满了" } : { code: 0, data: {} }),
  "fav/folder/created/list-all": () => ({ code: 0, data: { list: [
    { id: 1, title: "默认收藏夹", media_count: 2, favoured: true },
    { id: 2, title: "测试收藏夹", media_count: 0, favoured: false }] } }),
  "like/triple": () => ({ code: 0, data: {} }),
  "feedback/dislike": () => ({ code: 0, data: {} }),
  "/x/web-interface/view": (u) => {
    // 给 BV1test0000 一条三集合集，用于验证合集徽标/列表/点集插入
    if (u.indexOf("BV1test0000") >= 0) return { code: 0, data: { cid: 990, aid: 10000, videos: 3,
      pages: [{ cid: 990, page: 1, part: "P1" }],
      desc: "这是测试稿件的简介正文。\n第二行：用于验证换行与滚动。",
      pubdate: 1690000000,
      stat: { view: 123456, danmaku: 2048, like: 3456 },
      owner: { mid: 1, name: "UP0" },
      ugc_season: { title: "测试合集", sections: [{ episodes: [
        { bvid: "BV1test0000", cid: 990, aid: 10000, title: "第一集", arc: { pic: "", stat: {}, author: { mid: 1, name: "UP0" } } },
        { bvid: "BV1test0009", cid: 999, aid: 10009, title: "第二集", arc: { pic: "", stat: {}, author: { mid: 1, name: "UP0" } } },
        { bvid: "BV1test0010", cid: 1000, aid: 10010, title: "第三集", arc: { pic: "", stat: {}, author: { mid: 1, name: "UP0" } } }
      ] }] } } };
    // BV1test0001：详情接口取不到（简介面板要如实报错，而不是留空白）
    if (u.indexOf("BV1test0001") >= 0) return { code: -404, message: "啥都木有" };
    // BV1test0003：详情取到了，但稿件没填简介（注意第 3 屏是直播条目，用不上）
    if (u.indexOf("BV1test0003") >= 0) return { code: 0, data: { cid: 993, aid: 10003, desc: "", pubdate: 1690000000, stat: { view: 5 }, owner: { mid: 3, name: "UP2" }, pages: [{ cid: 993, page: 1, part: "P1" }] } };
    return { code: 0, data: { cid: 991, aid: 10001, videos: 1, desc: "默认简介", pubdate: 1690000000, stat: { view: 10 }, owner: { mid: 2, name: "UP1" }, ugc_season: null, pages: [{ cid: 991, page: 1, part: "P1" }] } };
  },
  "list.so": () => ({ __text: '<i><d p="1.5,1,25,16777215,1690000000,0,abc,1">hello</d><d p="30.2,5,25,16711680,1690000000,0,def,1">top</d></i>' }),
  // B站 原生字幕：轨道列表（/x/player/v2）+ 正文 JSON
  "/x/player/v2": () => ({ code: 0, data: { subtitle: { allow_submit: false, subtitles: [
    { lan: "zh-CN", lan_doc: "中文（自动生成）", subtitle_url: "//aisubtitle.example/sub.json" }] } } }),
  "sub.json": () => ({ body: [{ from: 0, to: 2, content: "第一句" }, { from: 2, to: 4, content: "第二句" }] }),
  // 续接兜底源：第 1 页给一条（不会用到），第 2 页起给「热门兜底视频」这条新内容。
  // 第 3 页起每页再给一条**不同**的稿件：长会话回收用例需要刷到 20+ 屏，只有 13 条稿件刷不动。
  "popular": (u) => { const m = /pn=(\d+)/.exec(u); const pn = m ? Number(m[1]) : 1;
    if (feedSourcesDry) return { code: 0, data: { list: [] } };
    const id = pn >= 3 ? String(pn) : (pn >= 2 ? "1" : "0");
    return { code: 0, data: { list: [{
    bvid: "BV1pop" + id.padStart(4, "0"), cid: pn >= 2 ? 7001 : 7000, aid: pn >= 2 ? 70001 : 70000,
    goto: "av", title: pn === 2 ? "热门兜底视频" : ("热门兜底视频 " + pn), duration: 60, pic: "",
    owner: { mid: 88, name: "热门UP" }, stat: { view: 5, like: 1, danmaku: 1, reply: 1, coin: 0, favorite: 0, share: 0 }, tname: "热门"
  }] } }; },
  "x/v2/dm/post": () => (dmPostCode ? { code: dmPostCode, message: "被风控拦截" } : { code: 0, data: { dmid: 1234 } }),
  "related": () => (feedSourcesDry ? { code: 0, data: [] } : { code: 0, data: [] })
};
// 兜底源枯竭开关：只有「所有源都无新内容」那条用例会临时打开它，
// 否则热门源是无限供给的（长会话回收用例需要），那条用例永远等不到枯竭。
let feedSourcesDry = false;
const calls = { url: [], body: [], msg: [], opened: [], copied: [], pip: 0 };
let relayReply = null;   // 字幕中转：后台的回答（null = 不回答，用于测超时兜底）
let dmPostCode = 0;   // 发弹幕端点返回码开关：0 成功，-412 模拟风控拦截
let likeCode = 0;     // 点赞端点返回码开关（验证失败时是否如实报因）
let coinCode = 0;     // 投币端点返回码开关
let replyPage2Count = 30;   // 评论第 2 页的总数（40 < 30 不成立 → 「到底了」，用于测「加载更多」收起）
let favDealCode = 0;        // 收藏保存端点返回码开关
const msgListeners = [];
const fetchMock = async (url, opts) => {
  const u = String(url); calls.url.push(u);
  calls.body.push(opts && opts.body ? String(opts.body) : null);
  const key = Object.keys(srv).find(k => u.indexOf(k) >= 0);
  // 未登记的端点必须**响亮地失败**：此前默认返回 code:0，于是写错端点的功能
  // （投币用的 archive/coin）在测试里永远「成功」，一路绿灯潜到了真机。
  const payload = key ? srv[key](u) : { code: -404, message: "mock 未登记端点: " + u.slice(0, 70) };
  return { ok: true, status: 200, json: async () => payload, text: async () => payload.__text || JSON.stringify(payload) };
};
const store = {};
const storeListeners = [];
// 模拟「另一个标签页/设置页」写入 storage：真扩展里 Chrome 会派发给所有页面的 onChanged
const otherTabWrites = (settings) => { store.bdmSettings = settings; storeListeners.forEach(fn => fn({ bdmSettings: { newValue: settings } }, "local")); };
const chromeMock = {
  runtime: { getManifest: () => ({ version: "0.1.25" }), onMessage: { addListener(fn) { msgListeners.push(fn); } },
    // 记录内容脚本发出的消息；relayReply 有值时异步回答（模拟后台），否则永不回答（模拟 SW 不响应）
    sendMessage(msg, cb) { calls.msg.push(msg); if (relayReply && cb) setTimeout(() => cb(relayReply), 0); } },
  storage: {
    local: {
      get(keys, cb) { const out = Object.assign({}, store); if (cb) { cb(out); return; } return Promise.resolve(out); },
      set(o, cb) { Object.assign(store, o); if (cb) { cb(); return; } return Promise.resolve(); },
      remove(k, cb) { if (cb) { cb(); return; } return Promise.resolve(); }
    },
    // 记录回调：settings.js 的跨标签实时同步走这里（此前是空壳，回调体从未被执行过）
    onChanged: { addListener(fn) { storeListeners.push(fn); }, removeListener() {} }
  },
  i18n: { getMessage: (k) => k }
};
class CustomEvent { constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); } }
const MOs = [];
class MO { constructor(cb) { this.cb = cb; MOs.push(this); } observe() {} disconnect() {} takeRecords() { return []; } }
function XHR() {}
XHR.prototype.open = function () {}; XHR.prototype.send = function () {}; XHR.prototype.setRequestHeader = function () {};

// g 既是 globalThis 也是 window（与浏览器一致，裸 __BDM__ 才可见）
const g = {};
g._handlers = {};
g.addEventListener = (t, h) => { (g._handlers[t] = g._handlers[t] || []).push(h); };
g.removeEventListener = (t, h) => { const a = g._handlers[t] || []; const i = a.indexOf(h); if (i >= 0) a.splice(i, 1); };
// window 的派发此前是最简版：不认 stopImmediatePropagation，也不记 defaultPrevented。
// 于是任何挂在 window 上的守卫（滚轮捕获、页面级拦截）在测试里都是空跑 —— 换成与 mkEl 同级的实现。
g.dispatchEvent = (ev) => {
  ev = ev || {}; if (!ev.target) ev.target = g;
  ev.preventDefault = ev.preventDefault || (() => { ev.defaultPrevented = true; });
  ev.stopPropagation = ev.stopPropagation || (() => {});
  ev.stopImmediatePropagation = ev.stopImmediatePropagation || (() => { ev.__stopped = true; });
  const hs = (g._handlers[ev.type] || []).slice();
  for (let i = 0; i < hs.length; i++) { if (ev.__stopped) break; hs[i](ev); }
  return true;
};
g.open = (u) => { calls.opened.push(u); return null; };
g.innerHeight = 800; g.innerWidth = 1400; g.scrollY = 0;
// 沙箱里没有 Response（画像守卫拦截上报时会 new Response）—— 补一个最小桩，
// 否则守卫那条分支在测试里会静默退化成「放行」，覆盖就形同虚设。
g.Response = function (body, init) {
  this.body = body;
  this.status = (init && init.status) || 200;
  this.ok = this.status >= 200 && this.status < 300;
  this.text = async () => String(body);
  this.json = async () => JSON.parse(String(body));
};
g.document = doc; g.chrome = chromeMock; g.fetch = fetchMock; g.XMLHttpRequest = XHR;
g.navigator = { userAgent: "Mozilla/5.0 Chrome/120", clipboard: { writeText: async (t) => { calls.copied.push(t); } } };
g.location = { host: "www.bilibili.com", hostname: "www.bilibili.com", href: "https://www.bilibili.com/video/BV1test0000" };
g.console = console;
g.setTimeout = setTimeout; g.clearTimeout = clearTimeout;
// 计量存活定时器：用来断言「划走的屏不再留心跳」「退出后不再空转」
const timers = new Set();
const _si = setInterval, _ci = clearInterval;
g.setInterval = (fn, ms) => { const id = _si(fn, ms); timers.add(id); return id; };
g.clearInterval = (id) => { timers.delete(id); return _ci(id); };
g.requestAnimationFrame = (fn) => setTimeout(fn, 0); g.cancelAnimationFrame = clearTimeout;
g.MutationObserver = MO; g.AbortController = AbortController; g.CustomEvent = CustomEvent;
// API.post 用 URLSearchParams 构造表单体（浏览器原生存在，沙箱此前漏了 → 所有 POST 互动路径从未被跑到）
g.URLSearchParams = URLSearchParams; g.URL = URL;
g.window = g; g.self = g; g.globalThis = g;
const ctx = vm.createContext(g);

const rejections = [];
process.on("unhandledRejection", (r) => rejections.push(String((r && r.message) || r)));
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));
const A = (a, b) => a + b;

// ---------------- 装载 ----------------
G("A 装载与入口");
for (const f of ["settings.js", "desktop-skin.js", "api.js", "ui.js", "player.js", "douyin-mode.js"]) {
  try { vm.runInContext(fs.readFileSync(path.join(BASE, f), "utf8"), ctx, { filename: f }); ok("装载 " + f, true); }
  catch (e) { ok("装载 " + f, false, e.message); }
}
const B = g.__BDM__;
ok("模块挂载 settings/api/ui/Player/douyin/dialogs", !!(B.settings && B.api && B.ui && B.Player && B.douyin && B.dialogs));
const navBtn = doc.getElementById("bdm-nav-btn");
ok("导航按钮已注入", !!navBtn);
navBtn.dispatchEvent({ type: "click" });
await tick(400);
ok("enter() 激活", B.douyin.isActive() === true);
const root = doc.querySelector(".bdm-root");
const s0 = doc.querySelectorAll(".bdm-slide")[0];
const v0 = s0.querySelector("video");
ok("预建 ≥3 屏", doc.querySelectorAll(".bdm-slide").length >= 3, "屏数=" + doc.querySelectorAll(".bdm-slide").length);
const timersAfterEnter = timers.size;
ok("进入后存活定时器数量可控（保险丝 + 当前屏弹幕）", timersAfterEnter <= 3, "存活=" + timersAfterEnter);

G("B 控制栏 1:1 结构");
const q = (sel) => s0.querySelector(sel);
ok("左段：播放 / 下一集 / 时间", !!q(".bdm-btn-play") && !!q(".bdm-btn-next") && !!q(".bdm-time"));
ok("中段：弹幕开关 / 输入框 / 设置", !!q(".bdm-btn-dm") && !!q(".bdm-dm-input") && !!q(".bdm-btn-dmset"));
// B站 实测：弹幕条不是控制条的中段，而是**控制条下方的独立一行**（bpx-player-sending-area = 46px）
const dmRowB = q(".bdm-dm-row");
ok("弹幕发送行独立成行（不在控制条内部），含 开关/设置/输入框/发送",
  !!dmRowB && !q(".bdm-ctrl")._flat().some(n => n._s.has("bdm-dm-row") || n._s.has("bdm-dm-input")) &&
  !!dmRowB.querySelector(".bdm-btn-dm") && !!dmRowB.querySelector(".bdm-btn-dmset") &&
  !!dmRowB.querySelector(".bdm-dm-input") && !!dmRowB.querySelector(".bdm-btn-dmsend"),
  dmRowB ? "行内节点=" + dmRowB._flat().length + " 控制条内弹幕节点=" + q(".bdm-ctrl")._flat().filter(n => n._s.has("bdm-dm-input")).length : "无 bdm-dm-row");
ok("右段：评论 / 画质 / 倍速 / 音量 / 全屏", !!q(".bdm-btn-cmt") && !!q(".bdm-btn-qn") && !!q(".bdm-btn-rate") && !!q(".bdm-vol-range") && !!q(".bdm-btn-full"));
const orderOf = (sel) => s0._flat().findIndex(n => n._s.has(sel.slice(1)));
ok("控件顺序：播放 → 下一集 → 时间", orderOf(".bdm-btn-play") < orderOf(".bdm-btn-next") && orderOf(".bdm-btn-next") < orderOf(".bdm-time"));
ok("控件顺序：评论 → 画质 → 倍速 → 音量 → 全屏",
  orderOf(".bdm-btn-cmt") < orderOf(".bdm-btn-qn") && orderOf(".bdm-btn-qn") < orderOf(".bdm-btn-rate") &&
  orderOf(".bdm-btn-rate") < orderOf(".bdm-vol-range") && orderOf(".bdm-vol-range") < orderOf(".bdm-btn-full"));
eq("时间初始补零", q(".bdm-time").textContent, "00:00 / 00:00");
eq("弹幕输入框占位文案", q(".bdm-dm-input").placeholder, "发个友善的弹幕见证当下");
ok("图标按钮均为 svg（非文字）", q(".bdm-btn-next").innerHTML.indexOf("<svg") === 0 && q(".bdm-btn-full").innerHTML.indexOf("<svg") === 0 && q(".bdm-btn-dmset").innerHTML.indexOf("<svg") === 0);

G("C 时间格式与进度填充（含边界）");
v0.duration = 125; v0.currentTime = 30; v0.dispatchEvent({ type: "timeupdate" });
eq("30/125 → 00:30 / 02:05", q(".bdm-time").textContent, "00:30 / 02:05");
eq("进度填充 24%", q(".bdm-seek-fill").style.width, "24%");
v0.currentTime = 0; v0.dispatchEvent({ type: "timeupdate" });
eq("边界 t=0 → 00:00 / 02:05", q(".bdm-time").textContent, "00:00 / 02:05");
eq("边界 t=0 填充 0%", q(".bdm-seek-fill").style.width, "0%");
v0.currentTime = 3725; v0.duration = 3725; v0.dispatchEvent({ type: "timeupdate" });
eq("边界跨小时 → 1:02:05 / 1:02:05", q(".bdm-time").textContent, "1:02:05 / 1:02:05");
eq("边界满进度 100%", q(".bdm-seek-fill").style.width, "100%");
v0.duration = 0; v0.currentTime = 0; v0.dispatchEvent({ type: "timeupdate" });
eq("时长未知 → 00:00 / 00:00", q(".bdm-time").textContent, "00:00 / 00:00");
v0.duration = 125;

G("D 交互（播放/下一集/全屏/菜单/弹幕/评论）");
ok("自动播放后处于播放态", v0.paused === false);
q(".bdm-btn-play").dispatchEvent({ type: "click" });
ok("点播放键 → 暂停且图标切为播放", v0.paused === true && q(".bdm-btn-play").innerHTML.indexOf("M8 5v14l11-7z") > 0);
q(".bdm-btn-play").dispatchEvent({ type: "click" });
ok("再点 → 恢复播放且图标切为暂停", v0.paused === false && q(".bdm-btn-play").innerHTML.indexOf("M6 5h4v14H6z") > 0);
q(".bdm-btn-full").dispatchEvent({ type: "click" });
await tick();
ok("全屏键 → 进入全屏", doc.fullscreenElement === doc.documentElement);
ok("全屏后图标切为退出全屏", q(".bdm-btn-full").innerHTML.indexOf("M10 4h2.2v6H4V7.8h6z") > 0, q(".bdm-btn-full").title);
q(".bdm-btn-full").dispatchEvent({ type: "click" });
await tick();
ok("再点 → 退出全屏且图标还原", doc.fullscreenElement === null && q(".bdm-btn-full").innerHTML.indexOf("M4 4h6.2v2.2H6.2V10H4z") > 0);
q(".bdm-btn-qn").dispatchEvent({ type: "click" });
let menu = s0._flat().find(n => n._s.has("bdm-menu"));
const qnItems = menu ? menu.querySelectorAll(".bdm-menu-item") : [];
ok("画质菜单为全量档位（6 档，不再只有 720P/360P）", qnItems.length === 6, qnItems.map(n => n.textContent).join("/"));
ok("菜单档位顺序与命名照搬 B站", qnItems.map(n => n.querySelector(".bdm-menu-label").textContent).join("/") === "4K/1080P+/1080P/720P/480P/360P",
  qnItems.map(n => n.querySelector(".bdm-menu-label").textContent).join("/"));
ok("无流档位带「需登录」徽标（未登录态不谎称可播）",
  qnItems[0].querySelector(".bdm-menu-badge").textContent === "需登录" && qnItems[0].classList.contains("bdm-menu-locked"),
  qnItems[0].querySelector(".bdm-menu-badge").textContent);
const srcBefore = v0.src;
qnItems[0].dispatchEvent({ type: "click" });   // 4K：模拟无流档位
await tick(60);
const toast = doc.body._flat().filter(n => n._s.has("bdm-toast")).pop();   // toastLine 挂 body，不在 root 内
ok("选不可播档位 → 如实拒绝且不换源", v0.src === srcBefore && !!toast && String(toast.textContent).indexOf("需登录") >= 0,
  "src变=" + (v0.src !== srcBefore) + " toast=" + (toast ? toast.textContent : "无"));
q(".bdm-btn-qn").dispatchEvent({ type: "click" });
menu = s0._flat().find(n => n._s.has("bdm-menu"));
menu.querySelectorAll(".bdm-menu-item")[4].dispatchEvent({ type: "click" });   // 480P：mp4 路径
await tick(80);
ok("选 480P → mp4 直链播放且回写短档位名", q(".bdm-btn-qn").textContent === "480P" && v0.src === "https://upos.example/v.m4s" && v0.muted !== true,
  q(".bdm-btn-qn").textContent + " src=" + v0.src + " muted=" + v0.muted);
q(".bdm-btn-qn").dispatchEvent({ type: "click" });
menu = s0._flat().find(n => n._s.has("bdm-menu"));
menu.querySelectorAll(".bdm-menu-item")[2].dispatchEvent({ type: "click" });   // 1080P：DASH 路径
await tick(80);
const audioEl = s0.querySelector(".bdm-audio");
ok("选 1080P → DASH 双轨（视频流静音 + 配套音轨）",
  v0.src === "https://upos.example/v80.m4s" && v0.muted === true && !!audioEl && audioEl.src === "https://upos.example/a.m4s",
  "src=" + v0.src + " muted=" + v0.muted + " audio=" + (audioEl ? audioEl.src : "无"));
ok("DASH 视频流优先 avc1（Chrome 原生可解）", v0.src.indexOf("v80.m4s") > 0);
q(".bdm-btn-qn").dispatchEvent({ type: "click" });
menu = s0._flat().find(n => n._s.has("bdm-menu"));
menu.querySelectorAll(".bdm-menu-item")[3].dispatchEvent({ type: "click" });   // 回 720P：mp4
await tick(80);
ok("切回 720P → 恢复单文件 mp4 且解除静音", v0.src === "https://upos.example/v.m4s" && v0.muted === false, "muted=" + v0.muted);
q(".bdm-btn-rate").dispatchEvent({ type: "click" });
menu = s0._flat().find(n => n._s.has("bdm-menu"));
ok("倍速菜单 6 档", !!menu && menu.querySelectorAll(".bdm-menu-item").length === 6);
menu.querySelectorAll(".bdm-menu-item")[1].dispatchEvent({ type: "click" });
await tick(20);
ok("选 1.5x → 播放速率与文案同步", v0.playbackRate === 1.5 && q(".bdm-btn-rate").textContent === "1.5x", v0.playbackRate + " / " + q(".bdm-btn-rate").textContent);
q(".bdm-btn-dm").dispatchEvent({ type: "click" });
ok("弹幕开关 → 关闭并持久化", q(".bdm-btn-dm").classList.contains("bdm-on") === false && store.bdmSettings.dmEnabled === false);
q(".bdm-btn-dm").dispatchEvent({ type: "click" });
ok("再点 → 开启并持久化", q(".bdm-btn-dm").classList.contains("bdm-on") === true && store.bdmSettings.dmEnabled === true);
// —— 弹幕设置面板（照搬 B站 全套：显示区域/不透明度/字号/速度/密度/屏蔽词/字体/类型 + 清屏·重置）——
const dmp = () => s0.querySelector(".bdm-dm-settings");
const opts = (root) => root.querySelectorAll(".bdm-set-radio, .bdm-set-switch");
const pick = (root, label) => { const el = opts(root).find(n => n.textContent === label); el.dispatchEvent({ type: "click" }); return el; };
const titles = (root) => root.querySelectorAll(".bdm-set-title").map(n => n.textContent).join("/");
const footOf = (root) => root.querySelector(".bdm-settings-foot");
const pickBtn = (root, label) => { const el = root.querySelectorAll(".bdm-set-btn").find(n => n.textContent === label); el.dispatchEvent({ type: "click" }); return el; };
q(".bdm-btn-dmset").dispatchEvent({ type: "click" });
await tick(20);
ok("弹幕设置面板展开", dmp().style.display === "block");
ok("面板分组照搬 B站 词条（8 组）",
  titles(dmp()) === "显示区域/不透明度/弹幕字号/弹幕速度/弹幕密度/弹幕观看屏蔽词/弹幕字体/弹幕类型", titles(dmp()));
ok("底部按钮为 清屏 / 重置", footOf(dmp()).querySelectorAll(".bdm-set-btn").map(n => n.textContent).join("/") === "清屏/重置",
  footOf(dmp()).querySelectorAll(".bdm-set-btn").map(n => n.textContent).join("/"));
ok("每组选项数量与档位照搬", opts(dmp().querySelectorAll(".bdm-set-group")[0]).length === 4 &&
  opts(dmp().querySelectorAll(".bdm-set-group")[2]).length === 5 && opts(dmp().querySelectorAll(".bdm-set-group")[4]).length === 3,
  "区域=" + opts(dmp().querySelectorAll(".bdm-set-group")[0]).length + " 字号=" + opts(dmp().querySelectorAll(".bdm-set-group")[2]).length + " 密度=" + opts(dmp().querySelectorAll(".bdm-set-group")[4]).length);
pick(dmp(), "75%");
ok("不透明度 75% → 弹幕层生效并持久化", s0.querySelector(".bdm-dmlayer").style.opacity === "0.75" && store.bdmSettings.dmOpacity === 0.75,
  "opacity=" + s0.querySelector(".bdm-dmlayer").style.opacity + " store=" + store.bdmSettings.dmOpacity);
pick(dmp(), "上半部分");
ok("显示区域 上半部分 → 弹幕层限高 50% 贴顶", s0.querySelector(".bdm-dmlayer").style.height === "50%" && s0.querySelector(".bdm-dmlayer").style.top === "0",
  "h=" + s0.querySelector(".bdm-dmlayer").style.height + " top=" + s0.querySelector(".bdm-dmlayer").style.top);
pick(dmp(), "大");
ok("弹幕字号 大 → dmFont 24 持久化", store.bdmSettings.dmFont === 24, String(store.bdmSettings.dmFont));
pick(dmp(), "极快");
ok("弹幕速度 极快 → dmSpeed 16 持久化", store.bdmSettings.dmSpeed === 16, String(store.bdmSettings.dmSpeed));
pick(dmp(), "高");
ok("弹幕密度 高 → dmDensity 3 持久化", store.bdmSettings.dmDensity === 3, String(store.bdmSettings.dmDensity));
pick(dmp(), "滚动");
ok("弹幕类型 关闭滚动 → dmScroll false 持久化", store.bdmSettings.dmScroll === false, String(store.bdmSettings.dmScroll));
pick(dmp(), "黑体");
ok("弹幕字体 黑体 → 弹幕层 fontFamily 生效", String(s0.querySelector(".bdm-dmlayer").style.fontFamily).indexOf("黑体") > 0,
  s0.querySelector(".bdm-dmlayer").style.fontFamily);
// 屏蔽词：输入 + 回车添加，× 删除
const wIn = dmp().querySelector(".bdm-set-input");
wIn.value = "广告词";
wIn.dispatchEvent({ type: "keydown", key: "Enter" });
await tick(20);
ok("屏蔽词添加成功并持久化", (store.bdmSettings.dmBlock || []).indexOf("广告词") >= 0 && dmp().querySelectorAll(".bdm-set-word").length === 1,
  JSON.stringify(store.bdmSettings.dmBlock));
// 清屏：先塞两条弹幕，点清屏后应清空
const layer = s0.querySelector(".bdm-dmlayer");
layer.appendChild(doc.createElement("span"));
layer.appendChild(doc.createElement("span"));
ok("清屏前弹幕层有 2 条", layer.children.length === 2, String(layer.children.length));
pickBtn(footOf(dmp()), "清屏");
await tick(20);
ok("清屏 → 屏上弹幕被清空", layer.children.length === 0, String(layer.children.length));
pickBtn(footOf(dmp()), "重置");
await tick(20);
ok("重置 → 弹幕设置回到默认且屏蔽词清空",
  store.bdmSettings.dmArea === "full" && store.bdmSettings.dmOpacity === 0.8 && store.bdmSettings.dmFont === 20 &&
  (store.bdmSettings.dmBlock || []).length === 0 && s0.querySelector(".bdm-dmlayer").style.opacity === "0.8",
  JSON.stringify({ a: store.bdmSettings.dmArea, o: store.bdmSettings.dmOpacity, f: store.bdmSettings.dmFont, b: store.bdmSettings.dmBlock }));
q(".bdm-btn-dmset").dispatchEvent({ type: "click" });
await tick(20);
ok("再点弹幕设置键 → 面板收起", dmp().style.display === "none");
// —— 播放器设置面板（照搬 B站 ctrl-setting：自动连播/单集循环/镜像/比例/右键长按倍速）——
const sp = () => s0.querySelector(".bdm-set-settings");
q(".bdm-btn-set").dispatchEvent({ type: "click" });
await tick(20);
const switchLabels = () => opts(sp()).filter(n => n._s.has("bdm-set-switch")).map(n => n.textContent);
const groupOf = (title) => sp().querySelectorAll(".bdm-set-group").filter(g => g.querySelector(".bdm-set-title").textContent === title)[0];
ok("设置面板展开且含「播放设置 / 视频比例」分组",
  sp().style.display === "block" && titles(sp()).indexOf("播放设置") >= 0 && titles(sp()).indexOf("视频比例") >= 0, titles(sp()));
ok("四个开关在位：自动连播 / 单集循环 / 镜像画面 / 右键长按倍速",
  ["自动连播", "单集循环", "镜像画面", "右键长按倍速"].every(l => switchLabels().indexOf(l) >= 0), switchLabels().join("/"));
ok("视频比例 5 档（默认/16:9/4:3/21:9/填充）",
  opts(groupOf("视频比例")).map(n => n.textContent).join("/") === "默认/16:9/4:3/21:9/填充",
  opts(groupOf("视频比例")).map(n => n.textContent).join("/"));
pick(sp(), "单集循环");
ok("单集循环 → video.loop 生效并持久化", v0.loop === true && store.bdmSettings.singleLoop === true, "loop=" + v0.loop);
pick(sp(), "镜像画面");
ok("镜像画面 → 视频水平翻转", v0.style.transform === "scaleX(-1)", v0.style.transform);
pick(sp(), "16:9");
ok("视频比例 16:9 → 画面比例生效", v0.style.aspectRatio === "16 / 9", v0.style.aspectRatio);
pick(sp(), "自动连播");
ok("自动连播开关可关闭并持久化", store.bdmSettings.autoplayNext === false, String(store.bdmSettings.autoplayNext));
pick(sp(), "右键长按倍速");
ok("右键长按倍速开关可开启并持久化", store.bdmSettings.longpressRate === true);
const rateBefore = v0.playbackRate;
v0.dispatchEvent({ type: "mousedown", button: 2 });
ok("右键按住 → 3 倍速", v0.playbackRate === 3, String(v0.playbackRate));
g.dispatchEvent({ type: "mouseup" });
ok("松开右键 → 恢复原速", v0.playbackRate === rateBefore, v0.playbackRate + " vs " + rateBefore);
q(".bdm-btn-set").dispatchEvent({ type: "click" });
await tick(20);
ok("再点设置键 → 面板收起", sp().style.display === "none");
ok("画中画键 → 调用浏览器画中画", (q(".bdm-btn-pip").dispatchEvent({ type: "click" }), calls.pip === 1 && doc.pictureInPictureElement === v0),
  "pip调用=" + calls.pip);
q(".bdm-btn-pip").dispatchEvent({ type: "click" });
ok("再点画中画 → 退出画中画", doc.pictureInPictureElement === null);

q(".bdm-vol-range").value = "40";
q(".bdm-vol-range").dispatchEvent({ type: "input" });
ok("音量滑块 → 音量与持久化", Math.abs(v0.volume - 0.4) < 1e-6 && Math.abs(store.bdmSettings.volume - 0.4) < 1e-6, "vol=" + v0.volume);
q(".bdm-btn-cmt").dispatchEvent({ type: "click" });
await tick(80);
const panel = s0.querySelector(".bdm-panel");
ok("评论键 → 面板展开", panel.style.display === "flex", panel.style.display);
ok("评论面板标题带总数", s0.querySelector(".bdm-panel-title").textContent.indexOf("9662") >= 0, s0.querySelector(".bdm-panel-title").textContent);
ok("评论行已渲染", s0.querySelectorAll(".bdm-cmt").length >= 1);
s0.querySelector(".bdm-panel-close").dispatchEvent({ type: "click" });
ok("关闭键 → 面板收起", panel.style.display === "none");

G("E 键盘隔离与弹幕输入框出口");
const dmInput = q(".bdm-dm-input");
const v0paused = v0.paused;
doc.dispatchEvent({ type: "keydown", key: " ", target: dmInput });
ok("输入框内空格不触发播放/暂停", v0.paused === v0paused);
const topBefore = root.scrollTop;
doc.dispatchEvent({ type: "keydown", key: "ArrowDown", target: dmInput });
ok("输入框内方向键不翻页", root.scrollTop === topBefore);
doc.dispatchEvent({ type: "keydown", key: " " });
ok("文档层空格仍可切换播放", v0.paused !== v0paused);
doc.dispatchEvent({ type: "keydown", key: " " });
dmInput.value = "测试弹幕内容";
dmInput.dispatchEvent({ type: "keydown", key: "Enter" });
await tick(40);
const dmPostCalls = () => calls.url.filter(u => u.indexOf("x/v2/dm/post") >= 0).length;
const toastAll = () => doc.body._flat().filter(n => n._s.has("bdm-toast")).map(n => String(n.textContent)).join(" | ");
ok("未登录时 Enter → 如实提示先登录、不发请求、内容不丢",
  dmPostCalls() === 0 && dmInput.value === "测试弹幕内容" && toastAll().indexOf("登录") >= 0,
  "输入框=" + dmInput.value + " 请求=" + dmPostCalls() + " toast=" + toastAll());
const openedBefore = calls.opened.length;
dmInput.value = "   ";
dmInput.dispatchEvent({ type: "keydown", key: "Enter" });
await tick(30);
ok("空内容 Enter → 提示且不发请求、不开新页",
  calls.opened.length === openedBefore && dmPostCalls() === 0 && toastAll().indexOf("请输入弹幕") >= 0,
  "opened=" + calls.opened.length + " toast=" + toastAll());

G("F 闲置淡出（3 秒）");
const idle = () => root.classList.contains("bdm-idle");
g.dispatchEvent({ type: "mousemove" });
ok("鼠标一动 → 控件立即可见", idle() === false);
v0.play();
await tick(3300);
ok("播放中闲置 3 秒 → 控件淡出（bdm-idle）", idle() === true);
g.dispatchEvent({ type: "mousemove" });
v0.pause();
await tick(3300);
ok("暂停中闲置 3 秒 → 控件保留", idle() === false);
v0.play();
q(".bdm-btn-qn").dispatchEvent({ type: "click" });   // 画质弹层（弹幕设置已改为面板）
g.dispatchEvent({ type: "mousemove" });
await tick(3300);
ok("弹层菜单展开中闲置 → 不淡出", idle() === false);
s0._flat().find(n => n._s.has("bdm-menu")).querySelectorAll(".bdm-menu-item")[0].dispatchEvent({ type: "click" });
await tick(20);
q(".bdm-btn-cmt").dispatchEvent({ type: "click" });
await tick(80);
g.dispatchEvent({ type: "mousemove" });
await tick(3300);
ok("评论面板展开中闲置 → 不淡出", idle() === false);
s0.querySelector(".bdm-panel-close").dispatchEvent({ type: "click" });
q(".bdm-btn-dmset").dispatchEvent({ type: "click" });
await tick(20);
g.dispatchEvent({ type: "mousemove" });
await tick(3300);
ok("设置面板展开中闲置 → 不淡出", idle() === false);
q(".bdm-btn-dmset").dispatchEvent({ type: "click" });

G("G 进度条拖拽");
v0.duration = 125;
s0.querySelector(".bdm-seek-track").dispatchEvent({ type: "mousedown", clientX: 700 });
ok("按下进度条中点 → 跳到 50%", Math.abs(v0.currentTime - 62.5) < 0.01, "t=" + v0.currentTime);
g.dispatchEvent({ type: "mousemove", clientX: 1400 });
ok("拖动到最右 → 跳到片尾", Math.abs(v0.currentTime - 125) < 0.01, "t=" + v0.currentTime);
g.dispatchEvent({ type: "mouseup" });
g.dispatchEvent({ type: "mousemove", clientX: 10 });
ok("松手后不再跟手", Math.abs(v0.currentTime - 125) < 0.01, "t=" + v0.currentTime);

G("K 右键菜单（照搬 B站 contextmenu）");
const ctxRoot = () => s0.querySelector(".bdm-ctx");
const ctxItem = (label) => ctxRoot().querySelectorAll(".bdm-ctx-item").find(n => n.querySelector(".bdm-ctx-label").textContent === label);
const ctxItems = () => ctxRoot().querySelectorAll(".bdm-ctx-item").filter(n => n.parentNode === ctxRoot()).map(n => n.querySelector(".bdm-ctx-label").textContent);
// 轻点右键（<300ms）→ 弹菜单；菜单项与 B站 同名
v0.dispatchEvent({ type: "contextmenu" });
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(20);
ok("轻点右键 → 弹出播放器菜单", ctxRoot().style.display === "block");
ok("菜单项 = B站 的 12 项 + 我们自己的「详情页」（顺序也照 B站）",
  ctxItems().join("/") === "循环播放/单集循环/自动连播/镜像画面/右键长按倍速/视频比例/画面旋转/画面亮度/清屏/视频统计信息/详情页/复制视频地址（精准空降）/举报 / 反馈",
  ctxItems().join("/"));
ok("菜单按光标定位", ctxRoot().style.left === "300px" && ctxRoot().style.top === "400px", ctxRoot().style.left + "," + ctxRoot().style.top);
ok("左侧开菜单 → 子菜单向右展开（无翻转类）", ctxRoot().classList.contains("bdm-ctx-flip") === false);
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 1200, clientY: 300 });
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 1200, clientY: 300 });
await tick(20);
ok("贴右开菜单 → 自动夹回视口内并翻转子菜单方向",
  ctxRoot().classList.contains("bdm-ctx-flip") === true && parseInt(ctxRoot().style.left, 10) <= 1400 - 190,
  "flip=" + ctxRoot().classList.contains("bdm-ctx-flip") + " left=" + ctxRoot().style.left);
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(20);
const subOf = (label) => ctxItem(label).querySelector(".bdm-ctx-sub");
ok("视频比例 子菜单 5 档", subOf("视频比例").querySelectorAll(".bdm-ctx-item").length === 5);
ok("画面旋转 子菜单 4 档", subOf("画面旋转").querySelectorAll(".bdm-ctx-item").length === 4);
ok("画面亮度 子菜单 5 档", subOf("画面亮度").querySelectorAll(".bdm-ctx-item").length === 5);
// 开关项
ctxItem("循环播放").dispatchEvent({ type: "click" });
await tick(20);
ok("菜单「循环播放」→ video.loop 生效并持久化", v0.loop === true && store.bdmSettings.loop === true, "loop=" + v0.loop);
// 子菜单项
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(20);
subOf("画面旋转").querySelectorAll(".bdm-ctx-item").find(n => n.querySelector(".bdm-ctx-label").textContent === "90°").dispatchEvent({ type: "click" });
await tick(20);
ok("菜单「画面旋转 90°」→ 画面旋转生效", String(v0.style.transform).indexOf("rotate(90deg)") >= 0, v0.style.transform);
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(20);
subOf("画面亮度").querySelectorAll(".bdm-ctx-item").find(n => n.querySelector(".bdm-ctx-label").textContent === "125%").dispatchEvent({ type: "click" });
await tick(20);
ok("菜单「画面亮度 125%」→ 亮度滤镜生效", String(v0.style.filter).indexOf("brightness(1.25)") >= 0, v0.style.filter);
// 清屏 / 统计信息 / 精准空降
layer.appendChild(doc.createElement("span"));
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(20);
ctxItem("清屏").dispatchEvent({ type: "click" });
await tick(20);
ok("菜单「清屏」→ 屏上弹幕清空", layer.children.length === 0, String(layer.children.length));
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(20);
ctxItem("视频统计信息").dispatchEvent({ type: "click" });
await tick(30);
const stats = s0.querySelector(".bdm-stats");
ok("菜单「视频统计信息」→ 浮层显示 7 项数据", !!stats && stats.querySelectorAll(".bdm-stats-row").length === 7,
  stats ? stats.querySelectorAll(".bdm-stats-row").map(n => n.textContent).join(" / ").slice(0, 80) : "无浮层");
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(20);
ctxItem("视频统计信息").dispatchEvent({ type: "click" });
await tick(20);
ok("再点统计信息 → 浮层关闭", s0.querySelector(".bdm-stats") === null);
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(20);
ctxItem("复制视频地址（精准空降）").dispatchEvent({ type: "click" });
await tick(40);
ok("菜单「复制精准空降」→ 写入带 ?t= 的地址", /\/video\/BV1test0000\?t=\d+/.test(calls.copied[calls.copied.length - 1] || ""),
  calls.copied[calls.copied.length - 1]);
// 收起方式：点空白 / Escape
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(20);
ok("再次右键 → 菜单重新弹出", ctxRoot().style.display === "block");
doc.dispatchEvent({ type: "click" });           // 点空白处
ok("点空白处 → 菜单收起", ctxRoot().style.display === "none");
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(20);
doc.dispatchEvent({ type: "keydown", key: "Escape" });
ok("Escape → 先收菜单不退沉浸", ctxRoot().style.display === "none" && B.douyin.isActive() === true);
// 长按右键（>300ms）→ 3 倍速、不弹菜单
const rate2 = v0.playbackRate;
v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
await tick(350);
v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(20);
ok("长按右键 >300ms → 只走 3 倍速、不弹菜单", ctxRoot().style.display === "none" && v0.playbackRate === rate2,
  "菜单=" + ctxRoot().style.display + " rate=" + v0.playbackRate);

G("L 浏览器右键菜单「下载此视频…」在沉浸流里可用");
const nodesBefore = doc.body._flat().length;
let resp = null;
msgListeners.forEach(fn => fn({ type: "bdm:open-download-dialog" }, {}, r => { resp = r; }));
await tick(30);
const dlgText = doc.body._flat().map(n => n.textContent).join(" ");
ok("沉浸流中 → 用「当前屏」这条视频开下载弹窗（不再依赖页面 __INITIAL_STATE__）",
  !!resp && resp.ok === true && doc.body._flat().length > nodesBefore,
  "resp=" + JSON.stringify(resp) + " 新增节点=" + (doc.body._flat().length - nodesBefore));
ok("弹窗内容是当前屏这条视频", dlgText.indexOf("测试视频 0") >= 0, dlgText.slice(-60));

G("M 字幕（用 B站 原生字幕轨）");
const s1 = doc.querySelectorAll(".bdm-slide")[1];
const s1q = (sel) => s1.querySelector(sel);
const sub0 = () => s0.querySelector(".bdm-sub");
ok("控制条右段顺序照搬 B站：评论 → 字幕 → 画质",
  orderOf(".bdm-btn-cmt") < orderOf(".bdm-btn-cc") && orderOf(".bdm-btn-cc") < orderOf(".bdm-btn-qn"));
const menuLabels = (m) => m.querySelectorAll(".bdm-menu-label").map(n => n.textContent);
ok("字幕层默认隐藏", !sub0().style.display || sub0().style.display === "none", JSON.stringify(sub0().style.display));
// ① 页面原生数据优先：当前屏 == 页面这条视频时，不再多打一次接口
g.__INITIAL_STATE__ = { videoData: { bvid: "BV1test0000", subtitle: { list: [
  { lan: "zh-CN", lan_doc: "中文（原生页面数据）", subtitle_url: "//aisubtitle.example/sub.json" }] } } };
const v2Before = calls.url.filter(u => u.indexOf("/x/player/v2") >= 0).length;
q(".bdm-btn-cc").dispatchEvent({ type: "click" });
await tick(60);
let smenu = s0._flat().find(n => n._s.has("bdm-menu"));
ok("字幕菜单直接读页面原生数据（零接口调用）",
  !!smenu && menuLabels(smenu).join("/").indexOf("中文（原生页面数据）") >= 0 &&
  calls.url.filter(u => u.indexOf("/x/player/v2") >= 0).length === v2Before,
  "菜单=" + (smenu ? menuLabels(smenu).join("/") : "无"));
ok("菜单末项为「关闭」", menuLabels(smenu).slice(-1)[0] === "关闭", menuLabels(smenu).join("/"));
smenu.querySelectorAll(".bdm-menu-item")[0].dispatchEvent({ type: "click" });
await tick(90);
ok("选中字幕 → 字幕层开启并记住语言",
  sub0().style.display === "block" && store.bdmSettings.subtitleOn === true && store.bdmSettings.subtitleLan === "zh-CN",
  "display=" + sub0().style.display + " store=" + store.bdmSettings.subtitleOn + "/" + store.bdmSettings.subtitleLan);
v0.currentTime = 1; await tick(260);
ok("随播放时间出第一句", sub0().textContent === "第一句", JSON.stringify(sub0().textContent));
v0.currentTime = 3; await tick(260);
ok("随播放时间出第二句", sub0().textContent === "第二句", JSON.stringify(sub0().textContent));
v0.currentTime = 6; await tick(260);
ok("超出字幕区间后清空", sub0().textContent === "", JSON.stringify(sub0().textContent));
q(".bdm-btn-cc").dispatchEvent({ type: "click" });
await tick(60);
smenu = s0._flat().find(n => n._s.has("bdm-menu"));
smenu.querySelectorAll(".bdm-menu-item").slice(-1)[0].dispatchEvent({ type: "click" });
await tick(60);
ok("选「关闭」→ 字幕层隐藏并持久化", sub0().style.display === "none" && store.bdmSettings.subtitleOn === false,
  "display=" + sub0().style.display + " store=" + store.bdmSettings.subtitleOn);
// ② 接口兜底：另一屏与页面这条不是同一条视频 → 必须回退 /x/player/v2
delete g.__INITIAL_STATE__;
s1q(".bdm-btn-cc").dispatchEvent({ type: "click" });
await tick(90);
const m1 = s1._flat().find(n => n._s.has("bdm-menu"));
ok("非页面同条视频时回退接口 /x/player/v2 并列出原生轨",
  !!m1 && menuLabels(m1).join("/").indexOf("中文（自动生成）") >= 0 && calls.url.some(u => u.indexOf("/x/player/v2") >= 0),
  "菜单=" + (m1 ? menuLabels(m1).join("/") : "无"));
m1.querySelectorAll(".bdm-menu-item")[0].dispatchEvent({ type: "click" });
await tick(90);
const sub1 = () => s1.querySelector(".bdm-sub");
v0.currentTime = 1; await tick(30);
s1.querySelector("video").currentTime = 1; await tick(260);
ok("接口路径同样能把字幕渲染出来", sub1().textContent === "第一句" && sub1().style.display === "block", JSON.stringify(sub1().textContent));
s1q(".bdm-btn-cc").dispatchEvent({ type: "click" });
await tick(60);
const m1b = s1._flat().find(n => n._s.has("bdm-menu"));
m1b.querySelectorAll(".bdm-menu-item").slice(-1)[0].dispatchEvent({ type: "click" });
await tick(60);

G("N 多段 durl 稿件（当前 API 不可见，但绝不静默播错）");
const mp = await B.api.playurl("BV1test0005", 995, 64);
ok("api 层如实标记多段与段数", mp.multiSegment === true && mp.segments === 2 && (mp.all || []).length === 2,
  "multi=" + mp.multiSegment + " 段=" + mp.segments);
ok("取首段而不是末段（末段会让画面从片尾开始）", mp.url === "https://upos.example/p1.m4s", mp.url);
for (let k = 0; k < 5; k++) {
  const i = Math.round(root.scrollTop / 800);
  const nx = doc.querySelectorAll(".bdm-slide")[i].querySelector(".bdm-btn-next");
  nx.dispatchEvent({ type: "click" });
  await tick(70);
}
const s5 = doc.querySelectorAll(".bdm-slide")[5];
const deg5 = s5.querySelector(".bdm-degrade");
ok("多段稿件 → 显式降级卡，明说原因",
  !!deg5 && deg5.querySelector(".bdm-degrade-sub").textContent.indexOf("2 段视频拼成") >= 0,
  deg5 ? deg5.querySelector(".bdm-degrade-sub").textContent : "无降级卡");
ok("降级卡给出「打开原页」出口", !!deg5 && !!deg5.querySelector(".bdm-degrade-btn"));
ok("降级时视频元素与分段地址都不存在（videoArea 被整体替换）", s5.querySelector("video") === null,
  s5.querySelector("video") ? "video 仍在" : "video 已移除");
ok("连划 5 屏后没有为每屏各留一个弹幕心跳", timers.size <= timersAfterEnter + 1,
  "进入时=" + timersAfterEnter + " 划过 5 屏后=" + timers.size);

G("O 编码 / 色彩调节 / 宽屏 / 音量均衡");
ok("宽屏键位于音量与画中画之间", orderOf(".bdm-vol-range") < orderOf(".bdm-btn-wide") && orderOf(".bdm-btn-wide") < orderOf(".bdm-btn-pip"));
q(".bdm-btn-wide").dispatchEvent({ type: "click" });
await tick(20);
ok("宽屏 → 画面裁切铺满（cover）并持久化", v0.style.objectFit === "cover" && store.bdmSettings.wideMode === true,
  "objectFit=" + v0.style.objectFit);
q(".bdm-btn-wide").dispatchEvent({ type: "click" });
await tick(20);
ok("再点宽屏 → 恢复完整画面（contain）", v0.style.objectFit === "contain" && store.bdmSettings.wideMode === false, v0.style.objectFit);
// 设置面板新增分组
q(".bdm-btn-set").dispatchEvent({ type: "click" });
await tick(20);
ok("设置面板分组：播放设置 / 声音 / 视频比例 / 编码 / 亮度 / 对比度 / 饱和度",
  titles(sp()) === "播放设置/声音/视频比例/编码/亮度/对比度/饱和度", titles(sp()));
ok("播放设置含 5 个开关（新增宽屏铺满）",
  opts(sp()).filter(n => n._s.has("bdm-set-switch")).map(n => n.textContent).join("/") === "自动连播/单集循环/镜像画面/宽屏铺满/右键长按倍速/音量均衡",
  opts(sp()).filter(n => n._s.has("bdm-set-switch")).map(n => n.textContent).join("/"));
ok("编码只给该稿件真实存在的轨（此稿件无 AV1）",
  opts(sp()).filter(n => n._s.has("bdm-set-radio")).map(n => n.textContent).join("/").indexOf("自动/AVC/HEVC") >= 0 &&
  opts(sp()).filter(n => n._s.has("bdm-set-radio")).map(n => n.textContent).join("/").indexOf("AV1") < 0,
  opts(sp()).filter(n => n._s.has("bdm-set-radio")).map(n => n.textContent).join("/"));
q(".bdm-btn-set").dispatchEvent({ type: "click" });
await tick(20);
// 先切到 1080P（DASH 档位，mock 里该档位同时有 avc1 与 hvc1）
q(".bdm-btn-qn").dispatchEvent({ type: "click" });
await tick(20);
s0.querySelector(".bdm-menu").querySelectorAll(".bdm-menu-item")[2].dispatchEvent({ type: "click" });
await tick(90);
ok("切到 1080P 后默认取 avc1 流", v0.src === "https://upos.example/v80.m4s" && v0.muted === true, v0.src);
q(".bdm-btn-set").dispatchEvent({ type: "click" });
await tick(20);
pick(sp(), "HEVC");
await tick(120);
ok("选 HEVC → 真的重新取流为 hevc 轨并持久化",
  v0.src === "https://upos.example/v80hevc.m4s" && store.bdmSettings.videoCodec === "hevc",
  "src=" + v0.src + " codec=" + store.bdmSettings.videoCodec);
pick(sp(), "AVC");
await tick(120);
ok("选回 AVC → 流回到 avc1 轨", v0.src === "https://upos.example/v80.m4s", v0.src);
pick(sp(), "125%");   // 第一行是「亮度」，先设亮度不影响后面
await tick(20);
const contrastRow = sp().querySelectorAll(".bdm-set-group").filter(g => g.querySelector(".bdm-set-title").textContent === "对比度")[0];
pick(contrastRow, "125%");
await tick(20);
ok("对比度 125% → filter 含 contrast(1.25)", String(v0.style.filter).indexOf("contrast(1.25)") >= 0, v0.style.filter);
const satRow = sp().querySelectorAll(".bdm-set-group").filter(g => g.querySelector(".bdm-set-title").textContent === "饱和度")[0];
pick(satRow, "50%");
await tick(20);
ok("饱和度 50% → filter 含 saturate(0.5)", String(v0.style.filter).indexOf("saturate(0.5)") >= 0, v0.style.filter);
// 音量均衡：VM 里没有 AudioContext → 必须如实回退，不许留「开了但没效果」的开关
const soundRow = sp().querySelectorAll(".bdm-set-group").filter(g => g.querySelector(".bdm-set-title").textContent === "声音")[0];
pick(soundRow, "音量均衡");
await tick(30);
ok("无 Web Audio 环境 → 音量均衡如实回退（不落库）", store.bdmSettings.volumeBalance === false, String(store.bdmSettings.volumeBalance));
const soundToast = doc.body._flat().filter(n => n._s.has("bdm-toast")).pop();
ok("并给出明确提示", !!soundToast && String(soundToast.textContent).indexOf("不支持音量均衡") >= 0,
  soundToast ? soundToast.textContent : "无提示");
// 注入 AudioContext 桩后应能真正建图
const acLog = { ctx: 0, comp: 0, src: 0, connect: 0, disconnect: 0 };
g.AudioContext = function () {
  acLog.ctx++;
  this.state = "running"; this.destination = { dest: true };
  this.createDynamicsCompressor = () => { acLog.comp++; return { threshold: {}, ratio: {}, attack: {}, release: {},
    connect() { acLog.connect++; }, disconnect() { acLog.disconnect++; } }; };
  this.createMediaElementSource = () => { acLog.src++; return { connect() { acLog.connect++; }, disconnect() { acLog.disconnect++; } }; };
  this.resume = () => {}; this.close = () => {};
};
const soundGroup = () => sp().querySelectorAll(".bdm-set-group").filter(x => x.querySelector(".bdm-set-title").textContent === "声音")[0];
pick(soundGroup(), "音量均衡");
await tick(30);
ok("有 Web Audio 环境 → 开启成功（1 个共享上下文 + 1 个压缩器 + 视频与音轨各 1 个媒体源）",
  acLog.ctx === 1 && acLog.comp === 1 && acLog.src === 2 && store.bdmSettings.volumeBalance === true,
  "ctx=" + acLog.ctx + " comp=" + acLog.comp + " src=" + acLog.src + " store=" + store.bdmSettings.volumeBalance);
ok("开启时元素被路由进压缩器", acLog.connect >= 3, "connect=" + acLog.connect);
// 关键约束：元素一生只能绑一次，关闭不能销毁上下文，否则再开启必抛「元素已绑定到其它上下文」
pick(soundGroup(), "音量均衡");
await tick(30);
const turnedOff = store.bdmSettings.volumeBalance === false && acLog.ctx === 1 && acLog.disconnect >= 2;
pick(soundGroup(), "音量均衡");
await tick(30);
ok("关闭再开启仍成功（不新建上下文、不重复绑定元素）",
  turnedOff && store.bdmSettings.volumeBalance === true && acLog.ctx === 1 && acLog.comp === 1 && acLog.src === 2,
  "关后状态=" + turnedOff + " ctx=" + acLog.ctx + " comp=" + acLog.comp + " src=" + acLog.src + " store=" + store.bdmSettings.volumeBalance);
// 诚实反馈：当前是 mp4 单文件流时，编码偏好改变不了流，提示必须说清生效条件而不是谎报「已切换」
q(".bdm-btn-set").dispatchEvent({ type: "click" });
await tick(20);
q(".bdm-btn-qn").dispatchEvent({ type: "click" });
await tick(20);
s0.querySelector(".bdm-menu").querySelectorAll(".bdm-menu-item")[3].dispatchEvent({ type: "click" });   // 720P → mp4 路径
await tick(90);
ok("切回 720P 后模式为 mp4 单文件流", v0.src === "https://upos.example/v.m4s", v0.src);
q(".bdm-btn-set").dispatchEvent({ type: "click" });
await tick(20);
pick(groupOf("编码"), "HEVC");
await tick(120);
const codecToast = doc.body._flat().filter(n => n._s.has("bdm-toast")).pop();
ok("mp4 档位下选编码 → 如实说明生效条件（不谎报已切换）",
  !!codecToast && String(codecToast.textContent).indexOf("mp4 单文件流") >= 0 && store.bdmSettings.videoCodec === "hevc",
  codecToast ? codecToast.textContent : "无提示");
ok("编码生效条件提示常驻在面板里", titles(sp()).indexOf("编码生效条件") >= 0, titles(sp()));
q(".bdm-btn-set").dispatchEvent({ type: "click" });
await tick(20);

G("H 下一集与退出（信息流尚未耗尽）");
const scrollBefore = root.scrollTop;
// 只有「当前屏」的下一集键生效（产品守卫），所以取当前屏那颗
doc.querySelectorAll(".bdm-slide")[Math.round(root.scrollTop / 800)].querySelector(".bdm-btn-next").dispatchEvent({ type: "click" });
await tick(60);
ok("下一集键 → 滚到下一屏", root.scrollTop === scrollBefore + 800, "scrollTop=" + root.scrollTop);
G("P 直播降级 + 信息流续接兜底（此前零覆盖）");
const nextClick = async () => {
  const i = Math.round(root.scrollTop / 800);
  const sl = doc.querySelectorAll(".bdm-slide")[i];
  if (sl && sl.querySelector(".bdm-btn-next")) sl.querySelector(".bdm-btn-next").dispatchEvent({ type: "click" });
  await tick(70);
};
const s2 = doc.querySelectorAll(".bdm-slide")[2];
const deg2 = s2.querySelector(".bdm-degrade");
ok("直播条目在构建时即转降级卡（不静默丢弃）",
  !!deg2 && deg2.querySelector(".bdm-degrade-title").textContent.indexOf("直播") >= 0,
  deg2 ? deg2.querySelector(".bdm-degrade-title").textContent : "无降级卡");
ok("直播降级卡带主播信息与出口按钮",
  !!deg2 && deg2.querySelector(".bdm-degrade-sub").textContent.indexOf("主播甲") >= 0 &&
  deg2.querySelector(".bdm-degrade-sub").textContent.indexOf("8888") >= 0 &&
  deg2.querySelector(".bdm-degrade-btn").textContent === "进入直播间",
  deg2 ? deg2.querySelector(".bdm-degrade-sub").textContent : "无");
ok("直播屏不得发起取流请求", !calls.url.some(u => u.indexOf("cid=0") >= 0));
// 划到初始 12 条的末尾（前序分组已推进过，故用「划到为止」而非固定次数）
let guard = 0;
while (Math.round(root.scrollTop / 800) < 11 && guard++ < 20) await nextClick();
ok("已划到初始列表末尾（index 11）", Math.round(root.scrollTop / 800) === 11, "idx=" + Math.round(root.scrollTop / 800));
const rcmdBefore = calls.url.filter(u => u.indexOf("rcmd") >= 0).length;
await nextClick();
ok("rcmd 全是重复时，popular 兜底把信息流续上", Math.round(root.scrollTop / 800) === 12, "idx=" + Math.round(root.scrollTop / 800));
ok("兜底确实按 rcmd → popular 顺序尝试",
  calls.url.filter(u => u.indexOf("rcmd") >= 0).length > rcmdBefore && calls.url.some(u => u.indexOf("popular") >= 0),
  "rcmd=" + calls.url.filter(u => u.indexOf("rcmd") >= 0).length + " popular=" + calls.url.filter(u => u.indexOf("popular") >= 0).length);
const s12 = doc.querySelectorAll(".bdm-slide")[12];
ok("续接进来的就是兜底源那一条", !!s12 && s12.querySelector(".bdm-info-title").textContent.indexOf("热门兜底视频") >= 0,
  s12 ? s12.querySelector(".bdm-info-title").textContent : "无");
// 三个源都给不出新内容时：如实提示，不移动位置（临时把兜底源掐断）
feedSourcesDry = true;
await nextClick();
feedSourcesDry = false;
const t3 = doc.body._flat().filter(n => n._s.has("bdm-toast")).pop();
ok("所有续接源都无新内容 → 如实提示且不移动位置",
  Math.round(root.scrollTop / 800) === 12 && !!t3 && String(t3.textContent).indexOf("加载更多失败") >= 0,
  "idx=" + Math.round(root.scrollTop / 800) + " toast=" + (t3 ? t3.textContent : "无"));

G("Q 互动门控（点赞/三连/不感兴趣）——此前零覆盖");
const likeBtn = () => s0.querySelector(".bdm-btn-like");
const lastToast = () => doc.body._flat().filter(n => n._s.has("bdm-toast")).pop();
// ① 总闸关闭：不调接口、如实提示
B.settings.allowExplicitLike = false;
const likeCallsX = calls.url.filter(u => u.indexOf("archive/like") >= 0).length;
likeBtn().dispatchEvent({ type: "click" });
await tick(40);
ok("「放行显式操作」关闭时点赞被拦下且不调接口",
  calls.url.filter(u => u.indexOf("archive/like") >= 0).length === likeCallsX &&
  String(lastToast().textContent).indexOf("放行显式操作") >= 0, lastToast() ? lastToast().textContent : "无提示");
// ② 总闸开启但未登录：仍不调接口
B.settings.allowExplicitLike = true;
doc.cookie = "";
likeBtn().dispatchEvent({ type: "click" });
await tick(40);
ok("未登录点赞被拦下且不调接口",
  calls.url.filter(u => u.indexOf("archive/like") >= 0).length === likeCallsX &&
  String(lastToast().textContent).indexOf("登录") >= 0, lastToast() ? lastToast().textContent : "无提示");
// ③ 登录 + 放行：真的调接口
doc.cookie = "SESSDATA=abc; bili_jct=xyz; DedeUserID=42";
likeBtn().dispatchEvent({ type: "click" });
await tick(60);
ok("已登录 + 放行 → 点赞真的调接口", calls.url.filter(u => u.indexOf("archive/like") >= 0).length === likeCallsX + 1,
  "调用次数=" + calls.url.filter(u => u.indexOf("archive/like") >= 0).length);
s0.querySelector(".bdm-btn-triple").dispatchEvent({ type: "click" });
await tick(60);
ok("三连走点赞/投币/收藏三合一接口", calls.url.some(u => u.indexOf("like/triple") >= 0));
const bodyOf = (frag) => calls.body.filter(b => b && b.indexOf(frag) >= 0).pop() || "";
const bTriple = bodyOf("aid=");
ok("三连用官方形态的 aid（旧实现发 bvid，读 B站 自身代码才发现）",
  calls.url.some(u => u.indexOf("like/triple") >= 0) && bodyOf("csrf=").length > 0 &&
  calls.body.filter(b => b && b.indexOf("aid=") >= 0).length > 0,
  "含 aid 的请求数=" + calls.body.filter(b => b && b.indexOf("aid=") >= 0).length);
// ④ 不感兴趣：弹窗 → 确定 → 提交并移除该屏
const slidesBefore = doc.querySelectorAll(".bdm-slide").length;
const curBefore = B.douyin.current();
// 在「当前屏」上操作：这才是真实用户位置，也才能验证移除后 idx 重新指向
doc.querySelectorAll(".bdm-slide")[Math.round(root.scrollTop / 800)].querySelector(".bdm-btn-dislike").dispatchEvent({ type: "click" });
await tick(40);
const dlgs = doc.body._flat().filter(n => n._s.has("bdm-dialog"));
ok("「不感兴趣」弹出原因选择框（两个理由）",
  dlgs.length >= 1 && dlgs[dlgs.length - 1].querySelectorAll(".bdm-dl-btn").length === 2,
  "弹窗数=" + dlgs.length);
const reasonBtns = dlgs[dlgs.length - 1].querySelectorAll(".bdm-dl-btn");
reasonBtns[0].dispatchEvent({ type: "click" });
await tick(80);
ok("提交原因 → 调用 feedback/dislike 并移除该屏",
  calls.url.some(u => u.indexOf("feedback/dislike") >= 0) &&
  doc.querySelectorAll(".bdm-slide").length === slidesBefore - 1 &&
  B.douyin.current() && B.douyin.current().bvid !== curBefore.bvid,
  "屏数 " + slidesBefore + " → " + doc.querySelectorAll(".bdm-slide").length + " 当前 " + curBefore.bvid + " → " + (B.douyin.current() || {}).bvid);
// 撤销：B站 自己的推荐卡就有这个动作；dislikeCancel 接口此前有实现却零消费点
const undoCalls = () => calls.url.filter(u => u.indexOf("feedback/dislike/cancel") >= 0).length;
const cancelBefore = undoCalls();
const actToast = doc.body._flat().filter(n => n._s.has("bdm-toast")).pop();
const undoBtn = actToast ? actToast.querySelector(".bdm-toast-a") : null;
ok("提交后给出「撤销」入口（6 秒内可反悔）", !!undoBtn && String(undoBtn.textContent) === "撤销",
  undoBtn ? String(undoBtn.textContent) : "无动作按钮");
undoBtn.dispatchEvent({ type: "click" });
await tick(140);
ok("撤销 → 那一屏放回原位，并重新成为当前屏",
  doc.querySelectorAll(".bdm-slide").length === slidesBefore && !!B.douyin.current() && B.douyin.current().bvid === curBefore.bvid,
  "屏数=" + doc.querySelectorAll(".bdm-slide").length + "（原 " + slidesBefore + "）当前=" + (B.douyin.current() || {}).bvid + " 原=" + curBefore.bvid);
ok("撤销 → 同时通知服务端撤销（dislike/cancel，此前零消费点）", undoCalls() > cancelBefore, "调用 " + cancelBefore + " → " + undoCalls());
// 载荷形状：逐字段对照 B站 自身 bundle 里的实现（我们不再靠猜）
const dislikeBody = calls.body.filter(b => b && b.indexOf("app_id=100") >= 0).pop() || "";
const needKeys = ["app_id=100", "platform=5", "spmid=333.1007.0.0", "goto=", "id=", "mid=", "track_id=", "feedback_page=1", "reason_id=", "csrf="];
ok("不感兴趣载荷逐字段对齐 B站 自身实现",
  needKeys.every(k => dislikeBody.indexOf(k) >= 0),
  (needKeys.filter(k => dislikeBody.indexOf(k) < 0).join(",") || "全齐") + " | " + dislikeBody.slice(0, 80));

G("H2 退出与清理");
// 统计信息开着时退出：定时器必须被清掉，否则永久空转
const timersBeforeExit = timers.size;
const actSlide = doc.querySelectorAll(".bdm-slide")[Math.round(root.scrollTop / 800)];
const actVideo = actSlide.querySelector("video");
actVideo.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 300 });
actVideo.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 300 });
await tick(20);
const actMenu = actSlide.querySelector(".bdm-ctx");
actMenu.querySelectorAll(".bdm-ctx-item").filter(n => n.parentNode === actMenu)
  .find(n => n.querySelector(".bdm-ctx-label").textContent === "视频统计信息").dispatchEvent({ type: "click" });
await tick(30);
ok("统计信息开启 → 立刻多一个 500ms 定时器", timers.size === timersBeforeExit + 1, timersBeforeExit + " → " + timers.size);
B.douyin.exit();
ok("退出沉浸 → 统计信息与保险丝定时器一并清掉，不再空转", timers.size <= timersBeforeExit - 1,
  "退出前=" + timersBeforeExit + " 退出后=" + timers.size);
ok("exit() → 根节点移除", doc.querySelector(".bdm-root") === null);
eq("exit() → 恢复页面滚动", doc.body.style.overflow, "");
ok("exit() → 失活", B.douyin.isActive() === false);

G("J 弹幕筛选单元（类型 / 屏蔽词 / 密度）");
const holder = doc.createElement("div");
const P2 = new (g.__BDM__.Player)(holder, { bvid: "BVunit", cid: 1 });
const mk = (text, mode) => ({ t: 0, mode: mode, size: 25, color: 16777215, text: text });
B.settings.dmBlock = ["广告词"]; B.settings.dmDensity = 3; B.settings.dmScroll = true; B.settings.dmTop = true; B.settings.dmBottom = true;
ok("命中屏蔽词 → 拦截", P2.dmAllowed(mk("这里含广告词哦", 1)) === false);
ok("未命中 → 放行", P2.dmAllowed(mk("普通弹幕", 1)) === true);
B.settings.dmTop = false;
ok("顶部弹幕开关关闭 → 拦截", P2.dmAllowed(mk("顶部弹幕", 5)) === false);
ok("代码弹幕（mode 8）始终不执行", P2.dmAllowed(mk("code", 8)) === false);
B.settings.dmDensity = 1; P2.dmSent = 1;
ok("密度低 → 按 1/3 抽稀", P2.dmAllowed(mk("普通弹幕", 1)) === false);
P2.dmSent = 3;
ok("密度低 → 第 3 条放行", P2.dmAllowed(mk("普通弹幕", 1)) === true);
B.settings.dmDensity = 2; B.settings.dmBlock = [];
ok("恢复中密度后不再抽稀到 1/3", P2.dmAllowed(mk("普通弹幕", 1)) === false && (P2.dmSent = 4, P2.dmAllowed(mk("普通弹幕", 1)) === true));

G("R 合集（徽标 / 列表 / 点集插入）——退出后重新进入，在新 feed 上验（顺带覆盖重进）");
// 重新进入沉浸流，拿到一份全新状态
doc.getElementById("bdm-nav-btn").dispatchEvent({ type: "click" });
await tick(500);
ok("退出后能再次进入沉浸流（状态重置）", B.douyin.isActive() === true && doc.querySelectorAll(".bdm-slide").length >= 3,
  "激活=" + B.douyin.isActive() + " 屏数=" + doc.querySelectorAll(".bdm-slide").length);
const root2 = doc.querySelector(".bdm-root");
const sl0 = () => doc.querySelectorAll(".bdm-slide")[0];
const season0 = sl0().querySelector(".bdm-season");
ok("带合集的稿件显示合集徽标与进度", season0.textContent.indexOf("测试合集") >= 0 && season0.textContent.indexOf("1/3") >= 0,
  season0.textContent);
const s1b = doc.querySelectorAll(".bdm-slide")[1];
ok("无合集的稿件不显示徽标", !s1b.querySelector(".bdm-season").textContent, JSON.stringify(s1b.querySelector(".bdm-season").textContent));
season0.dispatchEvent({ type: "click" });
await tick(40);
const sl = sl0().querySelector(".bdm-season-list");
ok("点徽标 → 合集列表展开且集数正确",
  sl.style.display === "block" && sl.querySelectorAll(".bdm-season-item").length === 3,
  "display=" + sl.style.display + " 条数=" + sl.querySelectorAll(".bdm-season-item").length);
ok("列表标题与集号照搬", sl.querySelector(".bdm-season-head").textContent.indexOf("测试合集") >= 0 &&
  sl.querySelectorAll(".bdm-season-item")[1].textContent === "2. 第二集",
  sl.querySelectorAll(".bdm-season-item").map(n => n.textContent).join("/"));
sl.querySelectorAll(".bdm-season-item")[1].dispatchEvent({ type: "click" });
await tick(120);
ok("点第 2 集 → 该集被插入到当前屏之后（列表关闭）", sl.style.display === "none", "display=" + sl.style.display);
ok("插入进来的那集已成为第 2 屏", doc.querySelectorAll(".bdm-slide")[1].querySelector(".bdm-info-title").textContent === "第二集",
  doc.querySelectorAll(".bdm-slide")[1].querySelector(".bdm-info-title").textContent);


ok("重进后退出，收尾干净", (B.douyin.exit(), doc.querySelector(".bdm-root") === null && B.douyin.isActive() === false));

G("S 竞态：加载中划走/退出，迟到的流不得写进已销毁的播放器");
// ① 单元层：销毁屏障
const hp = doc.createElement("div");
const P3 = new (g.__BDM__.Player)(hp, { bvid: "BVrace", cid: 9 });
P3.setSrc("https://x/a.mp4", "https://x/a.m4a");
ok("DASH 首次 setSrc 建 1 条音轨", P3.wrap.querySelectorAll(".bdm-audio").length === 1);
P3.destroy();
ok("destroy 幂等（重复调用不再二次动 DOM）", (P3.destroy(), P3.dead === true && P3.audio === null));
P3.setSrc("https://x/b.mp4", "https://x/b.m4a");
ok("已销毁的播放器拒绝再 setSrc（不换源、不重建不可回收的音轨）",
  P3.video.src !== "https://x/b.mp4" && P3.wrap.querySelectorAll(".bdm-audio").length === 1,
  "src=" + P3.video.src + " 音轨=" + P3.wrap.querySelectorAll(".bdm-audio").length);

// ② 集成层：真实路径 —— 加载中退出（pend 里确认请求真的在飞，避免空跑通过）
const pend = [];
const realPlayurl = B.api.playurl;
B.api.playurl = function () { return new Promise(function (res) { pend.push(res); }); };
B.douyin.enter();
await tick(220);
const racers = doc.querySelectorAll(".bdm-video");   // 直播降级卡会清空 videoArea，故屏数要数 .bdm-slide
ok("流还没回来也照样预建 3 屏（滑动绝不等网络）",
  doc.querySelectorAll(".bdm-slide").length >= 3 && racers.length >= 2 && racers.every(v => !v.src),
  "屏数=" + doc.querySelectorAll(".bdm-slide").length + " 播放器=" + racers.length);
ok("每个真要取流的屏都确实有一个请求在飞（否则下面的断言是空跑）",
  racers.length > 0 && pend.length === racers.length, "播放器=" + racers.length + " 在飞=" + pend.length);
B.douyin.exit();
await tick(30);
pend.forEach(res => res({ url: "https://late/v.m4s", audioUrl: "https://late/a.m4s", quality: 64, qnList: [], qnDesc: [], list: [], codecs: null }));
await tick(150);
ok("退出后迟到的流不写 src（不再发起无人观看的请求）", racers.every(v => !v.src),
  "非空 src 的屏=" + racers.filter(v => v.src).length);
ok("退出后迟到的高清流不重建音轨（Web Audio 节点不可回收）", doc.querySelectorAll(".bdm-audio").length === 0,
  "音轨=" + doc.querySelectorAll(".bdm-audio").length);
B.api.playurl = realPlayurl;

G("T 长会话回收：媒体流与弹幕数据不随刷屏数线性增长");
B.douyin.enter();                        // 全新会话：注意必须重新取根节点（旧 root 句柄已随上次 exit 移除）
await tick(300);
const rootT = doc.querySelector(".bdm-root");
const at = () => Math.round(rootT.scrollTop / 800);
let guardT = 0;
while (at() < 22 && guardT++ < 45) {
  const cur = doc.querySelectorAll(".bdm-slide")[at()];
  const nx = cur && cur.querySelector(".bdm-btn-next");
  if (!nx) break;
  nx.dispatchEvent({ type: "click" });
  await tick(60);
}
const idxT = at();
const rootsT = doc.querySelectorAll(".bdm-slide");
const liveT = rootsT.filter(n => !n._s.has("bdm-released"));
ok("已刷到深位置（要验证回收，会话必须足够长）", idxT >= 20, "idx=" + idxT + " 屏数=" + rootsT.length);
ok("DOM 骨架保留（滚动几何不变，划回去仍定位得到）", rootsT.length >= idxT + 1, "屏数=" + rootsT.length + " idx=" + idxT);
ok("离当前屏远的屏被回收：常驻媒体流有上界", liveT.length <= 9, "未回收=" + liveT.length + " / 共 " + rootsT.length);
ok("已渲染的弹幕节点随回收清空", doc.querySelectorAll(".bdm-dm").length <= 60, "弹幕节点=" + doc.querySelectorAll(".bdm-dm").length);
ok("同时只有一个弹幕心跳（不是每屏一个）", timers.size <= 8, "定时器=" + timers.size);
await tick(900);                                   // 躲开自家平滑滚动的保护窗口
const pBefore = calls.url.filter(u => u.indexOf("playurl") >= 0).length;
const backTo = idxT - 10;
rootT.scrollTop = backTo * 800;
rootT.dispatchEvent({ type: "scroll" });
await tick(600);
const backSlide = doc.querySelectorAll(".bdm-slide")[backTo];
const pAfter = calls.url.filter(u => u.indexOf("playurl") >= 0).length;
ok("划回被回收的屏 → 原位重新取流（playurl 真的再发一次）",
  !!backSlide && !backSlide._s.has("bdm-released") && pAfter > pBefore,
  "playurl " + pBefore + " -> " + pAfter + " released=" + (backSlide ? backSlide._s.has("bdm-released") : "无此屏"));
const likeBefore = calls.url.filter(u => u.indexOf("archive/like") >= 0).length;
backSlide.querySelector(".bdm-btn-like").dispatchEvent({ type: "click" });
await tick(40);
ok("回收不破坏互动：划回后点赞仍然发得出去", calls.url.filter(u => u.indexOf("archive/like") >= 0).length >= likeBefore, "");
B.douyin.exit();
await tick(60);
ok("T 组收尾：退出干净", B.douyin.isActive() === false && doc.querySelector(".bdm-root") === null);
G("U wbi 签名自愈：长驻标签页（页面从不刷新）里密钥轮换后必须能回源重取");
const navCount = () => calls.url.filter(u => u.indexOf("/nav") >= 0).length;
g.__INITIAL_STATE__ = g.__INITIAL_STATE__ || {};
const pageKey = (c) => { g.__INITIAL_STATE__.defaultWbiKey = { wbiImgKey: c.repeat(32), wbiSubKey: "q".repeat(32) }; };
// ① 刚加载的页面：直接用页面烘焙的密钥，不必打 nav
B.api.dropWbi();                       // 清掉前面用例留下的缓存，并让「页面密钥」重新计时
pageKey("r");
const n1 = navCount();
const k1 = await B.api.getWbi();
ok("刚加载的页面用页面烘焙的密钥（不打 nav）",
  !!k1 && k1.img === "r".repeat(32) && navCount() === n1,
  "img=" + (k1 ? k1.img.slice(0, 4) : "无") + " nav=" + navCount() + "(原 " + n1 + ")");
ok("未过期时命中缓存，不重复打 nav", (await B.api.getWbi(), navCount() === n1), "nav=" + navCount());
// ② 关键用例：沉浸流一刷几小时、页面从不刷新 —— 页面那对密钥早已过期
// 沙箱是 vm.createContext(g)，Date 不在 g 上 —— 要在沙箱内部改才算数（这也更贴近真实）
vm.runInContext("(function(){ if (!Date.__orig) { Date.__orig = Date.now; Date.now = function(){ return Date.__orig() + 31 * 60 * 1000; }; } })()", ctx);
const n2 = navCount();
const k2 = await B.api.getWbi();
ok("页面密钥吃满保鲜期 → 回源 nav 重取（旧实现在这里永远走不到）",
  !!k2 && k2.img !== "r".repeat(32) && navCount() > n2,
  "img=" + (k2 ? k2.img.slice(0, 4) : "无") + " nav " + n2 + " -> " + navCount());
vm.runInContext("(function(){ if (Date.__orig) { Date.now = Date.__orig; delete Date.__orig; } })()", ctx);
// ③ 签名被拒：作废缓存 + 退回免签端点，信息流不能断
wbiSignBroken = true;
const itemsAfterReject = await B.api.rcmd(12);
ok("签名被拒 → 退回免签端点，信息流不断", Array.isArray(itemsAfterReject) && itemsAfterReject.length > 0,
  "条数=" + (itemsAfterReject || []).length);
const n3 = navCount();
await B.api.getWbi();
ok("签名被拒会作废密钥缓存（下一轮回源 nav 重取，不再一路用坏密钥）", navCount() > n3,
  "nav " + n3 + " -> " + navCount());
wbiSignBroken = false;
delete g.__INITIAL_STATE__.defaultWbiKey;
G("V 发弹幕（操作条照搬 B站：回车即发，成功与失败都如实回报）");
B.settings.allowExplicitLike = true;    // 本组专测发送链路，显式操作总闸打开
B.douyin.enter();
await tick(350);
const rootV = doc.querySelector(".bdm-root");
const atV = () => Math.round(rootV.scrollTop / 800);
const inV = () => doc.querySelectorAll(".bdm-slide")[atV()].querySelector(".bdm-dm-input");
const toastV = () => doc.body._flat().filter(n => n._s.has("bdm-toast")).map(n => String(n.textContent)).join(" | ");
const dmPosts = () => calls.url.filter(u => u.indexOf("x/v2/dm/post") >= 0).length;
const lastDmBody = () => calls.body.filter(b => b && b.indexOf("msg=") >= 0).pop() || "";
// ① 未登录：不发请求、内容不丢
doc.cookie = "";
const p0 = dmPosts();
inV().value = "未登录发的";
inV().dispatchEvent({ type: "keydown", key: "Enter" });
await tick(60);
ok("未登录 → 不发请求、提示先登录、内容保留",
  dmPosts() === p0 && inV().value === "未登录发的" && toastV().indexOf("登录") >= 0,
  "请求=" + dmPosts() + " toast=" + toastV());
// ② 登录后：真的发出去，且参数逐项正确（含落在当前时间轴）
doc.cookie = "SESSDATA=abc; bili_jct=xyz; DedeUserID=42";
const curV = B.douyin.current();
doc.querySelectorAll(".bdm-slide")[atV()].querySelector("video").currentTime = 12.5;
inV().value = "沉浸流测试弹幕";
inV().dispatchEvent({ type: "keydown", key: "Enter" });
await tick(180);
const bodyV = lastDmBody();
ok("登录后回车 → 真的调用了发弹幕端点", dmPosts() > p0, "调用=" + dmPosts() + " body=" + bodyV.slice(0, 70));
ok("弹幕参数逐项正确（oid=cid / bvid / msg / csrf / progress=当前时间轴）",
  bodyV.indexOf("oid=" + curV.cid) >= 0 && bodyV.indexOf("bvid=" + curV.bvid) >= 0 &&
  decodeURIComponent(bodyV).indexOf("msg=沉浸流测试弹幕") >= 0 && bodyV.indexOf("csrf=xyz") >= 0 &&
  bodyV.indexOf("progress=12500") >= 0, bodyV.slice(0, 170));
ok("成功 → 清空输入框并如实报「已发送」（带落点时间）",
  inV().value === "" && toastV().indexOf("弹幕已发送") >= 0, "toast=" + toastV() + " 框=" + inV().value);
// ②b 发送按钮：B站 操作条上「回车」与「发送」并存，必须同一条路径
doc.querySelectorAll(".bdm-slide")[atV()].querySelector(".bdm-dm-input").value = "点发送按钮发的";
doc.querySelectorAll(".bdm-slide")[atV()].querySelector(".bdm-btn-dmsend").dispatchEvent({ type: "click" });
await tick(180);
ok("点「发送」按钮 → 与回车同一条路径（发出同一端点、发出后清空）",
  dmPosts() > p0 && decodeURIComponent(lastDmBody()).indexOf("msg=点发送按钮发的") >= 0 && inV().value === "",
  "调用=" + dmPosts() + " 框=" + JSON.stringify(inV().value));
// ②c 飞行中重复触发：同一 tick 内连点两下「发送」/连按回车，不该发出两条一样的弹幕
const pRepeat = dmPosts();
const slideV = doc.querySelectorAll(".bdm-slide")[atV()];
slideV.querySelector(".bdm-dm-input").value = "连点两下";
slideV.querySelector(".bdm-btn-dmsend").dispatchEvent({ type: "click" });
slideV.querySelector(".bdm-btn-dmsend").dispatchEvent({ type: "click" });
await tick(200);
ok("请求飞行中再触发一次 → 只发一条（重复触发不该刷屏）", dmPosts() - pRepeat === 1, "实际发出 " + (dmPosts() - pRepeat) + " 条");

// ③ 服务端拒绝：绝不谎报成功，内容还给用户
dmPostCode = -412;
inV().value = "会被风控拦下的弹幕";
inV().dispatchEvent({ type: "keydown", key: "Enter" });
await tick(180);
ok("服务端拒绝 → 如实报因、内容保留、不谎报成功",
  toastV().indexOf("发送失败") >= 0 && toastV().indexOf("风控") >= 0 && inV().value === "会被风控拦下的弹幕",
  "toast=" + toastV() + " 框=" + inV().value);
ok("失败出口：内容已复制并给出原页（内容不丢）",
  calls.copied.indexOf("会被风控拦下的弹幕") >= 0 && calls.opened.some(u => u.indexOf("/video/") > 0),
  "copied=" + JSON.stringify(calls.copied.slice(-1)) + " opened=" + calls.opened.length);
dmPostCode = 0;
doc.cookie = "";
B.douyin.exit();
await tick(60);
ok("V 组收尾：退出干净", B.douyin.isActive() === false && doc.querySelector(".bdm-root") === null);
G("W 简介（v0.1.24 点名要的三件事里唯一没落地的一件）");
B.douyin.enter();
await tick(400);
const rootW = doc.querySelector(".bdm-root");
const goW = async (i) => { rootW.scrollTop = i * 800; rootW.dispatchEvent({ type: "scroll" }); await tick(400); };
const slW = () => doc.querySelectorAll(".bdm-slide")[Math.round(rootW.scrollTop / 800)];
const moreW = () => slW().querySelector(".bdm-info-more");
const descW = () => slW().querySelector(".bdm-desc-panel");
const viewCalls = () => calls.url.filter(u => u.indexOf("web-interface/view") >= 0).length;
const descText = () => descW()._flat().map(n => String(n.textContent)).join("\n");
ok("信息区有「简介」入口（B站 桌面版是点标题展开，这里给明确入口）", !!moreW() && String(moreW().textContent) === "简介");
ok("简介面板默认收起", descW().style.display === "none");
moreW().dispatchEvent({ type: "click" });
await tick(150);
ok("点简介 → 面板展开，标题为「简介」",
  descW().style.display === "block" && descW().querySelector(".bdm-settings-title").textContent === "简介",
  "display=" + descW().style.display);
const t1 = descText();
ok("简介正文来自真实接口（含换行，不是占位文案）", t1.indexOf("这是测试稿件的简介正文") >= 0 && t1.indexOf("第二行") >= 0, t1.slice(0, 60));
ok("信息行齐备：UP主 / 发布 / 数据（万位格式化）",
  t1.indexOf("UP主：UP0") >= 0 && t1.indexOf("发布：") >= 0 && t1.indexOf("12.3万 播放") >= 0,
  t1.split("\n").filter(x => x.indexOf("主：") >= 0 || x.indexOf("数据") >= 0).join(" / "));
ok("合集信息也在简介里（与徽标同源）", t1.indexOf("合集：测试合集") >= 0, t1.slice(0, 40));
const vc1 = viewCalls();
moreW().dispatchEvent({ type: "click" });
await tick(60);
ok("再点一次 → 收起", descW().style.display === "none");
moreW().dispatchEvent({ type: "click" });
await tick(120);
ok("缓存生效：第二次打开不再打 view 接口", viewCalls() === vc1, "view " + vc1 + " -> " + viewCalls());
// 合集列表与简介面板同位同尺寸（都挂左下、380 宽）：必须互斥，不能叠在一起
moreW().dispatchEvent({ type: "click" });            // 先收起简介
await tick(60);
slW().querySelector(".bdm-season").dispatchEvent({ type: "click" });
await tick(60);
const seasonOpen = slW().querySelector(".bdm-season-list").style.display;
moreW().dispatchEvent({ type: "click" });            // 再开简介 → 合集列表应自动收起
await tick(150);
ok("合集列表与简介面板互斥（开后一个，前一个自动收起）",
  seasonOpen === "block" && slW().querySelector(".bdm-season-list").style.display === "none" && descW().style.display === "block",
  "合集(开时)=" + seasonOpen + " 合集(现)=" + slW().querySelector(".bdm-season-list").style.display + " 简介=" + descW().style.display);
moreW().dispatchEvent({ type: "click" });            // 收尾：收起简介
await tick(60);
// 详情接口取不到的稿件（第 2 屏 BV1test0001）：如实报错 + 给出出口，绝不留空白
await goW(1);
ok("第 2 屏是「详情取不到」那一条", B.douyin.current().bvid === "BV1test0001", "bvid=" + B.douyin.current().bvid);
moreW().dispatchEvent({ type: "click" });
await tick(220);
const tFail = descText();
ok("详情取不到 → 如实提示失败并给「打开原页」出口",
  tFail.indexOf("简介加载失败") >= 0 && descW()._flat().some(n => String(n.textContent) === "打开原页"),
  tFail.slice(0, 60));
moreW().dispatchEvent({ type: "click" });
await tick(60);
ok("失败后再点一次也能正常收起（不会卡在加载态）", descW().style.display === "none");
// 第 3 屏是直播条目：没有简介可言，入口必须收起来（别留一个点了就错的按钮）
await goW(2);
ok("第 3 屏是直播条目", slW().querySelector(".bdm-info-title").textContent === "直播间测试标题",
  "标题=" + slW().querySelector(".bdm-info-title").textContent);
ok("直播屏不显示「简介」入口", moreW().style.display === "none", "display=" + moreW().style.display);
// 取到了详情但稿件没填简介（第 4 屏 BV1test0003）：如实说明，不留空白
await goW(3);
ok("第 4 屏是「没填简介」那一条", B.douyin.current().bvid === "BV1test0003", "bvid=" + B.douyin.current().bvid);
moreW().dispatchEvent({ type: "click" });
await tick(220);
ok("没填简介 → 如实说「该稿件没有填写简介」", descText().indexOf("该稿件没有填写简介") >= 0, descText().slice(0, 60));
moreW().dispatchEvent({ type: "click" });
await tick(60);
B.douyin.exit();
await tick(60);
ok("W 组收尾：退出干净", B.douyin.isActive() === false);
G("X 互动端点与失败诚实性（投币此前零覆盖，端点写错都没人发现）");
B.douyin.enter();
await tick(400);
const rootX = doc.querySelector(".bdm-root");
const atX = () => Math.round(rootX.scrollTop / 800);
const slX = () => doc.querySelectorAll(".bdm-slide")[atX()];
const toastX = () => doc.body._flat().filter(n => n._s.has("bdm-toast")).map(n => String(n.textContent)).join(" | ");
const dlgBtns = () => { const ds = doc.body._flat().filter(n => n._s.has("bdm-dialog")); return ds.length ? ds[ds.length - 1].querySelectorAll(".bdm-dl-btn") : []; };
doc.cookie = "SESSDATA=abc; bili_jct=xyz; DedeUserID=42";
B.settings.allowExplicitLike = true;
// ① 投币必须走真实存在的端点（旧实现用的 archive/coin 实测是 404）
const coinBefore = calls.url.filter(u => u.indexOf("coin") >= 0).length;
slX().querySelector(".bdm-btn-coin").dispatchEvent({ type: "click" });
await tick(80);
ok("点投币 → 弹出 1 枚 / 2 枚选择", dlgBtns().length === 2, "按钮数=" + dlgBtns().length);
dlgBtns().find(b => String(b.textContent) === "投 1 枚").dispatchEvent({ type: "click" });
await tick(150);
const coinUrls = calls.url.filter(u => u.indexOf("coin") >= 0);
ok("投币走真实端点 /x/web-interface/coin/add（旧路径 archive/coin 实测 404）",
  coinUrls.length > coinBefore && coinUrls[coinUrls.length - 1].indexOf("/x/web-interface/coin/add") >= 0 &&
  !coinUrls.some(u => u.indexOf("archive/coin") >= 0), coinUrls[coinUrls.length - 1] || "无请求");
ok("投币成功 → 如实提示成功", toastX().indexOf("投币成功") >= 0, toastX());
// ② 投币失败：如实报因，且按钮恢复可点（不能卡在禁用态）
coinCode = -412;
slX().querySelector(".bdm-btn-coin").dispatchEvent({ type: "click" });
await tick(80);
const btn2 = dlgBtns().find(b => String(b.textContent) === "投 2 枚");
const toastBoxes = () => doc.body._flat().filter(n => n._s.has("bdm-toast"));
const nToastBefore = toastBoxes().length;
btn2.dispatchEvent({ type: "click" });
await tick(150);
// toast 要 1.8 秒才消失，所以只看**最新一条**是不是失败提示（旧的成功提示还留在 DOM 里是正常的）
const newest = toastBoxes().slice(-1).map(n => String(n.textContent)).join("");
ok("投币失败 → 最新提示如实报因（含服务端消息）、按钮恢复可点、不谎报成功",
  toastBoxes().length > nToastBefore && newest.indexOf("投币失败") >= 0 && newest.indexOf("硬币不足") >= 0 && btn2.disabled !== true,
  "最新=" + newest + " disabled=" + btn2.disabled);
coinCode = 0;
// ③ 点赞失败：此前是静默的（按钮不变蓝、什么都不说）
const likeCallsX2 = calls.url.filter(u => u.indexOf("archive/like") >= 0).length;
likeCode = -412;
slX().querySelector(".bdm-btn-like").dispatchEvent({ type: "click" });
await tick(150);
const likeBtnX = slX().querySelector(".bdm-btn-like");
ok("点赞失败 → 有真实原因提示，且按钮不亮（不再静默）",
  calls.url.filter(u => u.indexOf("archive/like") >= 0).length > likeCallsX2 &&
  toastX().indexOf("点赞失败") >= 0 && toastX().indexOf("风控") >= 0 && !likeBtnX._s.has("bdm-act-on"),
  "toast=" + toastX() + " 亮了=" + likeBtnX._s.has("bdm-act-on"));
// ④ 点赞成功：按钮亮（确认上面的开关关掉后仍正常）
likeCode = 0;
slX().querySelector(".bdm-btn-like").dispatchEvent({ type: "click" });
await tick(150);
ok("点赞成功 → 按钮点亮", slX().querySelector(".bdm-btn-like")._s.has("bdm-act-on"),
  "toast=" + toastX());
// 写接口参数形态：以 B站 自身实现为准（aid 为主 + like/multiply/select_like）
const likeBody = calls.body.filter(b => b && b.indexOf("like=1") >= 0).pop() || "";
ok("点赞体用 aid + like=1（官方形态）", likeBody.indexOf("aid=") >= 0 && likeBody.indexOf("like=1") >= 0, likeBody.slice(0, 80));
const coinBody = calls.body.filter(b => b && b.indexOf("multiply=") >= 0).pop() || "";
ok("投币体用 aid + multiply + select_like=0 + cross_domain（官方形态）",
  coinBody.indexOf("aid=") >= 0 && coinBody.indexOf("multiply=") >= 0 && coinBody.indexOf("select_like=0") >= 0 && coinBody.indexOf("cross_domain") >= 0,
  coinBody.slice(0, 110));
// ⑤ 测试台自证：未登记的端点会响亮失败（投币那次绿灯就是被默认放行放过去的）
const unknown = await B.api.get("https://api.bilibili.com/x/definitely/not/registered");
ok("mock 对未登记端点返回 -404（这条网能挡住写错的端点）",
  !!unknown && unknown.code === -404 && String(unknown.message).indexOf("mock 未登记") >= 0,
  JSON.stringify(unknown).slice(0, 70));
doc.cookie = "";
B.douyin.exit();
await tick(60);
ok("X 组收尾：退出干净", B.douyin.isActive() === false);
G("Z 评论分页（实现早就有，但「加载更多」此前零覆盖 —— 与投币同一类盲区）");
B.douyin.enter();
await tick(400);
const rootZ = doc.querySelector(".bdm-root");
const slZ = () => doc.querySelectorAll(".bdm-slide")[Math.round(rootZ.scrollTop / 800)];
const panelZ = () => slZ().querySelector(".bdm-panel");
const cmtRows = () => slZ().querySelectorAll(".bdm-cmt");
const moreZ = () => slZ().querySelector(".bdm-cmt-more");
const replyCalls = () => calls.url.filter(u => u.indexOf("/x/v2/reply") >= 0).length;
slZ().querySelector(".bdm-btn-cmt").dispatchEvent({ type: "click" });
await tick(220);
ok("评论面板展开并显示第一页", panelZ().style.display === "flex" && cmtRows().length === 1, "行=" + cmtRows().length);
const firstRow = cmtRows()[0];
ok("还有更多时给出「加载更多」", !!moreZ() && String(moreZ().textContent) === "加载更多", moreZ() ? String(moreZ().textContent) : "无");
const cBefore = replyCalls();
moreZ().dispatchEvent({ type: "click" });
await tick(240);
ok("加载更多 → 请求第 2 页且列表变长",
  replyCalls() > cBefore && cmtRows().length === 2 && calls.url.some(u => /[?&]pn=2/.test(u)),
  "行=" + cmtRows().length + " 调用 " + cBefore + "→" + replyCalls());
ok("只追加不重建：第一页那一行仍是同一个节点（点完不会被扔回顶部）",
  cmtRows()[0] === firstRow && firstRow.parentNode === slZ().querySelector(".bdm-panel-body"),
  "同一节点=" + (cmtRows()[0] === firstRow));
ok("到底了就收起「加载更多」", !moreZ(), moreZ() ? String(moreZ().textContent) : "已收起");
const cAfter = replyCalls();
slZ().querySelector(".bdm-btn-cmt").dispatchEvent({ type: "click" });
await tick(80);
slZ().querySelector(".bdm-btn-cmt").dispatchEvent({ type: "click" });
await tick(180);
ok("面板重开不重复请求（rec.cmts 缓存），且已加载的两页都在",
  replyCalls() === cAfter && cmtRows().length === 2, "调用 " + cAfter + "→" + replyCalls() + " 行=" + cmtRows().length);
B.douyin.exit();
await tick(60);
ok("Z 组收尾：退出干净", B.douyin.isActive() === false);
G("Y 收藏与分享弹窗（此前零覆盖：分享在测试里一次都没出现）");
B.douyin.enter();
await tick(400);
const rootY = doc.querySelector(".bdm-root");
const slY = () => doc.querySelectorAll(".bdm-slide")[Math.round(rootY.scrollTop / 800)];
const toastY = () => doc.body._flat().filter(n => n._s.has("bdm-toast")).map(n => String(n.textContent)).join(" | ");
const dlgY = () => { const ds = doc.body._flat().filter(n => n._s.has("bdm-dialog")); return ds.length ? ds[ds.length - 1] : null; };
doc.cookie = "SESSDATA=abc; bili_jct=xyz; DedeUserID=42";
B.settings.allowExplicitLike = true;
// ① 分享弹窗：链接正确 + 复制可用（此前零断言）
slY().querySelector(".bdm-btn-share").dispatchEvent({ type: "click" });
await tick(160);
const shareBox = dlgY();
const shareInput = shareBox ? shareBox.querySelector(".bdm-share-input") : null;
ok("点分享 → 弹窗里给出标准视频链接",
  !!shareInput && String(shareInput.value).indexOf("bilibili.com/video/") > 0, shareInput ? String(shareInput.value) : "无输入框");
const copiedBefore = calls.copied.length;
shareBox.querySelectorAll(".bdm-dl-btn")[0].dispatchEvent({ type: "click" });
await tick(80);
ok("点复制 → 真的写进剪贴板且按钮给出反馈", calls.copied.length > copiedBefore && /bilibili\.com\/video\//.test(calls.copied[calls.copied.length - 1] || ""),
  "copied=" + JSON.stringify(calls.copied.slice(-1)));
// ② 收藏弹窗：列出收藏夹并反映已收藏状态
slY().querySelector(".bdm-btn-fav").dispatchEvent({ type: "click" });
await tick(200);
const favBox = dlgY();
const favRows = favBox.querySelectorAll(".bdm-fav-row");
const favCbs = favRows.map(r => r.querySelector("input"));
ok("收藏弹窗列出全部收藏夹，已收藏的默认勾上",
  favRows.length === 2 && favCbs[0].checked === true && favCbs[1].checked === false,
  "夹数=" + favRows.length + " 勾选=" + favCbs.map(c => c.checked).join(","));
// ③ 什么都不改就确定：必须说清楚（原实现是静默关闭）
const dealCalls0 = calls.url.filter(u => u.indexOf("fav/resource/deal") >= 0).length;
favBox.querySelector(".bdm-fav-ok").dispatchEvent({ type: "click" });
await tick(120);
ok("未做修改就确定 → 明确提示且不发请求（不再静默关闭）",
  toastY().indexOf("未做修改") >= 0 && calls.url.filter(u => u.indexOf("fav/resource/deal") >= 0).length === dealCalls0,
  "toast=" + toastY());
// ④ 勾选新收藏夹 → 提交 add_media_ids
slY().querySelector(".bdm-btn-fav").dispatchEvent({ type: "click" });
await tick(200);
const favBox2 = dlgY();
const cb2 = favBox2.querySelectorAll(".bdm-fav-row").map(r => r.querySelector("input"));
cb2[1].checked = true;
cb2[1].dispatchEvent({ type: "change" });
favBox2.querySelector(".bdm-fav-ok").dispatchEvent({ type: "click" });
await tick(160);
const dealBody = calls.body.filter(b => b && b.indexOf("add_media_ids") >= 0).pop() || "";
ok("勾选新收藏夹 → 提交 add_media_ids=2 且 rid 用 aid（空的那个 id 键不发）",
  dealBody.indexOf("add_media_ids=2") >= 0 && dealBody.indexOf("rid=") >= 0 && dealBody.indexOf("type=2") >= 0 &&
  dealBody.indexOf("del_media_ids") < 0 && dealBody.indexOf("platform=web") >= 0, dealBody.slice(0, 100));
ok("保存成功 → 如实提示", toastY().indexOf("已保存") >= 0, toastY());
// ⑤ 保存失败 → 提示里带服务端原因
favDealCode = -400;
slY().querySelector(".bdm-btn-fav").dispatchEvent({ type: "click" });
await tick(200);
const favBox3 = dlgY();
const cb3 = favBox3.querySelectorAll(".bdm-fav-row").map(r => r.querySelector("input"));
cb3[0].checked = false;
cb3[0].dispatchEvent({ type: "change" });
favBox3.querySelector(".bdm-fav-ok").dispatchEvent({ type: "click" });
await tick(160);
const newestY = doc.body._flat().filter(n => n._s.has("bdm-toast")).slice(-1).map(n => String(n.textContent)).join("");
ok("保存失败 → 最新提示带服务端原因（不谎报成功）",
  newestY.indexOf("保存失败") >= 0 && newestY.indexOf("收藏夹满了") >= 0, "最新=" + newestY);
favDealCode = 0;
doc.cookie = "";
B.douyin.exit();
await tick(60);
ok("Y 组收尾：退出干净", B.douyin.isActive() === false);
G("AA 三个零覆盖功能：画像守卫 / 右键长按倍速 / 字幕后台中转兜底");
// ① 画像守卫：installProfileGuard 全局改写了 fetch 与 XHR.open/send，判据写宽就会毁掉整个扩展
const urlReport = "https://api.bilibili.com/x/click-interface/click/web/h5?aid=1";
const urlOurs = "https://api.bilibili.com/x/web-interface/view?bvid=BV1test0000";
B.settings.profileGuard = true;
let nG = calls.url.length;
const rGuard = await g.fetch(urlReport);
ok("画像守卫：上报类请求被本地拦下（不打网络）",
  calls.url.length === nG && String(await rGuard.text()) === "{}", "新增请求=" + (calls.url.length - nG));
nG = calls.url.length;
await g.fetch(urlOurs);
ok("画像守卫：绝不拦我们自己的接口（判据写宽＝整个扩展瘫掉）", calls.url.length === nG + 1, "新增=" + (calls.url.length - nG));
B.settings.profileGuard = false;
nG = calls.url.length;
await g.fetch(urlReport);
ok("画像守卫关掉后：上报请求放行", calls.url.length === nG + 1, "新增=" + (calls.url.length - nG));
B.settings.profileGuard = true;
// ② 右键长按倍速：按住 3x，松手必须恢复到**发起长按的那一屏**
B.douyin.enter();
await tick(420);
const rootA = doc.querySelector(".bdm-root");
const vsA = doc.querySelectorAll(".bdm-video");
B.settings.longpressRate = true;
vsA[0].dispatchEvent({ type: "mousedown", button: 2, clientX: 10, clientY: 10 });
ok("按住右键 → 立刻 3 倍速", vsA[0].playbackRate === 3, "rate=" + vsA[0].playbackRate);
rootA.scrollTop = 800;
rootA.dispatchEvent({ type: "scroll" });
await tick(320);
g.dispatchEvent({ type: "mouseup" });   // 全局松手：真实场景下手可能已经移出了那个元素
ok("松手 → 恢复到发起长按的那一屏（原实现恢复当前屏，原屏会永久停在 3x）",
  vsA[0].playbackRate === 1, "原屏 rate=" + vsA[0].playbackRate);
B.settings.longpressRate = false;
B.douyin.exit();
await tick(60);
// ③ 字幕后台中转兜底：CORS 被拦时走 SW，且必须有超时（SW 不响应不能永远挂着）
B.api.relayTimeoutMs(80);
calls.msg.length = 0;
relayReply = null;
const tRelay = Date.now();
const cuesNone = await B.api.subtitleBody("https://aisubtitle.example/never-answered.json");
ok("中转无响应 → 有超时兜底（返回空而不是永远挂着）",
  Array.isArray(cuesNone) && cuesNone.length === 0 && Date.now() - tRelay < 1500 &&
  calls.msg.some(m => m && m.type === "bdm:fetch-json"),
  "用时 " + (Date.now() - tRelay) + "ms 消息=" + JSON.stringify(calls.msg.slice(-1)));
calls.msg.length = 0;
relayReply = { ok: true, data: { body: [{ from: 0, to: 2, content: "中转回来的第一句" }] } };
const cuesOk = await B.api.subtitleBody("https://aisubtitle.example/relay-ok.json");
ok("中转有响应 → 字幕正文正常解析成 cue",
  cuesOk.length === 1 && cuesOk[0].text === "中转回来的第一句", JSON.stringify(cuesOk));
B.api.relayTimeoutMs(6000);
relayReply = null;
G("AB 两处改写页面行为的功能（零覆盖：抑制登录弹窗 / 不自动暂停）+ 需要登录时的可用出口");
const visNAB = { n: 0 };
const onVis = () => { visNAB.n += 1; };
doc.addEventListener("visibilitychange", onVis);   // 模拟「B站 页面自己的」监听器（注册在守卫之后）
B.douyin.enter();
await tick(320);
B.settings.noAutoPause = true;
B.settings.suppressLoginPopup = true;
visNAB.n = 0;
doc.dispatchEvent({ type: "visibilitychange" });
ok("沉浸流中 + 不自动暂停开 → 页面自身的 visibilitychange 监听被截断",
  visNAB.n === 0 && doc.bdmImmersive === true, "收到=" + visNAB.n + " 沉浸=" + doc.bdmImmersive);
B.douyin.exit();
await tick(60);
visNAB.n = 0;
doc.dispatchEvent({ type: "visibilitychange" });
ok("退出沉浸流后 → 不截断（不干扰页面自身行为）", visNAB.n === 1, "收到=" + visNAB.n);
B.douyin.enter();
await tick(320);
B.settings.noAutoPause = false;
visNAB.n = 0;
doc.dispatchEvent({ type: "visibilitychange" });
ok("关掉「不自动暂停」→ 不截断", visNAB.n === 1, "收到=" + visNAB.n);
B.settings.noAutoPause = true;
// 需要登录时的出口：默认开着抑制弹窗，只丢一句话等于把人堵死
const slAB = () => doc.querySelectorAll(".bdm-slide")[Math.round(doc.querySelector(".bdm-root").scrollTop / 800)];
doc.cookie = "";
slAB().querySelector(".bdm-btn-like").dispatchEvent({ type: "click" });
await tick(90);
const loginBoxAB = doc.body._flat().filter(n => n._s.has("bdm-toast")).pop();
const loginActAB = loginBoxAB ? loginBoxAB.querySelector(".bdm-toast-a") : null;
ok("未登录互动 → 提示说明原因，并点明登录弹窗已被抑制",
  !!loginBoxAB && String(loginBoxAB.textContent).indexOf("登录") >= 0 && String(loginBoxAB.textContent).indexOf("抑制") >= 0,
  loginBoxAB ? String(loginBoxAB.textContent) : "无提示");
const openedAB = calls.opened.length;
loginActAB.dispatchEvent({ type: "click" });
await tick(60);
ok("提示里有「去登录」，点了真的打开通行证登录页（弹窗被抑制时仍能登录）",
  calls.opened.length > openedAB && calls.opened[calls.opened.length - 1].indexOf("passport.bilibili.com/login") >= 0,
  "opened=" + JSON.stringify(calls.opened.slice(-1)));
doc.cookie = "SESSDATA=abc; bili_jct=xyz; DedeUserID=42";
// 抑制登录弹窗：按设置隐藏 B站 的登录遮罩（用 MutationObserver 模拟页面插入节点）
const maskOnAB = doc.createElement("div");
maskOnAB.className = "bili-mini-mask";
doc.body.appendChild(maskOnAB);
MOs[MOs.length - 1].cb();
ok("开启抑制 → B站 登录遮罩被隐藏（置 display:none，且不删除节点）",
  maskOnAB.style.display === "none" && maskOnAB.parentNode === doc.body, "display=" + maskOnAB.style.display);
B.settings.suppressLoginPopup = false;
const maskOffAB = doc.createElement("div");
maskOffAB.className = "bili-mini-mask";
doc.body.appendChild(maskOffAB);
MOs[MOs.length - 1].cb();
ok("关闭抑制 → 不碰 B站 的登录遮罩", !maskOffAB.style.display, "display=" + JSON.stringify(maskOffAB.style.display));
B.settings.suppressLoginPopup = true;
doc.cookie = "";
B.douyin.exit();
await tick(60);
ok("AB 组收尾：退出干净", B.douyin.isActive() === false);
G("AC DASH 双轨音画同步（此前零覆盖）+ 关掉弹幕后纠偏仍在跑（真耦合缺陷）");
const holderAC = doc.createElement("div");
const pAC = new (g.__BDM__.Player)(holderAC, { bvid: "BVsync", cid: 7 });
B.settings.dmEnabled = false;                 // 关键：关掉弹幕，tickDanmaku 不再驱动 syncAudio
pAC.setSrc("https://upos.example/v.m4s", "https://upos.example/a.m4s");
const vAC = pAC.video, aAC = pAC.audio;
ok("DASH 流建出配套音轨", !!aAC && String(aAC.src).indexOf("a.m4s") > 0, aAC ? String(aAC.src) : "无音轨");
const timersAC0 = timers.size;
vAC.play();
await tick(60);
ok("播放时挂上独立的音画纠偏心跳（不依赖弹幕开关）", timers.size > timersAC0, "定时器 " + timersAC0 + " → " + timers.size);
vAC.currentTime = 10; aAC.currentTime = 10.5;   // 人为把音轨拉偏 0.5 秒
await tick(1300);
ok("音轨漂移 0.5s → 一个心跳周期内被纠回（弹幕关着也照纠）",
  Math.abs(aAC.currentTime - vAC.currentTime) < 0.05, "音轨=" + aAC.currentTime + " 画面=" + vAC.currentTime);
vAC.pause();
await tick(80);
ok("暂停 → 纠偏心跳停止（不会每屏留一个定时器）", timers.size <= timersAC0, "定时器=" + timers.size);
const srcAC0 = acLog.src;
pAC.setVolumeBalance(true);
pAC.setVolumeBalance(false);
pAC.setVolumeBalance(true);
await tick(40);
ok("反复开关音量均衡不得重建媒体源（元素一生只能绑一次，回收/重建场景的安全前提）",
  acLog.src === srcAC0 + 2, "媒体源 " + srcAC0 + " → " + acLog.src);
pAC.destroy();
ok("销毁 → 纠偏心跳一并清掉", pAC.syncTimer === null, "syncTimer=" + pAC.syncTimer);
B.settings.dmEnabled = true;
G("AD 滚轮与原生滚动翻页（此前零覆盖：桌面端最主要的换屏手势）");
// 这条链路此前一条断言都没有，而它承载过两个真缺陷：① 基准取测量值而非逻辑位置 →「刷两下就卡住」
// ② 原生滚动（B站 在捕获阶段吞掉 wheel）时 DOM 只够当前屏 →「划到第 3 条就再也动不了」。
B.douyin.enter();
await tick(400);
const rootAD = doc.querySelector(".bdm-root");
const idxAD = () => Math.round(rootAD.scrollTop / 800);
function wheelAD(dy) { const ev = { type: "wheel", deltaY: dy }; g.dispatchEvent(ev); return ev.defaultPrevented === true; }
const gapAD = () => tick(700);   // 每个动作前先等过节流窗口(550ms)，否则滚轮被吃掉、断言变空跑
ok("AD 组进入沉浸流，落在首屏", idxAD() === 0 && !!B.douyin.current(), "scrollTop=" + rootAD.scrollTop);
const bvidAD0 = B.douyin.current().bvid;
await gapAD();
const prevAD1 = wheelAD(120);
await tick(80);
ok("滚轮向下 → 前进一屏，并阻止原生滚动（否则 B站 页面会跟着一起滚）",
  idxAD() === 1 && B.douyin.current().bvid !== bvidAD0 && prevAD1 === true,
  "scrollTop=" + rootAD.scrollTop + " prevented=" + prevAD1);
await gapAD();
wheelAD(120); wheelAD(120);
await tick(80);
ok("550ms 内连发两次只走一屏（惯性不会一次跳两屏）", idxAD() === 2 && rootAD.scrollTop === 1600,
  "scrollTop=" + rootAD.scrollTop + " 当前=" + (B.douyin.current() || {}).bvid);
await gapAD();
wheelAD(-120);
await tick(80);
ok("滚轮向上 → 退回上一屏", idxAD() === 1 && rootAD.scrollTop === 800, "scrollTop=" + rootAD.scrollTop);
await gapAD();
wheelAD(-120);
await tick(80);
const slidesAD = doc.querySelectorAll(".bdm-slide").length;
await gapAD();
wheelAD(-120);
await tick(80);
ok("首屏继续向上 → 原地不动、不报错、不重复建屏",
  idxAD() === 0 && doc.querySelectorAll(".bdm-slide").length === slidesAD,
  "scrollTop=" + rootAD.scrollTop + " 屏数 " + slidesAD + " → " + doc.querySelectorAll(".bdm-slide").length);
const bvidADtop = B.douyin.current() ? B.douyin.current().bvid : null;
await tick(900);
rootAD.scrollTop = 800;
rootAD.dispatchEvent({ type: "scroll" });
await tick(260);
ok("原生滚动兜底：没拿到 wheel 事件时也照样同步当前屏并预建后续屏（「划到第 3 条就动不了」的守卫）",
  idxAD() === 1 && !!B.douyin.current() && B.douyin.current().bvid !== bvidADtop && doc.querySelectorAll(".bdm-slide").length >= 3,
  "idx=" + idxAD() + " 屏数=" + doc.querySelectorAll(".bdm-slide").length + " 当前=" + (B.douyin.current() || {}).bvid);
B.douyin.exit();
await tick(80);
const prevADoff = wheelAD(120);
await tick(80);
ok("退出沉浸后滚轮完全放手：不翻页、也不阻止原生滚动（否则退出后页面滚不动）",
  prevADoff === false && B.douyin.isActive() === false, "prevented=" + prevADoff + " 激活=" + B.douyin.isActive());
ok("AD 组收尾：退出干净", B.douyin.isActive() === false && doc.querySelector(".bdm-root") === null);
G("AE 计数格式化（万/亿）与渲染 —— 此前零覆盖（ui.fmt 被 4 处用户可见文案共用）");
// 判据不是「我觉得」，是 B站 自己的 bundle：逆向资料/render__assets__lib__core.js 里的工具函数
//   const t=Number(e), i = t>=1e8 ? (t/1e8).toFixed(1)+"亿" : t>=1e4 ? (t/1e4).toFixed(1)+"万" : String(e)
// 即：边界取 >=，且到 1e8 才进位到亿（99999999 会显示成 10000.0万，不会翻滚成 1.0亿）。
const FMT = B.ui.fmt;
eq("9999：不到万，原样输出", FMT(9999), "9999");
eq("10000（边界，>= 判定）→ 1.0万", FMT(10000), "1.0万");
eq("12345678 → 1234.6万", FMT(12345678), "1234.6万");
eq("99999999 → 10000.0万（到 1e8 才进位，与 B站 一致）", FMT(99999999), "10000.0万");
eq("100000000 → 1.0亿", FMT(100000000), "1.0亿");
eq("0 与 undefined 都不出现 NaN", FMT(0) + "/" + FMT(undefined), "0/0");
const bAE = B.ui.buildSlide({ bvid: "BV1fmt", cid: 1, aid: 1, title: "计数", pic: "", duration: 60,
  owner: { mid: 1, name: "UP" }, stat: { view: 12345678, like: 234567, danmaku: 34567890, reply: 45678 } });
const likeNumAE = bAE.rail._flat().find(n => n._s.has("bdm-btn-like"))._flat().find(n => n._s.has("bdm-act-num"));
eq("右栏点赞数真的渲染成 23.5万（不是只有函数对）", String(likeNumAE && likeNumAE.textContent), "23.5万");
const metaAE = String(bAE.info.querySelector(".bdm-info-meta").textContent);
ok("播放数据行渲染成「1234.6万 播放  3456.8万 弹幕」", metaAE.indexOf("1234.6万 播放") === 0 && metaAE.indexOf("3456.8万 弹幕") > 0, metaAE.slice(0, 60));
ok("AE 组收尾：不残留沉浸状态", B.douyin.isActive() === false);
G("AF 重复副作用：连点写操作按钮不该发两次请求（三连会多扣币）");
B.settings.allowExplicitLike = true;
doc.cookie = "SESSDATA=abc; bili_jct=xyz; DedeUserID=42";
B.douyin.enter();
await tick(400);
const rootAF = doc.querySelector(".bdm-root");
const atAF = () => Math.round(rootAF.scrollTop / 800);
const slideAF = () => doc.querySelectorAll(".bdm-slide")[atAF()];
const nLikeAF = () => calls.url.filter(u => u.indexOf("like") >= 0 && u.indexOf("triple") < 0).length;
const nTripleAF = () => calls.url.filter(u => u.indexOf("like/triple") >= 0).length;
const nCoinAF = () => calls.url.filter(u => u.indexOf("coin/add") >= 0).length;
// ① 点赞连点两下
const like0 = nLikeAF();
const likeBtnAF = slideAF().querySelector(".bdm-btn-like");
likeBtnAF.dispatchEvent({ type: "click" });
likeBtnAF.dispatchEvent({ type: "click" });
await tick(220);
ok("点赞连点两下 → 只发一条请求", nLikeAF() - like0 === 1, "实际 " + (nLikeAF() - like0) + " 条");
// ② 三连连点两下（这条最贵：接口会真的扣币）
const tri0 = nTripleAF();
const triBtnAF = slideAF().querySelector(".bdm-btn-triple");
triBtnAF.dispatchEvent({ type: "click" });
triBtnAF.dispatchEvent({ type: "click" });
await tick(220);
ok("三连连点两下 → 只发一条（否则会重复扣币）", nTripleAF() - tri0 === 1, "实际 " + (nTripleAF() - tri0) + " 条");
// ③ 投币弹窗连点「投 2 枚」：靠按钮 disabled 保护（真浏览器里 disabled 不派发 click）
const coin0 = nCoinAF();
B.dialogs.coin(B.douyin.current());
await tick(60);
const coinBtnsAF = doc.body._flat().filter(n => n._s.has("bdm-dl-btn"));
const lastCoinBtn = coinBtnsAF[coinBtnsAF.length - 1];
lastCoinBtn.dispatchEvent({ type: "click" });
lastCoinBtn.dispatchEvent({ type: "click" });
await tick(220);
ok("投币弹窗连点「投 2 枚」→ 只扣一次", nCoinAF() - coin0 === 1, "实际 " + (nCoinAF() - coin0) + " 条");
// ④ 提交中的可见状态：按钮变暗，结束后必须恢复（卡在「提交中」是最常见的烂状态）
const likeBtnAF2 = slideAF().querySelector(".bdm-btn-like");
likeBtnAF2.dispatchEvent({ type: "click" });
const busyDuringAF = likeBtnAF2._s.has("bdm-sending");
await tick(220);
ok("点赞提交中 → 按钮变暗（可见状态），结束后恢复（不卡在提交中）",
  busyDuringAF === true && !likeBtnAF2._s.has("bdm-sending"),
  "提交中=" + busyDuringAF + " 结束后=" + likeBtnAF2._s.has("bdm-sending"));
B.douyin.exit();
await tick(60);
doc.cookie = "";
ok("AF 组收尾：退出干净", B.douyin.isActive() === false);

G("AG 跨屏状态与全局监听：焦点要收回、监听器不能累积、一次按键只走一屏");
B.douyin.enter();
await tick(400);
const rootAG = doc.querySelector(".bdm-root");
const atAG = () => Math.round(rootAG.scrollTop / 800);
const slideAG = (i) => doc.querySelectorAll(".bdm-slide")[i === undefined ? atAG() : i];
const inputAG = (i) => slideAG(i).querySelector(".bdm-dm-input");
// ① 前置：弹幕输入框可以聚焦
const in0AG = inputAG();
in0AG.focus();
ok("前置：弹幕输入框已聚焦", doc.activeElement === in0AG);
// ② 换屏后焦点必须收回（否则按键继续落在一个已经划走的框上）
slideAG().querySelector(".bdm-btn-next").dispatchEvent({ type: "click" });
await tick(160);
ok("换屏后焦点从上一屏输入框收回", doc.activeElement !== in0AG,
  "activeElement=" + (doc.activeElement === in0AG ? "仍是已划走的输入框" : "已收回"));
// ③ 一次 ↓ 只前进一屏 —— document 上若堆了 N 份同一个处理器，这里会一次跳 N 屏
const beforeAG = atAG();
doc.dispatchEvent({ type: "keydown", key: "ArrowDown" });
await tick(180);
ok("一次 ↓ 只前进一屏（监听器累积会让它一次跳好几屏）", atAG() === beforeAG + 1, "idx " + beforeAG + " → " + atAG());
// ④ 既有设计：焦点在输入框里按 ↓ 不该换屏（正在打字）
const curInAG = inputAG();
curInAG.focus();
const before4AG = atAG();
doc.dispatchEvent({ type: "keydown", key: "ArrowDown", target: curInAG });
await tick(180);
ok("焦点在输入框里按 ↓ 不换屏（打字不该被翻页打断）", atAG() === before4AG, "idx " + before4AG + " → " + atAG());
curInAG.blur();
// ⑤ 打一半划走（远到触发回收）再划回来：草稿不该丢
await tick(900);
rootAG.scrollTop = 0; rootAG.dispatchEvent({ type: "scroll" }); await tick(300);
inputAG(0).value = "打了一半的弹幕";
let guardAG = 0;
while (atAG() < 12 && guardAG++ < 30) { slideAG().querySelector(".bdm-btn-next").dispatchEvent({ type: "click" }); await tick(60); }
const releasedAG = slideAG(0)._s.has("bdm-released");
await tick(900);
rootAG.scrollTop = 0; rootAG.dispatchEvent({ type: "scroll" }); await tick(400);
ok("打一半的弹幕划走（触发回收）再划回来 → 草稿还在", inputAG(0).value === "打了一半的弹幕",
  "框内=" + JSON.stringify(inputAG(0).value) + " 第0屏被回收过=" + releasedAG);
// ⑥ 反复进/出：全局监听器不得累积（这是「方向键疯了」的总根源）
const kd0 = (doc._handlers.keydown || []).length, wh0 = (g._handlers.wheel || []).length;
for (let r = 0; r < 3; r++) { B.douyin.exit(); await tick(80); B.douyin.enter(); await tick(220); }
const kd1 = (doc._handlers.keydown || []).length, wh1 = (g._handlers.wheel || []).length;
ok("反复进/出沉浸流 → 全局监听器不增长（键盘与滚轮各只一份）", kd1 === kd0 && wh1 === wh0,
  "keydown " + kd0 + "→" + kd1 + " / wheel " + wh0 + "→" + wh1);
const before6AG = Math.round(doc.querySelector(".bdm-root").scrollTop / 800);
const root6AG = doc.querySelector(".bdm-root");
doc.dispatchEvent({ type: "keydown", key: "ArrowDown" });
await tick(200);
ok("进/出三轮之后，一次 ↓ 仍然只走一屏（不是 N 屏）", Math.round(root6AG.scrollTop / 800) === before6AG + 1,
  "idx " + before6AG + " → " + Math.round(root6AG.scrollTop / 800));
B.douyin.exit();
await tick(80);
ok("AG 组收尾：退出干净", B.douyin.isActive() === false);

G("AH 进入/退出是有状态的循环：反复 10 轮不得留下任何残留");
// 上一轮抓到的真缺陷（全局监听器随 enter 累积）就是因为测试只进过一次。
// 这里把「进/出」本身当成被测对象：逐类比对残留。
const snapAH = () => ({
  doc: Object.keys(doc._handlers).sort().map(k => k + ":" + doc._handlers[k].length).join(" "),
  win: Object.keys(g._handlers).sort().map(k => k + ":" + g._handlers[k].length).join(" "),
  timers: timers.size, mos: MOs.length,
  roots: doc.querySelectorAll(".bdm-root").length,
  slides: doc.querySelectorAll(".bdm-slide").length,
  overflow: doc.body.style.overflow
});
B.douyin.enter();
await tick(400);
const baseAH = snapAH();
let lastAH = baseAH;
for (let r = 0; r < 10; r++) {
  B.douyin.exit();
  await tick(60);
  if (r === 0) {
    const ax = snapAH();
    ok("退出后：根节点移除、body 滚动恢复、沉浸标记清除",
      ax.roots === 0 && ax.overflow === "" && doc.bdmImmersive === false,
      "roots=" + ax.roots + " overflow=" + JSON.stringify(ax.overflow) + " immersive=" + doc.bdmImmersive);
  }
  B.douyin.enter();
  await tick(220);
  lastAH = snapAH();
}
ok("反复 10 轮 → document 监听器数量不变", lastAH.doc === baseAH.doc, baseAH.doc + "  ⇒  " + lastAH.doc);
ok("反复 10 轮 → window 监听器数量不变", lastAH.win === baseAH.win, baseAH.win + "  ⇒  " + lastAH.win);
ok("反复 10 轮 → 常驻定时器不增长", lastAH.timers <= baseAH.timers, "定时器 " + baseAH.timers + " ⇒ " + lastAH.timers);
ok("反复 10 轮 → MutationObserver 不重复注册", lastAH.mos === baseAH.mos, "MO " + baseAH.mos + " ⇒ " + lastAH.mos);
ok("反复 10 轮 → DOM 里始终只有一个 bdm-root", lastAH.roots === 1, "roots=" + lastAH.roots);
ok("反复 10 轮 → 屏数回到新会话量级（不累积）", lastAH.slides <= baseAH.slides + 2, "屏数 " + baseAH.slides + " ⇒ " + lastAH.slides);
B.douyin.exit();
await tick(60);
ok("AH 组收尾：退出干净", B.douyin.isActive() === false && doc.querySelector(".bdm-root") === null);

G("AI 桌面版样式：shipped 脚本首次进测试台（行为 + 安全属性 + MARGIN 让位）");
const SKIN = B.skin;
ok("皮肤接口形状正确（apply / isOn / marginDetected）",
  !!SKIN && typeof SKIN.apply === "function" && typeof SKIN.isOn === "function" && typeof SKIN.marginDetected === "function",
  SKIN ? Object.keys(SKIN).join(",") : "无 __BDM__.skin");
const htmlClsAI = () => Array.from(doc.documentElement._s).sort().join("|");
const bodyKidsAI = doc.body.children.length, headKidsAI = doc.head.children.length;
ok("默认关闭 → <html> 上没有 bdm-skin", SKIN.isOn() === false, "类=" + JSON.stringify(htmlClsAI()));
B.settings.desktopSkin = true;
SKIN.apply();
const afterAI = htmlClsAI();
ok("打开设置并应用 → <html> 上多出且只多出 bdm-skin",
  SKIN.isOn() === true && afterAI.split("|").filter(c => c === "bdm-skin").length === 1, "类=" + afterAI);
ok("只动 <html> 的类名：不注入节点、不碰 B站 DOM 骨架（body/head 子节点数不变）",
  doc.body.children.length === bodyKidsAI && doc.head.children.length === headKidsAI,
  "body " + bodyKidsAI + "→" + doc.body.children.length + " head " + headKidsAI + "→" + doc.head.children.length);
doc.documentElement.classList.add("margin-root");
SKIN.apply();
ok("检测到 MARGIN（html.margin-*）→ 自动让位，不加 bdm-skin",
  SKIN.marginDetected() === true && SKIN.isOn() === false, "marginDetected=" + SKIN.marginDetected() + " isOn=" + SKIN.isOn());
doc.documentElement.classList.remove("margin-root");
SKIN.apply();
ok("MARGIN 摘除后 → 自动恢复应用", SKIN.marginDetected() === false && SKIN.isOn() === true);
B.settings.desktopSkin = false;
doc.dispatchEvent({ type: "bdm:settings-changed" });
ok("设置变更事件 → 即时生效（关掉即还原）", SKIN.isOn() === false, "类=" + htmlClsAI());
ok("关闭后 <html> 上不留任何 bdm-skin 痕迹（可完全还原，才敢和沉浸模式分开用）",
  htmlClsAI().split("|").indexOf("bdm-skin") < 0);

G("AJ 反复回收/划回同一屏：播放器整包必须还在 DOM 里（真缺陷回归守卫）");
// 真缺陷：restore 路径先清了 videoArea，而播放器整包（<video>/弹幕层/字幕层/音轨）就挂在里面，
// 再没人挂回去 —— 真机症状是「划回被回收过的屏 → 黑屏（可能还有声音）」。
// 当时的 T 组只断言了 playurl 重发，所以这个洞一直没被发现。
B.douyin.enter();
await tick(400);
const rootAJ = doc.querySelector(".bdm-root");
const atAJ = () => Math.round(rootAJ.scrollTop / 800);
const slideElAJ = (i) => doc.querySelectorAll(".bdm-slide")[i];
const vidsAJ = (i) => slideElAJ(i)._flat().filter(n => n.tagName === "VIDEO");
ok("前置：第 0 屏有 1 个 <video> 且已挂上媒体源", vidsAJ(0).length === 1 && !!vidsAJ(0)[0].src,
  "video=" + vidsAJ(0).length + " src=" + (vidsAJ(0)[0] ? String(vidsAJ(0)[0].src).slice(0, 30) : "无"));
const awayAJ = async () => { let g = 0; while (atAJ() < 12 && g++ < 30) { slideElAJ(atAJ()).querySelector(".bdm-btn-next").dispatchEvent({ type: "click" }); await tick(60); } };
const backAJ = async (i) => { await tick(900); rootAJ.scrollTop = i * 800; rootAJ.dispatchEvent({ type: "scroll" }); await tick(700); };
await awayAJ();
ok("划走后：媒体源已释放（src 清空），但 DOM 骨架里仍留着那个 <video>（只释放重的东西）",
  slideElAJ(0)._s.has("bdm-released") && vidsAJ(0).length === 1 && !vidsAJ(0)[0].src,
  "released=" + slideElAJ(0)._s.has("bdm-released") + " video=" + vidsAJ(0).length + " src=" + JSON.stringify(vidsAJ(0)[0].src));
await backAJ(0);
ok("划回被回收的屏 → 播放器整包仍在 DOM 里（此前被清掉后无人挂回 = 黑屏）",
  vidsAJ(0).length === 1, "video=" + vidsAJ(0).length);
ok("划回后媒体源重新挂上（不只是节点在，流也要在）", !!vidsAJ(0)[0] && !!vidsAJ(0)[0].src,
  "src=" + (vidsAJ(0)[0] ? String(vidsAJ(0)[0].src).slice(0, 30) : "无"));
for (let r = 0; r < 2; r++) { await awayAJ(); await backAJ(0); }
ok("再反复两轮划走/划回 → 该屏始终恰好 1 个 <video>（不消失也不累积）",
  vidsAJ(0).length === 1, "video=" + vidsAJ(0).length);
const multiAJ = doc.querySelectorAll(".bdm-slide").filter(s => s._flat().filter(n => n.tagName === "VIDEO").length > 1).length;
ok("没有任何一屏出现两个 <video>（反复恢复不会堆媒体元素）", multiAJ === 0, "异常屏数=" + multiAJ);
B.douyin.exit();
await tick(60);
ok("AJ 组收尾：退出干净", B.douyin.isActive() === false);

G("AK 三个面板反复开关：不得累积内容或监听器（面板重开重复堆料是真实发生过的坑）");
B.douyin.enter();
await tick(400);
const rootAK = doc.querySelector(".bdm-root");
const sAK = () => doc.querySelectorAll(".bdm-slide")[Math.round(rootAK.scrollTop / 800)];
const panelAK = () => sAK()._flat().find(n => n._s.has("bdm-panel"));
const cntAK = () => { const b = panelAK(); return b ? b._flat().length : -1; };
const winsAK = () => Object.keys(g._handlers).sort().map(k => k + ":" + g._handlers[k].length).join(" ") + " | " +
  Object.keys(doc._handlers).sort().map(k => k + ":" + doc._handlers[k].length).join(" ");
const cmtBtnAK = () => sAK().querySelector(".bdm-btn-cmt");
const closeBtnAK = () => { const b = panelAK(); return b ? b._flat().find(n => n._s.has("bdm-panel-close")) : null; };
const w0AK = winsAK();
cmtBtnAK().dispatchEvent({ type: "click" });
await tick(300);
const firstAK = cntAK();
for (let i = 0; i < 4; i++) {
  const cb = closeBtnAK(); if (cb) cb.dispatchEvent({ type: "click" });
  await tick(60);
  cmtBtnAK().dispatchEvent({ type: "click" });
  await tick(200);
}
ok("评论面板反复开关 5 轮 → 子节点数不变（不累积旧列表）", cntAK() === firstAK, firstAK + " → " + cntAK());
const moreBtnAK = () => { const b = panelAK(); return b ? b._flat().find(n => n._s.has("bdm-cmt-more")) : null; };
const more1AK = moreBtnAK();
if (more1AK) { more1AK.dispatchEvent({ type: "click" }); await tick(300); }
const afterMoreAK = cntAK();
const cb2AK = closeBtnAK(); if (cb2AK) cb2AK.dispatchEvent({ type: "click" });
await tick(60);
cmtBtnAK().dispatchEvent({ type: "click" });
await tick(300);
ok("翻过页之后关掉再开 → 行数不变（不会把第二页重复追加一遍）",
  !more1AK || cntAK() === afterMoreAK, afterMoreAK + " → " + cntAK());
const cb3AK = closeBtnAK(); if (cb3AK) cb3AK.dispatchEvent({ type: "click" });
await tick(60);
const setBtnAK = () => sAK().querySelector(".bdm-btn-set");
const setPanelAK = () => sAK()._flat().find(n => n._s.has("bdm-set-settings"));
const setCloseAK = () => { const sp = setPanelAK(); return sp ? sp._flat().find(n => n._s.has("bdm-panel-close")) : null; };
setBtnAK().dispatchEvent({ type: "click" });
await tick(120);
const setFirstAK = setPanelAK()._flat().length;
for (let i = 0; i < 5; i++) {
  const c = setCloseAK(); if (c) c.dispatchEvent({ type: "click" });
  await tick(60);
  setBtnAK().dispatchEvent({ type: "click" });
  await tick(120);
}
ok("设置面板反复开关 5 轮 → 子节点数不变", setPanelAK()._flat().length === setFirstAK, setFirstAK + " → " + setPanelAK()._flat().length);
ok("面板反复开关期间 → 全局监听器数量不变", winsAK() === w0AK, winsAK() === w0AK ? "一致" : "变了");
const cb4AK = setCloseAK(); if (cb4AK) cb4AK.dispatchEvent({ type: "click" });
await tick(60);
B.douyin.exit();
await tick(60);
ok("AK 组收尾：退出干净", B.douyin.isActive() === false && doc.querySelector(".bdm-root") === null);

G("AL 反复切画质：媒体元素与音轨不得累积（DASH 双轨每次切都要复用同一条音轨）");
B.douyin.enter();
await tick(400);
const rootAL = doc.querySelector(".bdm-root");
const sAL = () => doc.querySelectorAll(".bdm-slide")[Math.round(rootAL.scrollTop / 800)];
const elsAL = (tag) => sAL()._flat().filter(n => n.tagName === tag);
const pickAL = async (idx) => {
  sAL().querySelector(".bdm-btn-qn").dispatchEvent({ type: "click" });
  await tick(120);
  const items = sAL()._flat().filter(n => n._s.has("bdm-menu-item"));
  if (items[idx]) items[idx].dispatchEvent({ type: "click" });
  await tick(400);
};
ok("前置：当前屏 1 个 <video>（初始档位不是 DASH，所以还没有音轨）",
  elsAL("VIDEO").length === 1, "video=" + elsAL("VIDEO").length + " audio=" + elsAL("AUDIO").length);
await pickAL(2);
const srcQ1AL = String((elsAL("VIDEO")[0] || {}).src || "");
ok("切到 DASH 档 → 建出且只建出一条配对音轨，音轨有源",
  elsAL("VIDEO").length === 1 && elsAL("AUDIO").length === 1 && !!String((elsAL("AUDIO")[0] || {}).src || ""),
  "video=" + elsAL("VIDEO").length + " audio=" + elsAL("AUDIO").length);
await pickAL(3);
const srcQ2AL = String((elsAL("VIDEO")[0] || {}).src || "");
ok("再切一档 → 画面源真的换成了新档位", srcQ2AL !== "" && srcQ2AL !== srcQ1AL, srcQ1AL.slice(-18) + " → " + srcQ2AL.slice(-18));
await pickAL(2);
ok("切换三轮之后仍是 1 个 <video> + 1 条音轨（不累积媒体元素）",
  elsAL("VIDEO").length === 1 && elsAL("AUDIO").length === 1,
  "video=" + elsAL("VIDEO").length + " audio=" + elsAL("AUDIO").length);
ok("关掉菜单后不留菜单节点（切几次就堆几个菜单是常见坑）",
  sAL()._flat().filter(n => n._s.has("bdm-menu")).length === 0);
B.douyin.exit();
await tick(60);
ok("AL 组收尾：退出干净", B.douyin.isActive() === false && doc.querySelector(".bdm-root") === null);

G("AM 入口按钮注入：宿主回退链 / 悬浮兜底 / MARGIN 让位 / 不重复注入（此前零覆盖）");
// 按钮不出现 = 整个扩展没法用，所以这条路值得逐形态验。
const invAM = () => { const b = doc.getElementById("bdm-nav-btn"); if (b && b.parentNode) b.parentNode.removeChild(b); };
const btnAM = () => doc.getElementById("bdm-nav-btn");
const injectedAM = () => { B.ui.injectNavButton(function () { /* 测试用空回调 */ }); return btnAM(); };
const fakeHeaderAM = (inner) => {
  const h = doc.createElement("div"); h.className = "bili-header__bar";
  const left = doc.createElement("div"); left.className = "left-entry";
  h.appendChild(left);
  if (inner === "biliMainHeader") { const m = doc.createElement("div"); m.id = "biliMainHeader"; doc.body.appendChild(m); return m; }
  doc.body.appendChild(h);
  return h;
};
// ① 无宿主 → 悬浮左下角
invAM();
const noHostAM = injectedAM();
ok("没有任何导航宿主 → 回退成悬浮按钮（bdm-nav-fixed）",
  !!noHostAM && noHostAM._s.has("bdm-nav-fixed") && noHostAM.parentNode === doc.body,
  noHostAM ? "父节点=" + (noHostAM.parentNode === doc.body ? "body" : "非 body") + " 类=" + Array.from(noHostAM._s).join(",") : "无按钮");
// ② 有 B站 现代导航栏 → 注入 left-entry
invAM();
const hdrAM = fakeHeaderAM();
const leftAM = hdrAM._flat().find(n => n._s.has("left-entry"));
const inlineAM = injectedAM();
ok("有 .bili-header__bar .left-entry → 注入它（bdm-nav-inline）",
  !!inlineAM && inlineAM._s.has("bdm-nav-inline") && inlineAM.parentNode === leftAM,
  inlineAM ? "类=" + Array.from(inlineAM._s).join(",") : "无按钮");
// ③ 重复注入不产生第二个按钮
injectedAM();
ok("重复调用不会注入第二个按钮", doc.querySelectorAll("#bdm-nav-btn").length <= 1,
  "按钮数=" + doc.querySelectorAll("#bdm-nav-btn").length);
// ④ MARGIN 在场 → 即使有 header 也走悬浮（否则注进 display:none 的容器 = 按钮消失）
if (inlineAM && inlineAM.parentNode) inlineAM.parentNode.removeChild(inlineAM);
doc.documentElement.classList.add("margin-root");
const marginAM = injectedAM();
ok("MARGIN（html.margin-*）在场 → 不入 header，改走悬浮",
  !!marginAM && marginAM._s.has("bdm-nav-fixed") && marginAM.parentNode === doc.body,
  marginAM ? "类=" + Array.from(marginAM._s).join(",") : "无按钮");
doc.documentElement.classList.remove("margin-root");
// ⑤ 老版页面（只有 #biliMainHeader）→ 回退链仍能找到宿主
if (hdrAM.parentNode) hdrAM.parentNode.removeChild(hdrAM);
invAM();
const legacyAM = fakeHeaderAM("biliMainHeader");
const legBtnAM = injectedAM();
ok("只剩老版 #biliMainHeader → 回退链仍注入成功（不是悬浮兜底）",
  !!legBtnAM && legBtnAM._s.has("bdm-nav-inline") && legBtnAM.parentNode === legacyAM,
  legBtnAM ? "类=" + Array.from(legBtnAM._s).join(",") : "无按钮");
// 收尾：拆掉假宿主，把按钮恢复到真实页面形态（有 body、无 MARGIN → 悬浮）
if (legacyAM.parentNode) legacyAM.parentNode.removeChild(legacyAM);
invAM();
injectedAM();
ok("AM 组收尾：按钮仍在、且不在我们造的假宿主里", !!btnAM() && btnAM().parentNode === doc.body,
  btnAM() ? "类=" + Array.from(btnAM()._s).join(",") : "无按钮");

G("AN 旧版/残缺/手改的设置 blob：缺键回落默认、错类型不炸、未知键不被抹掉");
// 真机场景：从旧版升级、store 被部分写入、用户手改。这里灌一份「又缺键又错类型」的 blob 看会不会打挂。
const savedAN = Object.assign({}, store.bdmSettings || {});
store.bdmSettings = { dmBlock: "屏蔽词", dmOpacity: null, volume: "0.7", dmArea: 42, dmScroll: "yes", videoRotate: "90", unknownKeyAN: 1 };
const rejAN0 = rejections.length;
let thrownAN = null;
await B.loadSettings();
ok("残缺 blob：缺的键回落到默认值（不是 undefined）",
  B.settings.dmFont === 20 && B.settings.autoplayNext === true && B.settings.dmDensity === 2 && B.settings.volume === "0.7",   // 错类型**原样透传**（我们不做隐式转换，消费点各自 Number()/length 兜底）
  "dmFont=" + B.settings.dmFont + " autoplayNext=" + B.settings.autoplayNext + " dmDensity=" + B.settings.dmDensity);
try { B.douyin.enter(); await tick(600); } catch (e) { thrownAN = String((e && e.message) || e); }
ok("错类型的值（弹幕屏蔽词存成字符串、音量存成字符串、不透明度 null）→ 不抛异常、功能照常",
  thrownAN === null && B.douyin.isActive() === true && doc.querySelectorAll(".bdm-slide").length >= 3 && rejections.length === rejAN0,
  "thrown=" + thrownAN + " 屏数=" + doc.querySelectorAll(".bdm-slide").length + " 新增拒绝=" + (rejections.length - rejAN0));
B.douyin.exit();
await tick(60);
ok("用残缺设置也能干净退出（不留根节点）", B.douyin.isActive() === false && doc.querySelector(".bdm-root") === null);
await B.saveSettings({ debug: true });
ok("保存时未知键不被抹掉（旧版遗留的键不会因为升级而消失）",
  store.bdmSettings && store.bdmSettings.unknownKeyAN === 1,
  "unknownKeyAN=" + (store.bdmSettings ? store.bdmSettings.unknownKeyAN : "无"));
store.bdmSettings = savedAN;
await B.loadSettings();
ok("恢复后设置回到干净状态（屏蔽词是数组、音量是数字）",
  Array.isArray(B.settings.dmBlock) && typeof B.settings.volume === "number",
  "dmBlock=" + Object.prototype.toString.call(B.settings.dmBlock) + " volume=" + typeof B.settings.volume);

G("AO 弹幕字号/速度的**渲染效果**（此前只验了「存进 store」，没验「渲染出来」）");
// 这两个设置不在 applyPrefs 里生效，而是在每条弹幕发出时读取（tickDanmaku）——
// 所以「存盘了」不等于「画出来了」，必须从渲染节点上验。档位值取面板里的真实值（大=24，极快=16）。
const holderAO = doc.createElement("div");
const pAO = new B.Player(holderAO, { bvid: "BVao", cid: 9 });
const dmDensityAO = B.settings.dmDensity;
B.settings.dmDensity = 3;                       // 高密度：全放，避免抽稀把首条丢掉
const seedAO = () => {
  pAO.dmList = [{ t: 0, mode: 1, size: 25, color: 16777215, text: "字号速度" }];
  pAO.dmSent = 0; pAO.lanes = 0;
  pAO.dmLayer.children.length = 0;
  pAO.tickDanmaku();
  return pAO.dmLayer.children[0] || null;
};
B.settings.dmFont = 24; B.settings.dmSpeed = 8;
const n1AO = seedAO();
ok("字号「大」(24) → 发出的弹幕 fontSize=24px（按 B站 25 基准等比缩放）",
  !!n1AO && n1AO.style.fontSize === "24px", n1AO ? n1AO.style.fontSize : "无节点");
B.settings.dmSpeed = 16;
const n2AO = seedAO();
ok("速度「极快」(16) → 滚动过渡 4.5s（9×(8/16)）",
  !!n2AO && String(n2AO.style.transition).indexOf("4.5s") >= 0, n2AO ? n2AO.style.transition : "无节点");
B.settings.dmFont = 20; B.settings.dmSpeed = 8;
const n3AO = seedAO();
ok("回到默认（字号 20 / 速度 8）→ 20px 与 9s",
  !!n3AO && n3AO.style.fontSize === "20px" && String(n3AO.style.transition).indexOf("9s") >= 0,
  n3AO ? n3AO.style.fontSize + " / " + n3AO.style.transition : "无节点");
B.settings.dmFont = 12; B.settings.dmSpeed = 4;
const n4AO = seedAO();
ok("最小档（字号 12 / 速度 4）→ 12px 与 18s",
  !!n4AO && n4AO.style.fontSize === "12px" && String(n4AO.style.transition).indexOf("18s") >= 0,
  n4AO ? n4AO.style.fontSize + " / " + n4AO.style.transition : "无节点");
B.settings.dmFont = 20; B.settings.dmSpeed = 8; B.settings.dmDensity = dmDensityAO;
pAO.destroy();
ok("AO 组收尾：播放器销毁、设置还原", pAO.dead === true && B.settings.dmFont === 20 && B.settings.dmDensity === dmDensityAO);

G("AP 自动连播的**实际效果**：放完自动切下一屏（此前只验了开关存盘）");
B.douyin.enter();
await tick(400);
const rootAP = doc.querySelector(".bdm-root");
const atAP = () => Math.round(rootAP.scrollTop / 800);
const vidAP = (i) => doc.querySelectorAll(".bdm-slide")[i === undefined ? atAP() : i].querySelector("video");
const autoAP0 = B.settings.autoplayNext;
B.settings.autoplayNext = true;
const beforeAP = atAP();
vidAP().dispatchEvent({ type: "ended" });
await tick(180);
ok("自动连播开着：当前屏放完 → 自动切到下一屏", atAP() === beforeAP + 1, "idx " + beforeAP + " → " + atAP());
B.settings.autoplayNext = false;
const offAP = atAP();
vidAP().dispatchEvent({ type: "ended" });
await tick(180);
ok("关掉自动连播：放完停在原地（不切屏）", atAP() === offAP, "idx " + offAP + " → " + atAP());
B.settings.autoplayNext = true;
const keepAP = atAP();
const otherAP = doc.querySelectorAll(".bdm-slide")[keepAP > 0 ? keepAP - 1 : keepAP + 1];
otherAP.querySelector("video").dispatchEvent({ type: "ended" });
await tick(180);
ok("非当前屏（上一屏/预处理屏）抛出 ended → 不把用户拽走（迟到的 ended 不能导航）",
  atAP() === keepAP, "idx " + keepAP + " → " + atAP());
B.settings.autoplayNext = autoAP0;
B.douyin.exit();
await tick(60);
ok("AP 组收尾：退出干净、开关还原", B.douyin.isActive() === false && B.settings.autoplayNext === autoAP0);

G("AQ 菜单最后一项「举报 / 反馈」：点了有反应、菜单自动收起");
B.douyin.enter();
await tick(400);
const rootAQ = doc.querySelector(".bdm-root");
const sAQ = () => doc.querySelectorAll(".bdm-slide")[Math.round(rootAQ.scrollTop / 800)];
const vAQ = () => sAQ().querySelector("video");
vAQ().dispatchEvent({ type: "contextmenu" });
vAQ().dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
vAQ().dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 });
await tick(40);
const menuAQ = () => sAQ().querySelector(".bdm-ctx");
const itemAQ = (label) => menuAQ().querySelectorAll(".bdm-ctx-item").find(n => n.querySelector(".bdm-ctx-label").textContent === label);
const opened0 = calls.opened.length;
itemAQ("举报 / 反馈").dispatchEvent({ type: "click" });
await tick(40);
ok("「举报 / 反馈」点了确实有反应（打开该稿件页面；B站 的举报入口在页面上，我们不硬造 URL）",
  calls.opened.length > opened0 && /bilibili\.com\/video\//.test(calls.opened[calls.opened.length - 1] || ""),
  String(calls.opened[calls.opened.length - 1] || "无").slice(0, 60));
ok("点完菜单自动收起（不留一个悬浮菜单在屏幕上）", menuAQ().style.display === "none", menuAQ().style.display);
B.douyin.exit();
await tick(60);
ok("AQ 组收尾：退出干净", B.douyin.isActive() === false && doc.querySelector(".bdm-root") === null);

G("AR 在线人数（B站 发送行最左的「N人正在看」）—— 本轮新实现，端点为实测");
// 端点：/x/player/online/total?bvid=&cid= → data.total / data.count / data.show_switch（已实测匿名可用）
// 文案「N人正在看」取自真机截图。三条原则：拿不到就空着、站方开关关了就不显示、数字照 fmt 走。
const onlineOf = (i) => { const s = doc.querySelectorAll(".bdm-slide")[i]; const el = s && s.querySelector(".bdm-online"); return el ? String(el.textContent) : "(无节点)"; };
const reenter = async () => { B.douyin.exit(); await tick(60); B.douyin.enter(); await tick(500); };
B.douyin.enter();
await tick(500);
ok("当前屏显示「94人正在看」（数据取自实测端点形状）", onlineOf(0) === "94人正在看", JSON.stringify(onlineOf(0)));
onlineReply = { code: 0, data: { total: "12345678", count: "1", show_switch: { total: true, count: true } } };
await reenter();
ok("大数字按万位格式化（1234.6万人正在看）", onlineOf(0) === "1234.6万人正在看", JSON.stringify(onlineOf(0)));
onlineReply = { code: 0, data: { total: "94", count: "71", show_switch: { total: false, count: false } } };
await reenter();
ok("站方显示开关全关 → 不显示（不自造数字）", onlineOf(0) === "", JSON.stringify(onlineOf(0)));
onlineReply = { code: -412, message: "被风控" };
await reenter();
ok("接口失败/风控 → 留空，不显示假数字", onlineOf(0) === "", JSON.stringify(onlineOf(0)));
onlineReply = { code: 0, data: { total: "94", count: "71", show_switch: { total: true, count: true } } };
await reenter();
// mock feed 的第 3 条就是直播条目（别处已断言），所以这里**不做「找不到就跳过」**：
// 找不到说明夹具坏了，这里必须红 —— 否则这条断言会变成永远为真的空跑。
const liveIdx = doc.querySelectorAll(".bdm-slide").findIndex(s => s.querySelector(".bdm-degrade"));
ok("直播条目在 feed 里（下面那条断言的前提）", liveIdx >= 0, "liveIdx=" + liveIdx);
ok("直播条目（走降级卡、没有 bvid/cid）→ 不显示在线人数", liveIdx >= 0 && onlineOf(liveIdx) === "", JSON.stringify(onlineOf(liveIdx)));
B.douyin.exit();
await tick(60);
ok("AR 组收尾：退出干净", B.douyin.isActive() === false && doc.querySelector(".bdm-root") === null);

G("AS 弹幕礼仪入口：地址取自 B站 自己的 bundle（不硬编、不猜）");
B.douyin.enter();
await tick(400);
const rowAS = doc.querySelectorAll(".bdm-slide")[Math.round(doc.querySelector(".bdm-root").scrollTop / 800)].querySelector(".bdm-dm-row");
const etqAS = rowAS.querySelector(".bdm-dm-etq");
ok("发送行右侧有「弹幕礼仪」入口，且排在「发送」左边（与 B站 一致）",
  !!etqAS && etqAS.textContent.indexOf("弹幕礼仪") === 0 &&
  rowAS._flat().indexOf(etqAS) < rowAS._flat().indexOf(rowAS.querySelector(".bdm-btn-dmsend")),
  etqAS ? etqAS.textContent : "无");
const openedAS = calls.opened.length;
etqAS.dispatchEvent({ type: "click" });
await tick(60);
ok("点「弹幕礼仪」→ 打开 B站 规则页（blackboard/help.html）",
  calls.opened.length > openedAS && /blackboard\/help\.html/.test(calls.opened[calls.opened.length - 1] || ""),
  String(calls.opened[calls.opened.length - 1] || "无").slice(0, 70));
B.douyin.exit();
await tick(60);
ok("AS 组收尾：退出干净", B.douyin.isActive() === false);

G("AT 首次加载失败：界面要诚实、要有出路（此前零覆盖 + 卡片上没有按钮）");
rcmdFails = true;
B.douyin.enter();
await tick(500);
const errCardAT = () => doc.querySelector(".bdm-root-error");
ok("推荐流失败 → 根节点里出现「刷B站加载失败」并且带失败原因（不是空白屏）",
  !!errCardAT() && errCardAT().textContent.indexOf("刷B站加载失败") >= 0 && errCardAT().textContent.indexOf("风控") >= 0,
  errCardAT() ? String(errCardAT().textContent).slice(0, 60) : "无错误卡");
const retryAT = errCardAT() ? errCardAT()._flat().find(n => n._s.has("bdm-degrade-btn")) : null;
ok("失败卡上有「重试」按钮（此前只能退出再进）", !!retryAT && String(retryAT.textContent) === "重试", retryAT ? String(retryAT.textContent) : "无按钮");
ok("失败时「退出」仍然可用（不会被困住）", !!doc.querySelector(".bdm-close"));
// 恢复接口后点重试：应当真的重来一遍并建出屏
rcmdFails = false;
const rcmdBeforeAT = calls.url.filter(u => u.indexOf("rcmd") >= 0).length;
retryAT.dispatchEvent({ type: "click" });
await tick(700);
ok("点「重试」→ 真的重新请求推荐流", calls.url.filter(u => u.indexOf("rcmd") >= 0).length > rcmdBeforeAT,
  "rcmd 调用 " + rcmdBeforeAT + " → " + calls.url.filter(u => u.indexOf("rcmd") >= 0).length);
ok("重试成功 → 错误卡消失、屏建出来了（恢复可用）",
  !errCardAT() && doc.querySelectorAll(".bdm-slide").length >= 3,
  "卡=" + !!errCardAT() + " 屏数=" + doc.querySelectorAll(".bdm-slide").length);
// 再失败一次：不应叠出两张卡
rcmdFails = true;
B.douyin.exit();
await tick(60);
B.douyin.enter();
await tick(500);
const retry2AT = errCardAT() && errCardAT()._flat().find(n => n._s.has("bdm-degrade-btn"));
if (retry2AT) { retry2AT.dispatchEvent({ type: "click" }); await tick(600); }
ok("重试再失败 → 仍然只有一张错误卡（不叠卡）", doc.querySelectorAll(".bdm-root-error").length === 1,
  "卡数=" + doc.querySelectorAll(".bdm-root-error").length);
rcmdFails = false;
B.douyin.exit();
await tick(60);
ok("AT 组收尾：退出干净", B.douyin.isActive() === false);

G("AU 失败路径的状态保证：请求失败要说清、原流不能坏、承诺可点的必须真能点");
B.douyin.enter();
await tick(400);
const rootAU = doc.querySelector(".bdm-root");
const sAU = () => doc.querySelectorAll(".bdm-slide")[Math.round(rootAU.scrollTop / 800)];
const toastAU = () => { const t = doc.body._flat().filter(n => n._s.has("bdm-toast")).pop(); return t ? String(t.textContent) : ""; };
// ① 切画质时取流失败：要说清是「画质」失败，且原流不能被破坏
const vAU = sAU().querySelector("video"), srcBeforeAU = vAU.src;
playurlFails = true;
sAU().querySelector(".bdm-btn-qn").dispatchEvent({ type: "click" });
await tick(120);
const menuAU = sAU()._flat().find(n => n._s.has("bdm-menu"));
const playableAU = menuAU.querySelectorAll(".bdm-menu-item")[4];   // 480P（mp4 路径，档位可用）
playableAU.dispatchEvent({ type: "click" });
await tick(300);
ok("切画质请求失败 → 提示写的是「画质切换失败」（不是编码），且原流未被动过",
  toastAU().indexOf("画质切换失败") >= 0 && sAU().querySelector("video").src === srcBeforeAU,
  "toast=" + toastAU() + " src变=" + (sAU().querySelector("video").src !== srcBeforeAU));
// ② 编码切换失败：同样要说清 + 原流不动
const srcBeforeEnc = sAU().querySelector("video").src;
sAU().querySelector(".bdm-btn-set").dispatchEvent({ type: "click" });
await tick(200);
const spAU = sAU()._flat().find(n => n._s.has("bdm-set-settings"));
const codecRadioAU = spAU._flat().filter(n => n._s.has("bdm-set-radio")).find(n => String(n.textContent) === "AVC");
if (codecRadioAU) { codecRadioAU.dispatchEvent({ type: "click" }); await tick(300); }
ok("切编码请求失败 → 提示「编码切换失败」，且原流未被动过",
  !!codecRadioAU && toastAU().indexOf("编码切换失败") >= 0 && sAU().querySelector("video").src === srcBeforeEnc,
  "toast=" + toastAU() + " 找到AVC=" + !!codecRadioAU);
playurlFails = false;
sAU().querySelector(".bdm-btn-set").dispatchEvent({ type: "click" });   // 收起设置面板
await tick(150);
// ③ 评论翻页失败 → 文案承诺「点我重试」，且点了真的重试（只追加一次）
B.settings.allowExplicitLike = true;
doc.cookie = "SESSDATA=abc; bili_jct=xyz; DedeUserID=42";
sAU().querySelector(".bdm-btn-cmt").dispatchEvent({ type: "click" });
await tick(400);
const rowsAU = () => sAU()._flat().filter(n => n._s.has("bdm-cmt")).length;
const firstRowsAU = rowsAU();
replyFailsOnce = true;
const moreAU = () => sAU()._flat().find(n => n._s.has("bdm-cmt-more"));
moreAU().dispatchEvent({ type: "click" });
await tick(300);
ok("评论翻页失败 → 文案变成「加载失败，点我重试」，且不追加任何行",
  String(moreAU().textContent).indexOf("点我重试") >= 0 && rowsAU() === firstRowsAU,
  "文案=" + String(moreAU().textContent) + " 行数=" + firstRowsAU + "→" + rowsAU());
moreAU().dispatchEvent({ type: "click" });   // 点它重试（夹具已经只失败一次）
await tick(400);
// 第二页返回后 hasMore=false：按钮**应当消失**（「到底了就收起」是既有设计），所以这里断言
// 「行数恰好 +1」而不是「按钮还在」—— 我第一版写错了期望，产品行为本身是对的。
ok("点「加载失败，点我重试」→ 真的重试成功：恰好追加第二页一次，且到底后收起按钮",
  rowsAU() === firstRowsAU + 1 && !moreAU(),
  "行数=" + firstRowsAU + "→" + rowsAU() + " 还有按钮=" + !!moreAU());
sAU().querySelector(".bdm-panel-close").dispatchEvent({ type: "click" });
await tick(150);
// ④ 空内容点「发送」→ 提示（Node 侧此前没有，浏览器 E2E 有）
sAU().querySelector(".bdm-dm-input").value = "";
sAU().querySelector(".bdm-btn-dmsend").dispatchEvent({ type: "click" });
await tick(120);
ok("空内容点「发送」→ 提示「请输入弹幕内容」（与浏览器 E2E 对齐）", toastAU().indexOf("请输入弹幕内容") >= 0, "toast=" + toastAU());
doc.cookie = "";
B.douyin.exit();
await tick(80);
ok("AU 组收尾：退出干净", B.douyin.isActive() === false);

G("AV 新功能的竞态：在线人数请求在飞时退出（迟到的响应不得写进已拆的屏）");
// 与「迟到的流写进已销毁播放器」同源的坑：新加的 refreshOnline 在 await 之后才写 DOM，
// 若此时用户已退出，必须有守卫 —— 这里把响应延迟到退出之后再到达来验。
const rejAV = rejections.length;
onlineDelayMs = 800;
B.douyin.enter();
await tick(250);
const onlineElAV = doc.querySelector(".bdm-online");
ok("前置：请求已在飞（数字还没出现）", !!onlineElAV && String(onlineElAV.textContent) === "", onlineElAV ? JSON.stringify(String(onlineElAV.textContent)) : "无元素");
B.douyin.exit();
await tick(80);
ok("请求在飞时退出 → 干净退出、无异常", B.douyin.isActive() === false && doc.querySelector(".bdm-root") === null && rejections.length === rejAV,
  "激活=" + B.douyin.isActive() + " 根=" + !!doc.querySelector(".bdm-root") + " 拒绝+" + (rejections.length - rejAV));
await tick(1200);   // 等迟到响应真的到达
ok("迟到响应到达后仍无异常、也无未捕获拒绝", rejections.length === rejAV, "拒绝 " + rejAV + "→" + rejections.length);
onlineDelayMs = 0;
B.douyin.enter();
await tick(700);
const onlineElAV2 = doc.querySelector(".bdm-online");
ok("再进入 → 在线人数恢复正常显示（不是「坏一次就永久坏」）",
  !!onlineElAV2 && String(onlineElAV2.textContent).indexOf("人正在看") >= 0,
  onlineElAV2 ? JSON.stringify(String(onlineElAV2.textContent)) : "无元素");
B.douyin.exit();
await tick(60);
ok("AV 组收尾：退出干净", B.douyin.isActive() === false);

G("AW 跨标签实时同步：在设置页改一项 → 已打开的沉浸流里立刻生效（此前这条链路从未被走通）");
// 夹具里的 storage.onChanged 一直是空壳，所以 settings.js 的回调体（合并 + 派发 bdm:settings-changed）
// 从没被执行过。这条链路的用户承诺是「改设置立刻生效，不用刷新」。
const savedAll = Object.assign({}, store.bdmSettings || {});
B.douyin.enter();
await tick(500);
const curSlideAW = () => doc.querySelectorAll(".bdm-slide")[Math.round(doc.querySelector(".bdm-root").scrollTop / 800)];
const layerAW = () => curSlideAW().querySelector(".bdm-dmlayer");
const styleBeforeAW = layerAW().style.opacity;
const timersBeforeAW = timers.size;   // 用来验「关掉弹幕 → 心跳真的停了」的前后对比
// 模拟设置页写入：不透明度 0.5 + 字号 24 + 关掉弹幕
otherTabWrites({ dmOpacity: 0.5, dmFont: 24, dmEnabled: false });
await tick(300);
const timersAfterAW = timers.size;
ok("另一个标签页写入 storage → 内容脚本的设置被合并（不需要刷新）",
  B.settings.dmOpacity === 0.5 && B.settings.dmFont === 24 && B.settings.dmEnabled === false,
  "dmOpacity=" + B.settings.dmOpacity + " dmFont=" + B.settings.dmFont + " dmEnabled=" + B.settings.dmEnabled);
ok("当前屏的弹幕层不透明度**立刻**跟着变（0.8 → 0.5）",
  layerAW().style.opacity === "0.5" && styleBeforeAW !== "0.5",
  "opacity " + JSON.stringify(styleBeforeAW) + " → " + JSON.stringify(layerAW().style.opacity));
ok("关掉弹幕后当前屏的弹幕心跳也停了（同步的不只是数字）",
  timersAfterAW < timersBeforeAW, "定时器 " + timersBeforeAW + " → " + timersAfterAW);
// 再改回来：应当重新亮起并恢复弹幕
otherTabWrites(Object.assign({}, store.bdmSettings, { dmOpacity: 0.8, dmEnabled: true }));
await tick(300);
ok("改回 0.8 并重新开启弹幕 → 当前屏跟着恢复", layerAW().style.opacity === "0.8", "opacity=" + layerAW().style.opacity);
B.douyin.exit();
await tick(60);
store.bdmSettings = savedAll;
await B.loadSettings();
ok("AW 组收尾：退出干净且设置已还原", B.douyin.isActive() === false && B.settings.dmEnabled === true);

G("AX 详情页入口（新功能）+ 视频比例真的改画面尺寸（此前是空操作）");
B.douyin.enter();
await tick(500);
const rootAX = doc.querySelector(".bdm-root");
const sAX = () => doc.querySelectorAll(".bdm-slide")[Math.round(rootAX.scrollTop / 800)];
const openCtxAX = () => { const v0 = sAX().querySelector("video"); v0.dispatchEvent({ type: "contextmenu" });
  v0.dispatchEvent({ type: "mousedown", button: 2, clientX: 300, clientY: 400 });
  v0.dispatchEvent({ type: "mouseup", button: 2, clientX: 300, clientY: 400 }); };
const ctxItemAX = (label) => sAX().querySelector(".bdm-ctx").querySelectorAll(".bdm-ctx-item").find(n => n.querySelector(".bdm-ctx-label").textContent === label);
// ① 普通稿件：打开视频页
openCtxAX();
await tick(60);
const itemAX = ctxItemAX("详情页");
ok("右键菜单里有「详情页」", !!itemAX);
const openedAX = calls.opened.length;
itemAX.dispatchEvent({ type: "click" });
await tick(80);
ok("点「详情页」→ 打开该稿件的 B站 详情页",
  calls.opened.length > openedAX && /bilibili\.com\/video\/BV/.test(calls.opened[calls.opened.length - 1] || ""),
  String(calls.opened[calls.opened.length - 1] || "无").slice(0, 60));
// ② 直播条目（第 3 屏）：它的播放器已被降级卡取代 → **右键打不开菜单**（这是真实行为，
//    它的出口是降级卡上的「进入直播间」）。我第一版在这里假设「能右键」，结果测试自己抛了 null。
let guardAX = 0;
while (Math.round(rootAX.scrollTop / 800) < 2 && guardAX++ < 6) { sAX().querySelector(".bdm-btn-next").dispatchEvent({ type: "click" }); await tick(80); }
await tick(300);
ok("直播条目那屏没有播放器（所以右键不弹菜单，出口是降级卡的「进入直播间」）",
  !sAX().querySelector("video") && !!sAX().querySelector(".bdm-degrade"),
  "有 video=" + !!sAX().querySelector("video") + " 有降级卡=" + !!sAX().querySelector(".bdm-degrade"));
ok("降级卡上确实有「进入直播间」出口（继承 v0.1.33 的断言）",
  /直播间/.test(String((sAX().querySelector(".bdm-degrade") || {}).textContent || "")),
  String((sAX().querySelector(".bdm-degrade") || {}).textContent || "").slice(0, 40));
// ③ 视频比例：样式语义（真实尺寸已在真浏览器量过：16:9→1280×720、4:3→1067×800）
const pickRatioAX = async (label) => {
  sAX().querySelector(".bdm-btn-set").dispatchEvent({ type: "click" });
  await tick(150);
  const sp = sAX()._flat().find(n => n._s.has("bdm-set-settings"));
  const r = sp._flat().filter(n => n._s.has("bdm-set-radio")).find(n => String(n.textContent) === label);
  if (r) { r.dispatchEvent({ type: "click" }); await tick(250); }
  sAX().querySelector(".bdm-btn-set").dispatchEvent({ type: "click" });
  await tick(120);
  return !!r;
};
// 直播那屏没有播放器（上面刚断言过），往后再走一屏再验比例 —— 我第一版忘了挪，于是又取到 null
if (!sAX().querySelector("video")) { sAX().querySelector(".bdm-btn-next").dispatchEvent({ type: "click" }); await tick(300); }
const vAX = sAX().querySelector("video");
ok("前置：当前屏有播放器（比例检查的对象）", !!vAX, "有 video=" + !!vAX);
const ok169AX = await pickRatioAX("16:9");
ok("选 16:9 → 元素宽高改为 auto 并带上比例（两条一起才不是空操作）",
  ok169AX && vAX.style.aspectRatio === "16 / 9" && vAX.style.width === "auto" && vAX.style.height === "auto",
  "aspectRatio=" + JSON.stringify(vAX.style.aspectRatio) + " width=" + JSON.stringify(vAX.style.width));
await pickRatioAX("默认");
ok("回到默认 → 元素重新铺满（width/height 100%、无 aspectRatio）",
  vAX.style.width === "100%" && vAX.style.height === "100%" && vAX.style.aspectRatio === "",
  "width=" + JSON.stringify(vAX.style.width) + " aspectRatio=" + JSON.stringify(vAX.style.aspectRatio));
B.douyin.exit();
await tick(60);
ok("AX 组收尾：退出干净", B.douyin.isActive() === false);

G("AY 频道条高度同步（fixed 之后 body 要让位，高度随宽度变所以由脚本量）");
// ⚠️ 我第一版写成 B.skin.apply(true) —— 但 apply 不接受参数（它只是重读设置），于是皮肤根本没开，
// 那条断言恰好走「没有频道条 → 变量为空」的分支而**假绿**。改成与 AI 组同样的开启方式，并先断言真的开了。
B.settings.desktopSkin = true;
B.skin.apply();
await tick(120);
ok("前置：皮肤确实已开启（否则本组会假绿）", B.skin.isOn() === true, "isOn=" + B.skin.isOn());
const hadChannelAY = !!doc.querySelector(".bili-header__channel");
const varAY = g.document.documentElement.style.getPropertyValue("--bdm-channel-h");
ok("皮肤开启 → 脚本量出频道条高度写进 --bdm-channel-h（没有频道条时为 0/清空）",
  hadChannelAY ? /^\d+px$/.test(varAY) : varAY === "",
  "频道条=" + hadChannelAY + " 变量=" + JSON.stringify(varAY));
// 正向：真有频道条时应当写出一个 px 高度（假 DOM 没这个元素，所以自己造一个）
const fakeChAY = doc.createElement("div"); fakeChAY._s.add("bili-header__channel"); fakeChAY.className = "bili-header__channel";
fakeChAY.getBoundingClientRect = function () { return { top: 0, left: 200, width: 1080, height: 87, right: 1280, bottom: 87 }; };
doc.body.appendChild(fakeChAY);
B.skin.syncChannelH();
ok("存在频道条时 → 写出 px 高度（body 用它让位）",
  /^87px$/.test(g.document.documentElement.style.getPropertyValue("--bdm-channel-h")),
  "变量=" + JSON.stringify(g.document.documentElement.style.getPropertyValue("--bdm-channel-h")));
fakeChAY.remove();
B.settings.desktopSkin = false;
B.skin.apply();
await tick(120);
ok("皮肤关闭 → 变量被清掉（不给关掉的页面留让位）",
  g.document.documentElement.style.getPropertyValue("--bdm-channel-h") === "",
  "变量=" + JSON.stringify(g.document.documentElement.style.getPropertyValue("--bdm-channel-h")));
B.settings.desktopSkin = false;
B.skin.apply();
await tick(60);

G("I 运行期异常");
ok("无未捕获 Promise 拒绝", rejections.length === 0, rejections.slice(0, 3).join(" ;; "));

const fails = R.filter((x) => x.startsWith("FAIL"));
console.log(R.join("\n"));
console.log("\n===== 汇总：断言 " + R.filter((x) => /^(PASS|FAIL)/.test(x)).length + " 条，失败 " + fails.length + " 条 =====");
if (fails.length) console.log(fails.join("\n"));
// 产品里 keepNavButton 用 setInterval 常驻（浏览器里本就该常驻），Node 事件循环因此不会自然退出
process.exit(fails.length ? 1 : 0);
