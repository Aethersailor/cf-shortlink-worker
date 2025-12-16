# cf-shortlink-worker

一个兼容 SubWeb 的 Cloudflare Workers 短链接服务（Cloudflare Workers + KV）

---

## 项目简介

**cf-shortlink-worker** 是一个基于 **Cloudflare Workers** 与 **Workers KV** 的轻量级短链接服务，专门面向 **SubWeb** 这类“浏览器端前端直接请求短链后端”的工作流。

本项目的设计目标：

- 兼容 SubWeb 的请求与返回格式（可直接替换 `shortUrl`）
- 可自建、可控、无第三方短链依赖
- 在 Cloudflare 免费额度内长期运行（读多写少、避免写放大）
- 内置防滥用（免费方案可用）
- CORS 支持并可配置“开放/白名单/关闭”三种模式

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

- ✅ **CORS 三档模式（关键）**
  - `open`（默认）：允许任意前端跨域读取响应（最省事，适合“给别人前端调用”）
  - `list`：白名单模式（更安全，需配置 `CORS_ORIGINS`）
  - `off`：关闭 CORS（不加任何 CORS 头）

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
curl -sS -X POST "https://s.example.com/short"   -F 'longUrl=aHR0cHM6Ly9leGFtcGxlLmNvbS8='
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

#### 必需

- `BASE_URL`：短链对外展示的域名（建议使用自定义域名）
  - 示例：`https://s.example.com`
  - 测试阶段也可用 `https://xxx.your-account.workers.dev`（注意：workers.dev 在中国大陆地区无法直接访问）

#### 推荐（公开服务更抗刷）

- `RL_WINDOW_SEC`：限流窗口（秒），默认 `60`
- `RL_MAX_REQ`：每 IP 在窗口内最大请求数，默认 `10`
  - **建议公开服务使用 `5`**（例如：`RL_MAX_REQ=5`）

#### CORS（重点）

- `CORS_MODE`：CORS 模式（默认 `open`）
  - `open`：允许任意 Origin 跨域读取响应（最省事）
  - `list`：白名单模式（更安全）
  - `off`：关闭 CORS（不加 CORS 头）

- `CORS_ORIGINS`：仅在 `CORS_MODE=list` 时生效，逗号分隔
  - 示例：
    - `https://sub.example.com`
    - `https://sub.example.com,https://sub2.example.com`

> 说明：如果你的短链后端就是为了被“各种前端”调用（包括不受你控制的域名），可以保持默认 `CORS_MODE=open`；  
> 如果你担心被滥用或只允许自家 SubWeb 使用，请改为 `CORS_MODE=list` 并配置 `CORS_ORIGINS`。

#### 可选：长链去重

- `DEDUP_TTL_SEC`：长链接去重 TTL（秒）
  - 默认 `0` 表示关闭
  - 示例：`2592000`（30 天）

---

## 第 5 步：绑定自定义域名（推荐）

在 Worker 中添加路由（Routes）：

- `s.example.com/*` → 指向该 Worker

然后将 `BASE_URL` 改为：

- `https://s.example.com`

保存并重新部署。

---

## 第 6 步：配置 SubWeb

在 SubWeb 配置中设置：

```txt
shortUrl = https://s.example.com
```

注意：不需要加 `/short`，SubWeb 会自动请求 `POST /short`。

---

## 常见问题（FAQ）

### 1) 为什么 `curl -I` 需要支持？
`curl -I` 发送的是 `HEAD` 请求。很多探测器/CDN/健康检查也会用 HEAD。  
本项目对短码跳转同时支持 `GET` 与 `HEAD`，避免误判 404。

### 2) 我想更安全：只允许我的 SubWeb 域名调用，怎么做？
将环境变量设为：

```txt
CORS_MODE=list
CORS_ORIGINS=https://sub.example.com
```

如有多个前端域名：

```txt
CORS_MODE=list
CORS_ORIGINS=https://sub.example.com,https://sub2.example.com
```

### 3) 我想完全开放给任何前端用？
保持默认即可：

```txt
CORS_MODE=open
```

（或不配置 `CORS_MODE`，默认就是 `open`）

---

## 设计理念

cf-shortlink-worker 遵循以下原则：

- 优先使用 Cloudflare 原生能力
- 避免任何高频写入状态（降低成本与故障面）
- 成本可预测、接近于零
- 行为明确、易于理解、易于维护

---

## 许可证

推荐使用 **MIT License**。
