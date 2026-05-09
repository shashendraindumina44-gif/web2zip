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
    if (!targetUrl) return res.status(400).json({ error: 'URL ekak danna!' });
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

    try {
        // 1. Site eke HTML eka gannawa
        const response = await axios.get(targetUrl, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 8000 // Vercel overall timeout ekata kalin nawaththanna
        });

        const $ = cheerio.load(response.data);
        const zip = new JSZip();
        const urlObj = new URL(targetUrl);
        const zipName = urlObj.hostname.replace(/\./g, '_') + '_extracted.zip';
        const assets = [];

        // 2. Offline wada karanna HTML eka clean kirima
        $('base').remove(); // Offline yaddi base URL awul yana eka nawaththanna

        const processAsset = (tag, attr, typeFolder) => {
            $(tag).each((i, el) => {
                let src = $(el).attr(attr);
                if (src && !src.startsWith('data:') && !src.startsWith('#') && !src.startsWith('mailto:')) {
                    try {
                        const assetUrl = new URL(src, targetUrl).href;
                        // URL parameters ain karala clean filename eka gannawa
                        let cleanPath = new URL(assetUrl).pathname;
                        let fileName = path.basename(cleanPath);
                        
                        if (!fileName || !fileName.includes('.')) {
                            const extensions = { js: '.js', css: '.css', img: '.png', audio: '.mp3', video: '.mp4', icon: '.ico' };
                            fileName = `${typeFolder}-${i}${extensions[typeFolder] || '.file'}`;
                        } else {
                            // File names wala awul thiyena ewa clean karanawa
                            fileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                        }

                        assets.push({ type: typeFolder, url: assetUrl, fileName });
                        
                        // Path eka explicit widiyata local folder ekata point karanawa (CSS apply wenna meka wadagath)
                        $(el).attr(attr, `./${typeFolder}/${fileName}`); 
                    } catch (e) {
                        // Invalid URLs ignore karanawa
                    }
                }
            });
        };

        // Assets map kirima
        processAsset('link[rel="stylesheet"]', 'href', 'css');
        processAsset('script[src]', 'src', 'js');
        processAsset('img', 'src', 'img');
        processAsset('link[rel="icon"]', 'href', 'icon');
        processAsset('link[rel="shortcut icon"]', 'href', 'icon');
        processAsset('link[rel="apple-touch-icon"]', 'href', 'icon');
        processAsset('audio', 'src', 'audio');
        processAsset('source', 'src', 'media'); // catch all for audio/video sources
        processAsset('video', 'src', 'video');

        // Update karapu HTML eka zip ekata danawa
        zip.file("index.html", $.html());

        // 3. Batch Downloader (Vercel crash wena eka nawaththanna)
        const batchSize = 5; // Ekawara files 5k witharai download wenne
        for (let i = 0; i < assets.length; i += batchSize) {
            const batch = assets.slice(i, i + batchSize);
            const downloadTasks = batch.map(async (asset) => {
                try {
                    const assetRes = await axios.get(asset.url, { 
                        responseType: 'arraybuffer', 
                        timeout: 4000, // Eka file ekakata maximum 4 seconds
                        headers: { 
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Referer': targetUrl
                        }
                    });
                    zip.file(`${asset.type}/${asset.fileName}`, assetRes.data);
                } catch (err) {
                    console.log(`[SKIPPED] ${asset.url}`);
                }
            });
            await Promise.all(downloadTasks);
        }

        // 4. Zip eka generate karala send kirima
        const content = await zip.generateAsync({ 
            type: "nodebuffer",
            compression: "STORE" // Vercel CPU load eka adu karanna compression eka adu kala
        });
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
        res.send(content);

    } catch (error) {
        console.error(error);
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
