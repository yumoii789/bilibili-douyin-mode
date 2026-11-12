// 写接口契约探针（匿名）：点赞/投币/三连/收藏 这些按钮的失败在 UI 里是**静默**的
// （按钮不变蓝、没有任何提示），所以端点一旦写错，用户只会以为「点了没反应」。
const BASE = 'https://api.bilibili.com';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://www.bilibili.com/',
  'Origin': 'https://www.bilibili.com',
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
};
async function post(label, path, params) {
  try {
    const r = await fetch(BASE + path, { method: 'POST', headers: H, body: new URLSearchParams(params).toString() });
    const t = await r.text();
    let tag = t.slice(0, 60).replace(/\s+/g, ' ');
    try { const j = JSON.parse(t); tag = 'code=' + j.code + ' message=' + JSON.stringify(String(j.message || '').slice(0, 30)); } catch (e) { tag = '非JSON(' + r.status + '): ' + tag; }
    console.log(label.padEnd(34) + ' http=' + r.status + ' ' + tag);
  } catch (e) { console.log(label.padEnd(34) + ' 异常 ' + String(e.message || e).slice(0, 50)); }
}
const v = await (await fetch(BASE + '/x/web-interface/view?bvid=BV1xx411c7mD', { headers: H })).json();
const d = v.data || {};
const bvid = d.bvid, aid = d.aid;
console.log('探针对象: ' + bvid + ' aid=' + aid + '（匿名，全部预期被拒：未登录 / csrf）');
await post('① like', '/x/web-interface/archive/like', { bvid: bvid, like: 1, csrf: '' });
await post('② triple', '/x/web-interface/archive/like/triple', { bvid: bvid, csrf: '' });
await post('③ coin', '/x/web-interface/archive/coin', { bvid: bvid, multiply: 1, select_like: 0, csrf: '' });
await post('④ fav deal', '/x/v3/fav/resource/deal', { rid: aid, type: 2, add_media_ids: '', del_media_ids: '', csrf: '' });
await post('⑤ 对照·错误路径', '/x/web-interface/archive/like_wrong', { bvid: bvid, csrf: '' });
