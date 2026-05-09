# ⚡ WEB2ZIP | SCRAPE PROTOCOL v2.0.4

<div align="center">
  <img src="https://img.shields.io/badge/AUTHOR-LORD_INDUMINA-7000ff?style=for-the-badge" />
  <img src="https://img.shields.io/badge/STATUS-OPERATIONAL-00ff88?style=for-the-badge" />
  <img src="https://img.shields.io/badge/PLATFORM-VERCEL-black?style=for-the-badge&logo=vercel" />
</div>

---

## 🛠 SYSTEM OVERVIEW
**Web2Zip** is an advanced web-scraping utility designed by **Lord Indumina** to extract HTML, CSS, JavaScript, and media assets from any public URL and package them into a single, structured ZIP file. This protocol is optimized for **Vercel** serverless environments and features a dedicated API for seamless integration with automation scripts and bots.

## 🚀 KEY FEATURES
- **Cloudflare Bypass:** Integrated with Microlink API to navigate through bot-detection shields and Cloudflare verification without server-side browser overhead.
- **ReactJS & SPA Support:** Uses full browser rendering to capture content from sites built with React, Vue, Angular, and other modern frameworks.
- **Full Asset Extraction:** Automatically crawls and downloads linked CSS, Javascript, and Image files.
- **Session Persistence:** Captures and reuses browser cookies to ensure asset downloads are not blocked by security protocols.
- **Path Re-mapping:** Rewrites internal asset paths within the HTML to ensure the offline site functions correctly.
- **Developer API:** Includes a high-speed `/api/convert` endpoint for headless operation.
- **Cyber-UI Interface:** A high-performance terminal-style frontend built with Tailwind CSS and JetBrains Mono.

## 📡 API ACCESS (For Developers)
Developers can bypass the web interface and request ZIP files directly through the API. This is the primary method for integration with WhatsApp or Telegram bots.

### **Endpoint**
```http
GET /api/convert?url=TARGET_URL
