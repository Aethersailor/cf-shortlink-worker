/**
 * cf-shortlink-worker (Service Worker syntax)
 *
 * 目标：
 * - 兼容 SubWeb 的短链接接口
 * - POST /short  (FormData: longUrl=base64(url)) -> {Code:1, ShortUrl:"..."}
 * - GET/HEAD /:code -> 302 redirect
 *
 * Cloudflare:
 * - KV binding: LINKS
 * - Env var: BASE_URL (建议填 https://s.example.com)
 *
 * 可选环境变量（推荐）：
 * - RL_WINDOW_SEC   (默认 60)  限流窗口（秒）
 * - RL_MAX_REQ      (默认 10)  每 IP 每窗口最大请求次数
 *
 * CORS（重点改进）：
 * - CORS_MODE:
 *    - open (默认) : 允许任意 Origin 跨域读取响应（Access-Control-Allow-Origin: *）
 *    - list        : 白名单模式（使用 CORS_ORIGINS）
 *    - off         : 关闭 CORS（不加任何 CORS 头）
 * - CORS_ORIGINS   : 逗号分隔白名单，仅在 CORS_MODE=list 时生效
 *
 * 可选：长链去重（减少 KV 写入；默认关闭）
 * - DEDUP_TTL_SEC  : >0 启用，值为去重映射 TTL（秒），例如 2592000（30 天）
 */

addEventListener("fetch", (event) => {
  event.respondWith(handle(event.request));
});

/* -------------------- 基础响应工具 -------------------- */

function json(obj, status = 200, extraHeaders) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v;
  }
  return new Response(JSON.stringify(obj), { status, headers });
}

function text(msg, status = 200, extraHeaders) {
  const headers = { "content-type": "text/plain; charset=utf-8" };
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v;
  }
  return new Response(msg, { status, headers });
}

function getEnv() {
  // Dashboard 经典脚本模式下，bindings/vars 通常挂到 globalThis
  return globalThis;
}

/* -------------------- CORS（支持 open/list/off） -------------------- */

function corsMode(env) {
  return String(env.CORS_MODE || "open").toLowerCase(); // 默认 open：免配置
}

