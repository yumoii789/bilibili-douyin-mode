// 弹窗速控：每个开关以 DEFAULTS 为唯一依据判断勾选状态。
// 注意不能再用 s[id] !== false 的写法 —— 对「默认关闭」的开关（desktopSkin）
// undefined !== false 会算成 true，界面上会误显示为已勾选。
const DEFAULTS = {
  enabled: true,
  desktopSkin: false,
  dmEnabled: true,
  autoplayNext: true,
  suppressLoginPopup: true,
  noAutoPause: true,
  profileGuard: true
};
const IDS = Object.keys(DEFAULTS);

(async function init() {
  const got = await chrome.storage.local.get("bdmSettings");
  const s = Object.assign({}, DEFAULTS, got.bdmSettings || {});
  for (const id of IDS) {
    const el = document.getElementById(id);
    el.checked = !!s[id];
    el.addEventListener("change", persist);
  }
  // 同样只写变化的那一个键：整块写回会把玩家内面板的新值覆盖掉
  async function persist(e) {
    const id = e.target && e.target.id;
    if (!id || IDS.indexOf(id) < 0) return;
    const cur = (await chrome.storage.local.get("bdmSettings")).bdmSettings || {};
    const patch = {};
    patch[id] = e.target.checked;
    await chrome.storage.local.set({ bdmSettings: Object.assign({}, cur, patch) });
  }
})();

document.getElementById("openOptions").addEventListener("click", function () {
  chrome.runtime.openOptionsPage();
});
