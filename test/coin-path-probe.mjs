// 投币端点候选探测：前缀也可能是 /x/web-interface/coin/ 或老的 /x/v2/view/
const BASE = 'https://api.bilibili.com';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://www.bilibili.com/', 'Origin': 'https://www.bilibili.com',
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
};
async function post(label, path, params) {
  try {
    const r = await fetch(BASE + path, { method: 'POST', headers: H, body: new URLSearchParams(params || {}).toString() });
    const t = await r.text();
    let tag = t.slice(0, 40).replace(/\s+/g, ' ');
    try { const j = JSON.parse(t); tag = 'code=' + j.code + ' message=' + JSON.stringify(String(j.message || '').slice(0, 26)); } catch (e) { tag = '非JSON'; }
    console.log(label.padEnd(46) + ' http=' + r.status + ' ' + tag);
  } catch (e) { console.log(label.padEnd(46) + ' 异常'); }
}
const v = await (await fetch(BASE + '/x/web-interface/view?bvid=BV1xx411c7mD', { headers: H })).json();
const b = (v.data || {}).bvid;
const P = { bvid: b, multiply: 1, select_like: 0, csrf: '' };
await post('1 /x/web-interface/coin/add', '/x/web-interface/coin/add', P);
await post('2 /x/v2/view/coin/add', '/x/v2/view/coin/add', P);
await post('3 /x/web-interface/archive/coin/add', '/x/web-interface/archive/coin/add', P);
await post('4 /x/web-interface/coin/add2', '/x/web-interface/coin/add2', P);
