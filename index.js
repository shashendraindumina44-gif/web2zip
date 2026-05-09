const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const JSZip = require('jszip');
const path = require('path');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper to launch browser (Optimized for Vercel with Playwright)
async function launchBrowser() {
    return await playwright.launch({
        args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        executablePath: await chromium.executablePath(),
        headless: true, // Use boolean for Playwright
    });
}

app.get('/api/convert', async (req, res) => {
    let targetUrl = req.query.url;
    const mode = req.query.mode || 'simple'; 

    if (!targetUrl) return res.status(400).json({ error: 'URL MISSED!' });
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

    const zip = new JSZip();
    const urlObj = new URL(targetUrl);
    const zipName = urlObj.hostname.replace('www.', '').replace(/\./g, '_') + '.zip';
    const assets = [];
    let htmlContent = '';
    let cookieString = '';
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

    let browser;
    try {
        if (mode === 'advanced') {
            // --- ADVANCED MODE (PLAYWRIGHT) ---
            browser = await launchBrowser();
            const context = await browser.newContext({ userAgent });
            const page = await context.newPage();
            
            // Go to URL and wait for network to settle
            await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
            
            // Extra wait for React hydration
            await page.waitForTimeout(3000); 

            htmlContent = await page.content();
            const cookies = await context.cookies();
            cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        } else {
            // --- SIMPLE MODE (AXIOS) ---
            const response = await axios.get(targetUrl, { 
                headers: { 'User-Agent': userAgent },
                timeout: 15000 
            });
            htmlContent = response.data;
        }

        const $ = cheerio.load(htmlContent);

        // SECURITY & CLEANUP
        $('base').remove(); 
        $('script[src*="google-analytics"]').remove(); 
        $('script[src*="gtm.js"]').remove();

        const processAsset = (tag, attr, typeFolder) => {
            $(tag).each((i, el) => {
                let src = $(el).attr(attr);
                if (src && !src.startsWith('data:') && !src.startsWith('#') && !src.startsWith('mailto:')) {
                    try {
                        const assetUrl = new URL(src, targetUrl).href;
                        let cleanPath = new URL(assetUrl).pathname;
                        let fileName = path.basename(cleanPath);
                        if (!fileName || !fileName.includes('.')) {
                            const extensions = { js: '.js', css: '.css', img: '.png', icon: '.ico', media: '.mp4' };
                            fileName = `${typeFolder}-${i}${extensions[typeFolder] || '.file'}`;
                        } else {
                            fileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                        }
                        assets.push({ type: typeFolder, url: assetUrl, fileName });
                        $(el).attr(attr, `./${typeFolder}/${fileName}`); 
                    } catch (e) {}
                }
            });
        };

        processAsset('link[rel="stylesheet"]', 'href', 'css');
        processAsset('script[src]', 'src', 'js');
        processAsset('img', 'src', 'img');
        processAsset('link[rel*="icon"]', 'href', 'icon');
        processAsset('audio source', 'src', 'audio');
        processAsset('video source', 'src', 'video');

        zip.file("index.html", $.html());

        // ASSET DOWNLOADER
        const batchSize = 5; 
        for (let i = 0; i < assets.length; i += batchSize) {
            const batch = assets.slice(i, i + batchSize);
            await Promise.all(batch.map(async (asset) => {
                try {
                    const assetRes = await axios.get(asset.url, { 
                        responseType: 'arraybuffer', 
                        timeout: 10000, 
                        headers: { 
                            'User-Agent': userAgent,
                            'Referer': targetUrl,
                            'Cookie': cookieString
                        }
                    });
                    zip.file(`${asset.type}/${asset.fileName}`, assetRes.data);
                } catch (err) {}
            }));
        }

        const content = await zip.generateAsync({ 
            type: "nodebuffer",
            compression: "DEFLATE",
            compressionOptions: { level: 6 }
        });
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
        res.send(content);

    } catch (error) {
        console.error('Extraction Error:', error);
        res.status(500).json({ error: 'Extraction failed.', details: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`[shashendraindumina44-gif Protocol] Online on Port: ${PORT}`));
}
