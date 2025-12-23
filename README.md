# cf-shortlink-worker

> 一个基于 Cloudflare Workers + KV 的轻量级短链接服务，内置现代化前端界面，兼容 SubWeb。

🔗 **Demo**: [https://s.asailor.org](https://s.asailor.org)

---

## 📖 项目简介

**cf-shortlink-worker** 是一个运行在 **Cloudflare Workers** 上的 Serverless 短链接服务。它利用 **Workers KV** 进行低延迟的数据存储，旨在提供一个免费、高性能、免维护的短链解决方案。

### 核心亮点

*   🎨 **现代化前端**: 内置精美的 Glassmorphism (毛玻璃) 风格首页。
*   🌍 **多语言支持**: 内置 简体中文 / 繁體中文 / English，支持自动检测与即时切换。
*   🌗 **深色模式**: 完美适配系统明暗主题，支持手动切换。
*   📱 **多端适配**: 响应式设计，完美支持 PC 与移动端。
*   ⚡ **高性能**: 依托 Cloudflare 全球边缘网络，毫秒级响应。
*   🛡️ **防滥用**: 内置基于 Cache API 的 IP 高频访问限制。
*   🔗 **兼容性**: API 接口完全兼容 SubWeb 格式 (POST form-data)。

---

## 🚀 部署指南

### 前置要求

*   一个 Cloudflare 账号
*   （推荐）一个托管在 Cloudflare 上的域名

### 1. 创建 KV 命名空间

在 Cloudflare Dashboard 中：
1.  进入 `Workers & Pages` -> `KV`。
2.  点击 `Create a namespace`。
3.  命名为 `LINKS` (建议)。
4.  点击 `Add`。

### 2. 创建 Worker

1.  进入 `Workers & Pages` -> `Overview` -> `Create application` -> `Create Worker`。
2.  命名您的 Worker (例如 `shortlink`)。
3.  点击 `Deploy`。

### 3. 配置代码

1.  点击 `Edit code`。
2.  将本项目 `worker.js` 的内容完整复制并覆盖编辑器中的代码。
3.  点击 `Save and deploy`。

### 4. 绑定 KV

1.  回到 Worker 的配置页面，点击 `Settings` -> `Variables`。
2.  找到 `KV Namespace Bindings`，点击 `Add binding`。
3.  **Variable name**: 填写 `LINKS` (**必须与代码一致**)。
4.  **KV Namespace**: 选择第 1 步创建的命名空间。
5.  点击 `Save and deploy`。

---

## ⚙️ 配置说明 (环境变量)

您可以通过设置环境变量来自定义服务。
在 Worker 页面 -> `Settings` -> `Variables` -> `Environment Variables` 中添加：

### 🎨 前端配置

| 变量名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `PAGE_TITLE` | 网页标题 | `Cloudflare ShortLink` |
| `PAGE_ICON` | 网页图标 (Emoji) | `🔗` |
| `PAGE_DESC` | 网页描述文本 | `Simple, fast, and secure short links.` |

### 🔧 核心配置

| 变量名 | 说明 | 默认值 | 建议 |
| :--- | :--- | :--- | :--- |
| `BASE_URL` | 短链的基础域名 | `当前 Worker 域名` | 建议配置自定义域名，如 `https://s.example.com` |
| `RL_WINDOW_SEC` | 限流窗口时间(秒) | `60` | 公开服务建议 `60` |
| `RL_MAX_REQ` | 窗口内最大请求数 | `10` | 公开服务建议 `5` |
| `CORS_MODE` | 跨域模式 | `open` | `open`(全开) / `list`(白名单) / `off`(关闭) |
| `CORS_ORIGINS` | 跨域白名单 | 空 | 仅 `CORS_MODE=list` 时生效，逗号分隔 |

---

## 🔗 API 文档

### 1. 生成短链接

*   **URL**: `/short`
*   **Method**: `POST`
*   **Content-Type**: `multipart/form-data` 或 `application/x-www-form-urlencoded`

**参数**:

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `longUrl` | String | **必填**。经过 Base64 编码的原始长链接。 |

**请求示例**:

```bash
# Base64("https://example.com") = "aHR0cHM6Ly9leGFtcGxlLmNvbQ=="
curl -X POST https://s.your-domain.com/short \
     -F "longUrl=aHR0cHM6Ly9leGFtcGxlLmNvbQ=="
```

**返回示例**:

```json
{
  "Code": 1,
  "ShortUrl": "https://s.your-domain.com/AbCd123",
  "Message": ""
}
```

### 2. 访问短链接

*   **URL**: `/:code`
*   **Method**: `GET` / `HEAD`

直接跳转 (HTTP 302) 到原始链接。

---

## 🛠️ 开发与贡献

欢迎提交 Issue 和 Pull Request！

*   **GitHub**: [https://github.com/Aethersailor/cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker)
*   **License**: [GPL-3.0](LICENSE)

---

**Based on Cloudflare Workers & KV.**
