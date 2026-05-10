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
 * 🕵️ STEALTH PROXY (Advanced Mode Support)
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
            timeout: 15000,
            validateStatus: () => true
        });
        
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(response.status).send(response.data);
    } catch (error) {
        res.status(500).send(`Proxy Error: ${error.message}`);
    }
});

/**
 * 📱 Mobile check — User-Agent eke balanawa
 */
function isMobileDevice(userAgent) {
    return /android|iphone|ipad|ipod|mobile|opera mini|blackberry|windows phone/i.test(userAgent);
}

/**
 * 🔄 Asset eka base64 data URI ekata convert karanna
 */
async function toDataURI(url, userAgent) {
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 5000,
            headers: { 'User-Agent': userAgent }
        });
        const contentType = res.headers['content-type']?.split(';')[0] || 'application/octet-stream';
        const base64 = Buffer.from(res.data).toString('base64');
        return `data:${contentType};base64,${base64}`;
    } catch (e) {
        return null; // download failed nathnam null
    }
}

/**
 * ⚡ MAIN CONVERT ENDPOINT
 * PC   → ZIP file (css/, js/, img/ folders)
 * Mobile → Single inline HTML file (CSS + JS + images embedded)
 */
app.get('/api/convert', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'URL MISSED!' });
    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const clientUA = req.headers['user-agent'] || '';
    const mobile = isMobileDevice(clientUA);

    try {
        const response = await axios.get(targetUrl, {
            headers: { 'User-Agent': userAgent },
            timeout: 15000
        });
        const $ = cheerio.load(response.data);
        $('base').remove();

        const urlObj = new URL(targetUrl);

        // ─────────────────────────────────────────────
        // 📱 MOBILE MODE — single inline HTML file
        // ─────────────────────────────────────────────
        if (mobile) {
            // CSS inline karanna — <link rel="stylesheet"> → <style>
            const cssPromises = [];
            $('link[rel="stylesheet"]').each((i, el) => {
                const href = $(el).attr('href');
                if (href && !href.startsWith('data:')) {
                    try {
                        const cssUrl = new URL(href, targetUrl).href;
                        cssPromises.push(
                            axios.get(cssUrl, { timeout: 5000, headers: { 'User-Agent': userAgent } })
                                .then(r => {
                                    $(el).replaceWith(`<style>/* ${cssUrl} */\n${r.data}</style>`);
                                })
                                .catch(() => {
                                    $(el).remove(); // load nathnam remove
                                })
                        );
                    } catch (e) {
                        $(el).remove();
                    }
                }
            });
            await Promise.all(cssPromises);

            // JS inline karanna — <script src="..."> → <script>...</script>
            const jsPromises = [];
            $('script[src]').each((i, el) => {
                const src = $(el).attr('src');
                if (src && !src.startsWith('data:')) {
                    try {
                        const jsUrl = new URL(src, targetUrl).href;
                        jsPromises.push(
                            axios.get(jsUrl, { timeout: 5000, headers: { 'User-Agent': userAgent } })
                                .then(r => {
                                    const inlineScript = $('<script>').text(r.data);
                                    $(el).replaceWith(inlineScript);
                                })
                                .catch(() => {
                                    $(el).remove();
                                })
                        );
                    } catch (e) {
                        $(el).remove();
                    }
                }
            });
            await Promise.all(jsPromises);

            // Images → base64 data URIs
            const imgPromises = [];
            $('img').each((i, el) => {
                const src = $(el).attr('src');
                if (src && !src.startsWith('data:') && !src.startsWith('#')) {
                    try {
                        const imgUrl = new URL(src, targetUrl).href;
                        imgPromises.push(
                            toDataURI(imgUrl, userAgent).then(dataUri => {
                                if (dataUri) $(el).attr('src', dataUri);
                            })
                        );
                    } catch (e) {}
                }
            });
            await Promise.all(imgPromises);

            const fileName = urlObj.hostname.replace('www.', '').replace(/\./g, '_') + '.html';
            const htmlContent = $.html();

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            return res.send(htmlContent);
        }

        // ─────────────────────────────────────────────
        // 💻 PC MODE — ZIP file (original logic)
        // ─────────────────────────────────────────────
        const zip = new JSZip();
        const zipName = urlObj.hostname.replace('www.', '').replace(/\./g, '_') + '.zip';
        const assets = [];

        const processAsset = (tag, attr, folder) => {
            $(tag).each((i, el) => {
                let src = $(el).attr(attr);
                if (src && !src.startsWith('data:') && !src.startsWith('#')) {
                    try {
                        const assetUrl = new URL(src, targetUrl).href;
                        const fileName = `file-${i}.${folder}`;
                        assets.push({ url: assetUrl, path: `${folder}/${fileName}` });
                        $(el).attr(attr, `./${folder}/${fileName}`);
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
                const r = await axios.get(asset.url, {
                    responseType: 'arraybuffer',
                    timeout: 5000,
                    headers: { 'User-Agent': userAgent }
                });
                zip.file(asset.path, r.data);
            } catch (err) {}
        }

        const content = await zip.generateAsync({ type: "nodebuffer" });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
        return res.send(content);

    } catch (error) {
        res.status(500).json({ error: 'Server extraction failed.', details: error.message });
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`[Lord Indumina Protocol] Online on Port: ${PORT}`));
}
