console.log('versao 4')
const express = require('express');
const puppeteer = require('puppeteer-core');
const https = require('https');

const app = express();
app.use(express.json({ limit: '50mb' }));

let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      headless: 'new',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu',
        '--disable-web-security', '--font-render-hinting=none'
      ]
    });
    console.log('Browser iniciado.');
  }
  return browser;
}

function cloudinaryUpload(b64, cloudName, uploadPreset) {
  return new Promise((resolve, reject) => {
    // SEM public_id — Cloudinary gera automaticamente, sem risco de barra
    const payload = JSON.stringify({
      file: 'data:image/png;base64,' + b64,
      upload_preset: uploadPreset,
      resource_type: 'image'
    });
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${cloudName}/image/upload`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// POST /screenshots-and-upload
app.post('/screenshots-and-upload', async (req, res) => {
  const { renders, cloudinary: cld } = req.body;
  if (!renders || !cld) return res.status(400).json({ error: 'renders e cloudinary obrigatorios.' });

  const { cloud_name, upload_preset } = cld;
  const imageUrls = [];
  let storyUrl = '';
  let page = null;

  try {
    const b = await getBrowser();
    for (const r of renders) {
      page = await b.newPage();
      await page.setViewport({
        width: parseInt(r.w || 1080),
        height: parseInt(r.h || 1080),
        deviceScaleFactor: 2
      });
      await page.setContent(r.html, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.evaluateHandle('document.fonts.ready');
      await new Promise(resolve => setTimeout(resolve, 600));
      const shot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: parseInt(r.w || 1080), height: parseInt(r.h || 1080) }
      });
      await page.close(); page = null;

      const result = await cloudinaryUpload(shot.toString('base64'), cloud_name, upload_preset);
      if (!result.secure_url) throw new Error('Cloudinary erro ' + r.num + ': ' + JSON.stringify(result));
      console.log('OK slide', r.num, '->', result.secure_url);

      if (r.tipo === 'story') {
        storyUrl = result.secure_url;
      } else {
        imageUrls.push(result.secure_url);
      }
    }
    res.json({ imageUrls, storyUrl });
  } catch (err) {
    console.error(err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// POST /screenshot — rota simples
app.post('/screenshot', async (req, res) => {
  const { html, width = 1080, height = 1080 } = req.body;
  if (!html) return res.status(400).json({ error: 'html obrigatorio.' });
  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setViewport({ width: parseInt(width), height: parseInt(height), deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 600));
    const shot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: parseInt(width), height: parseInt(height) }
    });
    res.set('Content-Type', 'image/png');
    res.send(shot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// POST /html-to-pdf — converte HTML em PDF e retorna em base64
app.post('/html-to-pdf', async (req, res) => {
  const { html, format = 'A4', margin } = req.body;
  if (!html) return res.status(400).json({ error: 'html obrigatorio.' });
  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 500));
    const pdfBuffer = await page.pdf({
      format: format,
      margin: margin || { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' },
      printBackground: true
    });
    res.json({ pdf_base64: pdfBuffer.toString('base64') });
  } catch (err) {
    console.error('html-to-pdf:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

app.get('/health', (req, res) => res.json({
  status: 'ok',
  browser: browser?.isConnected() ? 'connected' : 'disconnected'
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Porta', PORT);
  getBrowser().catch(console.error);
});

process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
