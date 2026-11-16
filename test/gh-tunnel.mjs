// 本机 DNS 被污染时，给 git 用的最小 CONNECT 隧道（会自己找当前可用的 GitHub IP）。
//
// 设计要点（都是踩坑换来的）：
//   ① **先用缓存/种子 IP 立刻监听**，扫描放到后台 —— 顺序反了就变成「扫描中不可用」✗
//   ② IP 会轮换：曾经硬编 20.205.243.166，两天后失效，表现是「间歇成功 → 彻底失败」✗
//   ③ 端口被占用要清晰报错，别抛未处理异常把进程打崩（用过一次就崩过）
//   ④ 只做域名→IP 的 TCP 转发，TLS 仍是 git ↔ GitHub 端到端（不豁免证书校验）
//
// 用法：
//   node test/gh-tunnel.mjs            # 默认 127.0.0.1:8899
//   git -c http.proxy=http://127.0.0.1:8899 fetch origin
import net from "node:net";
import https from "node:https";
import fs from "node:fs";

const PORT = Number(process.argv[2] || 8899);
const API_SEEDS = ["140.82.113.6", "140.82.112.6", "140.82.114.6"];
const SEED = ["140.82.112.3", "140.82.112.4", "140.82.112.6", "140.82.114.3", "140.82.121.3"];
const CACHE = new URL("./.gh-ips.json", import.meta.url);

// Node 20+ 默认 autoSelectFamily，会以 {all:true} 调 lookup —— 那时必须回**数组**，
// 返回单地址会报 ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined。
const lookupTo = (ip) => (h, o, cb) => (o && o.all) ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4);

function get(host, path, ip) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host, path, method: "GET", timeout: 8000,
      headers: { "User-Agent": "bdm-tunnel", Accept: "application/vnd.github+json" },
      lookup: lookupTo(ip),
    }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function head(host, ip) {
  return new Promise((resolve) => {
    const req = https.request({ host, path: "/", method: "HEAD", timeout: 2500, lookup: lookupTo(ip) },
      (res) => { res.resume(); resolve(res.statusCode > 0); });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}

async function metaRanges() {
  for (const ip of API_SEEDS) {
    try {
      const r = await get("api.github.com", "/meta", ip);
      if (r.status === 200) {
        console.log("[隧道] 用 " + ip + " 问到了 IP 段");
        const j = JSON.parse(r.body);
        return (j.git || j.web || []).filter((c) => c.indexOf(":") < 0);
      }
    } catch (e) {
      if (!globalThis.__saidErr) { globalThis.__saidErr = 1; console.log("[隧道] 问 /meta 失败（首个错误）：" + (e && (e.code || e.message))); }
    }
  }
  return [];
}

// ⚠️ 不能把 CIDR 压成它的 /24 基址去探：可用主机可能在同段的**另一个 /24**
async function findHosts(cidrs, need) {
  const found = [];
  let probes = 0;
  for (const cidr of cidrs) {
    const parts = String(cidr).split("/");
    const bits = Number(parts[1] || 32);
    const oct = parts[0].split(".").map(Number);
    if (oct.length !== 4) continue;
    const blocks = Math.min(1 << Math.max(0, 24 - bits), 16);
    for (let b = 0; b < blocks; b++) {
      const third = oct[2] + b;
      if (third > 255) break;
      for (const last of [3, 4, 6]) {
        if (++probes > 40) return found;
        const ip = oct[0] + "." + oct[1] + "." + third + "." + last;
        if (await head("github.com", ip)) {
          console.log("[隧道] github.com 可用主机 " + ip);
          found.push(ip);
          if (found.length >= need) return found;
        }
      }
    }
  }
  return found;
}

// 缓存要带版本：第一版把 api 专用 IP 也写进了 github.com 列表，
// 结果下次启动用它去连 github.com → TLS 握手失败（schannel SEC_E_INVALID_TOKEN）✗。
const CACHE_V = 2;
function readCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    if (j && j.v === CACHE_V && Array.isArray(j.gh) && j.gh.length) return j.gh;
  } catch (e) {}
  return [];
}
function writeCache(gh) { try { fs.writeFileSync(CACHE, JSON.stringify({ v: CACHE_V, gh, at: Date.now() }), "utf8"); } catch (e) {} }

const cached = readCache();
let GH = cached.length ? cached : SEED.slice();
let API = API_SEEDS.slice();

// ① 先监听（用缓存/种子），保证「启动即可用」
const server = net.createServer((c) => {
  let buf = "";
  const onData = (d) => {
    buf += d.toString("latin1");
    const m = new RegExp("^CONNECT ([^:]+):(\\d+)").exec(buf);
    if (!m) return;
    c.removeListener("data", onData);
    const host = m[1], port = Number(m[2]);
    const list = host.indexOf("api.github.com") >= 0 ? API : GH;
    let i = 0;
    const tryNext = () => {
      if (i >= list.length) { c.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); return; }
      const up = net.connect(port, list[i++], () => {
        c.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        up.pipe(c); c.pipe(up);
      });
      up.on("error", () => { up.destroy(); tryNext(); });
      up.setTimeout(6000, () => { up.destroy(); tryNext(); });
    };
    tryNext();
  };
  c.on("data", onData);
  c.on("error", () => {});
});
server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    console.log("[隧道] 端口 " + PORT + " 已被占用（可能上一轮隧道还在跑）→ 直接用现有代理，或换端口：node test/gh-tunnel.mjs 8900");
    process.exit(0);
  }
  console.log("[隧道] 出错：" + (e && (e.code || e.message)));
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
  console.log("[隧道] 监听 127.0.0.1:" + PORT + "（先用" + (cached.length ? "缓存" : "种子") + " IP：" + GH.join(", ") + "）");
  console.log("[隧道] 用法：git -c http.proxy=http://127.0.0.1:" + PORT + " fetch origin");
});

// ② 后台扫描并刷新缓存
(async () => {
  const cidrs = await metaRanges();
  const gh = await findHosts(cidrs.length ? cidrs : ["140.82.112.0/20", "192.30.252.0/22"], 3);
  const apiWorking = [];
  for (const ip of API_SEEDS) if (await head("api.github.com", ip)) apiWorking.push(ip);
  if (gh.length) { GH = gh; writeCache(gh); console.log("[隧道] 缓存已刷新：github.com → " + gh.join(", ")); }
  else console.log("[隧道] 这次扫描没找到新主机，继续用现有列表");
  if (apiWorking.length) API = apiWorking;
})();
