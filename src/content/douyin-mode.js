// ============ 主控制器：竖屏沉浸流（抖音结构 × B站视觉） ============
window.__BDM__ = window.__BDM__ || {};
(function () {
  var S = window.__BDM__.settings;
  var api = window.__BDM__.api;
  var ui = window.__BDM__.ui;
  var Player = window.__BDM__.Player;

  var root = null;
  var slides = [];   // {item, slide, player, loaded, failed}
  var items = [];
  var idx = 0;
  var busy = false;
  var active = false;
  var keepTimer = null;   // 定时把 DOM 撑到当前屏之后 2 屏的保险丝

  function enter() {
    if (active) return;
    active = true;
    var navBtn = document.getElementById("bdm-nav-btn");
    if (navBtn) navBtn.classList.add("bdm-nav-on");
    document.bdmImmersive = true;
    root = ui.el("div", "bdm-root");
    document.documentElement.appendChild(root);
    var closeBtn = ui.el("button", "bdm-close", root);
    closeBtn.type = "button";
    closeBtn.textContent = "退出";
    closeBtn.addEventListener("click", exit);
    document.body.style.overflow = "hidden";
    bindGestures();
    pokeChrome();
    loadFeed();
    if (keepTimer) clearInterval(keepTimer);
    keepTimer = setInterval(keepAhead, 2000);
    setTimeout(function () { if (active) console.log("[刷B站] 已进入沉浸流 " + diag()); }, 900);
  }

  function exit() {
    active = false;
    if (keepTimer) { clearInterval(keepTimer); keepTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    chromeHide(false);
    var navBtn = document.getElementById("bdm-nav-btn");
    if (navBtn) navBtn.classList.remove("bdm-nav-on");
    document.bdmImmersive = false;
    slides.forEach(function (s) { teardownSlide(s); });
    slides = []; items = []; idx = 0;
    // 会话态必须一起清：seenIds 不清 → 重进时同一批推荐全被判成「已见」，
    // 一屏都建不出来（实测「退出再进入」得到空 feed）；busy 卡住会让滑动永久失效。
    seenIds = {}; busy = false; popPage = 1;
    if (root) { root.remove(); root = null; }
    document.body.style.overflow = "";
  }

  var seenIds = {};

  function keyOf(it) { return it.bvid + ':' + it.cid; }

  // 直播条目（goto=live）没有 bvid/cid，此前被静默丢弃；现在归一化后保留，
  // 交给降级卡并给出「进入直播间」出口（规格⑨「还有直播和直播间」）
  function normalize(it) {
    if (it && it.goto === 'live' && it.roomid) {
      return {
        goto: 'live', roomid: it.roomid, bvid: '', cid: 0,
        title: it.title || '直播', cover: it.cover || '',
        owner: { name: it.uname || '未知主播', face: it.face || '' },
        stat: { view: it.online || 0, danmaku: 0 },
        part: '直播'
      };
    }
    return it;
  }

  function addItems(list) {
    var added = 0;
    (list || []).forEach(function (raw) {
      var it = normalize(raw);
      if (!it) return;
      if (it.goto === 'live') {
        var lk = 'live:' + it.roomid;
        if (seenIds[lk]) return;
        seenIds[lk] = 1;
        items.push(it);
        added += 1;
        return;
      }
      // 分P 的 bvid 相同而 cid 不同，去重键必须带 cid，否则整段分P会被误杀
      if (!it.bvid || !it.cid || seenIds[keyOf(it)]) return;
      seenIds[keyOf(it)] = 1;
      items.push(it);
      added += 1;
    });
    return added;
  }

  // 把 DOM 同步撑到指定屏号：makeSlide 的节点插入发生在它第一个 await 之前，
  // 因此这里不 await 也已经占好高度 —— 否则 scrollTo 会被裁切，表现为「划不动」。
  function ensureSlides(upto) {
    for (var i = 0; i <= upto; i++) {
      if (!slides[i] && items[i]) makeSlide(i);
    }
  }

  // 保险丝：不论滚动是由我们的滚轮处理器、原生滚动、滚动条还是触摸驱动，
  // 都保证 DOM 高度始终领先当前屏 2 屏 —— 高度不够就再也滚不动，这正是
  // 「划到第 3 条」的死因（预建 3 屏，滚到第 3 屏后 scrollHeight 用尽）。
  function keepAhead() {
    if (!active || !root) return;
    ensureSlides(Math.min(items.length - 1, idx + 2));
    pruneFar();   // 保险丝每 2 秒也会兜一次回收
  }

  // 交错排序：优先挑与「上一条」不同 UP、不同分区的条目。
  // 实测 related 兜底的前 8 条分区序列是「日常→手游→手游→同人手书→同人手书→GMV→手游→手游」，
  // 这种相邻重复正是用户反馈的「连着好几个都是同类视频」。
  function diversify(list, lastItem) {
    var out = [];
    var pool = (list || []).slice();
    var lastMid = lastItem && lastItem.owner ? lastItem.owner.mid : null;
    var lastTn = lastItem ? lastItem.tname : null;
    while (pool.length) {
      var pick = 0;
      for (var i = 0; i < pool.length; i++) {
        var it = pool[i];
        var mid = it.owner && it.owner.mid;
        if (mid !== lastMid && (!lastTn || !it.tname || it.tname !== lastTn)) { pick = i; break; }
      }
      var chosen = pool.splice(pick, 1)[0];
      out.push(chosen);
      lastMid = chosen.owner && chosen.owner.mid;
      lastTn = chosen.tname;
    }
    return out;
  }

  var popPage = 1;

  // 续接内容：**推荐流优先**（与 B站 首页同一个接口，wbi 修好后一次 30 条）→
  // 热门补多样性（15 分区）→ related 仅最后少量兜底（它按定义就是同分区同 UP，取多了必然同类扎堆）
  async function extendFeed() {
    var tail = items[items.length - 1];
    try {
      if (addItems(diversify(await api.rcmd(12), tail))) return true;
    } catch (e) { /* 风控/限流 → 走下一源 */ }
    try {
      popPage += 1;
      if (addItems(diversify(await api.popular(popPage), tail))) return true;
    } catch (e) { /* ignore */ }
    try {
      if (tail && tail.bvid) {
        var rel = await api.related(tail.bvid);
        if (addItems(diversify(rel.slice(0, 6), tail))) return true;   // 只取 6 条，避免同类刷屏
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  async function loadFeed() {
    busy = true;
    try {
      items = [];
      addItems(await api.rcmd(12));
      if (!items.length) throw new Error("推荐流为空");
      ensureSlides(Math.min(2, items.length - 1));   // 预建 3 屏：给原生滚动留出余量
      await activateSlide(0);
    } catch (e) {
      showRootError(String(e.message || e));
    }
    busy = false;
  }

  function showRootError(msg) {
    if (!root) return;
    var old = root.querySelector(".bdm-degrade.bdm-root-error");
    if (old) old.remove();                      // 幂等：重试再失败时不叠卡
    var box = ui.el("div", "bdm-degrade bdm-root-error", root);
    ui.el("div", "bdm-degrade-title", box).textContent = "刷B站加载失败";
    ui.el("div", "bdm-degrade-sub", box).textContent = msg;
    // 出路：与其它失败出口同一套做法（降级卡给「打开原页」、评论分页给「点我重试」）。
    // 首次进入就撞上风控/断网时，此前只能退出再进 —— 现在点一下就能重来。
    var again = ui.el("button", "bdm-degrade-btn", box);
    again.type = "button";
    again.textContent = "重试";
    again.addEventListener("click", function () {
      box.remove();                            // 先摘掉自己：既清理界面，也顺手挡住连点
      loadFeed();
    });
  }

  // 组装单屏：UI 骨架 + 播放器 + 视频地址（失败转降级卡）
  async function makeSlide(i) {
    if (slides[i]) return slides[i];
    var item = items[i];
    var built = ui.buildSlide(item);
    root.insertBefore(built.root, root.querySelector(".bdm-close"));
    var ld = showLoading(built);                    // 占位：先滑得到、再慢慢加载
    var player = new Player(built.videoArea, item);
    var rec = { item: item, slide: built, player: player, loaded: false, failed: false };
    slides[i] = rec;
    bindActions(rec);
    bindSeek(rec);                                  // 传 rec 而不是 player：划回重建后必须指向当前播放器
    bindPlayerEvents(rec, player);
    if (item.goto === "live") {
      rec.failed = true;
      degradeLive(built, item);
      return rec;
    }
    try {
      var p = await api.playurl(item.bvid, item.cid, 64, { codec: S.get().videoCodec });
      // 这一屏在等待期间可能已被回收/丢弃（划走、不感兴趣、退出）：直接放弃，不碰播放器
      if (rec.gone || !active || rec.player !== player) return rec;
      if (!p.url) throw new Error("无可用视频流");
      if (p.multiSegment) throw new Error("该稿件由 " + p.segments + " 段视频拼成，沉浸模式暂不支持续播");
      applyStream(rec, p);
      if (ld.parentNode) ld.remove();
      if (rec === slides[idx]) activateSlide(idx);   // 迟到的加载也要补播，避免停在黑屏
    } catch (e) {
      rec.failed = true;
      var raw = String(e.message || e);
      degradeSlide(built, item, hintOf(raw) || raw);
    }
    return rec;
  }

  function showLoading(built) {
    var ld = ui.el("div", "bdm-loading", built.videoArea);
    ld.textContent = "加载中…";
    return ld;
  }

  // 播放器事件只挂一次（划回重建复用同一个播放器，不会重复挂）
  function bindPlayerEvents(rec, player) {
    var built = rec.slide;
    player.video.addEventListener("timeupdate", function () {
      if (rec !== slides[idx]) return;
      var d = player.duration();
      if (d) built.seek.fill.style.width = Math.min(100, player.currentTime() / d * 100) + "%";
      built.ctrl.time.textContent = fmtTime(player.currentTime()) + " / " + fmtTime(d);
    });
    player.video.addEventListener("play", function () {
      if (rec === slides[idx]) built.ctrl.play.innerHTML = SVG_PAUSE;
    });
    player.video.addEventListener("pause", function () {
      if (rec === slides[idx]) built.ctrl.play.innerHTML = SVG_PLAY;
    });
    player.video.addEventListener("ended", function () {
      if (rec === slides[idx] && S.get().autoplayNext) go(1);
    });
  }

  // 把一条流接到这一屏上：首次加载与「划回重建」共用同一条路径
  function applyStream(rec, p) {
    var player = rec.player, built = rec.slide;
    if (!player) return;
    rec.codecs = p.codecs || null;
    rec.mode = p.mode || null;
    // 防御：播放器整包必须在 videoArea 里。用 children 成员判断（对假 DOM 与真浏览器都成立），
    // 不依赖 parentNode 指针的清理时机。
    if (built.videoArea && player.wrap && Array.prototype.indexOf.call(built.videoArea.children, player.wrap) < 0) {
      built.videoArea.appendChild(player.wrap);
    }
    player.setSrc(p.url, p.audioUrl);   // DASH 档位需要配套音轨
    applyPrefs(rec);                    // 镜像 / 比例 / 循环 / 弹幕显示区域等用户偏好
    if (S.get().subtitleOn) loadSubtitle(rec, S.get().subtitleLan, true);   // 上次开着字幕就继续开着
    player.setVolume(Number(S.get().volume) || 0.7);
    player.loadDanmaku();
    player.setDanmakuOpacity(S.get().dmOpacity);
    rec.qn = { cur: p.quality, list: p.qnList || [], desc: p.qnDesc || [], items: p.list || [] };
    built.ctrl.qn.textContent = qnLabel(p, p.quality);
    rec.loaded = true;
    rec.pruned = false;
    if (built.root) built.root.classList.remove("bdm-released");
  }

  // 长会话回收：抖音式信息流一刷就是几百屏，而每一屏都一直持有 <video> 的媒体流
  // 和整份弹幕数组。全留着 = 内存线性增长，真机上的表现就是越刷越卡。
  // 只释放「重」的东西：媒体流、弹幕数据、已渲染的弹幕节点；DOM 骨架与滚动几何原样保留
  // （.bdm-slide 的高度来自容器的 height:100%，与内容无关），划回来时按原位重新取流。
  var KEEP = 3;
  function pruneFar() {
    for (var i = 0; i < slides.length; i++) {
      var s = slides[i];
      if (!s || s.pruned || !s.loaded || Math.abs(i - idx) <= KEEP) continue;
      releaseSlide(s);
    }
  }

  function releaseSlide(s) {
    var p = s.player;
    if (!p) return;
    s.pruned = true;
    s.loaded = false;
    if (s.slide && s.slide.root) s.slide.root.classList.add("bdm-released");   // 可观测：自测与排查都靠它
    try {
      p.stopDanmaku();
      p.stopSubtitleTimer();
      p.setVolumeBalance(false);      // 断开这一屏的均衡图（否则每屏各留一份）
      p.pause();
      p.video.removeAttribute("src");
      p.video.load();                 // 通知浏览器释放解码器与缓冲
      if (p.audio) { p.audio.pause(); p.audio.removeAttribute("src"); }
      p.dmList = [];                  // 弹幕数据可能上千条，是这里最大的一块
      p.dmLayer.innerHTML = "";       // 已渲染的弹幕节点一并回收
      p.dmSent = 0;
    } catch (e) { /* 回收失败不影响可用性 */ }
  }

  // 划回来：按原位重新取流（播放器对象与监听器都还在，只需重新挂流）
  async function restoreSlide(i) {
    var rec = slides[i];
    if (!rec || !rec.player || !rec.pruned) return;
    rec.pruned = false;               // 立刻置位，避免在飞的重复请求
    // 注意：**不要**在这里清 videoArea —— 播放器整包（<video> / 弹幕层 / 字幕层 / 音轨）
    // 就是挂在它里面的，清掉就再也没人挂回去。真机症状：划回被回收过的屏 → 黑屏（可能还有声音）。
    var ld = showLoading(rec.slide);
    try {
      var p = await api.playurl(rec.item.bvid, rec.item.cid, 64, { codec: S.get().videoCodec });
      if (rec.gone || !active || !rec.player) return;
      if (!p.url) throw new Error("无可用视频流");
      if (p.multiSegment) throw new Error("该稿件由 " + p.segments + " 段视频拼成，沉浸模式暂不支持续播");
      applyStream(rec, p);
      if (ld.parentNode) ld.remove();
      if (rec === slides[idx]) activateSlide(idx);
    } catch (e) {
      rec.failed = true;
      degradeSlide(rec.slide, rec.item, hintOf(String(e.message || e)));
    }
  }

  // 特殊/受限视频：降级卡 + 打开原页（交互视频、360°、大会员限定等）
  function degradeSlide(built, item, msg) {
    built.videoArea.innerHTML = "";
    var box = ui.el("div", "bdm-degrade", built.videoArea);
    ui.el("div", "bdm-degrade-title", box).textContent = "该视频暂不支持沉浸播放";
    ui.el("div", "bdm-degrade-sub", box).textContent = "可能为特殊格式或需要更高权限：" + msg;
    var btn = ui.el("button", "bdm-degrade-btn", box);
    btn.type = "button";
    btn.textContent = "打开原页";
    btn.addEventListener("click", function () {
      window.open("https://www.bilibili.com/video/" + item.bvid, "_blank");
    });
  }

  // 直播：不做沉浸内播放（m3u8 无法直接喂给 <video>），给明确出口
  function degradeLive(built, item) {
    if (built.more) built.more.style.display = "none";   // 直播没有简介，别留一个点了就错的入口
    built.videoArea.innerHTML = "";
    var box = ui.el("div", "bdm-degrade", built.videoArea);
    ui.el("div", "bdm-degrade-title", box).textContent = "直播内容暂不支持沉浸播放";
    ui.el("div", "bdm-degrade-sub", box).textContent = "主播：" + ((item.owner && item.owner.name) || "未知") +
      (item.stat && item.stat.view ? " · 人气 " + item.stat.view : "");
    var btn = ui.el("button", "bdm-degrade-btn", box);
    btn.type = "button";
    btn.textContent = "进入直播间";
    btn.addEventListener("click", function () {
      window.open("https://live.bilibili.com/" + item.roomid, "_blank");
    });
  }

  // 丢弃第 i 屏之后已预建的屏：列表被插入新项后，这些屏与 items 的索引对不上，必须重建
  // 单屏清理：定时器必须先停，否则退出/丢弃后它们仍在空转（统计 500ms、弹幕 120ms、字幕 200ms）
  function teardownSlide(s) {
    if (!s) return;
    s.gone = true;   // 迟到的 playurl / 弹幕 / 字幕续段据此止步（见 makeSlide）
    if (s._statsTimer) { clearInterval(s._statsTimer); s._statsTimer = null; }
    if (s.player) { try { s.player.destroy(); } catch (e) { /* ignore */ } }
  }

  function dropSlidesAfter(i) {
    for (var j = i + 1; j < slides.length; j++) {
      var s = slides[j];
      if (!s) continue;
      teardownSlide(s);
      if (s.slide && s.slide.root && s.slide.root.parentNode) s.slide.root.parentNode.removeChild(s.slide.root);
      slides[j] = null;
    }
    slides.length = i + 1;
  }

  // 进度条点击跳转：此前 CSS 写了 cursor:pointer、注释也写了「进度条点击」，
  // 但全项目没有任何处理器 —— 典型「看着能用其实不能用」的死交互。
  // 进度条拖拽。window 上只挂一对全局监听：原先每建一屏就多挂两个 window 监听，
  // 刷几百屏就是几百个常驻监听（长会话下既占内存又拖慢每次 mousemove）。
  var seekDrag = null;
  var seekWinBound = false;
  function bindSeek(rec) {
    var track = rec.slide.seek && rec.slide.seek.track;
    if (!track) return;
    function apply(clientX) {
      var player = rec.player;                 // 每次现取：这一屏可能已被回收，划回后又换了新流
      if (!player) return;
      var dur = player.duration();
      if (!dur || !isFinite(dur)) return;
      var r = track.getBoundingClientRect();
      if (!r.width) return;
      var ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      player.video.currentTime = ratio * dur;
    }
    track.addEventListener("mousedown", function (e) {
      seekDrag = { apply: apply };
      apply(e.clientX);
      e.preventDefault();
    });
    if (!seekWinBound) {
      seekWinBound = true;
      window.addEventListener("mousemove", function (e) { if (seekDrag) seekDrag.apply(e.clientX); });
      window.addEventListener("mouseup", function () { seekDrag = null; });
    }
  }

  // playurl 失败码 → 人话（B站 原始 message 直接甩给用户太生硬）
  var FAIL_HINT = {
    "-404": "视频不存在或已被删除",
    "-403": "无权限播放：可能是地区限制、会员专属或充电专属",
    "-10403": "地区限制：当前地区无法观看",
    "87007": "充电专属：需先为该 UP 主充电",
    "87008": "充电专属视频",
    "62002": "稿件不可见：可能已被设为私密",
    "62004": "稿件审核中",
    "-400": "请求被拒绝，请稍后重试",
    "-101": "未登录或登录已过期",
    "-111": "登录校验失败（csrf），请刷新页面后重试",
    "-412": "被风控拦截，请稍后再试",
    "1003212": "弹幕内容含敏感词，已被拦截"
  };
  function hintOf(msg) {
    var m = /(-?[0-9]{3,5})/.exec(String(msg || ""));
    return (m && FAIL_HINT[m[1]]) || "";
  }

  // 在线人数：只为「当前屏」取一次（B站 也是按屏显示），45 秒缓存；失败就留空。
  // 直播条目没有 bvid/cid（走降级卡），也不显示。
  var ONLINE_TTL = 45000;
  async function refreshOnline(rec) {
    var el0 = rec && rec.slide && rec.slide.ctrl && rec.slide.ctrl.online;
    if (!el0) return;
    var item = rec.item || {};
    if (item.goto === "live" || !item.bvid || !item.cid) { el0.textContent = ""; return; }
    var now = Date.now();
    if (rec.onlineAt && now - rec.onlineAt < ONLINE_TTL) { el0.textContent = rec.onlineText || ""; return; }
    rec.onlineAt = now;
    var r = await api.online(item.bvid, item.cid).catch(function () { return null; });
    if (!active || rec.gone) return;                       // 已退出/已拆的屏：迟到的结果不再写
    if (!r || !r.n) { el0.textContent = ""; rec.onlineText = ""; return; }
    rec.onlineText = ui.fmt(r.n) + "人正在看";
    el0.textContent = rec.onlineText;
  }

  async function activateSlide(i) {
    var rec = slides[i];
    if (!rec) return;
    // 换屏时把焦点从「已经划走的那一屏」的输入框收回：否则按键继续落在一个看不见的输入框上
    // （方向键被输入框守卫吞掉，用户以为键盘失灵），空格也会打到旧屏。
    var aeA = document.activeElement;
    if (aeA && aeA.tagName === "INPUT" && (!rec.slide || !rec.slide.ctrl || aeA !== rec.slide.ctrl.dmInput)) {
      try { aeA.blur(); } catch (e) { /* 忽略 */ }
    }
    // 此前被回收过（长会话省内存）：重新取流，取到后它会自己再调一次 activateSlide
    if (rec.pruned) { restoreSlide(i); return; }
    slides.forEach(function (s, j) {
      if (s && s.player && j !== i) {
        s.player.pause();
        s.player.stopDanmaku();          // 划走的屏不留 120ms 心跳（否则每划一屏永久多一个）
        s.player.stopSubtitleTimer();    // 字幕心跳同形，一并停
        s.player.setVolumeBalance(false); // 释放该屏的 Web Audio 图（否则每屏各留一个 AudioContext）
      }
    });
    if (rec.failed || !rec.loaded) return;
    rec.player.setDanmakuOn(S.get().dmEnabled);
    if (S.get().dmEnabled) rec.player.startDanmaku();
    else rec.player.stopDanmaku();
    rec.player.setDanmakuOpacity(S.get().dmOpacity);
    applyPrefs(rec);
    refreshOnline(rec);   // 在线人数（拿不到就空着）
    if (S.get().subtitleOn && rec.player.subCues.length) rec.player.setSubtitleOn(true);   // 回到本屏重新挂字幕心跳
    if (S.get().volumeBalance) rec.player.setVolumeBalance(true);                            // 当前屏才建均衡图
    rec.player.play();
    var prev = slides[i - 1];
    if (prev && prev.pruned) restoreSlide(i - 1);   // 邻屏预热：往回划一屏无需等重新取流
    pruneFar();                                     // 顺手回收离当前屏很远的屏（媒体流 + 弹幕）
  }

  // 程序化平滑滚动的保护窗口：期间不让「滚动落定」回写 idx，否则动画中途会把逻辑位置拽回旧屏
  var animUntil = 0;

  function slideH() {
    return (root && root.clientHeight) || window.innerHeight || 1;
  }

  // 诊断串：把「划不动」定位所需的关键数字一次性打出来。
  // 现场在用户浏览器里，我这边看不到 —— 让它自己报数，比来回猜测快得多。
  // 版本号取运行时 manifest，绝不与磁盘脱节 —— 用户贴日志时即可确认跑的是哪一版
  function ver() {
    try { return "v" + chrome.runtime.getManifest().version; } catch (e) { return "v?"; }
  }

  function diag() {
    if (!root) return "root=null";
    return ver() + " 屏=" + slides.filter(Boolean).length + "/" + items.length +
      " idx=" + idx + " scrollTop=" + Math.round(root.scrollTop) +
      " clientH=" + root.clientHeight + " scrollH=" + root.scrollHeight +
      " slideH=" + Math.round(slideH()) + " 子节点=" + root.children.length;
  }

  // 翻页自检：动画结束后若没落在目标屏上，说明滚动被裁切或被吞掉。
  // 正常情况下零输出；出问题时把数字与控制台对齐，一次就能定位。
  function verifyAdvance(expect) {
    setTimeout(function () {
      if (!active || !root) return;
      var got = Math.round(root.scrollTop / slideH());
      if (got === expect) return;
      var line = "[刷B站] 翻页未生效：期望屏 " + expect + " 实际 " + got + " | " + diag();
      console.warn(line);
      if (!window.__bdmWarned) {
        window.__bdmWarned = 1;
        toastLine("翻页异常，诊断已输出到控制台（F12）");
      }
    }, 460);
  }

  function currentIndex() {
    if (!root) return 0;
    return Math.max(0, Math.round(root.scrollTop / slideH()));
  }

  // 翻页只用原生滚动吸附（与 CSS scroll-snap-type 同一机制）；
  // 绝不平移 fixed 根容器，否则整个界面会被推出视口——「刷一屏就没了」的根因。
  // 滑动全路径追踪：前 6 次无条件记录，之后仅当 debug 开关打开时记录。
  // 特意覆盖「提前 return」的分支 —— 上一版自检只挂在滚动之后，busy 卡死这类
  // 静默无效根本打不出任何日志，等于盲区。
  // 输入追踪：若滚轮/按键被 B站 自身的捕获阶段监听吞掉，go() 根本不会被调用，
  // 那时任何翻页日志都不会出现 —— 必须单独记录「输入是否送达」。
  var inTrace = 0;
  function traceIn(msg) {
    inTrace += 1;
    if (inTrace <= 6) console.log("[刷B站] " + msg);
  }

  var goTrace = 0;
  function trace(msg) {
    var on = false;
    try { on = !!S.get().debug; } catch (e) { on = false; }
    if (on || goTrace <= 6) console.log("[刷B站] " + msg);
  }

  async function go(delta) {
    goTrace += 1;
    if (busy) { trace("被 busy 拦下，滑动无效 → " + diag()); return; }
    var target = idx + delta;   // 基准必须是逻辑位置：平滑滚动未落定时测量值仍是旧屏，会卡在同一屏刷不动
    if (target < 0) { trace("已在首屏，忽略向上"); return; }
    if (target >= items.length) {
      trace("需要续接内容：target=" + target + " items=" + items.length + " → " + diag());
      busy = true;
      var grew = await extendFeed();
      busy = false;
      if (target >= items.length) {
        trace("续接后仍无新内容，放弃翻页 → " + diag());
        if (!grew) toastLine("加载更多失败，请稍后重试");
        return;
      }
    }
    idx = target;
    closeCtx();   // 换屏时收起右键菜单（菜单属于上一屏）
    // 关键：只同步建节点（makeSlide 的 DOM 插入发生在它第一个 await 之前），**绝不 await 网络**。
    // 一旦 await 到挂住的 playurl，go() 就走不到 scrollTo —— 表现正是「刷两下就卡住」。
    ensureSlides(idx + 2);
    activateSlide(idx);
    animUntil = Date.now() + 800;
    root.scrollTo({ top: idx * slideH(), behavior: "smooth" });
    trace("滑动 → 目标屏 " + idx + " top=" + Math.round(idx * slideH()) + " → " + diag());
    verifyAdvance(idx);
  }

  // ---------- 控件自动隐藏（B站 桌面版同款：闲置 3 秒且正在播放时淡出底栏）----------
  var idleTimer = null, idleHidden = false;
  function chromeHide(on) {
    if (idleHidden === on) return;
    idleHidden = on;
    if (root) root.classList.toggle("bdm-idle", on);
  }
  function pokeChrome() {
    chromeHide(false);
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (!active || !root) return;
      var rec = slides[idx];
      if (!rec || !rec.slide) return;
      if (rec.slide._menu) return;                                        // 弹层菜单展开中不隐藏
      // 注意：评论面板展开时 display 为 flex（见 toggleComments），不是 block
      if (rec.slide.panel && rec.slide.panel.style.display !== "none") return;
      if (rec.slide.seasonList && rec.slide.seasonList.style.display !== "none") return;   // 合集列表展开中
      if (rec.slide.dmPanel && rec.slide.dmPanel.isOpen()) return;                          // 设置面板展开中
      if (rec.slide.setPanel && rec.slide.setPanel.isOpen()) return;
      if (rec.slide.ctxMenu && rec.slide.ctxMenu.isOpen()) return;                          // 右键菜单展开中
      var ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;    // 正在输入不隐藏
      var v = rec.player && rec.player.video;
      if (v && !v.paused) chromeHide(true);                               // 暂停时保留控件（与 B站 一致）
    }, 3000);
  }

  // 手势：滚轮 / 触摸 / 键盘 / 进度条点击
  var lastWheel = 0;
  // 全局监听（window/document）**一生只绑一次**：它们不属于某一次会话，而 exit() 也从不摘除。
  // 此前每次 enter() 都重绑一遍 —— 进/出几轮后 document 上堆了 N 份同一个键盘处理器，
  // 实测第 15 次进入时按一次 ↓ 直接跳了 11 屏（真机表现：入口点几次之后方向键「疯了」）。
  var gestureBound = false;
  function bindGlobalGestures() {
    window.addEventListener("mousemove", pokeChrome, { passive: true });
    window.addEventListener("pointerdown", pokeChrome, { passive: true });
    document.addEventListener("fullscreenchange", syncFullIcon);
    document.addEventListener("webkitfullscreenchange", syncFullIcon);
    // 右键长按倍速的收尾与设置面板的跨模块生效
    window.addEventListener("mouseup", longpressEnd);
    document.addEventListener("click", closeCtx);                    // 点空白处收起右键菜单
    document.addEventListener("bdm:settings-changed", function () {
      if (!active) return;
      var rec = slides[idx];
      if (rec) applyPrefs(rec);
    });
    // 挂在 window 的**捕获阶段**：这是事件流中最早的一站。
    // 之前挂在 root 冒泡阶段，B站 页面自身的捕获监听一旦 stopPropagation，
    // 我们连事件都收不到 —— 现场表现就是「能划动但控制台一条日志都没有」。
    window.addEventListener("wheel", function (e) {
      if (!active) return;
      e.preventDefault();
      traceIn("收到滚轮 deltaY=" + Math.round(e.deltaY));
      var now = Date.now();
      if (now - lastWheel < 550) return;
      lastWheel = now;
      go(e.deltaY > 0 ? 1 : -1);
    }, { capture: true, passive: false });


    document.addEventListener("keydown", function (e) {
      if (!active) return;
      // 在输入框/滑块里按键不应翻页：否则空格会一边打字一边暂停，方向键会一边调音量一边换屏
      var tn = e.target && e.target.tagName;
      if (tn === "INPUT" || tn === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") traceIn("收到按键 " + e.key);
      if (e.key === "ArrowDown") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); go(-1); }
      else if (e.key === "Escape") { if (!closeCtx()) exit(); }   // 先收菜单，再退沉浸
      else if (e.key === " ") {
        e.preventDefault();
        var rec = slides[idx];
        if (rec && rec.player) {
          if (rec.player.video.paused) rec.player.play(); else rec.player.pause();
        }
      }
    });
  }

  // root 级监听：root 每次 enter() 都是新节点、随它被移除而消失，所以每次会话都绑一遍。
  function bindSessionGestures() {
    root.addEventListener("scroll", function () { closeCtx(); }, { passive: true });
    // 触摸交给原生 scroll-snap（自带惯性与吸附），不再自算位移，避免双重滚动
    var settleTimer = null;
    root.addEventListener("scroll", function () {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        if (!active || !root) return;
        if (Date.now() < animUntil) return;   // 自家平滑滚动尚未结束，不回写
        var i = currentIndex();
        if (i === idx) return;
        idx = i;
        // 这里原先是 makeSlide(idx) —— 只建当前屏，不预建后面的屏。
        // 于是当滚动由**原生滚轮/滚动条/触控板**驱动时（我们的 wheel 处理器没拿到事件），
        // DOM 高度永远只够到当前屏，再往下 scrollTo 就被裁切：划到第 3 条就再也动不了。
        // 改用 ensureSlides 向前预建，原生路径与自定义路径都能无限下滑。
        ensureSlides(idx + 2);
        activateSlide(idx);
      }, 140);
    }, { passive: true });
  }

  function bindGestures() {
    if (!gestureBound) { gestureBound = true; bindGlobalGestures(); }
    bindSessionGestures();
  }

  // 操作栏点击 → 显式互动（用户主动，不受 profileGuard 影响）
  function bindActions(rec) {
    var rail = rec.slide.rail;
    rail.querySelector(".bdm-btn-like").addEventListener("click", function () { doLike(rec); });
    rail.querySelector(".bdm-btn-coin").addEventListener("click", function () {
      if (allowExplicit()) window.__BDM__.dialogs.coin(rec.item);
    });
    rail.querySelector(".bdm-btn-triple").addEventListener("click", function () { doTriple(rec); });
    rail.querySelector(".bdm-btn-fav").addEventListener("click", function () {
      if (allowExplicit()) window.__BDM__.dialogs.fav(rec.item);
    });
    rail.querySelector(".bdm-btn-share").addEventListener("click", function () { window.__BDM__.dialogs.share(rec.item); });
    rail.querySelector(".bdm-btn-down").addEventListener("click", function () { window.__BDM__.dialogs.download(rec.item); });
    rail.querySelector(".bdm-btn-dislike").addEventListener("click", function () {
      if (allowExplicit()) window.__BDM__.dialogs.dislike(rec);
    });
    bindControls(rec);
    bindSeason(rec);
  }

  // ---------- 底部控制条（B站 式）----------
  var SVG_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  var SVG_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  var SVG_FULL = '<svg viewBox="0 0 24 24"><path d="M4 4h6.2v2.2H6.2V10H4zM13.8 4H20v6h-2.2V6.2h-4zM4 14h2.2v3.8H10V20H4zM17.8 14H20v6h-6v-2.2h3.8z"/></svg>';
  var SVG_FULL_EXIT = '<svg viewBox="0 0 24 24"><path d="M10 4h2.2v6H4V7.8h6zM14 4h2v3.8h6V10h-8zM4 14h6v6H7.8v-3.8H4zM14 14h8v2.2h-6V20h-2z"/></svg>';
  var RATE_STEPS = [2, 1.5, 1.25, 1, 0.75, 0.5];
  var QN_NAME = { 127: "4K", 126: "杜比", 125: "HDR", 120: "4K", 116: "1080P60", 112: "1080P+", 100: "智能修复", 80: "1080P", 74: "720P60", 64: "720P", 32: "480P", 16: "360P" };
  function qnName(q) { return QN_NAME[q] || (q + "P"); }
  function pad2(n) { return String(n).padStart(2, "0"); }
  // B站 桌面版时间格式：不足 1 小时为 mm:ss（分钟补零），超过 1 小时为 h:mm:ss
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
    return (h ? h + ":" + pad2(m) : pad2(m)) + ":" + pad2(r);
  }
  // B站 档位名自带前缀（高清 1080P / 超清 4K），按钮与菜单只留短名
  function qnShort(name, qn) {
    var s = String(name || "").replace(/^(超清|高清|清晰|流畅)\s*/, "");
    return s || qnName(qn);
  }
  function qnLabel(p, q) {
    var hit = ((p && p.list) || []).filter(function (x) { return x.qn === q; })[0];
    return hit ? qnShort(hit.name, q) : qnName(q);
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  function bindControls(rec) {
    var built = rec.slide, c = built.ctrl, player = rec.player;
    c.play.addEventListener("click", function () { player.toggle(); });
    c.volRange.value = String(Math.round((Number(S.get().volume) || 0.7) * 100));
    c.volRange.addEventListener("input", function () {
      var v = Number(c.volRange.value) / 100;
      player.setVolume(v);
      S.saveSettings({ volume: v });
    });
    c.dm.classList.toggle("bdm-on", !!S.get().dmEnabled);
    c.dm.addEventListener("click", function () {
      var on = !S.get().dmEnabled;
      S.saveSettings({ dmEnabled: on });
      c.dm.classList.toggle("bdm-on", on);
      if (rec === slides[idx]) {
        player.setDanmakuOn(on);
        if (on) player.startDanmaku(); else player.stopDanmaku();
      }
    });
    // 发送按钮：与回车同一条路径（B站 操作条两者并存）
    c.dmSend.addEventListener("click", function () { sendDanmaku(rec); });
    // 弹幕礼仪：打开 B站 自己的规则页（地址来自它的 bundle，已验证 200）
    if (c.etq) c.etq.addEventListener("click", function () {
      window.open("https://www.bilibili.com/blackboard/help.html#/?qid=359&pid=357", "_blank");
    });
    c.qn.addEventListener("click", function () { openQnMenu(rec); });
    c.rate.addEventListener("click", function () { openRateMenu(rec); });
    c.cc.addEventListener("click", function () { openSubMenu(rec); });
    c.cmt.addEventListener("click", function () { toggleComments(rec); });

    // 「下一集」在沉浸流里就是下一屏
    c.next.addEventListener("click", function () { if (rec === slides[idx]) go(1); });

    // 全屏：真实调用 Fullscreen API（图标随全屏状态切换，见 syncFullIcon）
    c.full.addEventListener("click", function () { toggleFullscreen(); });

    // 弹幕设置面板 / 播放器设置面板 / 宽屏 / 画中画
    c.dmSet.addEventListener("click", function () { openDmPanel(rec); });
    c.set.addEventListener("click", function () { openSetPanel(rec); });
    c.pip.addEventListener("click", function () { togglePip(rec); });
    c.wide.addEventListener("click", function () {
      var on = !S.get().wideMode;
      S.saveSettings({ wideMode: on });
      rec.player.setWide(on);
      toastLine(on ? "宽屏铺满（裁切）" : "已恢复完整画面");
    });
    built.dmPanel.closeBtn.addEventListener("click", function () { closePanels(built); });
    built.setPanel.closeBtn.addEventListener("click", function () { closePanels(built); });
    built.descPanel.closeBtn.addEventListener("click", function () { closePanels(built); });
    if (built.more) built.more.addEventListener("click", function () { openDescPanel(rec); });
    // 右键：屏蔽浏览器菜单；开启「右键长按倍速」时按住＝3 倍速，轻点＝弹出播放器菜单
    player.video.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    player.video.addEventListener("mousedown", function (e) {
      if (e.button !== 2) return;
      rcAt = Date.now();
      if (S.get().longpressRate) longpressStart(rec, e);
    });
    player.video.addEventListener("mouseup", function (e) {
      if (e.button !== 2) return;
      var held = Date.now() - rcAt;
      if (S.get().longpressRate) longpressEnd();
      if (!S.get().longpressRate || held < 300) openCtxMenu(rec, e.clientX || 0, e.clientY || 0);
    });

    // 弹幕输入框：B站 桌面版操作条同款入口。回车即发（走 /x/v2/dm/post，纯用户显式操作）；
    // 失败时如实报因并保留内容，另给「复制 + 打开原页」的出口。
    c.dmInput.addEventListener("keydown", function (e) {
      e.stopPropagation();   // 空格/方向键不许穿透到信息流
      if (e.key === "Enter") { e.preventDefault(); sendDanmaku(rec); }
      else if (e.key === "Escape") c.dmInput.blur();
    });

    built.panel.querySelector(".bdm-panel-close").addEventListener("click", function () { toggleComments(rec, true); });
    built.panel.querySelector(".bdm-panel-foot").addEventListener("click", function () {
      window.open("https://www.bilibili.com/video/" + rec.item.bvid, "_blank");
    });
  }

  // ---------- 全屏 / 弹幕设置 / 弹幕入口出口 ----------
  function toggleFullscreen() {
    var d = document;
    var el0 = d.fullscreenElement || d.webkitFullscreenElement;
    try {
      if (el0) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen).call(d.documentElement);
    } catch (e) {
      toastLine("全屏切换失败：" + String(e.message || e));
    }
  }
  function syncFullIcon() {
    var rec = slides[idx];
    if (!rec || !rec.slide || !rec.slide.ctrl || !rec.slide.ctrl.full) return;
    var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    rec.slide.ctrl.full.innerHTML = on ? SVG_FULL_EXIT : SVG_FULL;
    rec.slide.ctrl.full.title = on ? "退出全屏" : "全屏";
  }
  // ---------- 弹幕设置面板（照搬 B站：显示区域/不透明度/字号/速度/密度/屏蔽词/字体/类型 + 清屏·重置）----------
  var DM_AREA = [{ label: "全屏", val: "full" }, { label: "上半部分", val: "top" }, { label: "下半部分", val: "bottom" }, { label: "1/4屏", val: "half" }];
  var DM_OPACITY = [{ label: "100%", val: 1 }, { label: "75%", val: 0.75 }, { label: "50%", val: 0.5 }, { label: "25%", val: 0.25 }];
  var DM_FONT = [{ label: "超小", val: 12 }, { label: "小", val: 16 }, { label: "中", val: 20 }, { label: "大", val: 24 }, { label: "超大", val: 28 }];
  var DM_SPEED = [{ label: "慢", val: 4 }, { label: "中", val: 8 }, { label: "快", val: 12 }, { label: "极快", val: 16 }];
  var DM_DENSITY = [{ label: "低", val: 1 }, { label: "中", val: 2 }, { label: "高", val: 3 }];
  var DM_FAMILY = [{ label: "默认", val: "" }, { label: "黑体", val: '"Microsoft YaHei", 黑体, sans-serif' },
    { label: "宋体", val: '"SimSun", 宋体, serif' }, { label: "圆体", val: '"PingFang SC", 圆体, sans-serif' }];
  var DM_DEFAULT = { dmArea: "full", dmOpacity: 0.8, dmFont: 20, dmSpeed: 8, dmDensity: 2,
    dmScroll: true, dmTop: true, dmBottom: true, dmFontFamily: "", dmBlock: [] };
  var isCur = function (a, b) { return String(a) === String(b); };

  // 设置项改动后统一走这里：落盘 → 立即作用到播放器 → 重建面板刷新选中态
  function applyPrefs(rec) {
    var st = S.get(), pl = rec && rec.player;
    if (!pl) return;
    pl.setDanmakuOpacity(st.dmOpacity);
    pl.applyDmSettings();
    pl.setMirror(!!st.mirror);
    pl.setAspect(st.videoAspect);
    pl.setLoop(!!st.singleLoop || !!st.loop);
    pl.setRotate(Number(st.videoRotate) || 0);
    pl.setBright(Number(st.videoBright) || 100);
    pl.setContrast(Number(st.videoContrast) || 100);
    pl.setSaturate(Number(st.videoSaturate) || 100);
    pl.setWide(!!st.wideMode);
  }
  function closePanels(slide) {
    if (!slide) return;
    if (slide.dmPanel) slide.dmPanel.show(false);
    if (slide.setPanel) slide.setPanel.show(false);
    if (slide.descPanel) slide.descPanel.show(false);
    closeMenu(slide);
  }
  function buildDmPanel(rec) {
    var p = rec.slide.dmPanel, st = S.get();
    p.label("弹幕设置");
    p.clear();
    function save(patch) { S.saveSettings(patch); applyPrefs(rec); buildDmPanel(rec); }
    function radio(col, title, list, key) {
      var g = p.group(col, title);
      p.radios(g, list.map(function (x) { return { label: x.label, val: x.val, on: isCur(x.val, st[key]) }; }),
        function (v) { var patch = {}; patch[key] = v; save(patch); });
    }
    radio(p.left, "显示区域", DM_AREA, "dmArea");
    radio(p.left, "不透明度", DM_OPACITY, "dmOpacity");
    radio(p.left, "弹幕字号", DM_FONT, "dmFont");
    radio(p.left, "弹幕速度", DM_SPEED, "dmSpeed");
    radio(p.left, "弹幕密度", DM_DENSITY, "dmDensity");
    var gb = p.group(p.left, "弹幕观看屏蔽词");
    p.block(gb, "输入后回车添加", function (w) {
      var list = (S.get().dmBlock || []).slice();
      if (list.indexOf(w) < 0) list.push(w);
      save({ dmBlock: list });
      toastLine("已屏蔽：" + w);
    });
    p.words(gb, st.dmBlock || [], function (w) {
      save({ dmBlock: (S.get().dmBlock || []).filter(function (x) { return x !== w; }) });
    });
    radio(p.right, "弹幕字体", DM_FAMILY, "dmFontFamily");
    var gt = p.group(p.right, "弹幕类型");
    p.switches(gt, [
      { label: "滚动", key: "dmScroll", on: st.dmScroll !== false },
      { label: "顶部", key: "dmTop", on: st.dmTop !== false },
      { label: "底部", key: "dmBottom", on: st.dmBottom !== false }
    ], function (key, val) { var patch = {}; patch[key] = val; save(patch); });
    p.action("清屏", function () {
      rec.player.clearScreen();
      toastLine("清屏成功");
    });
    p.action("重置", function () {
      S.saveSettings(DM_DEFAULT);
      applyPrefs(rec);
      buildDmPanel(rec);
      toastLine("已恢复默认弹幕设置");
    });
  }
  // 简介（v0.1.24 点名要的「简介」）：B站 桌面版点标题展开简介，抖音也是点标题看简介 ——
  // 这里给一个明确入口（信息块里的「简介」胶囊）。数据按需取：一个 view 请求就带回
  // 简介正文、发布时间、UP、分P、合集名；取到后缓存在这一屏上，再点开不再打网络。
  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
    if (n >= 10000) return (n / 10000).toFixed(1) + "万";
    return String(n);
  }
  async function openDescPanel(rec) {
    var p = rec.slide.descPanel;
    var was = p.isOpen();
    closePanels(rec.slide);
    rec.slide.seasonList.style.display = "none";   // 与合集列表同位同尺寸，互斥（否则两个面板叠在一起）
    if (was) return;                       // 再点一次 = 收起
    p.label("简介");
    p.show(true);
    var info = rec.desc;
    if (!info) {
      p.clear();
      ui.el("div", "bdm-desc-text", p.group(p.left, "视频信息")).textContent = "加载中…";
      // 合集徽标那条路径已经取过一次 view（见 bindSeason），能复用就不重复请求
      var j = rec.view || null;
      if (!j) { try { j = await api.view(rec.item.bvid); } catch (e) { j = null; } }
      if (j) rec.view = j;
      if (!p.isOpen()) return;             // 加载期间用户已收起
      if (!j) {
        p.clear();
        ui.el("div", "bdm-desc-empty", p.group(p.left, "视频信息")).textContent = "简介加载失败，可点下面的按钮去原页查看";
        p.action("打开原页", function () { window.open("https://www.bilibili.com/video/" + rec.item.bvid, "_blank"); });
        return;
      }
      info = {
        desc: String(j.desc || "").trim(),
        pubdate: j.pubdate || 0,
        stat: j.stat || {},
        ownerName: (j.owner && j.owner.name) || (rec.item.owner && rec.item.owner.name) || "",
        pages: (j.pages || []).length || 1,
        season: (j.ugc_season && j.ugc_season.title) || ""
      };
      rec.desc = info;                     // 缓存：这一屏再点开不再打网络
    }
    p.clear();
    var st = info.stat || {};
    var body = p.group(p.left, "视频信息");
    [
      "UP主：" + (info.ownerName || "未知"),
      "发布：" + (info.pubdate ? new Date(info.pubdate * 1000).toLocaleDateString() : "未知"),
      "数据：" + fmtNum(st.view) + " 播放 · " + fmtNum(st.danmaku) + " 弹幕 · " + fmtNum(st.like) + " 点赞",
      info.pages > 1 ? "分P：" + info.pages + " 个" : "",
      info.season ? "合集：" + info.season : ""
    ].forEach(function (t) { if (t) ui.el("div", "bdm-desc-kv", body).textContent = t; });
    var dg = p.group(p.left, "简介正文");
    if (info.desc) ui.el("div", "bdm-desc-text", dg).textContent = info.desc;
    else ui.el("div", "bdm-desc-empty", dg).textContent = "该稿件没有填写简介";
    p.action("复制简介", function () {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(info.desc || "").then(function () { toastLine("简介已复制"); }, function () { toastLine("复制失败"); });
          return;
        }
      } catch (e) { /* 剪贴板不可用 */ }
      toastLine("复制失败");
    });
    p.action("打开原页", function () { window.open("https://www.bilibili.com/video/" + rec.item.bvid, "_blank"); });
  }

  function openDmPanel(rec) {
    var p = rec.slide.dmPanel;
    var was = p.isOpen();
    closePanels(rec.slide);
    if (was) return;                       // 再点一次 = 收起
    buildDmPanel(rec);
    p.show(true);
  }

  // ---------- 播放器设置面板（照搬 B站 ctrl-setting：自动连播/单集循环/镜像/比例/右键长按倍速）----------
  var ASPECT = [{ label: "默认", val: "default" }, { label: "16:9", val: "16:9" }, { label: "4:3", val: "4:3" },
    { label: "21:9", val: "21:9" }, { label: "填充", val: "fill" }];
  function buildSetPanel(rec) {
    var p = rec.slide.setPanel, st = S.get();
    p.label("设置");
    p.clear();
    function save(patch) { S.saveSettings(patch); applyPrefs(rec); buildSetPanel(rec); }
    var g1 = p.group(p.left, "播放设置");
    p.switches(g1, [
      { label: "自动连播", key: "autoplayNext", on: st.autoplayNext !== false },
      { label: "单集循环", key: "singleLoop", on: !!st.singleLoop },
      { label: "镜像画面", key: "mirror", on: !!st.mirror },
      { label: "宽屏铺满", key: "wideMode", on: !!st.wideMode },
      { label: "右键长按倍速", key: "longpressRate", on: !!st.longpressRate }
    ], function (key, val) { var patch = {}; patch[key] = val; save(patch); });
    var g3 = p.group(p.left, "声音");
    p.switches(g3, [{ label: "音量均衡", key: "volumeBalance", on: !!st.volumeBalance }], function (key, val) {
      var ok = rec.player.setVolumeBalance(val);
      if (val && !ok) {
        // 建不起 Web Audio 图就如实回退，不留一个「打开了但没效果」的开关
        S.saveSettings({ volumeBalance: false });
        toastLine("当前环境不支持音量均衡");
      } else {
        S.saveSettings({ volumeBalance: val });
        toastLine(val ? "音量均衡已开启" : "已关闭音量均衡");
      }
      buildSetPanel(rec);
    });
    var g2 = p.group(p.right, "视频比例");
    p.radios(g2, ASPECT.map(function (x) { return { label: x.label, val: x.val, on: isCur(x.val, st.videoAspect) }; }),
      function (v) { save({ videoAspect: v }); });
    // 编码：只列本稿件真实存在的轨（rec.codecs 来自 playurl，没有就不给死选项）
    var have = rec.codecs;
    var codecList = [{ label: "自动", val: "auto" }, { label: "AVC", val: "avc" }, { label: "HEVC", val: "hevc" }, { label: "AV1", val: "av1" }]
      .filter(function (c) { return c.val === "auto" || !have || have[c.val]; });
    var g4 = p.group(p.right, "编码");
    p.radios(g4, codecList.map(function (c) { return { label: c.label, val: c.val, on: isCur(c.val, st.videoCodec) }; }),
      function (v) { S.saveSettings({ videoCodec: v }); buildSetPanel(rec); refetchStream(rec, "编码已切换：" + v); });
    if (st.videoCodec && st.videoCodec !== "auto" && rec.mode === "mp4") {
      // 当前若不是 DASH 播放，明确告知该偏好的生效条件（避免「设了却看不出」的困惑）
      var hint = p.group(p.right, "编码生效条件");
      ui.el("div", "bdm-set-empty", hint).textContent = "仅 DASH 档位（1080P+/4K）生效，mp4 固定 avc";
    }
    function colorRow(title, key) {
      var g = p.group(p.right, title);
      p.radios(g, [50, 75, 100, 125, 150].map(function (x) { return { label: x + "%", val: x, on: Number(st[key]) === x }; }),
        function (v) { var patch = {}; patch[key] = v; save(patch); });
    }
    colorRow("亮度", "videoBright");
    colorRow("对比度", "videoContrast");
    colorRow("饱和度", "videoSaturate");
  }
  function openSetPanel(rec) {
    var p = rec.slide.setPanel;
    var was = p.isOpen();
    closePanels(rec.slide);
    if (was) return;
    buildSetPanel(rec);
    p.show(true);
  }

  // ---------- 字幕（用 B站 原生字幕轨：页面数据优先，接口兜底）----------
  function pageSubtitle(bvid) {
    // 只有当前屏就是页面这一条时页面数据才可信（沉浸流里两者常常不是同一条）
    try {
      var st = window.__INITIAL_STATE__;
      if (!st || !st.videoData || st.videoData.bvid !== bvid) return null;
      var sub = st.videoData.subtitle || {};
      var raw = sub.list;
      if (!Array.isArray(raw) && sub.subtitles && !Array.isArray(sub.subtitles)) {
        raw = Object.keys(sub.subtitles).map(function (k) { return sub.subtitles[k]; });
      }
      var list = api.normalizeSubs(raw);
      return list.length ? list : null;
    } catch (e) { return null; }
  }
  async function subTracks(rec) {
    if (rec.subTracks) return rec.subTracks;
    var list = pageSubtitle(rec.item.bvid);
    if (!list) list = (await api.subtitles(rec.item.bvid, rec.item.cid)).list || [];
    rec.subTracks = list;
    return list;
  }
  async function pickSubtitle(rec, track, silent) {
    try {
      var cues = await api.subtitleBody(track.url);
      if (!cues.length) { if (!silent) toastLine("字幕内容为空"); return false; }
      rec.player.setSubtitleCues(cues);
      rec.player.setSubtitleOn(true);
      S.saveSettings({ subtitleOn: true, subtitleLan: track.lan });
      return true;
    } catch (e) {
      if (!silent) toastLine("字幕加载失败：" + (hintOf(String(e.message || e)) || String(e.message || e)));
      return false;
    }
  }
  async function loadSubtitle(rec, lan, silent) {
    var list = await subTracks(rec).catch(function () { return []; });
    if (!list.length) { if (!silent) toastLine("该视频没有字幕"); return false; }
    var hit = null;
    for (var i = 0; i < list.length; i++) if (list[i].lan === lan) { hit = list[i]; break; }
    return await pickSubtitle(rec, hit || list[0], silent);
  }
  function openSubMenu(rec) {
    subTracks(rec).then(function (list) {
      var cur = S.get().subtitleOn ? String(S.get().subtitleLan || "") : "";
      var items = list.map(function (t) {
        return { label: t.doc || t.lan, lan: t.lan, on: !!cur && t.lan === cur, track: t };
      });
      if (!items.length) items.push({ label: "该视频没有字幕", lan: "", none: true });
      items.push({ label: "关闭", lan: "", off: true, on: !cur });
      popMenu(rec.slide, items, function (it) {
        if (it.none) return;
        if (it.off) {
          rec.player.setSubtitleOn(false);
          S.saveSettings({ subtitleOn: false });
          toastLine("已关闭字幕");
          return;
        }
        pickSubtitle(rec, it.track, false).then(function (ok) {
          if (ok) toastLine("字幕：" + (it.track.doc || it.track.lan));
        });
      });
    }).catch(function () { toastLine("字幕信息获取失败"); });
  }

  // ---------- 画中画 / 右键长按倍速 ----------
  function togglePip(rec) {
    var d = document, v = rec.player.video;
    try {
      if (d.pictureInPictureElement) { (d.exitPictureInPicture || function () {}).call(d); return; }
      if (!v.requestPictureInPicture) { toastLine("当前浏览器不支持画中画"); return; }
      var r = v.requestPictureInPicture();
      if (r && r.catch) r.catch(function () { toastLine("画中画开启失败"); });
    } catch (e) { toastLine("画中画开启失败：" + String(e.message || e)); }
  }
  var lpSaved = null, lpRec = null, rcAt = 0;
  function longpressStart(rec, e) {
    if (!S.get().longpressRate) return;
    lpRec = rec;
    lpSaved = rec.player ? rec.player.rate() : null;
    if (rec.player) rec.player.setRate(3);
    e.preventDefault();
  }
  function longpressEnd() {
    if (lpSaved == null) return;
    // 必须恢复到**发起长按的那一屏**：按住期间滑到下一屏时，原实现恢复的是当前屏 ——
    // 结果原屏永久停在 3 倍速（松手也回不来）。
    var rec = lpRec;
    lpRec = null;
    if (rec && rec.player) rec.player.setRate(lpSaved);
    lpSaved = null;
  }

  // ---------- 右键菜单内容（照搬 B站 播放器右键菜单：开关 + 二级子菜单 + 统计/复制/反馈）----------
  function ctxItems(rec) {
    var st = S.get(), pl = rec.player;
    function save(patch) { S.saveSettings(patch); applyPrefs(rec); }
    function sw(label, key) {
      return { label: label, type: "switch", on: !!st[key],
        onPick: function () { var p = {}; p[key] = !st[key]; save(p); } };
    }
    function sub(label, list, key) {
      return { label: label, children: list.map(function (x) {
        return { label: x.label, on: isCur(x.val, st[key]),
          onPick: function () { var p = {}; p[key] = x.val; save(p); } };
      }) };
    }
    return [
      sw("循环播放", "loop"),
      sw("单集循环", "singleLoop"),
      sw("自动连播", "autoplayNext"),
      sw("镜像画面", "mirror"),
      sw("右键长按倍速", "longpressRate"),
      sub("视频比例", ASPECT, "videoAspect"),
      sub("画面旋转", [{ label: "0°", val: 0 }, { label: "90°", val: 90 }, { label: "180°", val: 180 }, { label: "270°", val: 270 }], "videoRotate"),
      sub("画面亮度", [50, 75, 100, 125, 150].map(function (v) { return { label: v + "%", val: v }; }), "videoBright"),
      { label: "清屏", onPick: function () { pl.clearScreen(); toastLine("清屏成功"); } },
      { label: "视频统计信息", onPick: function () { showStats(rec); } },
      // 详情页：从沉浸流跳到 B站 的稿件详情页（直播条目没有 bvid，改开直播间）
      { label: "详情页", onPick: function () { openItemPage(rec); } },
      { label: "复制视频地址（精准空降）", onPick: function () { copyTimeLink(rec); } },
      { label: "举报 / 反馈", onPick: function () { window.open("https://www.bilibili.com/video/" + rec.item.bvid, "_blank"); } }
    ];
  }
  // 详情页：普通稿件 = B站 稿件详情页（/video/BV…，与 view 接口同一个「详情」语义）。
  // 直播分支是**防御性**的：直播那屏的播放器已被降级卡取代，右键盘菜单在这类屏上打不开，
  // 所以实践中走不到这里；保留它是因为入口若将来扩到别处，语义仍然正确。
  function openItemPage(rec) {
    var it = (rec && rec.item) || {};
    if (it.goto === "live" && it.roomid) { window.open("https://live.bilibili.com/" + it.roomid, "_blank"); return; }
    if (!it.bvid) { toastLine("该条目没有可打开的页面"); return; }
    window.open("https://www.bilibili.com/video/" + it.bvid, "_blank");
  }

  function openCtxMenu(rec, x, y) {
    var m = rec.slide.ctxMenu;
    if (!m) return;
    closePanels(rec.slide);
    m.open(x, y, ctxItems(rec));
  }
  function closeCtx() {
    var any = false;
    slides.forEach(function (s) {
      if (s && s.slide && s.slide.ctxMenu && s.slide.ctxMenu.isOpen()) { s.slide.ctxMenu.close(); any = true; }
    });
    return any;
  }
  // 视频统计信息：B站 右键菜单同款入口，数据取自 <video> 与弹幕队列
  function showStats(rec) {
    var slide = rec.slide;
    if (slide._stats) {
      slide._stats.remove(); slide._stats = null;
      if (slide._statsTimer) { clearInterval(slide._statsTimer); slide._statsTimer = null; }
      return;
    }
    var v = rec.player.video;
    var box = ui.el("div", "bdm-stats", slide.root);   // 注意：rec.slide 是 UI 句柄对象，DOM 根在 .root
    slide._stats = box;
    function line() {
      var b = v.buffered, buf = (b && b.length) ? (b.end(b.length - 1) - (v.currentTime || 0)) : 0;
      var drop = 0;
      try { drop = (v.getVideoPlaybackQuality && v.getVideoPlaybackQuality().droppedVideoFrames) || 0; } catch (e) { drop = 0; }
      box.innerHTML = "";
      [["分辨率", (v.videoWidth || 0) + "×" + (v.videoHeight || 0)],
       ["清晰度", slide.ctrl.qn.textContent],
       ["音量", Math.round((v.volume || 0) * 100) + "%" + (v.muted ? "（静音·DASH）" : "")],
       ["倍速", rec.player.rate() + "x"],
       ["缓冲", buf.toFixed(1) + "s"],
       ["丢帧", String(drop)],
       ["弹幕", (S.get().dmEnabled ? "开" : "关") + " " + rec.player.dmSent + "/" + rec.player.dmList.length]
      ].forEach(function (kv) {
        var row = ui.el("div", "bdm-stats-row", box);
        ui.el("span", "bdm-stats-k", row).textContent = kv[0];
        ui.el("span", "bdm-stats-v", row).textContent = kv[1];
      });
    }
    line();
    slide._statsTimer = setInterval(line, 500);
    toastLine("视频统计信息已开启，再点一次关闭");
  }
  // 复制「精准空降」链接：带当前播放秒数，与 B站 右键项同名同义
  function copyTimeLink(rec) {
    var url = "https://www.bilibili.com/video/" + rec.item.bvid + "?t=" + Math.floor(rec.player.currentTime() || 0);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toastLine("已复制：" + url); }, function () { toastLine(url); });
        return;
      }
    } catch (e) { /* 剪贴板不可用则直接显示 */ }
    toastLine(url);
  }

  // 发弹幕：B站 网页版操作条同款行为（回车即发）。写操作一律由「用户按下回车」触发，
  // 与点赞/投币同一门槛；成败都如实回报，失败时把内容还给用户，绝不假装成功。
  async function sendDanmaku(rec) {
    var box = rec.slide.ctrl.dmInput;
    var txt = String(box.value || "").trim();
    if (!txt) { toastLine("请输入弹幕内容"); return; }
    // 请求还在飞的时候再触发一次（连点「发送」、连按回车、按住回车不放）不该刷出成对的弹幕：
    // 此前两条一模一样地进了服务端，而按钮旁没有任何提示 —— 这是重复副作用，不是观感问题。
    if (rec.dmSending) { toastLine("正在发送，请稍候"); return; }
    if (!allowExplicit()) return;                                          // 与点赞/投币同一个总闸
    if (!api.isLogin()) { toastLine("请先在 B 站登录后再发弹幕"); return; }   // 内容留在框里
    var ms = Math.round((rec.player ? rec.player.currentTime() : 0) * 1000);
    rec.dmSending = true;
    markSending(rec, true);
    var j = null;
    try { j = await api.dmPost(rec.item, txt, ms); } catch (e) { j = null; }
    rec.dmSending = false;
    markSending(rec, false);
    if (j && j.code === 0) {
      box.value = "";
      toastLine("弹幕已发送 · " + fmtTime(ms / 1000));   // 告诉用户它落在哪一秒，便于核对
      return;
    }
    var why = (j && (hintOf(String(j.code)) || j.message)) || "网络异常";
    toastLine("发送失败：" + why);
    dmCopyExit(rec, txt);
  }

  // 发送中：按钮变暗且不吃点击 —— 与真实状态一致，而不是静默忽略第二次点击
  function markSending(rec, on) {
    var b = rec.slide && rec.slide.ctrl && rec.slide.ctrl.dmSend;
    if (b) b.classList[on ? "add" : "remove"]("bdm-sending");
  }

  // 内容不丢的出口：复制到剪贴板并打开 B站 原页，用户可直接粘贴发送
  function dmCopyExit(rec, txt) {
    var url = "https://www.bilibili.com/video/" + rec.item.bvid;
    function fallback() { toastLine("内容已保留，可在 B站 原页发送"); window.open(url, "_blank"); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () {
          toastLine("内容已复制，可在 B站 原页粘贴发送");
          window.open(url, "_blank");
        }, fallback);
        return;
      }
    } catch (e) { /* 剪贴板不可用 → 直接给出口 */ }
    fallback();
  }

  function closeMenu(built) {
    if (built._menu) { built._menu.remove(); built._menu = null; }
    if (built._menuAway) { document.removeEventListener("click", built._menuAway); built._menuAway = null; }
  }
  function popMenu(built, items, onPick) {
    closeMenu(built);
    var m = ui.el("div", "bdm-menu", built.root);
    items.forEach(function (it) {
      var r = ui.el("div", "bdm-menu-item" + (it.on ? " bdm-menu-on" : "") + (it.badge ? " bdm-menu-locked" : ""), m);
      ui.el("span", "bdm-menu-label", r).textContent = it.label;
      if (it.badge) ui.el("span", "bdm-menu-badge", r).textContent = it.badge;
      r.addEventListener("click", function (e) { e.stopPropagation(); closeMenu(built); onPick(it); });
    });
    built._menu = m;
    setTimeout(function () {
      document.addEventListener("click", built._menuAway = function () { closeMenu(built); }, { once: true });
    }, 0);
  }

  async function switchQn(rec, it) {
    var c = rec.slide.ctrl;
    toastLine("切换画质…");
    try {
      var cur = rec.player.currentTime();
      var p = await api.playurl(rec.item.bvid, rec.item.cid, it.qn, { codec: S.get().videoCodec });
      rec.codecs = p.codecs || rec.codecs;
      rec.mode = p.mode || rec.mode;
      // 只认精确档位：未登录 / 非大会员的档位如实拒绝，绝不悄悄降一档冒充
      if (p.multiSegment) { toastLine("该稿件为多段视频，沉浸模式暂不支持切档"); return; }
      if (!p.exact || !p.exact.url) { toastLine(it.why ? ("该清晰度" + it.why) : "该清晰度当前不可用"); return; }
      rec.player.setSrc(p.exact.url, p.exact.audioUrl);
      rec.player.video.currentTime = cur;
      rec.player.play();
      rec.qn = { cur: p.exact.quality, list: p.qnList || [], desc: p.qnDesc || [], items: p.list || [] };
      c.qn.textContent = qnShort(it.name, p.exact.quality);
      toastLine("已切换 " + qnShort(it.name, p.exact.quality));
    } catch (e) {
      toastLine("画质切换失败：" + (hintOf(String(e.message || e)) || String(e.message || e)));
    }
  }
  // 编码切换要重新取流（编码不同 = 流不同），保留播放位置
  async function refetchStream(rec, why) {
    try {
      var cur = rec.player.currentTime();
      var q = rec.qn && rec.qn.cur ? rec.qn.cur : 64;
      var p = await api.playurl(rec.item.bvid, rec.item.cid, q, { codec: S.get().videoCodec });
      rec.codecs = p.codecs || rec.codecs;
      if (!p.exact || !p.exact.url) { toastLine("该编码当前不可用，已保持原流"); return; }
      rec.player.setSrc(p.exact.url, p.exact.audioUrl);
      rec.player.video.currentTime = cur;
      rec.player.play();
      if (why) {
        // 编码偏好只对 DASH 生效；mp4 单文件流（含 avc）不会因它改变，不能谎报「已切换」
        var mp4Fixed = p.exact.mode === 'mp4' && S.get().videoCodec !== 'auto';
        toastLine(mp4Fixed ? "编码偏好已记录；当前档位是 mp4 单文件流，切到 DASH 档位（1080P+ / 4K）后生效" : why);
      }
    } catch (e) { toastLine("编码切换失败：" + String(e.message || e)); }
  }
  function openQnMenu(rec) {
    var q = rec.qn;
    if (!q || !q.list || !q.list.length) { toastLine("清晰度信息未就绪"); return; }
    var items = (q.items && q.items.length) ? q.items
      : q.list.map(function (n, i) { return { qn: n, name: q.desc[i] || qnName(n), playable: true, why: "" }; });
    popMenu(rec.slide, items.map(function (m) {
      return { label: qnShort(m.name, m.qn), qn: m.qn, why: m.why || "", badge: m.playable ? "" : (m.why || "不可用"), on: m.qn === q.cur };
    }), function (it) { if (it.qn !== rec.qn.cur) switchQn(rec, it); });
  }
  function openRateMenu(rec) {
    var cur = rec.player.rate();
    popMenu(rec.slide, RATE_STEPS.map(function (r) {
      return { label: r === 1 ? "1.0x 常速" : r + "x", rate: r, on: Math.abs(r - cur) < 0.01 };
    }), function (it) {
      rec.player.setRate(it.rate);
      rec.slide.ctrl.rate.textContent = it.rate === 1 ? "倍速" : it.rate + "x";
    });
  }

  // ---------- 评论面板（只读 + 去B站写评论）----------
  function aidOf(item) { return item.aid || (item.arc && item.arc.aid) || 0; }
  async function toggleComments(rec, forceClose) {
    var built = rec.slide;
    var show = forceClose ? false : built.panel.style.display === "none";
    built.panel.style.display = show ? "flex" : "none";
    if (!show) { built.panelBody.innerHTML = ""; return; }
    if (rec.cmts) { renderComments(rec); return; }
    var aid = aidOf(rec.item);
    if (!aid) { built.panelBody.innerHTML = '<div class="bdm-cmt-empty">暂无法获取评论</div>'; return; }
    built.panelBody.innerHTML = '<div class="bdm-cmt-empty">加载中…</div>';
    try {
      var r = await api.replies(aid, 1);
      rec.cmts = { list: r.list, pn: 1, hasMore: r.hasMore, count: r.count };
      built.panelTitle.textContent = "评论 " + (r.count ? ui.fmt(r.count) : "");
      renderComments(rec);
    } catch (e) {
      built.panelBody.innerHTML = '<div class="bdm-cmt-empty">评论加载失败：' + esc(String(e.message || e)) + "</div>";
    }
  }
  function commentRow(rec, cm) {
    var row = ui.el("div", "bdm-cmt", rec.slide.panelBody);
    var av = ui.el("img", "bdm-cmt-face", row);
    if (cm.face) { av.src = cm.face; av.referrerPolicy = "no-referrer"; }
    var col = ui.el("div", "bdm-cmt-col", row);
    ui.el("div", "bdm-cmt-name", col).textContent = cm.uname;
    ui.el("div", "bdm-cmt-text", col).textContent = cm.text;
    ui.el("div", "bdm-cmt-meta", col).textContent =
      (cm.like ? "👍 " + ui.fmt(cm.like) : "") + (cm.reply ? " · " + cm.reply + " 回复" : "");
    return row;
  }

  // 「加载更多」只追加，不重建整列表：此前每次翻页都 innerHTML = "" 重建，
  // 用户点完会被扔回列表顶部（列表越长越难受）。追加还顺带省掉 O(n²) 的重建。
  function commentMore(rec) {
    var built = rec.slide, c = rec.cmts;
    var old = built.panelBody.querySelector(".bdm-cmt-more");
    if (old) old.remove();
    if (!c.hasMore) return;
    var more = ui.el("div", "bdm-cmt-more", built.panelBody);
    more.textContent = "加载更多";
    more.addEventListener("click", async function () {
      more.textContent = "加载中…";
      try {
        var r = await api.replies(aidOf(rec.item), c.pn + 1);
        c.pn += 1;
        c.hasMore = r.hasMore;
        r.list.forEach(function (cm) { c.list.push(cm); commentRow(rec, cm); });
        commentMore(rec);
      } catch (e) { more.textContent = "加载失败，点我重试"; }
    });
  }

  function renderComments(rec) {
    var built = rec.slide, c = rec.cmts;
    built.panelBody.innerHTML = "";
    c.list.forEach(function (cm) { commentRow(rec, cm); });
    if (!c.list.length) ui.el("div", "bdm-cmt-empty", built.panelBody).textContent = "还没有评论，去B站抢沙发";
    commentMore(rec);
  }

  // ---------- 合集徽标 + 列表（点击集数 → 插入下一屏并滑过去）----------
  function bindSeason(rec) {
    api.view(rec.item.bvid).then(function (v) {
      rec.view = v;                        // 留给简介面板复用（一次请求两处用）
      var sn = v && v.ugc_season;
      if (!sn || !sn.title) return;
      var eps = api.siblings(rec.item, v);
      if (eps.length < 2) return;
      var myIdx = -1;
      for (var k = 0; k < eps.length; k++) if (eps[k].bvid === rec.item.bvid) { myIdx = k; break; }
      rec.season = { title: sn.title, eps: eps, myIdx: myIdx };
      rec.slide.season.style.display = "";
      rec.slide.season.textContent = "📋 合集·" + sn.title + (myIdx >= 0 ? "  " + (myIdx + 1) + "/" + eps.length : "  共" + eps.length + "个");
      rec.slide.season.addEventListener("click", function (e) { e.stopPropagation(); openSeasonList(rec); });
    }).catch(function () { /* 无合集，静默 */ });
  }
  function openSeasonList(rec) {
    var built = rec.slide, sn = rec.season;
    if (!sn) return;
    closePanels(built);                    // 与简介面板互斥：开一个就收起另一个
    if (built.seasonList.style.display !== "none") { built.seasonList.style.display = "none"; return; }
    built.seasonList.innerHTML = "";
    ui.el("div", "bdm-season-head", built.seasonList).textContent = "合集 · " + sn.title;
    var body = ui.el("div", "bdm-season-body", built.seasonList);
    sn.eps.forEach(function (ep, k) {
      var row = ui.el("div", "bdm-season-item" + (k === sn.myIdx ? " bdm-season-cur" : ""), body);
      row.textContent = (k + 1) + ". " + (ep.title || ep.bvid);
      row.addEventListener("click", function () {
        built.seasonList.style.display = "none";
        if (k === sn.myIdx) return;
        var i = slides.indexOf(rec);
        if (i < 0) return;
        dropSlidesAfter(i);
        items.splice(i + 1, 0, ep);
        ensureSlides(i + 1);
        go(1);
      });
    });
    built.seasonList.style.display = "block";
    setTimeout(function () {
      document.addEventListener("click", built._seasonAway = function (ev) {
        if (!built.seasonList.contains(ev.target) && ev.target !== built.season) {
          built.seasonList.style.display = "none";
          document.removeEventListener("click", built._seasonAway);
          built._seasonAway = null;
        }
      });
    }, 0);
  }

  // 飞行中重复触发守卫：点赞/三连都是写操作，三连接口会**真的扣币** —— 连点两下此前会
  // 老老实实发两次请求（重复副作用），不是「点快了没反应」这么轻。守卫期间按钮同时变暗，
  // 让用户看见「正在提交」而不是以为没点上。
  var ACT_SEL = { like: ".bdm-btn-like", triple: ".bdm-btn-triple" };
  function markAct(rec, key, on) {
    var b = rec.slide && rec.slide.rail && ACT_SEL[key] ? rec.slide.rail.querySelector(ACT_SEL[key]) : null;
    if (b) b.classList[on ? "add" : "remove"]("bdm-sending");
  }
  function beginAct(rec, key) {
    rec.acts = rec.acts || {};
    if (rec.acts[key]) return false;
    rec.acts[key] = true;
    markAct(rec, key, true);
    return true;
  }
  function endAct(rec, key) {
    if (rec.acts) rec.acts[key] = false;
    markAct(rec, key, false);
  }

  function flashBtn(rec, cls, ok) {
    var b = rec.slide.rail.querySelector(cls);
    if (!b) return;
    b.classList.toggle("bdm-act-on", !!ok);
  }

  // 失败必须说话：此前只让按钮不变蓝，用户看到的是「点了没反应」——
  // 与「发弹幕」保持同一条原则：成功有反馈，失败有原因。
  function actFail(what, j) {
    var why = (j && (hintOf(String(j.code)) || j.message)) || "网络异常";
    toastLine(what + "失败：" + why);
  }
  async function doLike(rec) {
    if (!allowExplicit()) return;
    if (!api.isLogin()) return needLogin();
    if (!beginAct(rec, "like")) return;
    var j = null;
    try { j = await api.like(rec.item, true); } catch (e) { j = null; }
    endAct(rec, "like");
    var okL = j && j.code === 0;
    flashBtn(rec, ".bdm-btn-like", okL);
    if (!okL) actFail("点赞", j);
  }
  async function doTriple(rec) {
    if (!allowExplicit()) return;
    if (!api.isLogin()) return needLogin();
    if (!beginAct(rec, "triple")) return;
    var j = null;
    try { j = await api.triple(rec.item); } catch (e) { j = null; }
    endAct(rec, "triple");
    var ok = j && j.code === 0;
    if (!ok) actFail("三连", j);
    flashBtn(rec, ".bdm-btn-triple", ok);
    flashBtn(rec, ".bdm-btn-like", ok);
    flashBtn(rec, ".bdm-btn-coin", ok);
    flashBtn(rec, ".bdm-btn-fav", ok);
  }
  function toastLine(msg) {
    var box = ui.el("div", "bdm-toast", document.body);
    box.textContent = msg;
    setTimeout(function () { box.remove(); }, 1800);
  }
  // 默认开启「抑制未登录弹窗」，所以不能只丢一句「请先登录」：用户在页面上可能已经
  // 找不到那个被隐藏的登录弹窗了。给一个一定可用的入口 —— 通行证登录页。
  function needLogin() {
    var box = ui.el("div", "bdm-toast bdm-toast-act", document.body);
    // 消息同时写在容器上：这样任何读 toast 文本的地方（含自测）都能看到它
    box.textContent = S.get().suppressLoginPopup
      ? "请先在 B 站登录后再互动（登录弹窗已被抑制）"
      : "请先在 B 站登录后再互动";
    var a = ui.el("span", "bdm-toast-a", box);
    a.textContent = "去登录";
    a.addEventListener("click", function (e) {
      e.stopPropagation();
      box.remove();
      window.open("https://passport.bilibili.com/login", "_blank");
    });
    setTimeout(function () { box.remove(); }, 6000);
  }

  // 「放行显式操作」此前也是零消费的死设置项 —— 现在真正作为互动总闸
  function allowExplicit() {
    if (S.get().allowExplicitLike) return true;
    toastLine("已在设置中关闭「放行显式操作」");
    return false;
  }

  // 设置变更：弹幕开关/音量即时生效
  document.addEventListener("bdm:settings-changed", function () {
    var rec = slides[idx];
    if (!rec || !rec.player) return;
    rec.player.setVolume(Number(S.get().volume) || 0.7);
    rec.player.setDanmakuOpacity(S.get().dmOpacity);
    rec.player.setDanmakuOn(S.get().dmEnabled);
    if (S.get().dmEnabled) rec.player.startDanmaku(); else rec.player.stopDanmaku();
  });

  // 画像卫生：拦截页面自身的上报类请求（读操作不受影响）
  var REPORT_KEYS = ["click-interface", "heartbeat", "report", "history/report"];
  function isReportUrl(u) {
    if (!u) return false;
    u = String(u);
    for (var i = 0; i < REPORT_KEYS.length; i++) {
      if (u.indexOf(REPORT_KEYS[i]) >= 0 && u.indexOf("api.bilibili.com") >= 0) return true;
    }
    return false;
  }
  function installProfileGuard() {
    if (window.__bdmGuardInstalled) return;
    window.__bdmGuardInstalled = true;
    var of = window.fetch;
    window.fetch = function (input, init) {
      try {
        var u = (input && input.url) || input;
        if (S.get().profileGuard && isReportUrl(u)) {
          return Promise.resolve(new Response("{}", { status: 200 }));
        }
      } catch (e) { /* ignore */ }
      return of.apply(window, arguments);
    };
    var oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__bdmBlocked = S.get().profileGuard && isReportUrl(url);
      return oo.apply(this, arguments);
    };
    var os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      if (this.__bdmBlocked) { this.abort(); return; }
      return os.apply(this, arguments);
    };
  }

  // 入口：导航按钮 + 首次挂载
  function boot() {
    installProfileGuard();
    ui.startLoginSuppression();
    ui.startNoAutoPause();
    ui.keepNavButton(function () {
      if (S.get().enabled) {
        if (active) exit(); else enter();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }

  // 移除某屏（「不感兴趣」用）。这段逻辑必须住在主 IIFE：它操作 slides/items/idx/root，
  // 而弹窗模块是另一个 IIFE —— 此前 removeSlide 被放在那里，一调用就 ReferenceError: slides is not defined，
  // 用户看到的是「已提交」提示出现、那一屏却不动。
  var lastRemoval = null;   // { i, item } —— 供「撤销不感兴趣」放回原位
  function removeAt(i) {
    var rec = slides[i];
    if (rec) {
      teardownSlide(rec);
      if (rec.slide && rec.slide.root && rec.slide.root.parentNode) rec.slide.root.parentNode.removeChild(rec.slide.root);
    }
    dropSlidesAfter(i);
    lastRemoval = { i: i, item: items[i] };
    slides.splice(i, 1);
    items.splice(i, 1);
    if (idx > i) idx -= 1;
    if (idx >= items.length) idx = Math.max(0, items.length - 1);
    ensureSlides(Math.min(items.length - 1, idx + 2));
    if (root) root.scrollTo({ top: idx * slideH(), behavior: "auto" });
    if (slides[idx]) activateSlide(idx);
  }

  window.__BDM__.douyin = {
    enter: enter, exit: exit, isActive: function () { return active; },
    // 供弹窗模块（另一个 IIFE）按记录移除该屏
    removeRec: function (rec) { var i = slides.indexOf(rec); if (i < 0) return false; removeAt(i); return true; },
    // 「撤销不感兴趣」：B站 自己的推荐卡就有这个动作。放回原位用与「合集插集」同一套做法
    // （先把插入点之后的屏全部丢弃重建，保证 DOM 顺序与 items 索引仍然一一对应）。
    // 注意顺序：先本地恢复，再通知服务端撤销 —— 网络失败不该让用户找不回那一屏。
    undoRemove: function (reasonId) {
      var lr = lastRemoval;
      if (!lr || !lr.item) return false;
      lastRemoval = null;
      items.splice(lr.i, 0, lr.item);
      dropSlidesAfter(lr.i - 1);
      idx = lr.i;
      ensureSlides(Math.min(items.length - 1, idx + 2));
      if (root) root.scrollTo({ top: idx * slideH(), behavior: "auto" });
      activateSlide(idx);
      if (reasonId && api.dislikeCancel) {
        api.dislikeCancel(lr.item, reasonId).catch(function () { /* 服务端撤销失败不影响本地恢复 */ });
      }
      return true;
    },
    // 供弹窗模块（另一个 IIFE）取「当前屏」这条视频：沉浸流里它就是右键菜单的对象
    current: function () {
      var r = active && slides[idx] ? slides[idx] : null;
      if (!r) return null;
      return { bvid: r.item.bvid, cid: r.item.cid, aid: aidOf(r.item), title: r.item.title };
    }
  };
})();

// ============ 弹窗模块：下载 ⑦ / 收藏 ⑥ / 投币 ⑥ / 分享 ⑥ ============
(function () {
  var ui = window.__BDM__.ui;
  var api = window.__BDM__.api;

  // 通用壳：遮罩 + B站风格卡片；返回 {card, close}
  function shell(title) {
    var mask = ui.el("div", "bdm-dialog-mask", document.body);
    var card = ui.el("div", "bdm-dialog", mask);
    var head = ui.el("div", "bdm-dialog-head", card);
    ui.el("span", "bdm-dialog-title", head).textContent = title;
    var x = ui.el("button", "bdm-dialog-x", head);
    x.type = "button";
    x.textContent = "×";
    var body = ui.el("div", "bdm-dialog-body", card);
    function close() { mask.remove(); }
    x.addEventListener("click", close);
    mask.addEventListener("click", function (e) { if (e.target === mask) close(); });
    return { card: card, body: body, close: close };
  }

  function toast(msg) {
    var box = ui.el("div", "bdm-toast", document.body);
    box.textContent = msg;
    setTimeout(function () { box.remove(); }, 1800);
  }

  // 带一个可点动作的提示（「撤销」这类一步之内的反悔）。留 6 秒，比普通提示久。
  function toastAction(msg, label, onPick, ms) {
    var box = ui.el("div", "bdm-toast bdm-toast-act", document.body);
    box.textContent = msg;                        // 容器也带消息文本，读 toast 文本的地方都能看到
    var a = ui.el("span", "bdm-toast-a", box);
    a.textContent = label;
    a.addEventListener("click", function (e) {
      e.stopPropagation();
      box.remove();
      onPick();
    });
    setTimeout(function () { box.remove(); }, ms || 6000);
  }

  function sizeText(n) {
    n = Number(n) || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    return Math.round(n / 1024) + " KB";
  }

  // 下载弹窗：列出 playurl 各分段，逐段下载（右键菜单也走这里）
  async function download(item) {
    var d = shell("下载视频");
    ui.el("div", "bdm-dialog-sub", d.body).textContent = item.title || item.bvid;
    d.body.appendChild(ui.el("div", "bdm-loading", d.body));
    var ld = d.body.querySelector(".bdm-loading");
    ld.textContent = "解析视频地址…";
    try {
      var p = await api.playurl(item.bvid, item.cid, 64);
      ld.remove();
      if (!p.all || !p.all.length) throw new Error("无可用视频流");
      p.all.forEach(function (seg, i) {
        var row = ui.el("div", "bdm-dl-row", d.body);
        var info = ui.el("div", "bdm-dl-info", row);
        info.textContent = (p.all.length > 1 ? "分段 " + (i + 1) + "  " : "") +
          "清晰度 " + (p.quality || "?") + "  " + sizeText(seg.size);
        var btn = ui.el("button", "bdm-dl-btn", row);
        btn.type = "button";
        btn.textContent = "下载";
        btn.addEventListener("click", function () {
          var name = (item.title || item.bvid).replace(new RegExp('[/:*?<>|]', 'g'), "_");
          var fname = "刷B站/" + name + (p.all.length > 1 ? "-" + (i + 1) : "") + ".mp4";
          chrome.runtime.sendMessage({ type: "bdm:download", url: seg.url, filename: fname }, function (res) {
            if (res && res.ok) { btn.textContent = "已开始"; btn.disabled = true; }
            else toast("下载失败：" + ((res && res.error) || "未知错误"));
          });
        });
      });
    } catch (e) {
      ld.textContent = "解析失败：" + String(e.message || e);
    }
  }

  // 收藏弹窗：列出收藏夹，勾选后应用差异
  async function fav(item) {
    var d = shell("收藏到…");
    if (!api.isLogin()) {
      ui.el("div", "bdm-dialog-sub", d.body).textContent = "请先登录 B 站";
      return;
    }
    d.body.appendChild(ui.el("div", "bdm-loading", d.body)).textContent = "读取收藏夹…";
    try {
      var j = await api.favFolders(item.aid);
      var list = (j.data && j.data.list) || [];
      var box = d.body.querySelector(".bdm-loading");
      if (box) box.remove();
      if (!list.length) { ui.el("div", "bdm-dialog-sub", d.body).textContent = "还没有收藏夹"; }
      var checked = {};
      list.forEach(function (f) {
        var row = ui.el("label", "bdm-fav-row", d.body);
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!f.favoured;
        checked[f.id] = cb.checked;
        cb.addEventListener("change", function () { checked[f.id] = cb.checked; });
        row.appendChild(cb);
        ui.el("span", "bdm-fav-name", row).textContent = f.title + "（" + (f.media_count || 0) + "）";
      });
      var ok = ui.el("button", "bdm-dl-btn bdm-fav-ok", d.body);
      ok.type = "button";
      ok.textContent = "确定";
      ok.addEventListener("click", async function () {
        var add = [], del = [];
        list.forEach(function (f) {
          if (checked[f.id] && !f.favoured) add.push(f.id);
          if (!checked[f.id] && f.favoured) del.push(f.id);
        });
        if (!add.length && !del.length) {
          // 什么都不改也要说清楚：原实现是静默关闭，用户会以为「点了没反应」（同一类死交互）
          toast("未做修改：没有勾选新的收藏夹，也没有取消已有收藏");
          d.close();
          return;
        }
        var r = await api.favDeal(item.aid, add, del).catch(function () { return null; });
        toast(r && r.code === 0 ? "已保存" : ("保存失败：" + ((r && r.message) || "请稍后重试")));
        d.close();
      });
    } catch (e) {
      var b = d.body.querySelector(".bdm-loading");
      if (b) b.textContent = "读取失败：" + String(e.message || e);
    }
  }

  // 分享弹窗：标准链接 + 复制
  function share(item) {
    var d = shell("分享视频");
    var link = "https://www.bilibili.com/video/" + item.bvid;
    var row = ui.el("div", "bdm-share-row", d.body);
    var inp = document.createElement("input");
    inp.className = "bdm-share-input";
    inp.readOnly = true;
    inp.value = link;
    row.appendChild(inp);
    var btn = ui.el("button", "bdm-dl-btn", row);
    btn.type = "button";
    btn.textContent = "复制";
    btn.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(link);
        btn.textContent = "已复制";
      } catch (e) {
        inp.select(); document.execCommand("copy");
        btn.textContent = "已复制";
      }
      setTimeout(function () { btn.textContent = "复制"; }, 1500);
    });
  }

  // 从信息流里摘掉第 i 屏（用于「不感兴趣」）：后续屏的索引会错位，必须整段丢弃后按新列表重建
  // removeSlide 已移入主 IIFE（见 removeAt）：弹窗模块取不到 slides/items/idx/root


  // 「不感兴趣」：B站 首页推荐的正规调控手段，选项与 reason_id 取自其前端原样
  function dislike(rec) {
    if (!rec || !rec.item) return;
    var d = shell("减少此类推荐");
    ui.el("div", "bdm-dialog-sub", d.body).textContent = rec.item.title || rec.item.bvid || "";
    var opts = [
      { text: "内容不感兴趣", reason: 1 },
      { text: "不想看此 UP 主", reason: 4 }
    ];
    opts.forEach(function (o) {
      var row = ui.el("div", "bdm-dl-row", d.body);
      ui.el("div", "bdm-dl-info", row).textContent = o.text + (o.reason === 4 ? "（该作者的内容都会减少）" : "");
      var b = ui.el("button", "bdm-dl-btn", row);
      b.type = "button";
      b.textContent = "确定";
      b.addEventListener("click", async function () {
        b.disabled = true;
        var r = await api.dislike(rec.item, o.reason).catch(function () { return null; });
        if (r && r.code === 0) {
          d.close();
          var gone = false;
          try {
            gone = !!(window.__BDM__.douyin && window.__BDM__.douyin.removeRec && window.__BDM__.douyin.removeRec(rec));
          } catch (e) { gone = false; }
          if (gone) {
            toastAction("已提交，将减少此类内容推荐", "撤销", function () {
              var back = false;
              try {
                back = !!(window.__BDM__.douyin && window.__BDM__.douyin.undoRemove &&
                  window.__BDM__.douyin.undoRemove(o.reason));
              } catch (e) { back = false; }
              toast(back ? "已撤销，这一屏放回原位" : "撤销失败：这一屏找不回来了");
            });
          } else {
            toast("已提交；该屏移除失败，刷新后推荐同样减少");
          }
        } else {
          b.disabled = false;
          toast("提交失败：" + ((r && r.message) || "请稍后重试"));
        }
      });
    });
    ui.el("div", "bdm-dialog-sub", d.body).textContent = "该操作只影响 B站 对你的推荐，不产生观看记录。";
  }

  // 投币弹窗（规格⑥）：复刻B站的 1 枚 / 2 枚选择，不再默默投 1 枚
  function coin(item) {
    if (!api.isLogin()) return toast("请先在 B 站登录后再互动");
    var d = shell("投币");
    ui.el("div", "bdm-dialog-sub", d.body).textContent = item.title || item.bvid;
    [1, 2].forEach(function (n) {
      var row = ui.el("div", "bdm-dl-row", d.body);
      ui.el("div", "bdm-dl-info", row).textContent = "投 " + n + " 枚硬币（每日上限 5 枚）";
      var b = ui.el("button", "bdm-dl-btn", row);
      b.type = "button";
      b.textContent = "投 " + n + " 枚";
      b.addEventListener("click", async function () {
        b.disabled = true;
        var r = await api.coin(item, n).catch(function () { return null; });
        if (r && r.code === 0) { toast("投币成功，感谢支持"); d.close(); }
        else {
          b.disabled = false;
          toast("投币失败：" + ((r && r.message) || "请稍后重试"));
        }
      });
    });
  }

  // 右键菜单事件：后台发来的下载请求（在普通视频页也能用）
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === "bdm:open-download-dialog") {
      // 本模块与主控不在同一个 IIFE，取「当前屏」必须走公开接口
      var item = null;
      try {
        if (window.__BDM__.douyin && window.__BDM__.douyin.current) item = window.__BDM__.douyin.current();
      } catch (e) { item = null; }
      if (!item || !item.bvid) {
        // 普通视频页：兜底用页面数据（沉浸流所在的首页没有 __INITIAL_STATE__.videoData）
        var st = window.__INITIAL_STATE__;
        try {
          if (st && st.videoData) {
            item = {
              bvid: st.videoData.bvid, cid: st.videoData.cid,
              aid: st.videoData.aid, title: st.videoData.title
            };
          }
        } catch (e) { /* ignore */ }
      }
      if (item) {
        download(item);
        if (sendResponse) sendResponse({ ok: true });
        return true;
      }
      toast("请先打开一个视频页");
      if (sendResponse) sendResponse({ ok: false });
      return true;
    }
  });

  window.__BDM__.dialogs = { download: download, fav: fav, coin: coin, share: share, dislike: dislike, toast: toast };
})();
