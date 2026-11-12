// 验证推断：dislike 的 -400 是「匿名 + csrf 为空」造成的，而不是载荷字段错。
const BASE = 'https://api.bilibili.com';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://www.bilibili.com/', 'Origin': 'https://www.bilibili.com',
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
};
async function post(label, path, params) {
  try {
    const r = await fetch(BASE + path, { method: 'POST', headers: H, body: new URLSearchParams(params).toString() });
    const t = await r.text();
    let tag = t.slice(0, 40).replace(/\s+/g, ' ');
    try { const j = JSON.parse(t); tag = 'code=' + j.code + ' ' + JSON.stringify(String(j.message || '').slice(0, 24)); } catch (e) { tag = '非JSON'; }
    console.log(label.padEnd(38) + ' http=' + r.status + ' ' + tag);
  } catch (e) { console.log(label.padEnd(38) + ' 异常'); }
}
const v = await (await fetch(BASE + '/x/web-interface/view?bvid=BV1xx411c7mD', { headers: H })).json();
const d = v.data || {};
const base = { app_id: 100, platform: 5, from_spmid: '', spmid: '333.1007.0.0', goto: 'av', id: d.aid, mid: (d.owner || {}).mid || 0, track_id: '', feedback_page: 1, reason_id: 1 };
await post('csrf 为空（上一轮的形态）', '/x/web-interface/feedback/dislike', Object.assign({}, base, { csrf: '' }));
await post('csrf 非空但无效', '/x/web-interface/feedback/dislike', Object.assign({}, base, { csrf: 'deadbeefdeadbeef' }));
await post('对照·点赞 csrf 非空无效', '/x/web-interface/archive/like', { bvid: d.bvid, like: 1, csrf: 'deadbeefdeadbeef' });
await post('对照·点赞 csrf 非空无效', '/x/web-interface/coin/add', { bvid: d.bvid, multiply: 1, csrf: 'deadbeefdeadbeef' });
