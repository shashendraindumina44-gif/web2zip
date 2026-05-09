const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const JSZip = require('jszip');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function buildWebContent(url, rawHtml) {
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(rawHtml, {
        url: url,
        runScripts: "dangerously",
        pretendToBeVisual: true,
        virtualConsole
    });

    // Smart Hydration Wait (Reduced to save Vercel execution time)
    await new Promise(resolve => setTimeout(resolve, 2000));

    const renderedHtml = dom.serialize();
    dom.window.close(); 
    return renderedHtml;
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
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    try {
        // --- 1. FETCH RAW CONTENT ---
        const response = await axios.get(targetUrl, { 
            headers: { 'User-Agent': userAgent },
            timeout: 20000 
        });
        htmlContent = response.data;

        // --- 2. ADVANCED MODE (RUN JS & BUILD WEB) ---
        if (mode === 'advanced') {
            htmlContent = await buildWebContent(targetUrl, htmlContent);
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
                        headers: { 'User-Agent': userAgent, 'Referer': targetUrl }
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
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`[Lord Indumina Protocol] Online on Port: ${PORT}`));
}
