const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const JSZip = require('jszip');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/convert', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'URL MISSED!' });
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

    try {
        const response = await axios.get(targetUrl, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 10000 
        });

        const $ = cheerio.load(response.data);
        const zip = new JSZip();
        const urlObj = new URL(targetUrl);
        const zipName = urlObj.hostname.replace('www.', '').replace(/\./g, '_') + '.zip';
        const assets = [];

        $('base').remove(); 

        const processAsset = (tag, attr, typeFolder) => {
            $(tag).each((i, el) => {
                let src = $(el).attr(attr);
                if (src && !src.startsWith('data:') && !src.startsWith('#') && !src.startsWith('mailto:')) {
                    try {
                        const assetUrl = new URL(src, targetUrl).href;
                        let cleanPath = new URL(assetUrl).pathname;
                        let fileName = path.basename(cleanPath);
                        
                        if (!fileName || !fileName.includes('.')) {
                            const extensions = { js: '.js', css: '.css', img: '.png', audio: '.mp3', video: '.mp4', icon: '.ico' };
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
        processAsset('link[rel="icon"]', 'href', 'icon');
        processAsset('link[rel="shortcut icon"]', 'href', 'icon');
        processAsset('link[rel="apple-touch-icon"]', 'href', 'icon');
        processAsset('audio', 'src', 'audio');
        processAsset('source', 'src', 'media');
        processAsset('video', 'src', 'video');

        zip.file("index.html", $.html());

        const batchSize = 5; 
        for (let i = 0; i < assets.length; i += batchSize) {
            const batch = assets.slice(i, i + batchSize);
            const downloadTasks = batch.map(async (asset) => {
                try {
                    const assetRes = await axios.get(asset.url, { 
                        responseType: 'arraybuffer', 
                        timeout: 5000, 
                        headers: { 
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Referer': targetUrl
                        }
                    });
                    zip.file(`${asset.type}/${asset.fileName}`, assetRes.data);
                } catch (err) {}
            });
            await Promise.all(downloadTasks);
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
        res.status(500).json({ 
            error: 'Extraction failed or Website is protected.', 
            details: error.message 
        });
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`[Cyber Protocol] Server running on port ${PORT}`));
}
