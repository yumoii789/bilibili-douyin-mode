// 本机 DNS 被污染时，给 git 用的最小 CONNECT 隧道（会**自己找当前可用的 GitHub IP**）。
//
// 为什么要自更新：GitHub 的 IP 会轮换。曾经硬编 20.205.243.166，两天后失效 ——
// 表现是「间歇成功 → 彻底失败」，很容易被误判成『被墙了』或『网络断了』✗。
//
// 用法：
//   node test/gh-tunnel.mjs            # 默认监听 127.0.0.1:8899
//   git -c http.proxy=http://127.0.0.1:8899 fetch origin
//   git -c http.proxy=http://127.0.0.1:8899 push origin main
// 说明：只做域名→IP 的 TCP 转发，TLS 仍是 git ↔ GitHub 端到端（不豁免证书校验）。
import net from "node:net";
import https from "node:https";

const PORT = Number(process.argv[2] || 8899);
// 已知出现过的 api.github.com 主机（用来问 /meta：/meta 会告诉我们 web/git 的 IP 段）
const API_SEEDS = ["140.82.113.6", "140.82.112.6", "140.82.114.6"];

// ⚠️ Node 20+ 默认 autoSelectFamily，会以 {all:true} 调 lookup —— 那时回调必须回**数组**，
// 返回单地址会报 ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined（我第一版就是这样，
// 而且我把错误吞了，白跑一轮）。
const lookupTo = (ip) => (h, o, cb) => (o && o.all) ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4);

function get(host, path, ip, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host, path, method: "GET", timeout: timeoutMs || 8000,
      headers: { "User-Agent": "bdm-tunnel", Accept: "application/vnd.github+json" },
      lookup: lookupTo(ip),                        // ← 关键：绕开系统解析，直接指定 IP
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

async function metaRanges() {
  for (const ip of API_SEEDS) {
    try {
      const r = await get("api.github.com", "/meta", ip);
      if (r.status === 200) {
        const j = JSON.parse(r.body);
        console.log("[隧道] 用 " + ip + " 问到了 IP 段");
        return (j.git || j.web || []).filter((c) => c.indexOf(":") < 0);   // 先不管 IPv6
      }
    } catch (e) {
      if (!globalThis.__saidErr) { globalThis.__saidErr = 1; console.log("[隧道] 问 /meta 失败（首个错误）：" + (e && (e.code || e.message))); }
    }
  }
  return [];
}

function head(host, ip) {
  return new Promise((resolve) => {
    const req = https.request({ host, path: "/", method: "HEAD", timeout: 6000, lookup: lookupTo(ip) },
      (res) => { res.resume(); resolve(res.statusCode > 0); });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}

async function findHosts(cidrs, need) {
  const found = [];
  let probes = 0;
  for (const cidr of cidrs) {
    const [net0, bitsStr] = String(cidr).split("/");
    const bits = Number(bitsStr || 32);
    const oct = net0.split(".").map(Number);
    if (oct.length !== 4) continue;
    // ⚠️ 关键：**不能**把 CIDR 压成它的 /24 基址去探（我第一版就是这么写的，
    // 于是漏掉了真实可用的 140.82.114.3 —— 它在同一个 /20 里的**另一个 /24**）。
    // 这里在 CIDR 覆盖的 /24 块里逐块试。
    const blocks = Math.min(1 << Math.max(0, 24 - bits), 16);
    for (let b2 = 0; b2 < blocks; b2++) {
      const third = oct[2] + b2;
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

(async () => {
  const cidrs = await metaRanges();
  const gh = await findHosts(cidrs.length ? cidrs : ["140.82.112.0/20", "192.30.252.0/22"], 3);
  const apiWorking = [];
  for (const ip of API_SEEDS) if (await head("api.github.com", ip)) apiWorking.push(ip);
  if (!gh.length) { console.log("[隧道] 找不到可用的 github.com 主机 —— 网络可能真的不通，请检查网络/代理"); process.exit(1); }
  console.log("[隧道] 就绪：github.com → " + gh.join(", ") + (apiWorking.length ? " ／ api → " + apiWorking.join(", ") : ""));
  net.createServer((c) => {
    let buf = "";
    const onData = (d) => {
      buf += d.toString("latin1");
      const m = /^CONNECT ([^:]+):(\d+)/.exec(buf);
      if (!m) return;
      c.removeListener("data", onData);
      const host = m[1], port = Number(m[2]);
      const list = host.indexOf("api.github.com") >= 0 && apiWorking.length ? apiWorking : gh;
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
  }).listen(PORT, "127.0.0.1", () => {
    console.log("[隧道] 监听 127.0.0.1:" + PORT + " —— 用法：git -c http.proxy=http://127.0.0.1:" + PORT + " fetch origin");
  });
})();
