// ============ B站 API 封装（只读 + 显式操作） ============
window.__BDM__ = window.__BDM__ || {};
(function () {
  var API = {};

  // ---------- 精简 MD5（wbi 签名用，RFC 1321 紧凑实现） ----------
  function md5cycle(x, k) {
    var a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
  function md51(s) {
    var n = s.length, state = [1732584193, -271733879, -1732584194, 271733878], i;
    for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
    s = s.substring(i - 64);
    var tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) { md5cycle(state, tail); for (i = 0; i < 16; i++) tail[i] = 0; }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }
  function md5blk(s) {
    var blks = [], i;
    for (i = 0; i < 64; i += 4) blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    return blks;
  }
  function rhex(n) {
    var s = "", j = 0;
    for (; j < 4; j++) s += ("0" + ((n >> (j * 8 + 4)) & 0x0F).toString(16)) + ("0" + ((n >> (j * 8)) & 0x0F).toString(16));
    return s;
  }
  function hex(x) { for (var i = 0; i < x.length; i++) x[i] = rhex(x[i]); return x.join(""); }
  var MD5 = function (s) { return hex(md51(unescape(encodeURIComponent(s)))); };
  API.md5 = MD5;

  // ---------- wbi 签名 ----------
  var MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
    26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
  var wbiCache = null;

  function readWbiFromPage() {
    try {
      var st = window.__INITIAL_STATE__;
      if (st && st.defaultWbiKey && st.defaultWbiKey.wbiImgKey) {
        return { img: st.defaultWbiKey.wbiImgKey, sub: st.defaultWbiKey.wbiSubKey };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function fetchWbiFallback() {
    // 官方 wbi 密钥来源：nav 接口（未登录也会返回 wbi_img）。
    // 旧实现硬编码扒 https://www.bilibili.com/video/BV1x411c7mD —— 该视频早已 404，
    // 于是密钥永远取不到、签名参数 w_rid 恒缺失，用户控制台里那一串 404 就是它。
    try {
      var j = await API.get('https://api.bilibili.com/x/web-interface/nav', 8000);
      var w = j && j.data && j.data.wbi_img;
      if (w && w.img_url && w.sub_url) {
        var img = String(w.img_url).split('/').pop().split('.')[0];
        var sub = String(w.sub_url).split('/').pop().split('.')[0];
        if (img && sub) return { img: img, sub: sub };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // 保鲜期：B站 会轮换 wbi 密钥，过了这个时间必须回源重取，否则签名恒失效。
  var WBI_TTL = 1800000;
  var wbiPageKey = null, wbiPageAt = 0;   // 页面烘焙的那对密钥：只记「首次见到」的时间

  function stampWbi(img, sub, at) {
    wbiCache = { img: img, sub: sub, at: at || Date.now() };
    return wbiCache;
  }

  // 请求被拒（签名过期 / 风控）时调用：下一轮 getWbi 会回源 nav 重取密钥。
  // 页面那对也要标记成过期 —— 长驻标签页里的 __INITIAL_STATE__ 永远不会自己更新。
  API.dropWbi = function () {
    wbiCache = null;
    wbiPageAt = Date.now() - WBI_TTL - 1;
  };

  API.getWbi = async function () {
    if (wbiCache && Date.now() - wbiCache.at < WBI_TTL) return wbiCache;
    // 页面里烘焙的密钥只在「刚读到」时可信。沉浸流一刷几小时都不刷新页面，
    // 而 B站 早已轮换密钥 —— 旧实现每次调用都把它当新鲜的返回，于是
    // 保鲜期 + nav 重取这条自愈路径**在 B站 页面上永远走不到**：
    // 签名恒被拒 → 一路退化到那个间歇 412 的免签老端点，直到用户手动刷新页面。
    var fromPage = readWbiFromPage();
    if (fromPage) {
      if (wbiPageKey !== fromPage.img) { wbiPageKey = fromPage.img; wbiPageAt = Date.now(); }
      if (Date.now() - wbiPageAt < WBI_TTL) return stampWbi(fromPage.img, fromPage.sub, wbiPageAt);
    }
    var got = await fetchWbiFallback();
    if (got) return stampWbi(got.img, got.sub);   // nav 结果不写 wbiPage*：页面那对的过期判定不能被它洗白
    // 回源失败：先顶着用页面那对，但 1 分钟后重试（离线/被限流时别把签名整个丢掉）
    if (fromPage) return stampWbi(fromPage.img, fromPage.sub, Date.now() - WBI_TTL + 60000);
    return wbiCache;
  };

  API.signWbi = async function (params) {
    var key = await API.getWbi();
    var p = Object.assign({}, params, { wts: Math.floor(Date.now() / 1000) });
    var dirty = new RegExp('[!' + String.fromCharCode(39) + '()*]', 'g');
    var qs = Object.keys(p).sort().map(function (k) {
      var v = String(p[k]).replace(dirty, '');
      return encodeURIComponent(k) + '=' + encodeURIComponent(v);
    }).join('&');
    if (key) {
      var keys = key.img + key.sub;
      var mixin = MIXIN_TAB.map(function (i) { return keys[i]; }).join('').slice(0, 32);
      qs += '&w_rid=' + MD5(qs + mixin);
    }
    return qs;
  };

  // ---------- 基础请求 / cookie ----------
  // 带超时的 fetch：B站 限流（实测遇过 412）时连接可能长时间挂住，
  // 而滑动手势一旦 await 到挂住的请求，整个信息流就再也划不动。宁可失败也不能挂住。
  // Promise.race 自带超时拒绝：不能只靠 AbortController 让请求失败 ——
  // 一旦底层 fetch 不响应 abort（代理、长连接、被拦截的请求都可能如此），Promise 仍会永远挂着。
  function fetchT(url, opt, ms) {
    var limit = ms || 10000;
    var o = Object.assign({}, opt || {});
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    if (ctl) o.signal = ctl.signal;
    var timer = null;
    var timeout = new Promise(function (_, rej) {
      timer = setTimeout(function () {
        if (ctl) { try { ctl.abort(); } catch (e) { /* ignore */ } }
        rej(new Error('请求超时（' + limit + 'ms）'));
      }, limit);
    });
    return Promise.race([
      fetch(url, o).then(function (r) { clearTimeout(timer); return r; },
        function (e) { clearTimeout(timer); throw e; }),
      timeout
    ]);
  }
  API.get = async function (url, ms) {
    var r = await fetchT(url, { credentials: 'include', method: 'GET' }, ms);
    return r.json();
  };
  API.post = async function (url, params, ms) {
    var r = await fetchT(url, {
      credentials: 'include', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams(params).toString()
    }, ms);
    return r.json();
  };
  function cookieVal(name) {
    var parts = document.cookie.split('; ');
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq > 0 && parts[i].slice(0, eq) === name) return parts[i].slice(eq + 1);
    }
    return '';
  }
  API.csrf = function () { return cookieVal('bili_jct'); };
  API.isLogin = function () { return !!cookieVal('SESSDATA'); };
  API.myMid = function () { return cookieVal('DedeUserID'); };

  // ---------- 推荐流（优先 wbi 签名端点；响应字段为 data.item，含 bvid+cid） ----------
  // v0.1.21：参数集对齐 B站 首页真实请求（laputa-home index-84fb5632.js 逆向 + 在线实测）。
  // fresh_type 枚举：Init=0 / Change=3 / DropDown=4 / Refresh=5；首页行为 =
  // 首刷 Init、之后每次上拉 DropDown；fresh_idx 随每次请求递增、brush 随 DropDown 递增。
  // 实测该参数组 4 连发 120 条 / 98% UP 去重；旧实现仅发 ps+wbi+fresh_type:3，
  // 缺 y_num/screen/brush 等，同分区内容反复聚类，正是「总是同一类视频」的主因。
  var rcmdState = { freshIdx: 0, brush: -1 };
  function rcmdParams(ps) {
    var first = rcmdState.freshIdx === 0;
    rcmdState.freshIdx += 1;
    if (!first) rcmdState.brush += 1;
    return {
      y_num: 0,
      fresh_type: first ? 0 : 4,
      feed_version: 'V8',
      fresh_idx_1h: rcmdState.freshIdx - 1,
      fetch_row: 1,
      fresh_idx: rcmdState.freshIdx - 1,
      brush: rcmdState.brush,
      device: 'pc_web',
      homepage_ver: 1,
      ps: ps,
      last_y_num: 0,
      screen: (typeof screen !== 'undefined' && screen.width ? screen.width + ',' + screen.height : '1920,1080'),
      tt_exp: ''
    };
  }
  // 旧端点退路：接受同一参数集，但走明文 query（免 wbi）。旧端点会间歇 412 限流，故仅作兜底。
  // feed 统一的收录判据：直播条目没有 bvid/cid（形态 {goto:'live', roomid, uname, online, ...}），
  // 三个 feed 接口原先都按「有 bvid 且有 cid」过滤，把它一并丢掉 ——
  // 结果是 douyin-mode 里那条直播降级分支（规格⑨「还有直播和直播间」）永远不可达。
  function keepFeedItem(it) {
    if (!it) return false;
    if (it.goto === 'live') return !!it.roomid;
    return !!(it.bvid && it.cid);
  }
  API.rcmd = async function (ps) {
    ps = ps || 12;
    var pr = rcmdParams(ps);
    var plain = [];
    for (var k in pr) plain.push(encodeURIComponent(k) + '=' + encodeURIComponent(pr[k]));
    var j = null;
    try {
      var qs = await API.signWbi(pr);
      j = await API.get('https://api.bilibili.com/x/web-interface/wbi/index/top/rcmd?' + qs);
    } catch (e) { j = null; }
    if (!j || j.code !== 0) {
      API.dropWbi();   // 很可能是签名过期：作废密钥，下一轮回源 nav 重取（否则会一直用坏密钥）
      j = await API.get('https://api.bilibili.com/x/web-interface/index/top/rcmd?' + plain.join('&'));
    }
    if (j.code !== 0) throw new Error('rcmd ' + j.code + ' ' + (j.message || ''));
    var items = (j.data && (j.data.item || j.data.items)) || [];
    if (!Array.isArray(items)) items = [];   // 防御：item 可能是单对象而非数组
    return items.filter(keepFeedItem);
  };

  // 「不感兴趣」—— B站 首页推荐的正规调控手段，参数取自 B站 前端原样
  // （s1.hdslb.com/bfs/static/shanks/laputa-home/assets/index-*.js）：
  //   {app_id:100, platform:5, from_spmid, spmid:"333.1007.0.0", goto,
  //    id: aid||roomId, mid: UP主mid, track_id, feedback_page:1, reason_id}
  // 撤销走同结构打 .../dislike/cancel。reason_id: 1=内容不感兴趣，4=不想看此UP主。
  // 注意 id 用的是 **aid**（推荐条目里的 id 字段），不是 bvid。
  function dislikePayload(item) {
    return {
      app_id: 100,
      platform: 5,
      from_spmid: '',
      spmid: '333.1007.0.0',
      goto: item.goto || 'av',
      id: item.id || item.aid || 0,
      mid: (item.owner && item.owner.mid) || 0,
      track_id: item.track_id || '',
      feedback_page: 1
    };
  }
  API.dislike = async function (item, reasonId) {
    var p = dislikePayload(item);
    p.reason_id = reasonId || 1;
    p.csrf = API.csrf();
    return API.post('https://api.bilibili.com/x/web-interface/feedback/dislike', p, 8000);
  };
  API.dislikeCancel = async function (item, reasonId) {
    var p = dislikePayload(item);
    p.reason_id = reasonId || 1;
    p.csrf = API.csrf();
    return API.post('https://api.bilibili.com/x/web-interface/feedback/dislike/cancel', p, 8000);
  };

  // 热门：无需 wbi。实测 20 条覆盖 15 个分区、UP 全不重复，
  // 是给推荐流补多样性的最佳来源（related 按定义就是同分区，不能当主力）。
  API.popular = async function (pn) {
    var j = await API.get('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=' + (pn || 1), 8000);
    if (j.code !== 0) throw new Error('popular ' + j.code + ' ' + (j.message || ''));
    return ((j.data && j.data.list) || []).filter(keepFeedItem);
  };

  // 相关视频：无需 wbi，实测稳定返回 40 条且字段完整。
  // 推荐流被风控时的续接源，保证信息流永不枯竭。
  API.related = async function (bvid) {
    var j = await API.get('https://api.bilibili.com/x/web-interface/archive/related?bvid=' + encodeURIComponent(bvid));
    if (j.code !== 0) throw new Error('related ' + j.code + ' ' + (j.message || ''));
    return (j.data || []).filter(keepFeedItem);
  };

  // ---------- 播放地址（fnval=1 取 durl 直链 MP4，音视频合并可直接播） ----------
  // 清晰度档位与播放流：线上实测（2024）
  //   fnval=1    → 只回 mp4(durl)，档位被压成「高清 720P/流畅 360P」——这就是「画质不全」的根因
  //   fnval=4049 → 只要带上 mp4 位，档位同样塌回 720P
  //   fnval=4048 → 不设 mp4 位时档位才是全量（超清 4K/1080P+/1080P…），但只给 DASH（视频与音频分离）
  // 因此：并行发两次，菜单用全量档位，播放优先 mp4 直链，高档位走 DASH 双轨（player.setSrc 第二参为音轨）。
  function dl(u, ms) {
    return (API.get(u, ms) || Promise.resolve(null)).catch(function () { return null; });
  }
  async function playurlOnce(bvid, cid, qn, fnval) {
    var qs = await API.signWbi({ bvid: bvid, cid: cid, qn: qn, fnval: fnval, fourk: 1, platform: 'pc', high_quality: 1 });
    var j = await API.get('https://api.bilibili.com/x/player/wbi/playurl?' + qs);
    if (!j || j.code !== 0) {
      if (!j || j.code === -403 || j.code === -352) API.dropWbi();   // 签名过期 / 风控：作废密钥
      return null;
    }
    return j.data || null;
  }
  // DASH 取流：同档位优先 avc1（Chrome 原生可解），否则退回该档位任一流
  // 只认精确档位：找不到该档位的流就返回 null，绝不「降一档冒充」——否则菜单写着 4K、画面却是 480P
  function codecRe(k) { return k === 'hevc' ? /^hvc|^hev/i : (/^av01/i.test(k) ? /^av01/i : /^avc/i); }
  function pickDash(d, qn, codec) {
    var vs = (d && d.dash && d.dash.video) || [];
    var same = vs.filter(function (v) { return Number(v.id) === Number(qn); });
    if (!same.length) return null;
    var pool = [];
    if (codec && codec !== 'auto') pool = same.filter(function (v) { return codecRe(codec).test(String(v.codecs || '')); });
    // 默认或偏好档位缺流时优先 avc1：Chrome 原生可解，HEVC/AV1 视系统支持
    if (!pool.length) pool = same.filter(function (v) { return /^avc/i.test(String(v.codecs || '')); });
    var v = (pool.length ? pool : same)[0];
    var as = (d.dash.audio || []).slice().sort(function (a, b) { return (b.bandwidth || 0) - (a.bandwidth || 0); });
    return { mode: 'dash', url: v.baseUrl || v.base_url || (v.backupUrl || [])[0],
      audioUrl: as.length ? (as[0].baseUrl || as[0].base_url) : null, quality: Number(v.id) };
  }
  API.playurl = async function (bvid, cid, qn, opts) {
    var q = qn || 64;
    var codec = (opts && opts.codec) || 'auto';
    var got = await Promise.all([playurlOnce(bvid, cid, q, 4048), playurlOnce(bvid, cid, q, 1)]);
    var full = got[0], mp4 = got[1];
    if (!full && !mp4) throw new Error('playurl 无响应');
    var list = (full && full.accept_quality) || (mp4 && mp4.accept_quality) || [];
    var desc = (full && full.accept_description) || (mp4 && mp4.accept_description) || [];
    // 多段稿件：B站 原生播放器会用 durl 分片列表续播。实测 6 条 110~419 分钟的长稿件都只回 1 段，
    // 该形态在当前 API 已几乎不可见；但一旦命中，取末段会让画面从片子尾部开始（静默错），
    // 所以这里取首段并打上 multiSegment，由上层显式降级给出出口。
    var segs = (mp4 && mp4.durl) || [];
    var seg = segs.length ? segs[0] : null;
    var mp4Qn = mp4 ? Number(mp4.quality) : 0;
    var exactDash = pickDash(full, q, codec);
    // 本稿件实际存在的编码轨（设置面板据此只给真选项，不做死选项）
    var codecs = { avc: false, hevc: false, av1: false };
    ((full && full.dash && full.dash.video) || []).forEach(function (v) {
      var c = String(v.codecs || '');
      if (/^avc/i.test(c)) codecs.avc = true;
      else if (/^hvc|^hev/i.test(c)) codecs.hevc = true;
      else if (/^av01/i.test(c)) codecs.av1 = true;
    });
    // best：首屏用——服务端实际能给的最好可播档（mp4 优先，音画同源最稳）
    var best = seg ? { mode: 'mp4', url: seg.url, audioUrl: null, quality: mp4Qn } : exactDash;
    // exact：换档用——只有该档位真有流才算通过，否则如实告知原因，不静默降级
    var exact = (mp4Qn === Number(q) && seg) ? { mode: 'mp4', url: seg.url, audioUrl: null, quality: mp4Qn } : exactDash;
    var login = API.isLogin();
    var have = {};
    ((full && full.dash && full.dash.video) || []).forEach(function (v) { have[Number(v.id)] = 1; });
    var items = list.map(function (n, i) {
      var id = Number(n);
      var playable = !!(have[id] || (seg && mp4Qn === id));
      var why = playable ? '' : (login ? '大会员' : '需登录');
      return { qn: id, name: desc[i] || (id + 'P'), playable: playable, vip: !playable, why: why };
    });
    return {
      quality: (best && best.quality) || (full && full.quality) || mp4Qn,
      mode: best ? best.mode : null,
      url: best ? best.url : null,                     // 兼容旧键：可直接喂给 <video>
      audioUrl: best ? best.audioUrl : null,           // DASH 时配套音轨
      exact: exact,                                    // 换档严格判定结果（null = 该档位不可播）
      size: seg ? seg.size : 0,
      all: segs,
      segments: segs.length,
      multiSegment: segs.length > 1,
      codecs: codecs,
      qnList: list,
      qnDesc: desc,
      list: items,
      acceptQn: desc
    };
  };

  // ---------- 评论（x/v2/reply，type=1 视频，oid=aid；无需 wbi） ----------
  API.replies = async function (aid, pn) {
    var j = await API.get('https://api.bilibili.com/x/v2/reply?type=1&oid=' + aid + '&pn=' + (pn || 1) + '&ps=20&sort=1');
    if (j.code !== 0) throw new Error('reply ' + j.code + ' ' + (j.message || ''));
    var d = j.data || {};
    var list = (d.replies || []).map(function (r) {
      var m = r.member || {};
      return {
        uname: m.uname || '用户',
        face: m.avatar || '',
        text: (r.content && r.content.message) || '',
        like: (r.like || 0),
        reply: (r.rcount || 0),
        ctime: r.ctime || 0
      };
    });
    var count = d.cursor ? (d.cursor.all_count || d.all || 0) : (d.page ? d.page.count : (d.all || 0));
    var hasMore = d.cursor ? !d.cursor.is_end : (d.page ? ((pn || 1) * 20 < d.page.count) : list.length > 0);
    return { count: count, list: list, hasMore: hasMore };
  };

  // ---------- 弹幕（XML，oid=cid） ----------
  var DM_RE = new RegExp('<d p="([^"]+)">([^<]*)</d>', 'g');
  API.danmaku = async function (cid) {
    try {
      var r = await fetchT('https://api.bilibili.com/x/v1/dm/list.so?oid=' + cid, { credentials: 'include' }, 8000);
      var text = await r.text();
      var out = [], m;
      DM_RE.lastIndex = 0;
      while ((m = DM_RE.exec(text)) !== null) {
        var p = m[1].split(',');
        out.push({ t: parseFloat(p[0]), mode: parseInt(p[1], 10), size: parseInt(p[2], 10), color: parseInt(p[3], 10), text: m[2] });
      }
      out.sort(function (a, b) { return a.t - b.t; });
      return out;
    } catch (e) { return []; }
  };

  // ---------- 字幕：用 B站 原生数据源 ----------
  // 免 wbi 的 /x/player/v2 直接给字幕轨列表（lan / lan_doc / subtitle_url）；
  // 视频页还会把同一份数据放在 __INITIAL_STATE__.videoData.subtitle 里（内容脚本瞬时可读，省一次请求）。
  function normalizeSubs(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (s) {
      var u = String(s.subtitle_url || '');
      if (u.indexOf('//') === 0) u = 'https:' + u;
      return { lan: s.lan || '', doc: s.lan_doc || s.lan || '字幕', url: u };
    }).filter(function (s) { return !!s.url; });
  }
  API.normalizeSubs = normalizeSubs;
  API.subtitles = async function (bvid, cid) {
    var j = await API.get('https://api.bilibili.com/x/player/v2?bvid=' + bvid + '&cid=' + cid);
    if (!j || j.code !== 0) return { list: [] };
    var sub = (j.data || {}).subtitle || {};
    return { list: normalizeSubs(sub.subtitles), allowSubmit: !!sub.allow_submit };
  };
  // 字幕正文 JSON：{ body: [{from,to,location,content}] }
  // 内容脚本跨源取 aisubtitle.hdslb.com 受页面 CORS 约束；被拦时改走后台中转
  // （manifest 里已声明最小 host_permissions: *://*.hdslb.com/*，后台可跨源）
  // 中转最长等待：后台若因任何原因不回答（SW 未唤醒/被杀/消息丢失），
  // 也必须给出结果 —— 否则字幕会永远停在「加载中」，而且没有任何报错。
  var relayTimeoutMs = 6000;
  API.relayTimeoutMs = function (ms) { relayTimeoutMs = Number(ms) || 6000; return relayTimeoutMs; };   // 自测用
  function relayJson(url) {
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (done) return; done = true; clearTimeout(timer); resolve(v); }
      var timer = setTimeout(function () { fin(null); }, relayTimeoutMs);
      try {
        chrome.runtime.sendMessage({ type: 'bdm:fetch-json', url: url }, function (resp) {
          if (chrome.runtime.lastError) { fin(null); return; }
          fin(resp && resp.ok ? resp.data : null);
        });
      } catch (e) { fin(null); }
    });
  }
  API.subtitleBody = async function (url) {
    if (!url) return [];
    var j = null;
    try {
      var r = await fetchT(url, { credentials: 'include' }, 8000);
      j = await r.json();
    } catch (e) { j = null; }
    if (!j || !j.body) j = await relayJson(url);
    return ((j && j.body) || []).map(function (b) {
      return { from: Number(b.from) || 0, to: Number(b.to) || 0, text: String(b.content == null ? '' : b.content).trim() };
    }).filter(function (c) { return !!c.text; });
  };

  // ---------- 显式互动（仅用户点击触发；不受 profileGuard 拦截） ----------
  // 参数形态以 B站 自己视频页 bundle 里的调用点为准（开发记录 §48 有原文）：
  //   Sl({aid, like:1|2})  /  xl({aid})  /  kl({aid, multiply, select_like:0, cross_domain:true})
  // 官方发的是 **aid**；旧实现发 bvid —— 匿名探针分辨不出（未登录先被拦），只能靠读它的代码。
  // bvid 仍然一并带上：官方客户端不校验多余字段（它自己也带了 spmid/statistics 等），
  // 带上可以让老形态的接口也认。
  function aidOf(item) {
    return (item && (item.aid || item.id)) || 0;
  }
  API.triple = async function (item) {
    return API.post('https://api.bilibili.com/x/web-interface/archive/like/triple',
      { aid: aidOf(item), bvid: (item && item.bvid) || '', csrf: API.csrf() });
  };
  API.like = async function (item, like) {
    return API.post('https://api.bilibili.com/x/web-interface/archive/like',
      { aid: aidOf(item), bvid: (item && item.bvid) || '', like: like ? 1 : 2, csrf: API.csrf() });
  };
  // 投币：真实路径是 /x/web-interface/**coin/add**。
  // 旧实现写的是 /x/web-interface/archive/coin —— 实测那个路径返回 **HTTP 404**（与故意写错的
  // 对照路径一模一样），也就是说「投币」这个功能一直是死的；又因为弹窗只报了句
  // 「投币失败：请稍后重试」，用户根本看不出是端点写错了。见开发记录 §46 的探针表。
  API.coin = async function (item, num) {
    return API.post('https://api.bilibili.com/x/web-interface/coin/add', {
      aid: aidOf(item),
      bvid: (item && item.bvid) || '',
      multiply: num || 1,
      select_like: 0,          // 官方原样：不自动点赞
      cross_domain: true,
      csrf: API.csrf()
    });
  };
  // 收藏保存：官方（视频页 bundle）只发**存在的那一个** id 键，并带 platform:web。
  // 旧实现会把空的 del_media_ids= 也发出去 —— 多余字段服务端一般不校验，但没有理由发它。
  API.favDeal = async function (aid, addIds, delIds) {
    var p = { rid: aid, type: 2, platform: 'web', csrf: API.csrf() };
    if ((addIds || []).length) p.add_media_ids = addIds.join(',');
    if ((delIds || []).length) p.del_media_ids = delIds.join(',');
    return API.post('https://api.bilibili.com/x/v3/fav/resource/deal', p);
  };
  // 发弹幕（B站 网页版同款端点 /x/v2/dm/post）：type=1 是视频弹幕，oid 就是 cid，
  // progress 决定这条弹幕落在时间轴的哪一毫秒 —— 沉浸模式手里正好握着这个值。
  // 只在用户按下回车时调用（与点赞/投币同一门槛：显式操作），不做任何自动发送。
  API.dmPost = async function (item, text, progressMs, opt) {
    var o = opt || {};
    return API.post('https://api.bilibili.com/x/v2/dm/post', {
      type: 1,
      oid: item.cid,
      msg: text,
      bvid: item.bvid,
      progress: Math.max(0, Math.round(Number(progressMs) || 0)),
      mode: o.mode || 1,          // 1 滚动 / 4 底部 / 5 顶部（与 B站 一致）
      fontsize: 25,
      color: 16777215,
      pool: 0,
      plat: 1,
      csrf: API.csrf()
    }, 8000);
  };

  API.favFolders = async function (aid) {
    return API.get('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=' + API.myMid() + '&type=2&rid=' + aid);
  };

  // 视频详情（无需 wbi）：取分P与合集，供信息流串播（规格⑨⑫）
  API.view = async function (bvid) {
    var j = await API.get('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid));
    if (j.code !== 0) throw new Error('view ' + j.code + ' ' + (j.message || ''));
    return j.data || {};
  };

  // 在线人数（B站 播放器发送行最左的「N人正在看」）：端点实测可用（匿名也返回）——
  //   /x/player/online/total?bvid=&cid=  →  data.total / data.count / data.show_switch
  // 站方给了显示开关，为 false 就不显示。**拿不到就留空，绝不自造数字。**
  API.online = async function (bvid, cid) {
    if (!bvid || !cid) return null;
    var j = await API.get('https://api.bilibili.com/x/player/online/total?bvid=' + encodeURIComponent(bvid) +
      '&cid=' + encodeURIComponent(cid));
    if (!j || j.code !== 0 || !j.data) return null;
    var sw = j.data.show_switch || {};
    if (sw.total === false && sw.count === false) return null;
    var n = Number(sw.total === false ? j.data.count : j.data.total);
    if (!isFinite(n) || n <= 0) return null;
    return { n: n };
  };

  // 规范化为「同源续播列表」：优先合集（实测 10 个推荐里 6 个带合集，最多 109 集），
  // 其次多分P。字段名取自实测：episodes[] 含 bvid/cid/title/arc，
  // arc 含 stat 与 author（注意不是 owner）。
  API.siblings = function (item, view) {
    var out = [];
    var season = view && view.ugc_season;
    if (season && season.sections && season.sections.length) {
      season.sections.forEach(function (sec) {
        (sec.episodes || []).forEach(function (ep) {
          if (!ep || !ep.bvid || !ep.cid) return;
          var arc = ep.arc || {};
          var au = arc.author || arc.owner;
          out.push({
            bvid: ep.bvid,
            cid: ep.cid,
            aid: ep.aid || arc.aid,
            title: ep.title || arc.title || '',
            cover: arc.pic || '',
            owner: (au && au.name) ? { name: au.name, face: au.face } : item.owner,
            stat: arc.stat || item.stat,
            part: '合集'
          });
        });
      });
      return out;
    }
    var pages = (view && view.pages) || [];
    if (pages.length > 1) {
      pages.forEach(function (p) {
        out.push({
          bvid: item.bvid,
          cid: p.cid,
          aid: item.aid,
          title: (item.title || '') + (p.part ? ' · ' + p.part : ' · P' + p.page),
          cover: item.cover || '',
          owner: item.owner,
          stat: item.stat,
          part: 'P' + p.page
        });
      });
    }
    return out;
  };

  window.__BDM__.api = API;
})();
