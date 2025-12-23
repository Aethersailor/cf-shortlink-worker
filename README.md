# cf-shortlink-worker

> 一个基于 Cloudflare Workers + KV 的轻量级短链接服务，内置现代化前端界面，兼容 SubWeb。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Aethersailor/cf-shortlink-worker)

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

### 方式一：一键部署 (推荐)

点击上方的 **[Deploy to Cloudflare Workers]** 按钮。
1.  授权 Cloudflare 连接您的 GitHub 账号。
2.  按照指引创建仓库副本。
3.  部署完成后，进入 Cloudflare Dashboard：
    *   **创建 KV**: 在 `Workers & Pages` -> `KV` 中创建一个命名空间 (如 `LINKS`)。
    *   **绑定 KV**: 进入新部署的 Worker -> `Settings` -> `Variables` -> `KV Namespace Bindings`，添加绑定：
        *   **Variable name**: `LINKS` (**必须精确**)
        *   **KV Namespace**: 选择刚才创建的 `LINKS`


### 方式二：手动部署

1.  **创建 KV**: 在 Cloudflare Dashboard 创建一个名为 `LINKS` 的 KV 命名空间。
2.  **创建 Worker**: 创建一个新的 Worker 服务。
3.  **复制代码**: 将本项目 `worker.js` 的内容完整复制到 Worker 编辑器中。
4.  **绑定 KV**: 在 Worker 设置中添加 KV 绑定，变量名为 `LINKS`，指向您创建的 KV。

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
