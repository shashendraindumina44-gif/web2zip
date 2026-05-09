const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const JSZip = require('jszip');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * 🕵️ STEALTH HEADERS
 * Optimized to mimic a real browser to bypass basic Cloudflare checks.
 */
const getStealthHeaders = () => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
});

app.get('/api/convert', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'URL MISSED!' });
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

    const zip = new JSZip();
    const urlObj = new URL(targetUrl);
    const zipName = urlObj.hostname.replace('www.', '').replace(/\./g, '_') + '.zip';
    const assets = [];

    try {
        // --- 1. FETCH CONTENT ---
        const response = await axios.get(targetUrl, { 
            headers: getStealthHeaders(),
            timeout: 15000 
        });
        
        let htmlContent = response.data;
        const $ = cheerio.load(htmlContent);

        // --- 2. ASSET DISCOVERY ---
        $('base').remove();
        const processAsset = (tag, attr, folder) => {
            $(tag).each((i, el) => {
                let src = $(el).attr(attr);
                if (src && !src.startsWith('data:') && !src.startsWith('#')) {
                    try {
                        const assetUrl = new URL(src, targetUrl).href;
                        const fileName = `asset-${i}-${Math.random().toString(36).substring(5)}.${folder}`;
                        assets.push({ url: assetUrl, path: `${folder}/${fileName}` });
                        $(el).attr(attr, `./${folder}/${fileName}`);
                    } catch (e) {}
                }
            });
        };

        processAsset('link[rel="stylesheet"]', 'href', 'css');
        processAsset('script[src]', 'src', 'js');
        processAsset('img', 'src', 'img');

        // --- 3. REACT DATA PATTERN MATCHING ---
        // Try to find __NEXT_DATA__ or other hydration scripts for React/NextJS
        const nextData = $('script#__NEXT_DATA__').html();
        if (nextData) {
            zip.file("react_hydration_data.json", nextData);
        }

        zip.file("index.html", $.html());

        // --- 4. BATCH DOWNLOAD ASSETS ---
        const downloadBatch = async (batch) => {
            await Promise.all(batch.map(async (asset) => {
                try {
                    const res = await axios.get(asset.url, { 
                        responseType: 'arraybuffer', 
                        timeout: 5000,
                        headers: getStealthHeaders()
                    });
                    zip.file(asset.path, res.data);
                } catch (err) {}
            }));
        };

        for (let i = 0; i < assets.length; i += 5) {
            await downloadBatch(assets.slice(i, i + 5));
        }

        // --- 5. PACKAGE & SEND ---
        const content = await zip.generateAsync({ type: "nodebuffer" });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
        res.send(content);

    } catch (error) {
        console.error('Extraction Error:', error.message);
        res.status(500).json({ 
            error: 'Pure-Protocol extraction failed.', 
            details: error.response ? `Status ${error.response.status}` : error.message 
        });
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`[Lord Indumina Protocol] Online on Port: ${PORT}`));
}
