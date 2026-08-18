[English](README.md) | **简体中文**

# cf-shortlink-worker

> 一个基于 Cloudflare Workers + KV 的轻量级短链接服务，内置现代化前端界面。

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
*   🔗 **API 接口**: 支持 POST form-data 格式创建短链接。

---

## 🚀 部署指南

### 前置要求

*   **Cloudflare 账号**: 您需要一个生效的 Cloudflare 账号。
*   **域名 (推荐)**: 虽然 Worker 提供 `*.workers.dev` 域名，但该域名在部分地区可能无法访问，且看起来不正式。建议绑定这一托管在 Cloudflare 上的自定义域名。

### 方式一：一键部署 (推荐)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Aethersailor/cf-shortlink-worker)

点击上方的 **[Deploy to Cloudflare Workers]** 按钮。

1.  **授权**: 允许 Cloudflare 连接您的 GitHub 账号。
2.  **配置**: 在部署页面，选择您的 Cloudflare 账户，建议项目名称填写 `shortlink`。
3.  **部署**: 点击 `Deploy` 按钮，等待部署完成。
4.  **关键步骤：绑定 KV 数据库**
    *   一键部署虽然会创建 Worker，但通常**不会自动绑定 KV**，您必须手动完成此步，否则服务无法运行。
    *   访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
    *   进入左侧菜单 `Workers & Pages` -> `KV`。
    *   点击 `Create a namespace`，命名为 `LINKS`，点击 `Add`。
    *   进入刚才部署好的 Worker (例如 `shortlink`) -> `Settings` (设置) -> `Variables` (变量)。
    *   找到 `KV Namespace Bindings` (KV 命名空间绑定)，点击 `Add binding`。
    *   **Variable name**: 填写 `LINKS` (**必须大写，完全一致**)。
    *   **KV Namespace**: 选择刚才创建的 `LINKS`。
    *   点击 `Save and deploy`。

### 方式二：手动部署

如果您喜欢完全掌控，可以手动操作：

1.  **创建 KV 数据存储**
    *   登录 Cloudflare 控制台，进入 `Workers & Pages` -> `KV`。
    *   点击 `Create a namespace`。
    *   输入名称 `LINKS`，点击 `Add`。

2.  **创建 Worker 服务**
    *   进入 `Workers & Pages` -> `Overview`。
    *   点击 `Create application` -> `Create Worker`。
    *   命名为 `shortlink` (或者您喜欢的名字)，点击 `Deploy`。

3.  **写入代码**
    *   进入刚才创建的 Worker，点击 `Edit code` (编辑代码)。
    *   将本项目 [worker.js](worker.js) 的内容**完整复制**。
    *   **覆盖**编辑器中原本的内容。

4.  **绑定 KV (至关重要)**
    *   回到 Worker 的配置页面 (不要在代码编辑器里)，点击 `Settings` -> `Variables`。
    *   在 `KV Namespace Bindings` 区域，点击 `Add binding`。
    *   **Variable name**: `LINKS`。
    *   **KV Namespace**: 选择第 1 步创建的 `LINKS`。
    *   点击 `Save and deploy`。

5.  **完成**
    *   访问您的 Worker 域名，应能看到短链首页。

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
*   **License**: [AGPL-3.0](LICENSE)
*   **Copyright**: © 2025 Aethersailor

---

**Based on Cloudflare Workers & KV.**
