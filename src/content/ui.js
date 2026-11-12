// ============ DOM 构建：操作栏 / 信息区 / 进度条 / 左侧"刷B站"按钮 / 登录抑制 ============
window.__BDM__ = window.__BDM__ || {};
(function () {
  var S = window.__BDM__.settings;

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  // 极简几何图标（fill=currentColor）
  var ICONS = {
    like: "M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2z",
    coin: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm-1 3h2v8h-2z",
    fav: "M12 2l3 6.6 7 .8-5.2 4.8 1.4 7-6.2-3.6L5.8 21.2l1.4-7L2 9.4l7-.8z",
    share: "M18 8a3 3 0 1 0-2.8-4H15a3 3 0 0 0 .1 1L8.9 8.4a3 3 0 1 0 0 7.2l6.2 3.4a3 3 0 1 0 2-1.8l-6.3-3.4a3 3 0 0 0 0-3.6L17 6.9c.3.1.7.1 1 .1z",
    comment: "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    triple: "M12 2l3 6.6 7 .8-5.2 4.8 1.4 7-6.2-3.6L5.8 21.2l1.4-7L2 9.4l7-.8z M12 21C7 16.5 3 13 3 8.8 3 6 5.2 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.8 4 21 6 21 8.8c0 4.2-4 7.7-9 12.2z",
    down: "M12 3v10l4-4 1.4 1.4L12 16.8 6.6 10.4 8 9l4 4V3h0zM5 19h14v2H5z",
    dislike: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5 9v2H7v-2h10z"
  };

  var SVG_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  var SVG_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  var SVG_VOL = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>';
  // 1:1 对齐 B站 桌面版控件：下一集 / 弹幕开关 / 弹幕设置(齿轮) / 全屏
  var SVG_NEXT = '<svg viewBox="0 0 24 24"><path d="M5 5.5l9 6.5-9 6.5zM16.5 5h2.4v14h-2.4z"/></svg>';
  var SVG_DM = '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2.6 5.4h18.8v10.4H9.6l-4.8 3.6v-3.6H2.6zM5.6 8.2h12.8v1.7H5.6zM5.6 11.2h8.4v1.7H5.6z"/></svg>';
  var SVG_GEAR = '<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/></svg>';
  var SVG_FULL = '<svg viewBox="0 0 24 24"><path d="M4 4h6.2v2.2H6.2V10H4zM13.8 4H20v6h-2.2V6.2h-4zM4 14h2.2v3.8H10V20H4zM17.8 14H20v6h-6v-2.2h3.8z"/></svg>';
  // 弹幕设置用「滑杆」图标，播放器设置用齿轮，避免两个齿轮混淆
  var SVG_SLIDERS = '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 7h4.2v1.7H4zM11.2 7H20v1.7h-8.8zM4 11.2h8.8v1.7H4zM15.8 11.2H20v1.7h-4.2zM4 15.4h5.6v1.7H4zM12.6 15.4H20v1.7h-7.4z"/><path d="M8.6 5.5h2.2v4.7H8.6zM13.2 9.7h2.2v4.7h-2.2zM10 13.9h2.2v4.7H10z"/></svg>';
  var SVG_PIP = '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2.5 4.5h19v15h-19zM4.6 6.6v10.8h14.8V6.6z"/><path d="M12.4 12.4h5.2v4.4h-5.2z"/></svg>';
  var SVG_CC = '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2.6 4.5h18.8v15H2.6zM4.7 6.6v10.8h14.6V6.6z"/><path d="M6.5 9.4h11v2h-11zM6.5 13.1h7v2h-7z"/></svg>';
  var SVG_WIDE = '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M2.4 4.5h19.2v15H2.4zM4.5 6.6v10.8h15V6.6z"/><path d="M8.2 10.2l-2.6 1.8 2.6 1.8zM15.8 10.2l2.6 1.8-2.6 1.8zM7 11.1h10v1.8H7z"/></svg>';

  // ---------- 设置面板（布局照搬 B站：标题 + 双栏 + 底部按钮；内容由调用方按当前设置重建）----------
  function buildPanel(slide, cls) {
    var box = el("div", "bdm-settings " + cls, slide);
    box.style.display = "none";
    var head = el("div", "bdm-settings-head", box);
    var title = el("span", "bdm-settings-title", head);
    var x = el("span", "bdm-settings-x", head);
    x.textContent = "×";
    var cols = el("div", "bdm-settings-cols", box);
    var left = el("div", "bdm-settings-col", cols);
    var right = el("div", "bdm-settings-col", cols);
    var foot = el("div", "bdm-settings-foot", box);
    var api = {
      root: box, left: left, right: right, foot: foot, closeBtn: x,
      label: function (t) { title.textContent = t; },
      clear: function () { left.innerHTML = ""; right.innerHTML = ""; foot.innerHTML = ""; },
      show: function (on) { box.style.display = on ? "block" : "none"; },
      isOpen: function () { return box.style.display !== "none"; },
      group: function (col, t) {
        var g = el("div", "bdm-set-group", col);
        el("div", "bdm-set-title", g).textContent = t;
        return g;
      },
      radios: function (g, items, onPick) {
        var row = el("div", "bdm-set-radios", g);
        items.forEach(function (it) {
          var s = el("span", "bdm-set-radio" + (it.on ? " bdm-on" : ""), row);
          s.textContent = it.label;
          s.addEventListener("click", function () { onPick(it.val); });
        });
        return row;
      },
      switches: function (g, items, onPick) {
        var row = el("div", "bdm-set-radios", g);
        items.forEach(function (it) {
          var s = el("span", "bdm-set-switch" + (it.on ? " bdm-on" : ""), row);
          s.textContent = it.label;
          s.addEventListener("click", function () { onPick(it.key, !it.on); });
        });
        return row;
      },
      block: function (g, placeholder, onAdd) {
        var row = el("div", "bdm-set-block", g);
        var inp = el("input", "bdm-set-input", row);
        inp.type = "text"; inp.placeholder = placeholder;
        var add = el("span", "bdm-set-add", row);
        add.textContent = "添加";
        function submit() { var v = String(inp.value || "").trim(); if (!v) return; inp.value = ""; onAdd(v); }
        add.addEventListener("click", submit);
        inp.addEventListener("keydown", function (e) {
          e.stopPropagation();                                  // 空格/方向键不许穿透到信息流
          if (e.key === "Enter") { e.preventDefault(); submit(); }
        });
        return row;
      },
      words: function (g, list, onDel) {
        var row = el("div", "bdm-set-words", g);
        if (!list.length) { el("span", "bdm-set-empty", row).textContent = "暂无屏蔽词"; return row; }
        list.forEach(function (w) {
          var s = el("span", "bdm-set-word", row);
          el("span", "bdm-set-word-t", s).textContent = w;
          var d = el("span", "bdm-set-word-x", s);
          d.textContent = "×";
          d.addEventListener("click", function (e) { e.stopPropagation(); onDel(w); });
        });
        return row;
      },
      action: function (label, onPick) {
        var b = el("span", "bdm-set-btn", foot);
        b.textContent = label;
        b.addEventListener("click", onPick);
        return b;
      }
    };
    return api;
  }

  // ---------- 右键菜单（照搬 B站 bpx-player-contextmenu：条目 + 勾选 + 二级子菜单）----------
  function buildContextMenu(slide) {
    var box = el("div", "bdm-ctx", slide);
    box.style.display = "none";
    var api = { root: box, isOpen: function () { return box.style.display !== "none"; } };
    function makeItem(it) {
      var row = el("div", "bdm-ctx-item" + (it.children ? " bdm-ctx-has-sub" : ""), box);
      el("span", "bdm-ctx-label", row).textContent = it.label;
      if (it.children) el("span", "bdm-ctx-arrow", row).textContent = "›";
      else if (it.type === "switch") {
        var t = el("span", "bdm-ctx-tick" + (it.on ? " bdm-on" : ""), row);
        t.textContent = it.on ? "✓" : "";
      }
      if (it.children) {
        var sub = el("div", "bdm-ctx-sub", row);
        it.children.forEach(function (c) {
          var cr = el("div", "bdm-ctx-item" + (c.on ? " bdm-ctx-on" : ""), sub);
          el("span", "bdm-ctx-label", cr).textContent = c.label;
          cr.addEventListener("click", function (e) { e.stopPropagation(); api.close(); c.onPick(); });
        });
      } else {
        row.addEventListener("click", function (e) { e.stopPropagation(); api.close(); it.onPick(); });
      }
      return row;
    }
    api.open = function (x, y, items) {
      box.innerHTML = "";
      box.style.display = "block";
      items.forEach(makeItem);
      // 贴边回退：先按光标定位，再按菜单尺寸夹回视口内
      var w = box.offsetWidth || 190, h = box.offsetHeight || items.length * 30;
      box.style.left = Math.max(4, Math.min(x, (window.innerWidth || 1280) - w - 4)) + "px";
      box.style.top = Math.max(4, Math.min(y, (window.innerHeight || 800) - h - 4)) + "px";
      // 靠右时子菜单改为向左展开，否则会被视口裁掉
      box.classList.toggle("bdm-ctx-flip", x > (window.innerWidth || 1280) * 0.6);
    };
    api.close = function () { box.style.display = "none"; box.innerHTML = ""; };
    return api;
  }

  function icon(name) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", ICONS[name]);
    svg.appendChild(p);
    return svg;
  }

  // 单屏结构（抖音网页版风格）：视频 + 弹幕层 + 信息区(左下：标题可展开 + 合集徽标)
  //   + 操作栏(右侧竖排) + 评论面板(右侧可收起) + 底部控制条(B站式：进度条在按钮行上方)
  function buildSlide(item) {
    var slide = el("div", "bdm-slide");
    var wrap = el("div", "bdm-video-area", slide);
    var info = el("div", "bdm-info", slide);

    var author = el("div", "bdm-info-author", info);
    var face = el("img", "bdm-face", author);
    if (item.owner && item.owner.face) face.src = item.owner.face;
    face.referrerPolicy = "no-referrer";
    el("span", "bdm-upname", author).textContent = (item.owner && item.owner.name) || "未知UP主";

    var title = el("div", "bdm-info-title bdm-clamp", info);
    title.textContent = item.title || "(无标题)";
    title.addEventListener("click", function () { title.classList.toggle("bdm-clamp"); });

    var meta = el("div", "bdm-info-meta", info);
    var st = item.stat || {};
    var reason = item.rcmd_reason ? String(item.rcmd_reason).trim() : "";
    meta.textContent = (fmt(st.view) || "0") + " 播放  " + (fmt(st.danmaku) || "0") + " 弹幕" + (reason ? "  ·  " + reason : "");

    var more = el("div", "bdm-info-more", info);          // 「简介」入口（v0.1.24 点名要的「简介」）
    more.textContent = "简介";

    var season = el("div", "bdm-season", info);          // 合集徽标（默认隐藏，有合集才显示）
    season.style.display = "none";
    var seasonList = el("div", "bdm-season-list", slide); // 合集列表面板（点徽标弹出）
    seasonList.style.display = "none";

    var rail = el("div", "bdm-rail", slide);
    var btns = [
      ["like", "点赞", "bdm-btn-like"],
      ["coin", "投币", "bdm-btn-coin"],
      ["fav", "收藏", "bdm-btn-fav"],
      ["share", "分享", "bdm-btn-share"],
      ["comment", "评论", "bdm-btn-comment"],
      ["down", "下载", "bdm-btn-down"],
      ["dislike", "不感兴趣（调控B站推荐）", "bdm-btn-dislike"]
    ];
    btns.forEach(function (b) {
      var g = el("div", "bdm-act " + b[2], rail);
      g.appendChild(icon(b[0]));
      el("span", "bdm-act-num", g).textContent = fmt(countOf(item, b[0]));
      g.title = b[1];
    });
    var g3 = el("div", "bdm-act bdm-btn-triple", rail);
    g3.appendChild(icon("triple"));
    el("span", "bdm-act-num", g3).textContent = "三连";
    g3.title = "一键三连";

    var panel = el("div", "bdm-panel", slide);           // 评论面板（抖音网页版：右侧深色圆角）
    panel.style.display = "none";
    var pHead = el("div", "bdm-panel-head", panel);
    var pTitle = el("span", "bdm-panel-title", pHead);
    pTitle.textContent = "评论";
    var pClose = el("span", "bdm-panel-close", pHead);
    pClose.textContent = "收起";
    var pBody = el("div", "bdm-panel-body", panel);
    var pFoot = el("div", "bdm-panel-foot", panel);
    pFoot.textContent = "去B站写评论 ›";

    // 底部控制条（B站 式）
    var seek = el("div", "bdm-seek", slide);
    var seekTrack = el("div", "bdm-seek-track", seek);
    var seekFill = el("div", "bdm-seek-fill", seekTrack);

    // 底部控制条：布局与控件顺序 1:1 对齐 B站 桌面版播放器（真浏览器实测的节点盒）
    //   左段 播放/暂停 · 下一集 · 00:00 / 00:00
    //   右段 评论 · 字幕 · 画质 · 倍速 · 音量(悬停展开滑块) · 宽屏 · 画中画 · 设置 · 全屏
    var ctrl = el("div", "bdm-ctrl", slide);
    var cLeft = el("div", "bdm-ctrl-left", ctrl);
    var playBtn = el("div", "bdm-ctrl-btn bdm-btn-play", cLeft);
    playBtn.innerHTML = SVG_PAUSE;
    playBtn.title = "播放/暂停";
    var nextBtn = el("div", "bdm-ctrl-btn bdm-btn-next", cLeft);
    nextBtn.innerHTML = SVG_NEXT;
    nextBtn.title = "下一个";
    var timeLb = el("span", "bdm-time", cLeft);
    timeLb.textContent = "00:00 / 00:00";

    // 弹幕发送行：B站 实测是**独立一行**（bpx-player-sending-area = 46px），在控制条下方；
    // 左 弹幕开关·弹幕设置（实测 x=143/179 都在左侧）、中 输入框、右 发送。
    var dmRow = el("div", "bdm-dm-row", slide);
    var dmLeft = el("div", "bdm-dm-row-left", dmRow);
    var onlineEl = el("span", "bdm-online", dmLeft);   // 在线人数（B站 发送行最左的「N人正在看」）
    var dmBtn = el("div", "bdm-ctrl-btn bdm-btn-dm bdm-on", dmLeft);
    dmBtn.innerHTML = SVG_DM;
    dmBtn.title = "弹幕开关";
    var dmSetBtn = el("div", "bdm-ctrl-btn bdm-btn-dmset", dmLeft);
    dmSetBtn.innerHTML = SVG_SLIDERS;
    dmSetBtn.title = "弹幕设置";
    var dmInput = el("input", "bdm-dm-input", dmRow);
    dmInput.type = "text";
    dmInput.maxLength = 100;
    dmInput.placeholder = "发个友善的弹幕见证当下";
    var dmRight = el("div", "bdm-dm-row-right", dmRow);
    // 弹幕礼仪：B站 发送行右侧就是它（「弹幕礼仪 ›」在「发送」左边）。地址取自 B站 自己的 bundle
    // （lib/core.js 里「弹幕礼仪」标签旁边就是这个链接），并已 curl 验证 200。
    var dmEtq = el("span", "bdm-dm-etq", dmRight);
    dmEtq.textContent = "弹幕礼仪 ›";
    dmEtq.title = "弹幕礼仪（B站 规则页）";
    var dmSendBtn = el("div", "bdm-ctrl-btn bdm-btn-dmsend", dmRight);
    dmSendBtn.textContent = "发送";
    dmSendBtn.title = "发送弹幕";

    var cRight = el("div", "bdm-ctrl-right", ctrl);
    var cmtBtn = el("div", "bdm-ctrl-btn bdm-btn-cmt", cRight);
    cmtBtn.textContent = "评论";
    cmtBtn.title = "评论";
    // B站 控制条右段顺序：字幕 → 清晰度 → 倍速 → 音量 → …
    var ccBtn = el("div", "bdm-ctrl-btn bdm-btn-cc", cRight);
    ccBtn.innerHTML = SVG_CC;
    ccBtn.title = "字幕";
    var qnBtn = el("div", "bdm-ctrl-btn bdm-btn-qn", cRight);
    qnBtn.textContent = "画质";
    qnBtn.title = "清晰度";
    var rateBtn = el("div", "bdm-ctrl-btn bdm-btn-rate", cRight);
    rateBtn.textContent = "倍速";
    rateBtn.title = "倍速";
    var vol = el("div", "bdm-vol", cRight);
    var volBtn = el("div", "bdm-ctrl-btn bdm-btn-vol", vol);
    volBtn.innerHTML = SVG_VOL;
    volBtn.title = "音量";
    var volSlide = el("div", "bdm-vol-slide", vol);
    var volRange = el("input", "bdm-vol-range", volSlide);
    volRange.type = "range"; volRange.min = "0"; volRange.max = "100"; volRange.value = "70";
    volRange.title = "音量";
    var wideBtn = el("div", "bdm-ctrl-btn bdm-btn-wide", cRight);
    wideBtn.innerHTML = SVG_WIDE;
    wideBtn.title = "宽屏（裁切铺满）";
    var pipBtn = el("div", "bdm-ctrl-btn bdm-btn-pip", cRight);
    pipBtn.innerHTML = SVG_PIP;
    pipBtn.title = "画中画";
    var setBtn = el("div", "bdm-ctrl-btn bdm-btn-set", cRight);
    setBtn.innerHTML = SVG_GEAR;
    setBtn.title = "设置";
    var fullBtn = el("div", "bdm-ctrl-btn bdm-btn-full", cRight);
    fullBtn.innerHTML = SVG_FULL;
    fullBtn.title = "全屏";
    // 两个设置面板：弹幕设置悬在弹幕条上方，播放器设置贴右侧
    var dmPanel = buildPanel(slide, "bdm-dm-settings");
    var setPanel = buildPanel(slide, "bdm-set-settings");
    var descPanel = buildPanel(slide, "bdm-desc-panel");   // 简介面板（按需展开，内容懒加载）
    var ctxMenu = buildContextMenu(slide);

    return {
      root: slide, videoArea: wrap, info: info, rail: rail,
      panel: panel, panelBody: pBody, panelTitle: pTitle,
      more: more,
      dmRow: dmRow,                                     // 弹幕发送行（独立一行，控制条下方）
      season: season, seasonList: seasonList, descPanel: descPanel,
      seek: { track: seekTrack, fill: seekFill },
      progress: seekFill,                                // 兼容旧引用（timeupdate 驱动 + bindSeek）
      dmPanel: dmPanel, setPanel: setPanel, ctxMenu: ctxMenu,
      ctrl: {
        play: playBtn, next: nextBtn, time: timeLb,
        dm: dmBtn, dmInput: dmInput, dmSet: dmSetBtn, dmSend: dmSendBtn, online: onlineEl, etq: dmEtq,
        cmt: cmtBtn, cc: ccBtn, qn: qnBtn, rate: rateBtn,
        volBtn: volBtn, volRange: volRange, wide: wideBtn, pip: pipBtn, set: setBtn, full: fullBtn
      }
    };
  }

  function countOf(item, kind) {
    var st = item.stat || {};
    if (kind === "like") return st.like;
    if (kind === "coin") return st.coin;
    if (kind === "fav") return st.favorite;
    if (kind === "comment") return st.reply;
    if (kind === "share") return st.share;
    return 0;
  }

  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
    if (n >= 10000) return (n / 10000).toFixed(1) + "万";
    return String(n);
  }

  // 左侧固定按钮："刷B站"（客户端风格：品牌蓝、6px 圆角）
  var NAV_HOSTS = [".bili-header__bar .left-entry", ".bili-header .left-entry", ".left-entry", ".bili-header__bar", "#biliMainHeader"];

  function navHost() {
    for (var i = 0; i < NAV_HOSTS.length; i++) {
      var n = document.querySelector(NAV_HOSTS[i]);
      if (n) return n;
    }
    return null;
  }

  // MARGIN（映间）会把整个 .bili-header display:none —— 按钮注入其中等于注入隐形容器。
  // 独立检测根节点 margin- 前缀类（与 skin.js 的 marginOn 同判据，避免模块加载顺序耦合）。
  function marginOn() {
    var cls = document.documentElement && document.documentElement.classList;
    if (!cls) return false;
    for (var i = 0; i < cls.length; i++) if (cls[i].indexOf("margin-") === 0) return true;
    return false;
  }

  function injectNavButton(onClick) {
    if (document.getElementById("bdm-nav-btn")) return;
    if (!document.body) return;
    var btn = el("button", "");
    btn.id = "bdm-nav-btn";
    btn.type = "button";
    btn.title = "刷B站 · 沉浸模式";
    btn.innerHTML = "<svg viewBox='0 0 24 24'><path d='M8 5v14l11-7z'/></svg><span>刷B站</span>";
    btn.addEventListener("click", onClick);
    var host = marginOn() ? null : navHost();   // MARGIN 在场 → 不入隐藏的 header，走悬浮按钮
    if (host) { host.appendChild(btn); btn.classList.add("bdm-nav-inline"); }
    else { document.body.appendChild(btn); btn.classList.add("bdm-nav-fixed"); }
    console.log("[刷B站] 入口已注入（" + (host ? "导航栏" : "悬浮左下角") + "）");
  }

  // B站是 SPA，导航栏可能被重绘；定时守护，缺失即补
  function keepNavButton(onClick) {
    injectNavButton(onClick);
    setInterval(function () {
      if (!S.get().enabled) {          // 刷B站关闭 → 入口消失；桌面版样式不受影响
        var b = document.getElementById("bdm-nav-btn");
        if (b) b.remove();
        return;
      }
      var b = document.getElementById("bdm-nav-btn");
      if (b && marginOn() && b.classList.contains("bdm-nav-inline")) b.remove();   // MARGIN 挂类 → 转悬浮
      if (b && !marginOn() && b.classList.contains("bdm-nav-fixed") && navHost()) b.remove();  // MARGIN 离场 → 回导航栏
      injectNavButton(onClick);
    }, 2000);
  }

  // 未登录：抑制登录弹窗（隐藏遮罩面板，不打断页面）
  var mo = null;
  function startLoginSuppression() {
    if (mo) return;
    mo = new MutationObserver(function () {
      // 选择器经源码核对：bili-mini-mask / bili-mini 真实存在；
      // 原先写的 .login-panel-bili 与 .bili-mini-base 在页面里 0 命中，已删除。
      // 用 display:none 而非 remove()：B站 脚本仍持有该节点引用，硬删会让它自己的回调报错。
      var masks = document.querySelectorAll(".bili-mini-mask, .bili-mini");
      masks.forEach(function (m) {
        if (S.get().suppressLoginPopup) m.style.display = "none";
      });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // 不自动暂停：拦截页面失焦检测（capture 阶段截断 visibilitychange）
  function startNoAutoPause() {
    document.addEventListener("visibilitychange", function (e) {
      if (S.get().noAutoPause && document.bdmImmersive) {
        e.stopImmediatePropagation();
      }
    }, true);
  }

  window.__BDM__.ui = {
    buildSlide: buildSlide,
    injectNavButton: injectNavButton,
    keepNavButton: keepNavButton,
    startLoginSuppression: startLoginSuppression,
    startNoAutoPause: startNoAutoPause,
    el: el, icon: icon, fmt: fmt
  };
})();
