/**
 * cf-shortlink-worker
 * https://github.com/Aethersailor/cf-shortlink-worker
 *
 * A lightweight, serverless short link service built on Cloudflare Workers & KV.
 * Features: Modern UI, i18n, Dark Mode, Rate Limiting, API compatible with SubWeb.
 *
 * Copyright (c) 2025 Aethersailor
 * Licensed under the GNU General Public License v3.0 (GPLv3)
 *
 * -----------------------------------------------------------------------------
 * 配置说明 (Environment Variables):
 *
 * [核心配置]
 * - KV Namespace Binding : LINKS (必需)
 * - BASE_URL             : 短链域名 (推荐设置，如 https://s.example.com)，若不填则自动推断
 *
 * [前端 UI]
 * - PAGE_TITLE           : 网页标题 (默认: Cloudflare ShortLink)
 * - PAGE_ICON            : 网页图标 (默认: 🔗)
 * - PAGE_DESC            : 网页描述 (默认: Simple, fast, and secure short links.)
 *
 * [CORS 跨域设置]
 * - CORS_MODE            : 'open' (默认全开，允许任意 Origin) | 'list' (白名单) | 'off' (关闭)
 * - CORS_ORIGINS         : 允许的 Origin 列表 (逗号分隔)，仅 CORS_MODE=list 时生效
 *
 * [安全与限流]
 * - RL_WINDOW_SEC        : 时间窗口，单位秒 (默认 60)
 * - RL_MAX_REQ           : 窗口内最大请求次数 (默认 10)
 *
 * [高级配置]
 * - DEDUP_TTL_SEC        : 长链去重缓存时间(秒)，>0 启用 (减少 KV 写入)
 *
 * -----------------------------------------------------------------------------
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

  // Landing Page: GET /
  if (path === "/" && req.method === "GET") {
    return new Response(landingHtml(env), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
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

/* -------------------- 前端页面模板 -------------------- */

