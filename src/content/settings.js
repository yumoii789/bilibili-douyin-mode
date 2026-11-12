// 共享设置层：chrome.storage.local 封装 + 默认值（内容脚本侧）
window.__BDM__ = window.__BDM__ || {};
__BDM__.defaults = {
  enabled: true,
  dmEnabled: true,
  dmOpacity: 0.8,
  dmSpeed: 8,
  dmFont: 20,
  dmArea: "full",        // 显示区域：full 全屏 / top 上半 / bottom 下半 / half 顶部1/4
  dmDensity: 2,          // 弹幕密度：1 低 / 2 中 / 3 高
  dmScroll: true,        // 弹幕类型：滚动
  dmTop: true,           // 弹幕类型：顶部固定
  dmBottom: true,        // 弹幕类型：底部固定
  dmFontFamily: "",      // 弹幕字体（空 = 默认字体）
  dmBlock: [],           // 弹幕观看屏蔽词
  subtitleOn: false,     // 字幕（B站 原生字幕轨）
  subtitleLan: "",       // 记住上次选的字幕语言
  mirror: false,         // 镜像画面
  videoCodec: "auto",    // 编码：auto / avc / hevc / av1（按接口实际返回的轨给选项）
  videoContrast: 100,    // 对比度
  videoSaturate: 100,    // 饱和度
  wideMode: false,       // 宽屏：画面裁切铺满（竖屏视频无左右黑边）
  volumeBalance: false,  // 音量均衡（Web Audio 动态压缩）
  videoAspect: "default",// 视频比例：default / 16:9 / 4:3 / 21:9 / fill
  longpressRate: false,  // 右键长按倍速
  singleLoop: false,     // 单集循环
  loop: false,           // 循环播放（右键菜单）
  videoRotate: 0,        // 画面旋转：0 / 90 / 180 / 270
  videoBright: 100,      // 画面亮度：50 ~ 150（%）
  volume: 0.7,
  autoplayNext: true,
  suppressLoginPopup: true,
  noAutoPause: true,
  profileGuard: true,
  allowExplicitLike: true,
  desktopSkin: false,
  debug: false
};

// settings 对象全程原地更新、绝不被替换，保证各模块 IIFE 捕获的引用始终有效
__BDM__.settings = Object.assign({}, __BDM__.defaults);
Object.defineProperty(__BDM__.settings, "get", {
  enumerable: false,
  value: function () { return window.__BDM__.settings; }
});

__BDM__.loadSettings = function () {
  return chrome.storage.local.get("bdmSettings").then(function (got) {
    Object.assign(window.__BDM__.settings, __BDM__.defaults, got.bdmSettings || {});
    return window.__BDM__.settings;
  }).catch(function () { return window.__BDM__.settings; });
};

__BDM__.saveSettings = function (patch) {
  Object.assign(window.__BDM__.settings, patch);
  var plain = Object.assign({}, window.__BDM__.settings);
  return chrome.storage.local.set({ bdmSettings: plain }).then(function () {
    return window.__BDM__.settings;
  });
};

chrome.storage.onChanged.addListener(function (ch, area) {
  if (area === "local" && ch.bdmSettings) {
    Object.assign(window.__BDM__.settings, ch.bdmSettings.newValue || {});
    document.dispatchEvent(new CustomEvent("bdm:settings-changed"));
  }
});

// 内容脚本启动即读取用户已保存的开关；读盘完成后广播一次，
// 让 desktop-skin / player 等模块按磁盘上的真实设置重新同步（否则首屏只会看到默认值）
__BDM__.loadSettings().then(function () {
  document.dispatchEvent(new CustomEvent("bdm:settings-changed"));
});
// S.saveSettings 直引（douyin-mode.js S = __BDM__.settings，音量/弹幕保存路径）
__BDM__.settings.saveSettings = __BDM__.saveSettings;
