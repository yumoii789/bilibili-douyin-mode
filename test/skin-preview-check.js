
(function () {
  var skinOn = document.documentElement.classList.contains("bdm-skin");
  if (/[?&]skin=0/.test(location.search)) { document.documentElement.classList.remove("bdm-skin"); skinOn = false; }
  var SKIN = skinOn;
  if (/[?&]panel=1/.test(location.search)) {
    setTimeout(function () {
      var pn = document.querySelector(".search-panel");
      if (pn) { pn.style.display = "block"; pn.style.visibility = "visible"; pn.style.opacity = "1"; }
      var box = document.querySelector(".center-search-container");
      if (box) { var r = pn.getBoundingClientRect(); console.log("[下拉] 面板=" + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height) + " 容器高=" + Math.round(box.getBoundingClientRect().height) + " 容器overflow=" + getComputedStyle(box).overflow); }
    }, 900);
  }
  if (/[?&]dark=1/.test(location.search)) { document.documentElement.classList.add("bili_dark"); }   // 暗色组合态
  setTimeout(function () {
    var q = function (s) { return document.querySelector(s); };
    var QA = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
    var R = function (el) { return el ? el.getBoundingClientRect() : null; };
    var L = [], bad = [];
    var side = R(q(".bili-header__bar")), search = R(q(".center-search-container"));
    var items = QA(".left-entry__item"), trigs = QA(".left-entry__item-trigger");
    // 照扩展的做法注入「刷B站」按钮：真实注入点是 .left-entry（append 到末尾）
    var le = q(".left-entry");
    if (le && !document.getElementById("bdm-nav-btn")) {
      var nb = document.createElement("button");
      nb.id = "bdm-nav-btn"; nb.type = "button"; nb.title = "刷B站 · 沉浸模式";
      nb.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><span>刷B站</span>';
      le.appendChild(nb);
    }
    var nbEl = document.getElementById("bdm-nav-btn"), nbR = R(nbEl);
    var sibs = le ? Array.prototype.slice.call(le.children).map(function (n) { return n.className.toString().slice(0, 26) || n.id; }) : [];
    L.push("注入的入口按钮 在 .left-entry 的第 " + (le ? Array.prototype.indexOf.call(le.children, nbEl) : -1) + " 个孩子（共 " + (le ? le.children.length : 0) + "），位置 " + (nbR ? Math.round(nbR.left) + "," + Math.round(nbR.top) : "无") + " 尺寸 " + (nbR ? Math.round(nbR.width) + "x" + Math.round(nbR.height) : "无"));
    L.push("  .left-entry 的孩子：" + JSON.stringify(sibs));
    QA(".left-entry__item").forEach(function (it, k) {
      var svg = it.querySelector("svg"), path = it.querySelector("path");
      var txt = (it.querySelector(".trigger-text") || {}).textContent || "";
      if (!svg) { console.log("[图标] 项#" + k + " 「" + txt + "」没有 svg"); return; }
      var chain = []; for (var q2 = svg; q2 && q2 !== document.documentElement; q2 = q2.parentElement) chain.push((q2.tagName || "?").toLowerCase() + "." + String(q2.className || "").slice(0, 24));
      console.log("[父链] 项#" + k + " " + chain.join(" < "));
      if (k === 0) {
        var found = [];
        Array.prototype.slice.call(document.styleSheets).forEach(function (ss) {
          try { Array.prototype.slice.call(ss.cssRules).forEach(function (r) { if (r.cssText && r.cssText.indexOf("currentColor") >= 0) found.push(ss.href ? ss.href.split("/").pop() : "inline"); }); } catch (e) { found.push("(无法读取 " + (ss.href || "inline") + ")"); }
        });
        console.log("[规则检查] 含 currentColor 的样式表：" + JSON.stringify([...new Set(found)]));
      }
      var sc = getComputedStyle(svg), pc = path ? getComputedStyle(path) : null, r = svg.getBoundingClientRect();
      console.log("[自身色] 项#" + k + " svg.color=" + sc.color + " path.color=" + (pc ? pc.color : "无") + " a.color=" + getComputedStyle(it.querySelector(".left-entry__item-trigger")).color + " fill=" + sc.fill);
      console.log("[图标] 项#" + k + " 「" + txt + "」svg " + Math.round(r.width) + "x" + Math.round(r.height) + " display=" + sc.display + " op=" + sc.opacity + " fill=" + sc.fill + " pathFill=" + (pc ? pc.fill : "无") + " 文字色=" + getComputedStyle(it.querySelector(".left-entry__item-trigger")).color);
    });
    var dump = function (sel) {
      var el = q(sel); if (!el) return sel + "=无";
      var cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return sel + " display=" + cs.display + " dir=" + cs.flexDirection + " pos=" + cs.position + " w=" + Math.round(r.width) + " h=" + Math.round(r.height) + " top=" + Math.round(r.top) + " margin=" + cs.marginTop + " flex=" + cs.flex + " align=" + cs.alignItems + " justifyContent=" + cs.justifyContent;
    };
    L.push("  " + dump(".left-entry"));
    L.push("  " + dump(".left-entry-main"));
    L.push("  " + dump("#bdm-nav-btn"));
    L.push("  " + dump(".left-entry__item"));
    L.push("  left-entry 的直接子节点数=" + (q(".left-entry") ? q(".left-entry").children.length : -1) + " innerHTML 末尾 120 字：" + (q(".left-entry") ? q(".left-entry").innerHTML.slice(-120).replace(/\s+/g, " ") : ""));
    if (SKIN && nbR) {
      var lastItem = items.length ? R(items[items.length - 1]) : null;
      L.push("  与最后一个导航项的垂直关系：入口 top=" + Math.round(nbR.top) + "，末项 bottom=" + (lastItem ? Math.round(lastItem.bottom) : "无"));
      if (nbR.height < 34 || nbR.height > 46) bad.push("入口按钮高度 " + Math.round(nbR.height));
      if (Math.abs(nbR.left - 12) > 6) bad.push("入口左边距 " + Math.round(nbR.left));
    }
    L.push("侧栏 " + (side ? Math.round(side.width) + "x" + Math.round(side.height) : "无") + "  搜索容器高=" + (search ? Math.round(search.height) : "无"));
    var ys = items.map(function (n) { return Math.round(n.getBoundingClientRect().top); });
    var hs = items.map(function (n) { return Math.round(n.getBoundingClientRect().height); });
    L.push("导航项 n=" + items.length + " 各高=" + JSON.stringify(hs));
    L.push("导航项 y=" + JSON.stringify(ys));
    var pitch = []; for (var i = 1; i < ys.length; i++) pitch.push(ys[i] - ys[i - 1]);
    L.push("行距=" + JSON.stringify(pitch));
    var theme = getComputedStyle(document.documentElement).backgroundColor;
    L.push("背景=" + theme + "  内容列左=" + (R(q(".bili-header")) ? Math.round(R(q(".bili-header")).left) : "无"));
    // 找「番剧」胶囊并打印父链（我前面两次把宽度上限加错了容器）
    var chip = null;
    QA(".bili-header__channel *").forEach(function (n) { if (!chip && n.textContent.trim() === "番剧" && n.children.length === 0) chip = n; });
    if (chip) {
      var chain2 = [];
      for (var q3 = chip; q3 && q3 !== document.body; q3 = q3.parentElement) {
        var rr = q3.getBoundingClientRect();
        chain2.push((q3.className || q3.tagName).toString().slice(0, 30) + "[" + Math.round(rr.left) + "," + Math.round(rr.width) + "]");
      }
      console.log("[胶囊父链] " + chain2.join(" < "));
    } else { console.log("[胶囊父链] 没找到「番剧」胶囊"); }
    // 卡片网格与用户区实测
    var cards = QA(".bili-video-card").slice(0, 6).map(function (n) { var r = n.getBoundingClientRect(); return Math.round(r.width) + "x" + Math.round(r.height) + "@" + Math.round(r.left) + "," + Math.round(r.top); });
    var wraps = QA(".bili-video-card__wrap").slice(0, 6).map(function (n) { return Math.round(n.getBoundingClientRect().width); });
    var grid = q(".recommended-container") || q(".feed-card") || q(".bili-feed4");
    var gr = grid ? grid.getBoundingClientRect() : null;
    var title = q(".bili-video-card__info--tit");
    var tcs = title ? getComputedStyle(title) : null;
    var thumb = q(".bili-video-card__image--wrap") || q(".bili-video-card__cover");
    var tr = thumb ? thumb.getBoundingClientRect() : null;
    var tcs2 = thumb ? getComputedStyle(thumb) : null;
    console.log("[网格] 容器=" + (gr ? Math.round(gr.width) + "x" + Math.round(gr.height) + "@" + Math.round(gr.left) : "无") + " 卡片=" + JSON.stringify(cards) + " wrap宽=" + JSON.stringify(wraps));
    console.log("[网格] 缩略图=" + (tr ? Math.round(tr.width) + "x" + Math.round(tr.height) + " radius=" + tcs2.borderRadius : "无") + " 标题=" + (tcs ? tcs.fontSize + "/" + tcs.fontWeight + " color=" + tcs.color : "无"));
    // 侧栏底部用户区：在矮窗口下会不会被挤出可视区
    var bar2 = q(".bili-header__bar"), re2 = q(".right-entry"), lentry = q(".left-entry");
    var barR = bar2 ? bar2.getBoundingClientRect() : null, reR = re2 ? re2.getBoundingClientRect() : null;
    var leR = lentry ? lentry.getBoundingClientRect() : null;
    L.push("侧栏 高=" + (barR ? Math.round(barR.height) : "无") + " scrollH=" + (bar2 ? bar2.scrollHeight : "无") + " overflowY=" + (bar2 ? getComputedStyle(bar2).overflowY : "无"));
    L.push("导航块 bottom=" + (leR ? Math.round(leR.bottom) : "无") + " 用户区 top=" + (reR ? Math.round(reR.top) : "无") + " 高=" + (reR ? Math.round(reR.height) : "无") + " bottom=" + (reR ? Math.round(reR.bottom) : "无"));
    L.push("用户区是否在首屏内=" + (reR && barR ? (reR.bottom <= barR.bottom + 1 ? "是" : "否（被挤出，需要滚动侧栏）") : "无"));
    var ch = R(q(".bili-header__channel")), sc2 = R(q(".center-search-container")), re = R(q(".right-entry"));
    L.push("顶部工具条 频道行 " + (ch ? Math.round(ch.left) + "," + Math.round(ch.top) + " " + Math.round(ch.width) + "x" + Math.round(ch.height) : "无") + " | 搜索 " + (sc2 ? Math.round(sc2.right - sc2.width) + "," + Math.round(sc2.top) + " " + Math.round(sc2.width) + "x" + Math.round(sc2.height) : "无") + " | 用户区 " + (re ? Math.round(re.right) + " 宽" + Math.round(re.width) : "无"));
    var de = document.documentElement; L.push("横向溢出=" + (de.scrollWidth - de.clientWidth) + "px");
    // 判定：行高必须一致（我们注入的按钮不在这个统计里，它由真扩展注入）
    if (SKIN) {
      if (!side || Math.abs(side.width - 200) > 4) bad.push("侧栏宽");
      if (hs.length && Math.max.apply(null, hs) - Math.min.apply(null, hs) > 2) bad.push("行高不一致 " + JSON.stringify(hs));
      if (pitch.length && (Math.max.apply(null, pitch) - Math.min.apply(null, pitch) > 2 || pitch[0] > 60)) bad.push("行距不均 " + JSON.stringify(pitch));
      if (de.scrollWidth - de.clientWidth > 4) bad.push("横向溢出");
    }
    L.push(bad.length ? "自检 FAIL：" + bad.join(" / ") : "自检 PASS（行高与行距一致）");
    // 滚动联动：sticky 频道条 + fixed 侧栏 + fixed 搜索框 是否仍然对齐
    setTimeout(function () {
      window.scrollTo(0, 600);
      setTimeout(function () {
        var b3 = R(q(".bili-header__bar")), ch3 = R(q(".bili-header__channel")), sc3 = R(q(".center-search-container"));
        var first = q(".recommended-container") || q(".bili-feed4");
        var f3 = first ? first.getBoundingClientRect() : null;
        var msg = "滚动 600 后：侧栏 top=" + (b3 ? Math.round(b3.top) : "无") + " 频道条 top=" + (ch3 ? Math.round(ch3.top) : "无") + " 搜索 top=" + (sc3 ? Math.round(sc3.top) : "无") + " 首块 top=" + (f3 ? Math.round(f3.top) : "无") + " scrollY=" + Math.round(window.scrollY);
        var bad2 = [];
        if (b3 && Math.abs(b3.top) > 1) bad2.push("侧栏没固定住");
        if (ch3 && Math.abs(ch3.top) > 1) bad2.push("频道条没吸顶");
        if (sc3 && Math.abs(sc3.top - 8) > 2) bad2.push("搜索框没跟着");
        // 内容从固定条下方穿过是**正常**的（客户端同样如此）；原先我拿「内容容器」当判据是错的，
        // 容器本来就会随页面滚走 → 那条判据只会制造假警报。真正该判的是「条自己有没有吸住」（上面两条）。
        console.log("[滚动检查] " + msg + " → " + (bad2.length ? "FAIL：" + bad2.join("/") : "PASS：三者仍对齐"));
      }, 260);
    }, 1500);
    L.forEach(function (x) {
      console.log("[皮肤2] " + x);
      try { if (window.parent !== window) window.parent.postMessage({ bdmSkin: x }, "*"); } catch (e) {}
    });
  }, 1200);
})();

