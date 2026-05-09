const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const JSZip = require('jszip');
const path = require('path');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper to launch browser (Optimized Golden Combo for Vercel)
async function launchBrowser() {
    return await puppeteer.launch({
        args: [
            ...chromium.args,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
        ],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
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
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

    let browser;
    try {
        let htmlContent = '';
        let cookieString = '';

        if (mode === 'advanced') {
            logServer(`Initiating Advanced Mode for: ${targetUrl}`);
            browser = await launchBrowser();
            const page = await browser.newPage();
            
            // --- STEALTH EVASIONS ---
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });

            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
            
            // Wait for React/Hydration
            await new Promise(r => setTimeout(r, 3000));

            htmlContent = await page.content();
            const cookies = await page.cookies();
            cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        } else {
            const response = await axios.get(targetUrl, { 
                headers: { 'User-Agent': userAgent },
                timeout: 15000 
            });
            htmlContent = response.data;
        }

        const $ = cheerio.load(htmlContent);
        $('base').remove();

        const processAsset = (tag, attr, typeFolder) => {
            $(tag).each((i, el) => {
                let src = $(el).attr(attr);
                if (src && !src.startsWith('data:') && !src.startsWith('#')) {
                    try {
                        const assetUrl = new URL(src, targetUrl).href;
                        const fileName = `file-${i}.${typeFolder}`;
                        assets.push({ url: assetUrl, path: `${typeFolder}/${fileName}` });
                        $(el).attr(attr, `./${typeFolder}/${fileName}`);
                    } catch (e) {}
                }
            });
        };

        processAsset('link[rel="stylesheet"]', 'href', 'css');
        processAsset('script[src]', 'src', 'js');
        processAsset('img', 'src', 'img');

        zip.file("index.html", $.html());

        // Asset Downloader
        for (const asset of assets) {
            try {
                const res = await axios.get(asset.url, { 
                    responseType: 'arraybuffer', 
                    timeout: 5000,
                    headers: { 'User-Agent': userAgent, 'Cookie': cookieString, 'Referer': targetUrl }
                });
                zip.file(asset.path, res.data);
            } catch (err) {}
        }

        const content = await zip.generateAsync({ type: "nodebuffer" });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
        res.send(content);

    } catch (error) {
        console.error('Final Engine Error:', error.message);
        res.status(500).json({ error: 'Automated extraction failed.', details: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

function logServer(msg) {
    console.log(`[Lord Indumina Protocol] ${msg}`);
}

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`[Lord Indumina Protocol] Online on Port: ${PORT}`));
}