function landingHtml(env) {
  const title = env.PAGE_TITLE || "Cloudflare ShortLink";
  const icon = env.PAGE_ICON || "🔗";
  const desc = env.PAGE_DESC || "Simple, fast, and secure short links.";
  const repo = "https://github.com/Aethersailor/cf-shortlink-worker";

  // i18n dictionaries
  const i18n = {
    "en": {
      "title": title,
      "desc": desc,
      "longLabel": "Long Link",
      "placeholder": "https://example.com/very/long/url...",
      "shortenBtn": "Shorten URL",
      "resultLabel": "Your Short Link:",
      "copyBtn": "Copy",
      "footer": "Powered by Cloudflare Workers.",
      "openSource": "Open Source",
      "copyToast": "Copied to clipboard!",
      "error": "Error: ",
      "networkError": "Network Error: "
    },
    "zh-CN": {
      "title": env.PAGE_TITLE || "Cloudflare 短链接",
      "desc": env.PAGE_DESC || "简单、快速、安全的短链接服务。",
      "longLabel": "长链接",
      "placeholder": "https://example.com/very/long/url...",
      "shortenBtn": "生成短链",
      "resultLabel": "您的短链接：",
      "copyBtn": "复制",
      "footer": "基于 Cloudflare Workers 强力驱动。",
      "openSource": "开源项目",
      "copyToast": "已复制到剪贴板！",
      "error": "错误：",
      "networkError": "网络错误："
    },
    "zh-TW": {
      "title": env.PAGE_TITLE || "Cloudflare 短網址",
      "desc": env.PAGE_DESC || "簡單、快速、安全的短網址服務。",
      "longLabel": "長網址",
      "placeholder": "https://example.com/very/long/url...",
      "shortenBtn": "產生短鏈",
      "resultLabel": "您的短網址：",
      "copyBtn": "複製",
      "footer": "基於 Cloudflare Workers 強力驅動。",
      "openSource": "開源專案",
      "copyToast": "已複製到剪貼簿！",
      "error": "錯誤：",
      "networkError": "網絡錯誤："
    }
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${icon}</text></svg>">
  <style>
    :root {
      --bg-color: #f0f2f5;
      --card-bg: rgba(255, 255, 255, 0.85);
      --text-main: #1f2937;
      --text-sub: #6b7280;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --border: #e5e7eb;
      --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      --glass-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.15);
      --dropdown-bg: #ffffff;
      --dropdown-hover: #f3f4f6;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-color: #111827;
        --card-bg: rgba(31, 41, 55, 0.7);
        --text-main: #f9fafb;
        --text-sub: #9ca3af;
        --primary: #60a5fa;
        --primary-hover: #93c5fd;
        --border: #374151;
        --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
        --dropdown-bg: #1f2937;
        --dropdown-hover: #374151;
      }
    }

    [data-theme="dark"] {
      --bg-color: #111827;
      --card-bg: rgba(31, 41, 55, 0.7);
      --text-main: #f9fafb;
      --text-sub: #9ca3af;
      --primary: #60a5fa;
      --primary-hover: #93c5fd;
      --border: #374151;
      --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
      --dropdown-bg: #1f2937;
      --dropdown-hover: #374151;
    }

    [data-theme="light"] {
      --bg-color: #f0f2f5;
      --card-bg: rgba(255, 255, 255, 0.85);
      --text-main: #1f2937;
      --text-sub: #6b7280;
      --dropdown-bg: #ffffff;
      --dropdown-hover: #f3f4f6;
      /* default values */
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-color);
      color: var(--text-main);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 1rem;
      transition: background-color 0.3s ease, color 0.3s ease;
      background-image: 
        radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%), 
        radial-gradient(at 50% 0%, hsla(225,39%,30%,1) 0, transparent 50%), 
        radial-gradient(at 100% 0%, hsla(339,49%,30%,1) 0, transparent 50%);
    }

    /* Light mode background gradient override */
    @media (prefers-color-scheme: light) {
      body {
        background-image: 
          radial-gradient(at 0% 0%, hsla(196, 68%, 90%, 1) 0, transparent 50%),
          radial-gradient(at 50% 100%, hsla(266, 60%, 94%, 1) 0, transparent 50%),
          radial-gradient(at 100% 0%, hsla(328, 70%, 92%, 1) 0, transparent 50%);
      }
    }
    
    [data-theme="light"] body {
        background-image: 
          radial-gradient(at 0% 0%, hsla(196, 68%, 90%, 1) 0, transparent 50%),
          radial-gradient(at 50% 100%, hsla(266, 60%, 94%, 1) 0, transparent 50%),
          radial-gradient(at 100% 0%, hsla(328, 70%, 92%, 1) 0, transparent 50%);
    }
    
    [data-theme="dark"] body {
      background-image: 
        radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%), 
        radial-gradient(at 50% 0%, hsla(225,39%,30%,1) 0, transparent 50%), 
        radial-gradient(at 100% 0%, hsla(339,49%,30%,1) 0, transparent 50%);
    }

    .container {
      width: 100%;
      max-width: 600px;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      background-color: var(--card-bg);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      box-shadow: var(--glass-shadow);
      padding: 40px;
      text-align: center;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .header { margin-bottom: 2rem; }
    
    .icon { font-size: 4rem; display: block; margin-bottom: 0.5rem; animation: float 6s ease-in-out infinite; }
    
    @keyframes float {
      0% { transform: translateY(0px); }
      50% { transform: translateY(-10px); }
      100% { transform: translateY(0px); }
    }

    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; letter-spacing: -0.025em; }
    
    .desc { color: var(--text-sub); font-size: 1rem; line-height: 1.5; }

    .input-group { position: relative; margin-bottom: 1.5rem; text-align: left; }
    
    label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 500; color: var(--text-main); }
    
    input[type="url"] {
      width: 100%;
      padding: 12px 16px;
      border-radius: 12px;
      border: 2px solid var(--border);
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-main);
      font-size: 1rem;
      transition: all 0.2s;
      outline: none;
    }
    
    input[type="url"]:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }

    button.primary-btn {
      width: 100%;
      padding: 14px;
      border-radius: 12px;
      border: none;
      background: var(--primary);
      color: white;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 0.5rem;
    }
    
    button.primary-btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
    button.primary-btn:active { transform: translateY(0); }
    button.primary-btn:disabled { opacity: 0.7; cursor: not-allowed; }

    .result {
      margin-top: 2rem;
      padding: 1.5rem;
      background: rgba(0, 0, 0, 0.03);
      border-radius: 12px;
      display: none;
      animation: fadeIn 0.3s ease;
      border: 1px solid var(--border);
      text-align: left;
    }
    
    @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

    .result-label { font-size: 0.875rem; color: var(--text-sub); margin-bottom: 0.5rem; }
    
    .result-box {
      display: flex;
      gap: 0.5rem;
      background: var(--bg-color);
      padding: 8px;
      border-radius: 8px;
      border: 1px solid var(--border);
      align-items: center;
    }
    
    .short-url { flex: 1; font-family: monospace; font-size: 1rem; color: var(--primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 0.5rem;}
    
    .copy-btn {
      width: auto;
      padding: 8px 12px;
      font-size: 0.875rem;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      background: rgba(0, 0, 0, 0.05); /* Soft background for copy button */
      color: var(--text-main);
      transition: background 0.2s;
    }
    
    .copy-btn:hover { background: rgba(0, 0, 0, 0.1); }

    .footer { margin-top: 2rem; font-size: 0.875rem; color: var(--text-sub); }
    .footer a { color: var(--text-sub); text-decoration: none; opacity: 0.8; transition: opacity 0.2s;}
    .footer a:hover { opacity: 1; text-decoration: underline; }

    .top-right-controls {
      position: absolute;
      top: 1.5rem;
      right: 1.5rem;
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .icon-btn {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: var(--text-main);
      cursor: pointer;
      padding: 8px;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
      position: relative;
    }
    .icon-btn:hover { background: rgba(255, 255, 255, 0.2); }

    /* Dropdown Menu */
    .dropdown {
        position: relative;
    }
    .dropdown-content {
        display: none;
        position: absolute;
        right: 0;
        top: 110%;
        background-color: var(--dropdown-bg);
        min-width: 120px;
        box-shadow: var(--shadow);
        border-radius: 8px;
        z-index: 10;
        overflow: hidden;
        border: 1px solid var(--border);
    }
    .dropdown-content button {
        color: var(--text-main);
        padding: 10px 16px;
        text-decoration: none;
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        border-radius: 0;
        justify-content: flex-start;
        font-weight: 400;
    }
    .dropdown-content button:hover {
        background-color: var(--dropdown-hover);
        transform: translateY(0);
    }
    .dropdown.show .dropdown-content {
        display: block;
    }

    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid #ffffff;
      border-bottom-color: transparent;
      border-radius: 50%;
      display: inline-block;
      box-sizing: border-box;
      animation: rotation 1s linear infinite;
    }

    @keyframes rotation {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    /* Toast notif */
    .toast {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--text-main);
        color: var(--bg-color);
        padding: 10px 20px;
        border-radius: 20px;
        font-size: 0.9rem;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s;
        z-index: 100;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .toast.show { opacity: 1; }
  </style>
</head>
<body>

  <div class="top-right-controls">
    <div class="dropdown" id="langDropdown">
        <button class="icon-btn" id="langBtn" aria-label="Switch Language" title="Switch Language">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
        </button>
        <div class="dropdown-content">
            <button onclick="changeLang('en')">English</button>
            <button onclick="changeLang('zh-CN')">简体中文</button>
            <button onclick="changeLang('zh-TW')">繁體中文</button>
        </div>
    </div>
    
    <button class="icon-btn" id="themeBtn" aria-label="Toggle theme" title="Switch Theme">
      <svg id="moonIcon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
      <svg id="sunIcon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
    </button>
  </div>

  <div class="container">
    <div class="header">
      <span class="icon">${icon}</span>
      <h1 id="pageTitle">${title}</h1>
      <p class="desc" id="pageDesc">${desc}</p>
    </div>

    <form id="shortenForm">
      <div class="input-group">
        <label for="longUrl" id="labelLongUrl">Long Link</label>
        <input type="url" id="longUrl" placeholder="https://example.com/very/long/url..." required autofocus>
      </div>
      
      <button type="submit" id="submitBtn" class="primary-btn">
        <span id="btnText">Shorten URL</span>
        <span class="spinner" id="btnSpinner" style="display:none"></span>
      </button>
    </form>

    <div class="result" id="resultArea">
      <div class="result-label" id="labelResult">Your Short Link:</div>
      <div class="result-box">
        <div class="short-url" id="shortUrlDisplay"></div>
        <button class="copy-btn" id="copyBtn">Copy</button>
      </div>
    </div>

    <div class="footer">
      <span id="labelFooter">Powered by Cloudflare Workers.</span> 
      <a href="${repo}" target="_blank" id="labelOpenSource">Open Source</a>
    </div>
  </div>
  
  <div class="toast" id="toast">Copied to clipboard!</div>

  <!-- Inject Dictionary -->
  <script>
    const I18N = ${JSON.stringify(i18n)};
  </script>

  <script>
    /* --- Logic --- */
    
    // Elements
    const els = {
      langBtn: document.getElementById('langBtn'),
      langDropdown: document.getElementById('langDropdown'),
      themeBtn: document.getElementById('themeBtn'),
      moonIcon: document.getElementById('moonIcon'),
      sunIcon: document.getElementById('sunIcon'),
      pageTitle: document.getElementById('pageTitle'),
      pageDesc: document.getElementById('pageDesc'),
      labelLongUrl: document.getElementById('labelLongUrl'),
      longUrl: document.getElementById('longUrl'),
      submitBtn: document.getElementById('submitBtn'),
      btnText: document.getElementById('btnText'),
      btnSpinner: document.getElementById('btnSpinner'),
      resultArea: document.getElementById('resultArea'),
      labelResult: document.getElementById('labelResult'),
      shortUrlDisplay: document.getElementById('shortUrlDisplay'),
      copyBtn: document.getElementById('copyBtn'),
      labelFooter: document.getElementById('labelFooter'),
      labelOpenSource: document.getElementById('labelOpenSource'),
      toast: document.getElementById('toast'),
      form: document.getElementById('shortenForm'),
    };

    // State
    let currentLang = 'en';
    const SESSION_KEY_LANG = 'cf_short_lang';
    const SESSION_KEY_THEME = 'cf_short_theme';
    
    // --- i18n ---
    function detectLang() {
      // Priority: Session -> Browser -> Default
      const saved = sessionStorage.getItem(SESSION_KEY_LANG);
      if (saved) return saved;
      
      const sys = navigator.language || navigator.userLanguage || "en";
      if (sys.toLowerCase().startsWith("zh")) {
         if (sys.toLowerCase().includes("tw") || sys.toLowerCase().includes("hk")) {
           return "zh-TW";
         }
         return "zh-CN";
      }
      return "en";
    }

    function applyLang(lang) {
      if (!I18N[lang]) lang = 'en';
      currentLang = lang;
      // Save to Session Storage ONLY
      sessionStorage.setItem(SESSION_KEY_LANG, lang);
      const dict = I18N[lang];
      
      // Update DOM
      els.pageTitle.textContent = dict.title;
      els.pageDesc.textContent = dict.desc;
      els.labelLongUrl.textContent = dict.longLabel;
      els.longUrl.placeholder = dict.placeholder;
      els.btnText.textContent = dict.shortenBtn;
      els.labelResult.textContent = dict.resultLabel;
      els.copyBtn.textContent = dict.copyBtn;
      els.labelFooter.textContent = dict.footer;
      els.labelOpenSource.textContent = dict.openSource;
      els.toast.textContent = dict.copyToast;
      
      // Update html lang attr
      document.documentElement.lang = lang;
    }
    
    // Dropdown Logic
    els.langBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        els.langDropdown.classList.toggle('show');
    });
    
    // Close dropdown when clicking outside
    window.addEventListener('click', () => {
        if (els.langDropdown.classList.contains('show')) {
            els.langDropdown.classList.remove('show');
        }
    });
    
    // Exposed function for onclick events
    window.changeLang = function(lang) {
        applyLang(lang);
    }
    
    // Init Lang
    applyLang(detectLang());


    // --- Theme ---
    function setTheme(isDark) {
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      els.moonIcon.style.display = isDark ? 'none' : 'block';
      els.sunIcon.style.display = isDark ? 'block' : 'none';
      // Save to Session Storage
      sessionStorage.setItem(SESSION_KEY_THEME, isDark ? 'dark' : 'light');
    }

    // Init Theme: Priority Session -> System
    const savedTheme = sessionStorage.getItem(SESSION_KEY_THEME);
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme) {
      setTheme(savedTheme === 'dark');
    } else {
      setTheme(systemPrefersDark);
    }
    
    els.themeBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      setTheme(currentTheme === 'light');
    });


    // --- Form ---
    els.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const longUrlVal = els.longUrl.value;
      
      if (!longUrlVal) return;

      // Loading
      els.submitBtn.disabled = true;
      els.btnText.style.display = 'none';
      els.btnSpinner.style.display = 'inline-block';
      els.resultArea.style.display = 'none';

      try {
        const formData = new FormData();
        const b64 = btoa(unescape(encodeURIComponent(longUrlVal))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=/g, "");
        formData.append('longUrl', b64);

        const response = await fetch('/short', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();
        const dict = I18N[currentLang];

        if (data.Code === 1) {
          els.shortUrlDisplay.textContent = data.ShortUrl;
          els.resultArea.style.display = 'block';
        } else {
          alert(dict.error + (data.Message || 'Unknown error'));
        }
      } catch (err) {
        alert(I18N[currentLang].networkError + err.message);
      } finally {
        els.submitBtn.disabled = false;
        els.btnText.style.display = 'inline-block';
        els.btnSpinner.style.display = 'none';
      }
    });

    // --- Copy ---
    els.copyBtn.addEventListener('click', () => {
      const text = els.shortUrlDisplay.textContent;
      navigator.clipboard.writeText(text).then(() => {
        showToast();
      });
    });
    
    function showToast() {
        els.toast.classList.add('show');
        setTimeout(() => els.toast.classList.remove('show'), 2000);
    }
  </script>
</body>
</html>`;
}