function getCorsAllowlist(env) {
  const raw = String(env.CORS_ORIGINS || "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function withCors(req, resp, env) {
  const mode = corsMode(env);

  // 关闭 CORS：不加任何头
  if (mode === "off") return resp;

  // open 模式：允许任意站点跨域读取响应
  // 注意：open 模式不支持 credentials（本项目也不需要 cookie）
  if (mode === "open") {
    resp.headers.set("Access-Control-Allow-Origin", "*");
    resp.headers.set("Access-Control-Allow-Credentials", "false");
    resp.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    const reqHdr = req.headers.get("Access-Control-Request-Headers");
    resp.headers.set("Access-Control-Allow-Headers", reqHdr ? reqHdr : "Content-Type");
    resp.headers.set("Access-Control-Max-Age", "86400");
    return resp;
  }

  // list 模式：严格白名单
  const origin = req.headers.get("Origin") || "";
  const allow = getCorsAllowlist(env);
  if (!origin || !allow.has(origin)) return resp;

  resp.headers.set("Access-Control-Allow-Origin", origin);
  resp.headers.set("Vary", "Origin");
  resp.headers.set("Access-Control-Allow-Credentials", "false");
  resp.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  const reqHdr = req.headers.get("Access-Control-Request-Headers");
  resp.headers.set("Access-Control-Allow-Headers", reqHdr ? reqHdr : "Content-Type");
  resp.headers.set("Access-Control-Max-Age", "86400");
  return resp;
}

/* -------------------- 工具函数 -------------------- */

function genCode(len = 7) {
  // 排除易混淆字符（0/O, 1/l/I 等）
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// 支持标准 Base64 与 URL-safe Base64
function base64ToUtf8(b64) {
  let s = (b64 || "").trim();
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";

  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function isHttpUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

function getClientIp(req) {
  return (
    req.headers.get("cf-connecting-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "0.0.0.0"
  );
}

/* -------------------- 防滥用：Cache API 限流 -------------------- */

async function rateLimit(req, env) {
  const windowSec = Math.max(10, parseInt(env.RL_WINDOW_SEC || "60", 10) || 60);
  const maxReq = Math.max(1, parseInt(env.RL_MAX_REQ || "10", 10) || 10);

  const ip = getClientIp(req);
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSec);

  // 这个 URL 只是作为 cache key 使用，不会真实请求外网
  const keyUrl = `https://ratelimit.local/short/${bucket}/${encodeURIComponent(ip)}`;
  const cache = caches.default;
  const cacheKey = new Request(keyUrl);

  const cached = await cache.match(cacheKey);
  let count = 0;
  if (cached) count = parseInt(await cached.text(), 10) || 0;

  const resetIn = (bucket + 1) * windowSec - now;

  if (count >= maxReq) {
    return { ok: false, remaining: 0, resetIn };
  }

  count += 1;
  const ttl = Math.max(1, resetIn);

  await cache.put(
    cacheKey,
    new Response(String(count), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": `public, max-age=${ttl}`,
      },
    })
  );

  return { ok: true, remaining: maxReq - count, resetIn };
}

/* -------------------- 可选：长链去重（默认关闭） -------------------- */

async function sha1Hex(input) {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function dedupTtl(env) {
  return parseInt(env.DEDUP_TTL_SEC || "0", 10) || 0;
}

async function getDedupCode(LINKS, env, longUrl) {
  const ttl = dedupTtl(env);
  if (ttl <= 0) return null;
  const h = await sha1Hex(longUrl);
  return await LINKS.get(`D:${h}`);
}

async function putDedupCode(LINKS, env, longUrl, code) {
  const ttl = dedupTtl(env);
  if (ttl <= 0) return;
  const h = await sha1Hex(longUrl);
  await LINKS.put(`D:${h}`, code, { expirationTtl: ttl });
}

/* -------------------- 主逻辑 -------------------- */

async function handle(req) {
  const env = getEnv();
  const LINKS = env.LINKS;

  const u = new URL(req.url);
  const path = u.pathname;

  // 健康检查
  if (path === "/healthz") return text("ok");

  // CORS 预检：浏览器会先发 OPTIONS /short
  if (path === "/short" && req.method === "OPTIONS") {
    return withCors(req, new Response(null, { status: 204 }), env);
  }

  // 创建短链
  if (path === "/short" && req.method === "POST") {
    if (!LINKS) {
      return withCors(req, json({ Code: 0, Message: "KV binding LINKS not found" }, 500), env);
    }

    // 限流
    const rl = await rateLimit(req, env);
    if (!rl.ok) {
      const resp = json(
        { Code: 0, Message: "Rate limited. Please try again later." },
        429,
        { "x-rl-reset-in": String(rl.resetIn), "x-rl-remaining": String(rl.remaining) }
      );
      return withCors(req, resp, env);
    }

    // 解析表单（兼容 multipart/form-data 与 x-www-form-urlencoded）
    let fd;
    try {
      fd = await req.formData();
    } catch {
      return withCors(req, json({ Code: 0, Message: "Invalid form-data" }, 400), env);
    }

    const longUrlB64 = fd.get("longUrl");
    if (typeof longUrlB64 !== "string" || !longUrlB64.trim()) {
      return withCors(req, json({ Code: 0, Message: "Missing longUrl" }, 400), env);
    }
    if (longUrlB64.length > 8192) {
      return withCors(req, json({ Code: 0, Message: "longUrl too large" }, 413), env);
    }

    // base64 解码
    let longUrl;
    try {
      longUrl = base64ToUtf8(longUrlB64);
    } catch {
      return withCors(req, json({ Code: 0, Message: "Invalid base64 longUrl" }, 400), env);
    }

    if (longUrl.length > 8192) {
      return withCors(req, json({ Code: 0, Message: "Decoded URL too large" }, 413), env);
    }
    if (!isHttpUrl(longUrl)) {
      return withCors(req, json({ Code: 0, Message: "Decoded longUrl is not a valid http/https URL" }, 400), env);
    }

    // 可选去重：复用已有短码（若启用）
    let code = await getDedupCode(LINKS, env, longUrl);
    if (code) {
      // 防止去重映射存在但 code->url 已不存在的极端情况
      const exists = await LINKS.get(code);
      if (!exists) code = null;
    }

    // 分配新短码
    if (!code) {
      for (let i = 0; i < 6; i++) {
        const c = genCode(7);
        const exists = await LINKS.get(c);
        if (!exists) {
          code = c;
          break;
        }
      }
      if (!code) {
        return withCors(req, json({ Code: 0, Message: "Failed to allocate code" }, 500), env);
      }

      // 写入 KV：code -> longUrl
      await LINKS.put(code, longUrl);

      // 去重映射：longUrl -> code（可选）
      await putDedupCode(LINKS, env, longUrl, code);
    }

    // ShortUrl 的 base：优先 BASE_URL，否则回退到当前 host
    const base = String(env.BASE_URL || `${u.protocol}//${u.host}`).replace(/\/+$/, "");
    const shortUrl = `${base}/${code}`;

    const resp = json(
      { Code: 1, ShortUrl: shortUrl },
      200,
      { "x-rl-reset-in": String(rl.resetIn), "x-rl-remaining": String(rl.remaining) }
    );
    return withCors(req, resp, env);
  }

  // 跳转短链：GET/HEAD /:code
  const m = path.match(/^\/([A-Za-z0-9_-]{3,64})$/);
  if ((req.method === "GET" || req.method === "HEAD") && m) {
    if (!LINKS) return text("KV binding LINKS not found", 500);

    const code = m[1];
    const longUrl = await LINKS.get(code);
    if (!longUrl) return text("Not Found", 404);

    return Response.redirect(longUrl, 302);
  }

  return text("Not Found", 404);
}
