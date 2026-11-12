// 弹幕读取端点实探：扩展用的是老的 XML 接口 list.so，失败时会静默返回空数组 ——
// 所以这里必须用真实网络确认它到底还活不活。
const BASE = 'https://api.bilibili.com';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://www.bilibili.com/',
  'Origin': 'https://www.bilibili.com'
};
async function probe(cid, label) {
  const u = BASE + '/x/v1/dm/list.so?oid=' + cid;
  try {
    const r = await fetch(u, { headers: H });
    const t = await r.text();
    const n = (t.match(/<d p=/g) || []).length;
    const first = (t.match(/<d p="[^"]+">[^<]*<\/d>/) || [''])[0].slice(0, 70);
    console.log(label + ' cid=' + cid + ' http=' + r.status + ' 长度=' + t.length + ' <d p= 条数=' + n + (first ? ' 例=' + first : ' 头部=' + t.slice(0, 60).replace(/\s+/g, ' ')));
    return n;
  } catch (e) { console.log(label + ' 请求异常 ' + String(e.message || e).slice(0, 60)); return -1; }
}
async function seg(cid, label) {
  try {
    const r = await fetch(BASE + '/x/v2/dm/web/seg.so?type=1&oid=' + cid + '&segment_index=1', { headers: H });
    const buf = Buffer.from(await r.arrayBuffer());
    console.log(label + ' seg.so http=' + r.status + ' 字节=' + buf.length + ' 含可读弹幕文本=' + /[\u4e00-\u9fa5]/.test(buf.toString('utf8')));
    return buf.length;
  } catch (e) { console.log(label + ' seg 异常 ' + String(e.message || e).slice(0, 60)); return -1; }
}
// 用两条款式对比：探针视频 + 一个高热度稿件
const v = await (await fetch(BASE + '/x/web-interface/view?bvid=BV1xx411c7mD', { headers: H })).json();
const cid1 = (v.data || {}).cid;
await probe(cid1, '① list.so 探针稿件');
await seg(cid1, '① ');
const hot = await (await fetch(BASE + '/x/web-interface/view?bvid=BV1GJ411x7h7', { headers: H })).json();
const cid2 = (hot.data || {}).cid;
if (cid2) { console.log('高热稿件: ' + (hot.data.title || '').slice(0, 20) + ' cid=' + cid2 + ' 弹幕数=' + ((hot.data.stat || {}).danmaku || 0)); await probe(cid2, '② list.so 高热稿件'); await seg(cid2, '② '); }
else console.log('高热稿件取不到: code=' + hot.code);
