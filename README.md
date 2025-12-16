# cf-shortlink-worker
一个兼容 SubWeb 的 Cloudflare Workers 短链接服务

---

## 项目简介

**cf-shortlink-worker** 是一个基于 **Cloudflare Workers** 与 **Workers KV** 的轻量级短链接服务。

本项目的设计目标非常明确：

- 完全兼容 SubWeb 前端所期望的行为
- 可自建、可控、无第三方依赖
- 在 Cloudflare 免费额度内长期运行
- 专注稳定性、性能与可维护性，而非功能堆砌

你可以将它视为：**“一个为代理订阅前端量身定制的 Edge 原生短链接后端”。**

---

## 核心特性

- ✅ **接口行为兼容**
  - `POST /short`
  - `multipart/form-data`
  - 参数：`longUrl = base64(url)`
  - 返回：`{ "Code": 1, "ShortUrl": "..." }`

- ✅ **短链跳转**
  - `GET /:code` → `302`
  - `HEAD /:code` → `302`（curl / 探测器兼容）

- ✅ **Workers KV 存储**
  - 存储：短码 → 长链接
  - 读多写少，成本极低

- ✅ **防滥用（免费）**
  - 基于 Cloudflare Cache API 做 per-IP 限流
  - 不依赖 Durable Objects
  - 避免 KV 写放大

- ✅ **CORS 支持（浏览器可用）**
  - SubWeb 前端可直接跨域调用短链服务
  - 白名单可通过环境变量配置

- ✅ **可选长链去重**
  - 同一长链接可复用短码（可关闭）
  - 减少 KV 写入次数

---

## 非目标（设计上刻意不做）

以下功能被明确排除在本项目范围之外：

- 点击统计 / 访问计数
- 访问日志
- 后台管理面板
- 用户系统 / 权限系统

原因：这些功能通常会带来 KV 写放大、成本上升、架构复杂度增加与维护负担。

---

## API 接口说明

### 1) 创建短链接

请求：

- `POST /short`
- `Content-Type: multipart/form-data`（SubWeb 默认）
- 表单字段：`longUrl`（base64 编码后的完整 URL）

示例：

```bash
curl -sS -X POST "https://s.example.com/short" \
  -F 'longUrl=aHR0cHM6Ly9leGFtcGxlLmNvbS8='
```

返回示例：

```json
{
  "Code": 1,
  "ShortUrl": "https://s.example.com/AbCdEf1"
}
```

### 2) 使用短链接（跳转）

- `GET /AbCdEf1` → `302 Location: <原始长链接>`
- `HEAD /AbCdEf1` → `302 Location: <原始长链接>`

示例：

```bash
curl -I "https://s.example.com/AbCdEf1"
```

预期输出类似：

```txt
HTTP/2 302
location: https://example.com/
```

---

## Cloudflare 部署流程（详细）

### 第 1 步：创建 KV 命名空间

Cloudflare 控制台：`Workers & Pages -> KV`

创建命名空间：

- 名称：`LINKS`

### 第 2 步：创建 Worker 并部署代码

`Workers & Pages -> 创建 Worker`

- 类型：Worker
- 将仓库中的 `worker.js` 完整粘贴到编辑器
- 保存并部署

### 第 3 步：绑定 KV

进入 Worker → `绑定（Bindings）` → 添加绑定：

- 类型：KV 命名空间
- **变量名（Binding name）：`LINKS`**
- 命名空间：`LINKS`

> 变量名必须与代码中使用的一致（本项目固定为 `LINKS`）。

### 第 4 步：配置环境变量

进入 Worker → `设置（Settings） -> 环境变量（Variables）`

必需：

- `BASE_URL`：短链对外展示的域名（建议使用自定义域名）
  - 示例：`https://s.example.com`
  - 测试阶段也可用 workers.dev 域名

可选：

- `RL_WINDOW_SEC`：限流时间窗口（秒），默认 `60`
- `RL_MAX_REQ`：每 IP 在窗口内最大请求数，默认 `10`
- `CORS_ORIGINS`：允许跨域的来源白名单（逗号分隔）
  - 默认：`https://sub.example.com`
  - 示例：`https://sub.example.com,https://sub2.example.com`
- `DEDUP_TTL_SEC`：长链接去重 TTL（秒）
  - 默认 `0` 表示关闭
  - 示例：`2592000`（30 天）

### 第 5 步：绑定自定义域名（推荐）

在 Worker 中添加路由（Routes）：

- `s.example.com/*` → 指向该 Worker

然后将 `BASE_URL` 改为：

- `https://s.example.com`

保存并重新部署。

### 第 6 步：配置 SubWeb

在 SubWeb 配置中设置：

```txt
shortUrl = https://s.example.com
```

注意：不需要加 `/short`，SubWeb 会自动请求 `POST /short`。

---

## 设计理念

cf-shortlink-worker 遵循以下原则：

- 优先使用 Cloudflare 原生能力
- 避免任何高频写入状态（降低成本与故障面）
- 成本可预测、接近于零
- 行为明确、易于理解、易于维护

---

## 许可证

**MIT License**。
