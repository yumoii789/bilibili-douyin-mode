// ============ 桌面版样式（独立开关 desktopSkin）============
// 只负责给 <html> 加/去一个 bdm-skin 类，全部视觉规则由 desktop-skin.css 承担。
// 不修改 B站 任何 DOM 结构，关闭即刻完全还原 —— 这是它与「刷B站沉浸模式」能分开使用的前提。
// v0.1.22 兼容「映间 MARGIN」扩展（html.margin-root 同样重设计首页）：检测到 MARGIN
// 在场时自动让位，避免两套首页改造互相挤压；MARGIN 摘除后自动恢复。
// v0.1.21 曾用 MutationObserver 监听根 class 即时让位，在 MARGIN + 原站三方频繁写
// html class 的环境下疑似导致标签页崩溃，故撤除：改为设置事件 + 两次低频兜底复检
// （MARGIN 在 document_start 挂类，本脚本 document_idle 执行时已能直接检出；
//   MARGIN 开关切换自身即 location.reload()，无需我方实时跟踪）。
window.__BDM__ = window.__BDM__ || {};
(function () {
  var CLS = "bdm-skin";
  var desired = false;

  // MARGIN 的 DOM 指纹：根元素上的 margin- 前缀类（margin-root / margin-search / margin-ads-hide …）
  function marginOn() {
    var el = document.documentElement;
    if (!el) return false;
    var cls = el.classList;
    for (var i = 0; i < cls.length; i++) {
      if (cls[i].indexOf("margin-") === 0) return true;
    }
    return false;
  }

  // 频道条是 fixed 的（原本用 sticky，滚动实测**吸不住**：sticky 的粘性范围被大约 350px 高的
  // 父容器 .bili-header 限制，视口 628 → 一滚过父容器底部就被顶走，实测 top = -34）。
  // 它的高度随宽度变化（频道胶囊会换行），所以量出来写进 --bdm-channel-h，body 用它让位。
  function syncChannelH() {
    var el = document.documentElement;
    if (!el) return 0;
    var st = el.style;
    if (!st || !st.setProperty) return 0;                      // 残缺 DOM 不打断整个脚本
    if (!el.classList.contains(CLS)) { st.removeProperty("--bdm-channel-h"); return 0; }
    var ch = document.querySelector(".bili-header__channel");
    var h = ch ? Math.round(ch.getBoundingClientRect().height) : 0;
    if (h > 0) st.setProperty("--bdm-channel-h", h + "px");
    else st.removeProperty("--bdm-channel-h");
    return h;
  }

  var rzTimer = 0;
  function onResize() {
    if (rzTimer) clearTimeout(rzTimer);
    rzTimer = setTimeout(syncChannelH, 180);   // 宽度换了 → 胶囊换行数变了 → 高度要重量
  }

  function apply() {
    var el = document.documentElement;
    if (!el) return;
    if (desired && !marginOn()) el.classList.add(CLS);
    else el.classList.remove(CLS);
    syncChannelH();
  }

  function sync() {
    var s = window.__BDM__.settings;
    desired = !!(s && s.get && s.get().desktopSkin);
    apply();
  }

  sync();                                                    // 立即按默认值应用
  document.addEventListener("bdm:settings-changed", sync);   // 设置变更即时生效
  setTimeout(apply, 2000);                                   // 兜底复检：MARGIN 晚挂类场景
  setTimeout(apply, 6000);                                   // 兜底复检：软导航后 class 再变场景
  window.addEventListener("resize", onResize);            // 宽度变化 → 重量频道条高度（胶囊换行数会变）

  window.__BDM__.skin = {
    apply: sync,
    sync: sync,
    isOn: function () { return document.documentElement.classList.contains(CLS); },
    marginDetected: marginOn,
    syncChannelH: syncChannelH
  };
})();
