**English** | [简体中文](README.zh-CN.md)

# cf-shortlink-worker

> A lightweight short link service based on Cloudflare Workers + KV, featuring a modern UI and SubWeb compatibility.

🔗 **Demo**: [https://s.asailor.org](https://s.asailor.org)

---

## 📖 Introduction

**cf-shortlink-worker** is a Serverless short link service running on **Cloudflare Workers**. It utilizes **Workers KV** for low-latency data storage, aiming to provide a free, high-performance, and maintenance-free short link solution.

### Key Features

*   🎨 **Modern UI**: Built-in beautiful Glassmorphism landing page.
*   🌍 **i18n Support**: Native support for Simplified Chinese / Traditional Chinese / English, with auto-detection and instant switching.
*   🌗 **Dark Mode**: Perfectly adapts to system dark/light themes, with manual toggle support.
*   📱 **Responsive Design**: Perfect support for both PC and mobile devices.
*   ⚡ **High Performance**: Powered by Cloudflare's global edge network for millisecond-level response.
*   🛡️ **Abuse Protection**: Built-in IP rate limiting based on Cache API.
*   🔗 **Compatibility**: API interface fully compatible with SubWeb format (POST form-data).

---

## 🚀 Deployment Guide

### Prerequisites

*   **Cloudflare Account**: You need an active Cloudflare account.
*   **Domain (Recommended)**: While Workers provide `*.workers.dev` domains, they may be inaccessible in some regions and look less professional. It is recommended to bind a custom domain managed on Cloudflare.

### Method 1: On-Click Deployment (Recommended)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Aethersailor/cf-shortlink-worker)

Click the **[Deploy to Cloudflare Workers]** button above.

1.  **Authorize**: Allow Cloudflare to connect to your GitHub account.
2.  **Configure**: On the deployment page, select your Cloudflare account. We suggest using `shortlink` as the project name.
3.  **Deploy**: Click the `Deploy` button and wait for completion.
4.  **CRITICAL STEP: Binding KV Database**
    *   One-click deployment creates the Worker but usually **DOES NOT automatically bind KV**. You must do this manually, otherwise the service will not run.
    *   Visit [Cloudflare Dashboard](https://dash.cloudflare.com/).
    *   Go to `Workers & Pages` -> `KV` on the left menu.
    *   Click `Create a namespace`, name it `LINKS`, and click `Add`.
    *   Go to your deployed Worker (e.g., `shortlink`) -> `Settings` -> `Variables`.
    *   Find `KV Namespace Bindings`, click `Add binding`.
    *   **Variable name**: Enter `LINKS` (**Must be uppercase, exact match**).
    *   **KV Namespace**: Select the `LINKS` namespace you just created.
    *   Click `Save and deploy`.

### Method 2: Manual Deployment

If you prefer full control, you can deploy manually:

1.  **Create KV Namespace**
    *   Log in to Cloudflare Dashboard, go to `Workers & Pages` -> `KV`.
    *   Click `Create a namespace`.
    *   Enter name `LINKS` and click `Add`.

2.  **Create Worker Service**
    *   Go to `Workers & Pages` -> `Overview`.
    *   Click `Create application` -> `Create Worker`.
    *   Name it `shortlink` (or any name you prefer), click `Deploy`.

3.  **Write Code**
    *   Enter the created Worker, click `Edit code`.
    *   Copy the entire content of [worker.js](worker.js) from this project.
    *   **Overwrite** the original content in the editor.

4.  **Bind KV (Crucial)**
    *   Go back to the Worker configuration page (not the code editor), click `Settings` -> `Variables`.
    *   In the `KV Namespace Bindings` section, click `Add binding`.
    *   **Variable name**: `LINKS`.
    *   **KV Namespace**: Select the `LINKS` namespace created in Step 1.
    *   Click `Save and deploy`.

5.  **Finish**
    *   Visit your Worker domain, and you should see the landing page.

---

## ⚙️ Configuration (Environment Variables)

You can customize the service by setting environment variables.
Go to Worker page -> `Settings` -> `Variables` -> `Environment Variables` to add:

### 🎨 Frontend Configuration

| Variable Name | Description | Default Value |
| :--- | :--- | :--- |
| `PAGE_TITLE` | Page Title | `Cloudflare ShortLink` |
| `PAGE_ICON` | Page Icon (Emoji) | `🔗` |
| `PAGE_DESC` | Page Description | `Simple, fast, and secure short links.` |

### 🔧 Core Configuration

| Variable Name | Description | Default Value | Recommendation |
| :--- | :--- | :--- | :--- |
| `BASE_URL` | Base domain for short links | `Current Worker Domain` | Recommend using custom domain, e.g., `https://s.example.com` |
| `RL_WINDOW_SEC` | Rate limit window (seconds) | `60` | `60` for public services |
| `RL_MAX_REQ` | Max requests per window | `10` | `5` for public services |
| `CORS_MODE` | CORS Mode | `open` | `open`(Allow All) / `list`(Allow List) / `off`(Disabled) |
| `CORS_ORIGINS` | CORS Allow List | Empty | Comma separated, only works when `CORS_MODE=list` |

---

## 🔗 API Reference

### 1. Generate Short Link

*   **URL**: `/short`
*   **Method**: `POST`
*   **Content-Type**: `multipart/form-data` or `application/x-www-form-urlencoded`

**Parameters**:

| Field | Type | Description |
| :--- | :--- | :--- |
| `longUrl` | String | **Required**. Base64 encoded original long URL. |

**Request Example**:

```bash
# Base64("https://example.com") = "aHR0cHM6Ly9leGFtcGxlLmNvbQ=="
curl -X POST https://s.your-domain.com/short \
     -F "longUrl=aHR0cHM6Ly9leGFtcGxlLmNvbQ=="
```

**Response Example**:

```json
{
  "Code": 1,
  "ShortUrl": "https://s.your-domain.com/AbCd123",
  "Message": ""
}
```

### 2. Access Short Link

*   **URL**: `/:code`
*   **Method**: `GET` / `HEAD`

Redirects (HTTP 302) to the original URL.

---

## 🛠️ Development & Contribution

Issues and Pull Requests are welcome!

*   **GitHub**: [https://github.com/Aethersailor/cf-shortlink-worker](https://github.com/Aethersailor/cf-shortlink-worker)
*   **License**: [GPL-3.0](LICENSE)
*   **Copyright**: © 2025 Aethersailor

---

**Based on Cloudflare Workers & KV.**
