// ============ 播放器封装：原生 video + 基础弹幕渲染 ============
window.__BDM__ = window.__BDM__ || {};
(function () {
  var S = window.__BDM__.settings;
  var api = window.__BDM__.api;

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function Player(container, item) {
    this.item = item;
    this.dead = false;   // 销毁屏障：销毁后到达的异步续段一律止步
    this.wrap = el("div", "bdm-player", container);
    this.video = el("video", "bdm-video", this.wrap);
    this.video.playsInline = true;
    this.video.preload = "auto";
    this.dmLayer = el("div", "bdm-dmlayer", this.wrap);
    this.dmList = [];
    this.dmSent = 0;
    this.dmTimer = null;
    this.syncTimer = null;       // 独立的音画纠偏心跳（不能只搭在弹幕心跳上）
    this.lanes = 0;              // 滚动弹幕轨道游标（原 tracks 是未被使用的死状态，已移除）
    this.ended = false;
    this.audio = null;           // DASH 高档位：视频流无声，声音由独立音轨提供
    this.subEl = el("div", "bdm-sub", this.wrap);   // 字幕层（渲染 B站 原生字幕轨）
    this.subCues = [];
    this.subIdx = 0;
    this.subOn = false;
    this.subTimer = null;
    var self = this;
    this.video.addEventListener("ended", function () { self.ended = true; });
  }

  // DASH 档位（1080P+/4K/HDR/杜比）只给视频流与音频流两个文件：视频元素静音出画面，
  // 声音交给配对的 <audio>，并把 play/pause/seek/rate/volume 全部镜像过去 + 定期纠偏。
  Player.prototype.ensureAudio = function () {
    if (this.dead || this.audio) return;
    var self = this, v = this.video;
    var a = el("audio", "bdm-audio", this.wrap);
    a.preload = "auto";
    this.audio = a;
    v.addEventListener("play", function () {
      a.play().catch(function () { /* 自动播放被拦时静默 */ });
      self.syncAudio(true);
      self.startAudioSync();
    });
    v.addEventListener("pause", function () { a.pause(); self.stopAudioSync(); });
    v.addEventListener("seeking", function () { self.syncAudio(true); });
    v.addEventListener("seeked", function () { self.syncAudio(true); });
    v.addEventListener("ratechange", function () { a.playbackRate = v.playbackRate; });
    v.addEventListener("volumechange", function () { a.volume = v.volume; });
  };
  // 音画纠偏此前只搭在弹幕心跳（tickDanmaku）里：**弹幕一关就没人纠偏**，DASH 双轨会漂。
  // 独立一条 1 秒心跳，且只在「正在播放且有音轨」时运行 —— 同一时刻只有一屏在播，
  // 所以最多只有一个定时器，不会每屏一个。
  Player.prototype.startAudioSync = function () {
    var self = this;
    if (this.syncTimer || this.dead || !this.audio) return;
    this.syncTimer = setInterval(function () { self.syncAudio(); }, 1000);
  };
  Player.prototype.stopAudioSync = function () {
    if (this.syncTimer) { clearInterval(this.syncTimer); this.syncTimer = null; }
  };
  Player.prototype.syncAudio = function (force) {
    var a = this.audio, v = this.video;
    if (!a || !a.src) return;
    if (force || Math.abs((a.currentTime || 0) - (v.currentTime || 0)) > 0.3) a.currentTime = v.currentTime || 0;
    if (v.paused && !a.paused) a.pause();
    if (!v.paused && a.paused) a.play().catch(function () { /* ignore */ });
  };
  Player.prototype.setSrc = function (url, audioUrl) {
    // 「加载期间已划走/退出」是常态（本扩展的设计前提就是滑动绝不等网络）：迟到的流若照写，
    // 会对已脱离文档的 video 重新发起一次没人看的请求，并重建一条不可回收的 Web Audio 音轨。
    if (this.dead) return;
    this.video.src = url;
    if (audioUrl) {
      this.ensureAudio();
      this.video.muted = true;                    // 只有音轨发声，避免双份声音
      this.audio.src = audioUrl;
      this.audio.volume = this.video.volume;
      this.audio.playbackRate = this.video.playbackRate;
      if (this.volBalance) { this.bindBalanceNode(this.audio, "audio"); this.routeBalance(true); }   // 音轨也要接进均衡图
    } else if (this.audio) {
      this.video.muted = false;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.stopAudioSync();          // 没有音轨了，纠偏心跳也没必要留着
    }
  };
  Player.prototype.play = function () {
    var p = this.video.play();
    if (p && p.catch) p.catch(function () { /* 自动播放被拦时静默 */ });
  };
  Player.prototype.pause = function () { this.video.pause(); };
  Player.prototype.setVolume = function (v) { this.video.volume = v; };
  Player.prototype.currentTime = function () { return this.video.currentTime || 0; };
  Player.prototype.duration = function () {
    var d = this.video.duration;
    return (d && isFinite(d)) ? d : 0;
  };
  Player.prototype.paused = function () { return this.video.paused; };
  Player.prototype.toggle = function () { if (this.video.paused) this.play(); else this.pause(); };
  Player.prototype.setRate = function (r) {
    var v = Number(r);
    if (v >= 0.25 && v <= 4) this.video.playbackRate = v;
  };
  Player.prototype.rate = function () { return this.video.playbackRate || 1; };

  Player.prototype.loadDanmaku = function () {
    var self = this;
    return api.danmaku(this.item.cid).then(function (list) {
      if (!self.dead) { self.dmList = list; self.dmSent = 0; }
      return list.length;
    });
  };

  Player.prototype.setDanmakuOn = function (on) {
    this.dmLayer.style.display = on ? "block" : "none";
  };

  // 弹幕不透明度：此前设置页有该项却全项目零消费，拖动毫无效果
  Player.prototype.setDanmakuOpacity = function (v) {
    var o = Number(v);
    this.dmLayer.style.opacity = (o >= 0.1 && o <= 1) ? String(o) : "0.8";
  };

  // 弹幕筛选（设置面板的真实消费点）：类型开关 / 屏蔽词 / 密度
  Player.prototype.dmAllowed = function (dm) {
    var st = S.get();
    var mode = Number(dm.mode) || 1;
    if (mode === 8) return false;                       // 代码弹幕不执行
    if (mode !== 7) {
      if (mode === 4 && st.dmBottom === false) return false;
      if (mode === 5 && st.dmTop === false) return false;
      if (mode !== 4 && mode !== 5 && st.dmScroll === false) return false;
    }
    var words = st.dmBlock || [];
    for (var i = 0; i < words.length; i++) {
      if (words[i] && String(dm.text).indexOf(words[i]) >= 0) return false;
    }
    var d = Number(st.dmDensity) || 2;
    if (d < 3 && this.dmSent % (d === 1 ? 3 : 2) !== 0) return false;   // 低=留 1/3，中=留 1/2，高=全放
    return true;
  };
  // 显示区域 / 字体：B站 弹幕设置面板里「显示区域、弹幕字体」的真实生效点
  Player.prototype.applyDmSettings = function () {
    var st = S.get(), l = this.dmLayer, area = st.dmArea || "full";
    l.style.top = ""; l.style.bottom = ""; l.style.height = "";
    if (area === "top") { l.style.top = "0"; l.style.bottom = "auto"; l.style.height = "50%"; }
    else if (area === "bottom") { l.style.top = "auto"; l.style.bottom = "0"; l.style.height = "50%"; }
    else if (area === "half") { l.style.top = "0"; l.style.bottom = "auto"; l.style.height = "25%"; }
    l.style.fontFamily = st.dmFontFamily || "";
  };
  // 清屏：只清屏上已有的弹幕，后续弹幕照常出现（与 B站 一致）
  Player.prototype.clearScreen = function () {
    var kids = this.dmLayer.children.slice();
    for (var i = 0; i < kids.length; i++) { try { kids[i].remove(); } catch (e) { /* ignore */ } }
  };
  Player.prototype.setMirror = function (on) { this.mirror = !!on; this.applyFx(); };
  Player.prototype.setAspect = function (v) { this.aspect = v || "default"; this.applyFx(); };
  Player.prototype.setLoop = function (on) { this.video.loop = !!on; };

  // ---------- 音量均衡（B站 设置项「音量均衡」的真实实现：Web Audio 动态压缩）----------
  // 两个硬约束决定了这里的结构：
  //   ① createMediaElementSource 对同一 <video>/<audio> 一生只能绑一次，且不能改绑到别的上下文
  //      → 关闭不能销毁上下文（否则再开启必然抛「元素已绑定」）
  //   ② 上下文数量有限（按屏各建一个会累积到上限）
  //      → 全扩展共用一个 AudioContext 与一个压缩器，每屏只往它上面挂自己的元素，开关只切路由
  var SHARED = { ctx: null, comp: null };
  function sharedAudio() {
    if (SHARED.ctx) return SHARED;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      SHARED.ctx = new AC();
      SHARED.comp = SHARED.ctx.createDynamicsCompressor();
      SHARED.comp.threshold.value = -24;
      SHARED.comp.ratio.value = 6;
      SHARED.comp.attack.value = 0.003;
      SHARED.comp.release.value = 0.25;
      SHARED.comp.connect(SHARED.ctx.destination);
    } catch (e) { SHARED.ctx = null; SHARED.comp = null; return null; }
    return SHARED;
  }
  Player.prototype.bindBalanceNode = function (el, key) {
    if (!this.volSrc || this.volSrc[key]) return;
    var sh = sharedAudio();
    if (!sh) return;
    try {
      this.volSrc[key] = sh.ctx.createMediaElementSource(el);
    } catch (e) { /* 已绑定过 → 忽略 */ }
  };
  // 开 = 元素 → 压缩器 → 输出；关 = 元素 → 输出（旁路）
  Player.prototype.routeBalance = function (on) {
    var self = this, sh = SHARED;
    if (!this.volSrc || !sh.ctx) return;
    ["video", "audio"].forEach(function (k) {
      var n = self.volSrc[k];
      if (!n) return;
      try { n.disconnect(); } catch (e) { /* ignore */ }
      try { n.connect(on && sh.comp ? sh.comp : sh.ctx.destination); } catch (e) { /* ignore */ }
    });
  };
  Player.prototype.setVolumeBalance = function (on) {
    if (!on) {
      this.volBalance = false;
      this.routeBalance(false);
      return true;
    }
    var sh = sharedAudio();
    if (!sh) { this.volBalance = false; return false; }   // 失败不留「已开启」，否则 setSrc 还会去多绑音轨
    try {
      if (!this.volSrc) this.volSrc = { video: null, audio: null };
      if (sh.ctx.state === "suspended" && sh.ctx.resume) sh.ctx.resume();
      this.bindBalanceNode(this.video, "video");
      if (this.audio) this.bindBalanceNode(this.audio, "audio");
      if (!this.volSrc.video) { this.volBalance = false; return false; }
      this.volBalance = true;
      this.routeBalance(true);
      return true;
    } catch (e) { this.volBalance = false; return false; }
  };

  // ---------- 字幕（B站 原生字幕轨）----------
  Player.prototype.setSubtitleCues = function (cues) {
    if (this.dead) return;   // 销毁后到达的字幕轨不得再渲染
    this.subCues = cues || [];
    this.subIdx = 0;
    if (this.subEl) this.subEl.textContent = "";
  };
  Player.prototype.setSubtitleOn = function (on) {
    this.subOn = !!on;
    if (this.subEl) {
      this.subEl.style.display = on ? "block" : "none";
      if (!on) this.subEl.textContent = "";
    }
    if (on) this.startSubtitleTimer(); else this.stopSubtitleTimer();
  };
  // 字幕有独立 200ms 心跳：弹幕关掉后 tickDanmaku 不再跑，字幕不能跟着停
  Player.prototype.startSubtitleTimer = function () {
    var self = this;
    this.stopSubtitleTimer();
    this.subTimer = setInterval(function () { self.tickSubtitle(); }, 200);
  };
  Player.prototype.stopSubtitleTimer = function () {
    if (this.subTimer) { clearInterval(this.subTimer); this.subTimer = null; }
  };
  Player.prototype.tickSubtitle = function () {
    if (!this.subOn || !this.subCues.length) return;
    var t = this.currentTime(), cues = this.subCues, i = this.subIdx;
    if (i >= cues.length) { if (this.subEl && this.subEl.textContent) this.subEl.textContent = ""; return; }
    while (i > 0 && t < cues[i].from) i -= 1;                      // 拖动/换源后回退
    while (i < cues.length && t >= cues[i].to) i += 1;
    this.subIdx = i;
    var text = (i < cues.length && t >= cues[i].from && t < cues[i].to) ? cues[i].text : "";
    if (this.subEl && this.subEl.textContent !== text) this.subEl.textContent = text;
  };
  Player.prototype.clearSubtitle = function () {
    this.stopSubtitleTimer();
    this.setSubtitleCues([]);
    this.subOn = false;
    if (this.subEl) { this.subEl.textContent = ""; this.subEl.style.display = "none"; }
  };
  // 右键菜单里的画面旋转 / 亮度（照搬 B站：旋转 0/90/180/270、亮度可调）
  // 画面效果统一由 applyFx 合成：旋转/镜像 → transform，亮度/对比度/饱和度 → filter，
  // 比例/宽屏 → aspectRatio + objectFit。各 setter 只存值，避免互相覆盖。
  Player.prototype.setRotate = function (deg) { this.rotate = Number(deg) || 0; this.applyFx(); };
  Player.prototype.setBright = function (pct) { this.bright = Number(pct) || 100; this.applyFx(); };
  Player.prototype.setContrast = function (pct) { this.contrast = Number(pct) || 100; this.applyFx(); };
  Player.prototype.setSaturate = function (pct) { this.saturate = Number(pct) || 100; this.applyFx(); };
  Player.prototype.setWide = function (on) { this.wide = !!on; this.applyFx(); };
  Player.prototype.applyFx = function () {
    var v = this.video, f = [];
    if (this.bright && this.bright !== 100) f.push("brightness(" + (this.bright / 100) + ")");
    if (this.contrast && this.contrast !== 100) f.push("contrast(" + (this.contrast / 100) + ")");
    if (this.saturate && this.saturate !== 100) f.push("saturate(" + (this.saturate / 100) + ")");
    v.style.filter = f.join(" ");
    v.style.transform = (this.rotate ? "rotate(" + this.rotate + "deg) " : "") + (this.mirror ? "scaleX(-1)" : "");
    var mFx = /^(\d+):(\d+)$/.exec(String(this.aspect || ""));   // 先算比例，供下面两处判断
    if (this.rotate && !mFx) v.style.maxWidth = "none";            // 旋转 + 无比例时才放开宽度（否则比例框会失去上界）
    var m = /^(\d+):(\d+)$/.exec(String(this.aspect || ""));
    if (m) {   // 比例优先于旋转：旋转只是 transform，不该让用户选的比例档位失效（此前加了 !this.rotate，结果一开旋转比例就不生效）
      // 固定比例：让**元素本身**成为该比例的最大内接框（宽高交给 aspect-ratio 推），画面再在框内 contain/fill。
      // 此前只写 aspectRatio，而 width/height 都是 100% —— 按 CSS 规范「同时指定宽高时 aspect-ratio 被忽略」，
      // 于是 16:9 / 4:3 / 21:9 三档是**空操作**（真浏览器实测：视频盒恒为 1280×800，无论选哪档）。
      v.style.width = "auto";
      v.style.height = "auto";
      v.style.maxWidth = "100%";
      v.style.maxHeight = "100%";
      v.style.aspectRatio = m[1] + " / " + m[2];
    } else {
      v.style.width = "100%";
      v.style.height = "100%";
      v.style.aspectRatio = "";
    }
    v.style.objectFit = this.aspect === "fill" ? "fill" : (this.wide ? "cover" : "contain");   // 宽屏 = 裁切铺满
  };

  // 弹幕调度：按播放时间从队列发出。逐条异常不影响播放。
  Player.prototype.tickDanmaku = function () {
    this.syncAudio();
    if (!this.item) return;
    var t = this.currentTime();
    var speed = Math.max(4, Number(S.get().dmSpeed) || 8);
    var base = Math.max(12, Number(S.get().dmFont) || 20);
    var scale = base / 25;                       // B站 弹幕默认字号为 25，按用户设定等比缩放
    var dur = 9 * (8 / speed);
    while (this.dmSent < this.dmList.length && this.dmList[this.dmSent].t <= t + 0.05) {
      var dm = this.dmList[this.dmSent];
      this.dmSent += 1;
      if (!this.dmAllowed(dm)) continue;
      try { this.emitDanmaku(dm, dur, scale); } catch (e) { /* 单条异常不中断 */ }
    }
  };

  // 按 B站 弹幕模式分别渲染（规格⑨「高级弹幕」）：
  //   1/2/3 滚动（右→左）   6 逆向滚动（左→右）
  //   4 底部固定            5 顶部固定
  //   7 高级弹幕（文本是 JSON，按 0-1 相对坐标定位，带透明度与持续时长）
  //   8 代码弹幕（脚本弹幕，不执行，安全跳过）
  Player.prototype.emitDanmaku = function (dm, dur, scale) {
    var mode = Number(dm.mode) || 1;
    if (mode === 8) return;
    var font = Math.max(12, Math.round((Number(dm.size) || 25) * scale));
    var color = (dm.color && dm.color !== 16777215)
      ? "#" + ("00000" + Number(dm.color).toString(16)).slice(-6) : "#FFFFFF";

    if (mode === 7) {
      var a = null;
      try { a = JSON.parse(dm.text); } catch (e) { a = null; }
      if (!Array.isArray(a)) return;
      var adv = el("span", "bdm-dm bdm-dm-adv", this.dmLayer);
      adv.textContent = String(a[4] == null ? "" : a[4]);
      adv.style.fontSize = font + "px";
      adv.style.color = color;
      adv.style.left = ((Number(a[0]) || 0) * 100) + "%";
      adv.style.top = ((Number(a[1]) || 0) * 100) + "%";
      adv.style.opacity = String(a[2] == null ? 1 : a[2]);
      adv.style.transform = "none";
      setTimeout(function (s) { return function () { s.remove(); }; }(adv), Math.max(2, Number(a[3]) || 4) * 1000);
      return;
    }

    var span = el("span", "bdm-dm", this.dmLayer);
    span.textContent = dm.text;
    span.style.fontSize = font + "px";
    span.style.color = color;

    if (mode === 5 || mode === 4) {              // 顶部 / 底部固定弹幕
      span.classList.add("bdm-dm-fixed");
      span.style.left = "50%";
      span.style.transform = "translateX(-50%)";
      if (mode === 5) span.style.top = "2%";
      else span.style.bottom = "2%";
      setTimeout(function (s) { return function () { s.remove(); }; }(span), Math.max(2000, dur * 550));
      return;
    }

    var lane = this.lanes % 5;                   // 轨道游标：5 条轨道，避免同屏重叠
    this.lanes += 1;
    span.style.top = (6 + lane * 12) + "%";
    span.style.transition = "transform " + dur + "s linear";
    if (mode === 6) {                            // 逆向滚动：从左入画
      span.style.left = "0";
      span.style.transform = "translateX(-100%)";
      requestAnimationFrame(function () { span.style.transform = "translateX(100vw)"; });
    } else {
      requestAnimationFrame(function () { span.style.transform = "translateX(calc(-100vw - 100%))"; });
    }
    setTimeout(function (s) { return function () { s.remove(); }; }(span), dur * 1000 + 200);
  };

  Player.prototype.startDanmaku = function () {
    var self = this;
    this.stopDanmaku();
    this.dmTimer = setInterval(function () { self.tickDanmaku(); }, 120);
  };
  Player.prototype.stopDanmaku = function () {
    if (this.dmTimer) { clearInterval(this.dmTimer); this.dmTimer = null; }
  };

  Player.prototype.destroy = function () {
    if (this.dead) return;   // 幂等：重复销毁不得二次动 DOM / 音轨
    this.dead = true;
    this.stopDanmaku();
    this.stopAudioSync();
    this.stopSubtitleTimer();
    if (this.audio) {
      try { this.audio.pause(); this.audio.removeAttribute("src"); } catch (e) { /* ignore */ }
      this.audio = null;
    }
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.wrap.remove();
  };

  window.__BDM__.Player = Player;
})();
