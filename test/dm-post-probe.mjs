// 真实网络契约探针（匿名）：分辨「Node 侧整体被风控」还是「只有 POST 被拦」。
const BASE = 'https://api.bilibili.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const H = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://www.bilibili.com/',
  'Origin': 'https://www.bilibili.com'
};
async function show(label, url, opt) {
  try {
    const r = await fetch(url, Object.assign({ headers: H }, opt || {}));
    const text = await r.text();
    let tag = text.slice(0, 90).replace(/\s+/g, ' ');
    try { const j = JSON.parse(text); tag = 'code=' + j.code + ' message=' + JSON.stringify(String(j.message || '').slice(0, 40)); } catch (e) { /* 非 JSON：就是风控页 */ }
    console.log(label + ': http=' + r.status + ' | ' + tag);
    return text;
  } catch (e) { console.log(label + ': 请求异常 ' + String(e.message || e).slice(0, 60)); return ''; }
}
const vt = await show('① 控制组 GET view', BASE + '/x/web-interface/view?bvid=BV1xx411c7mD');
let cid = 0, bvid = '';
try { const j = JSON.parse(vt); cid = (j.data || {}).cid; bvid = (j.data || {}).bvid; } catch (e) {}
console.log('   解析：bvid=' + (bvid || '?') + ' cid=' + (cid || '?'));
if (cid) await show('② 弹幕读取 GET seg.so（读接口用 oid=cid，可反证发弹幕的 oid 语义）', BASE + '/x/v2/dm/web/seg.so?type=1&oid=' + cid + '&segment_index=1');
const form = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
await show('③ 我们的发弹幕形态 POST dm/post', BASE + '/x/v2/dm/post', { method: 'POST', headers: Object.assign({}, H, form), body: new URLSearchParams({ type: 1, oid: cid || 1, msg: '契约探针（匿名）', bvid: bvid, progress: 1000, mode: 1, fontsize: 25, color: 16777215, pool: 0, plat: 1, csrf: '' }).toString() });
await show('④ 对照 POST 错误路径', BASE + '/x/v2/dm/post_wrong_path', { method: 'POST', headers: Object.assign({}, H, form), body: 'type=1&oid=1' });
