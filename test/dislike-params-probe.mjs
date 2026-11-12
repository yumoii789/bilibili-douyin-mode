// 找「不感兴趣」载荷的构造处：调用 Um( 的地方，以及 app_id / feedback_page / track_id 等字段。
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': 'https://www.bilibili.com/' };
const u = 'https://s1.hdslb.com/bfs/static/shanks/laputa-home/assets/index-84fb5632.js';
const t = await (await fetch(u, { headers: H })).text();
const ctx = (i, b, a) => t.slice(Math.max(0, i - b), i + a).replace(/\s+/g, ' ');
for (const key of ['Um(', 'app_id', 'feedback_page', 'track_id', 'spmid:"333']) {
  let i = t.indexOf(key), n = 0;
  console.log('=== ' + key + ' 命中=' + (i >= 0 ? '是' : '否'));
  while (i >= 0 && n < 2) { console.log('   …' + ctx(i, 420, 260) + '…'); i = t.indexOf(key, i + 1); n++; }
}
