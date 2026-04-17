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
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    console.log('browser ok');
  }
  return browser;
}

function cloudinaryUpload(b64, folder, publicId, cloudName, uploadPreset, resourceType = 'image') {
  return new Promise((resolve, reject) => {
    const mimePrefix = resourceType === 'raw' ? 'application/pdf' : 'image/png';
    const payload = JSON.stringify({
      file: `data:${mimePrefix};base64,${b64}`,
      upload_preset: uploadPreset,
      resource_type: resourceType,
      folder: folder,
      public_id: publicId
    });
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${cloudName}/${resourceType}/upload`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ============================================================================
// ENDPOINT EXISTENTE: screenshots + upload Cloudinary (para cards Instagram)
// ============================================================================
app.post('/screenshots-and-upload', async (req, res) => {
  const { renders, cloudinary: cld } = req.body;
  if (!renders || !cld) return res.status(400).json({ error: 'renders e cloudinary obrigatorios.' });
  const { cloud_name, upload_preset, slug } = cld;
  const ts = Date.now();
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
      await new Promise((rv) => setTimeout(rv, 600));
      const shot = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: parseInt(r.w || 1080), height: parseInt(r.h || 1080) }
      });
      await page.close();
      page = null;

      const isStory = r.tipo === 'story';
      const pid = `${slug}_${ts}_${isStory ? 'story' : 'slide' + (r.num || 0)}`;
      const up = await cloudinaryUpload(shot.toString('base64'), `ufem/${slug}`, pid, cloud_name, upload_preset);
      if (isStory) storyUrl = up.secure_url;
      else imageUrls.push(up.secure_url);
    }
    res.json({ imageUrls, storyUrl });
  } catch (err) {
    if (page) await page.close().catch(() => {});
    console.error('Erro screenshots-and-upload:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ENDPOINT NOVO: HTML → PDF (retorna base64, sem upload)
// Body: { html: "...", format?: "A4" }
// Resposta: { pdf_base64: "..." }
// ============================================================================
app.post('/html-to-pdf', async (req, res) => {
  const { html, format = 'A4', margin } = req.body;
  if (!html) return res.status(400).json({ error: 'html obrigatorio.' });

  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise((rv) => setTimeout(rv, 500));

    const pdfBuffer = await page.pdf({
      format: format,
      margin: margin || { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' },
      printBackground: true
    });
    await page.close();
    page = null;

    res.json({ pdf_base64: pdfBuffer.toString('base64') });
  } catch (err) {
    if (page) await page.close().catch(() => {});
    console.error('Erro html-to-pdf:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Health check
// ============================================================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', browser: browser?.isConnected() ? 'connected' : 'disconnected' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Screenshot service rodando na porta ${PORT}`);
  getBrowser().catch(console.error);
});

process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
