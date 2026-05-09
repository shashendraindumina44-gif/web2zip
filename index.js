const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const JSZip = require('jszip');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

// Vercel Bundler Fix: Explicitly require stealth evasions to ensure they are included in the deployment
try {
    require('puppeteer-extra-plugin-stealth/evasions/chrome.app');
    require('puppeteer-extra-plugin-stealth/evasions/chrome.csi');
    require('puppeteer-extra-plugin-stealth/evasions/chrome.loadTimes');
    require('puppeteer-extra-plugin-stealth/evasions/chrome.runtime');
    require('puppeteer-extra-plugin-stealth/evasions/iframe.contentWindow');
    require('puppeteer-extra-plugin-stealth/evasions/media.codecs');
    require('puppeteer-extra-plugin-stealth/evasions/navigator.languages');
    require('puppeteer-extra-plugin-stealth/evasions/navigator.permissions');
    require('puppeteer-extra-plugin-stealth/evasions/navigator.plugins');
    require('puppeteer-extra-plugin-stealth/evasions/navigator.webdriver');
    require('puppeteer-extra-plugin-stealth/evasions/sourceurl');
    require('puppeteer-extra-plugin-stealth/evasions/defaultArgs');
    require('puppeteer-extra-plugin-stealth/evasions/stack.trace');
    require('puppeteer-extra-plugin-stealth/evasions/user-agent-override');
    require('puppeteer-extra-plugin-stealth/evasions/webgl.vendor');
    require('puppeteer-extra-plugin-stealth/evasions/window.outerdimensions');
} catch (e) {}

// Initialize Stealth Plugin
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper to launch browser (Optimized for Vercel)
async function launchBrowser() {
    return await puppeteer.launch({
        args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    });
}
// conver api path
app.get('/api/convert', async (req, res) => {
    let targetUrl = req.query.url;
    const mode = req.query.mode || 'simple'; // 'simple' or 'advanced'

    if (!targetUrl) return res.status(400).json({ error: 'URL MISSED!' });
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
    // zip converter
    const zip = new JSZip();
    const urlObj = new URL(targetUrl);
    const zipName = urlObj.hostname.replace('www.', '').replace(/\./g, '_') + '.zip';
    const assets = [];
    let htmlContent = '';
    let cookieString = '';
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

    let browser;
    // modes selction
    try {
        if (mode === 'advanced') {
            // ADVANCED MODE (PUPPETEER)
            browser = await launchBrowser();
            const page = await browser.newPage();
            await page.setUserAgent(userAgent);
            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await new Promise(resolve => setTimeout(resolve, 3000));
            htmlContent = await page.content();
            const cookies = await page.cookies();
            cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        } else {
            //SIMPLE MODE (AXIOS)
            const response = await axios.get(targetUrl, {
                headers: { 'User-Agent': userAgent },
                timeout: 15000
            });
            htmlContent = response.data;
        }

        const $ = cheerio.load(htmlContent);

        //  SECURITY & CLEANUP
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
                    } catch (e) { }
                }
            });
        };

        // resources to include in zip
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
                } catch (err) { }
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
    app.listen(PORT, () => console.log(`[Lord Indumina Protocol] Online on Port: ${PORT}`));
}


