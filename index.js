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
 * 🛡️ ADVANCED MODE PROXY (User-Side Support)
 * This allows the user's browser to fetch content without CORS blocks.
 * No rendering happens here - only data tunneling to prevent Vercel crashes.
 */
app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL missing');
    
    try {
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': '*/*',
            },
            timeout: 15000
        });
        
        // Forward content-type and data
        res.setHeader('Content-Type', response.headers['content-type'] || 'text/html');
        res.setHeader('Access-Control-Allow-Origin', '*'); // Allow browser access
        res.send(response.data);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

/**
 * ⚡ SIMPLE MODE (Server-Side)
 * Optimized for speed on standard websites.
 */
app.get('/api/convert', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'URL MISSED!' });
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

    const zip = new JSZip();
    const urlObj = new URL(targetUrl);
    const zipName = urlObj.hostname.replace('www.', '').replace(/\./g, '_') + '.zip';
    const assets = [];
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    try {
        const response = await axios.get(targetUrl, { 
            headers: { 'User-Agent': userAgent },
            timeout: 15000 
        });
        const htmlContent = response.data;
        const $ = cheerio.load(htmlContent);

        // Cleanup
        $('base').remove();
        $('script[src*="google-analytics"]').remove();

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

        for (const asset of assets) {
            try {
                const res = await axios.get(asset.url, { responseType: 'arraybuffer', timeout: 5000 });
                zip.file(asset.path, res.data);
            } catch (err) {}
        }

        const content = await zip.generateAsync({ type: "nodebuffer" });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
        res.send(content);
    } catch (error) {
        res.status(500).json({ error: 'Server-side extraction failed.' });
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`[Lord Indumina Protocol] Online on Port: ${PORT}`));
}
