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
    if (!targetUrl) return res.status(400).send('URL ekak danna!');
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

    try {
        const response = await axios.get(targetUrl, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
            },
            timeout: 10000 
        });

        const $ = cheerio.load(response.data);
        const zip = new JSZip();
        const urlObj = new URL(targetUrl);
        const zipName = urlObj.hostname.replace(/\./g, '_') + '.zip';
        const assets = [];

        const processAsset = (tag, attr, typeFolder) => {
            $(tag).each((i, el) => {
                let src = $(el).attr(attr);
                if (src && !src.startsWith('data:') && !src.startsWith('#')) {
                    try {
                        // Absolute URL eka hadaganna widiya update kala
                        const assetUrl = new URL(src, targetUrl).href;
                        let fileName = path.basename(new URL(assetUrl).pathname);
                        
                        if (!fileName || !fileName.includes('.')) {
                            const extensions = { js: '.js', css: '.css', img: '.jpg' };
                            fileName = `${typeFolder}-${i}${extensions[typeFolder] || '.file'}`;
                        }

                        // Path eka "./css/style.css" wage wenas kala
                        assets.push({ type: typeFolder, url: assetUrl, fileName });
                        $(el).attr(attr, `./${typeFolder}/${fileName}`); 
                    } catch (e) {}
                }
            });
        };

        processAsset('link[rel="stylesheet"]', 'href', 'css');
        processAsset('script[src]', 'src', 'js');
        processAsset('img[src]', 'src', 'img');

        zip.file("index.html", $.html());

        // CSS/JS/IMG download karana ekata limit ekak damma timeout wena nisa
        const downloadTasks = assets.map(async (asset) => {
            try {
                const assetRes = await axios.get(asset.url, { 
                    responseType: 'arraybuffer', 
                    timeout: 5000, 
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                zip.file(`${asset.type}/${asset.fileName}`, assetRes.data);
            } catch (err) {
                console.log(`Failed to download: ${asset.url}`);
            }
        });

        await Promise.all(downloadTasks);

        const content = await zip.generateAsync({ type: "nodebuffer" });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
        res.send(content);

    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

module.exports = app;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
}
