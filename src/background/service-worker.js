// 后台：右键菜单「下载视频」+ 下载代理
const MENU_ID = "bdm-download-video";

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "下载此视频…",
      contexts: ["page", "video", "link"],
      // 沉浸流（刷B站）在首页也能用：内容脚本会用「当前屏」这条视频，而不是页面 __INITIAL_STATE__
      documentUrlPatterns: ["https://www.bilibili.com/*"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async function (info, tab) {
  if (info.menuItemId !== MENU_ID || !tab || !tab.id) return;
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "bdm:open-download-dialog" });
    if (!resp || !resp.ok) console.warn("下载弹窗未打开:", JSON.stringify(resp || {}));
  } catch (e) {
    console.warn("内容脚本未响应:", String(e && e.message || e));
  }
});

// 字幕 JSON 中转：内容脚本直取 aisubtitle.hdslb.com 若被 CORS 拦，改由后台取回
// （后台凭 host_permissions 可跨源，内容脚本不行；只放行 hdslb.com，不做通用代理）
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === "bdm:fetch-json" && msg.url) {
    var u = String(msg.url);
    // 必须与 manifest 的 host_permissions（*://*.hdslb.com/*）一致：原先的 [\w.-]*hdslb\.com
    // 会连 evil-hdslb.com 一起放行（它不是 hdslb.com 的子域），中转白名单被放宽了。
    if (!/^https:\/\/([\w-]+\.)*hdslb\.com\//i.test(u)) { sendResponse({ ok: false, err: "host not allowed" }); return false; }
    fetch(u, { credentials: "omit" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { sendResponse({ ok: true, data: j }); })
      .catch(function (e) { sendResponse({ ok: false, err: String((e && e.message) || e) }); });
    return true;   // 异步响应
  }
  return false;
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === "bdm:download" && msg.url) {
    chrome.downloads.download({
      url: msg.url,
      filename: msg.filename ? "刷B站/" + String(msg.filename).replace(/[\\/:*?"<>|]/g, "_") : undefined,
      saveAs: msg.saveAs !== false
    }, function (id) {
      const err = chrome.runtime.lastError;
      sendResponse({ ok: !err, id: id === undefined ? null : id, err: err ? err.message : null });
    });
    return true;
  }
  return false;
});
