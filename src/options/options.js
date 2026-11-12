const RANGE = ["volume", "dmOpacity"], NUM = ["dmFont", "dmSpeed"],
      CHECK = ["enabled", "desktopSkin", "profileGuard", "allowExplicitLike", "suppressLoginPopup", "noAutoPause", "debug"];
const DEFAULTS = { volume: 0.7, dmOpacity: 0.8, dmFont: 20, dmSpeed: 8,
  enabled: true, desktopSkin: false,
  profileGuard: true, allowExplicitLike: true, suppressLoginPopup: true, noAutoPause: true, debug: false };

(async function init() {
  const s = Object.assign({}, DEFAULTS, ((await chrome.storage.local.get("bdmSettings")).bdmSettings) || {});
  for (const id of RANGE) document.getElementById(id).value = s[id];
  for (const id of NUM) document.getElementById(id).value = s[id];
  for (const id of CHECK) document.getElementById(id).checked = !!s[id];   // s 已并入 DEFAULTS，默认关闭的开关才会正确显示为未勾选

  let timer;
  // 只写「发生变化的那一个键」，且写前重读存储：
  // 原先把 init 时的整份快照 s 连同补丁写回，会把本页打开期间玩家内面板（弹幕设置/设置齿轮）
  // 改过的值整块覆盖回旧值 —— 典型的陈旧快照覆盖。
  document.body.addEventListener("change", async function (e) {
    const id = e.target && e.target.id;
    if (!id) return;
    let val;
    if (RANGE.indexOf(id) >= 0) val = parseFloat(e.target.value);
    else if (NUM.indexOf(id) >= 0) val = parseInt(e.target.value, 10);
    else if (CHECK.indexOf(id) >= 0) val = e.target.checked;
    else return;
    const cur = (await chrome.storage.local.get("bdmSettings")).bdmSettings || {};
    const patch = {};
    patch[id] = val;
    await chrome.storage.local.set({ bdmSettings: Object.assign({}, cur, patch) });
    const el = document.getElementById("saved");
    el.style.opacity = 1;
    clearTimeout(timer);
    timer = setTimeout(function () { el.style.opacity = 0; }, 1200);
  });
})();
