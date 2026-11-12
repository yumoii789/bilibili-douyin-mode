// 找「普通弹幕条」的发送参数组装（而不是内核里那条 mode:9 的路径）。
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': 'https://www.bilibili.com/video/BV1xx411c7mD/' };
const P = 'https://s1.hdslb.com/bfs/static/player/main/core.1782590f.js';
const V = 'https://s1.hdslb.com/bfs/static/jinkela/video/video.8c3699a3aaf218112dadb300b3127b36bdacfe5c.js';
const pt = await (await fetch(P, { headers: H })).text();
const vt = await (await fetch(V, { headers: H })).text();
const ctx = (t, i, b, a) => t.slice(Math.max(0, i - b), i + a).replace(/\s+/g, ' ');
for (const [name, t, key, back, fwd] of [
  ['内核 fontsize:25', pt, 'fontsize:25', 340, 200],
  ['内核 16777215', pt, '16777215', 340, 200],
  ['内核 pool:0', pt, 'pool:0', 340, 200],
  ['视频页 dm/post', vt, 'dm/post', 300, 300]
]) {
  const i = t.indexOf(key);
  console.log('=== ' + name + (i >= 0 ? '' : '（未命中）'));
  if (i >= 0) console.log('  …' + ctx(t, i, back, fwd) + '…');
}
