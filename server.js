const express = require('express');
const puppeteer = require('puppeteer-core');

const app = express();

// Aceitar payloads grandes (HTMLs completos)
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
        '--disable-gpu',
        '--disable-web-security',
        '--font-render-hinting=none',
        '--enable-font-antialiasing'
      ]
    });
    console.log('Browser iniciado.');
  }
  return browser;
}

// -------------------------------------------------------
// POST /screenshot
// Body: { html: string, width: number, height: number }
// Retorna: PNG binário
// -------------------------------------------------------
app.post('/screenshot', async (req, res) => {
  const { html, width = 1080, height = 1080 } = req.body;

  if (!html) {
    return res.status(400).json({ error: 'Campo "html" é obrigatório.' });
  }

  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    await page.setViewport({
      width: parseInt(width),
      height: parseInt(height),
      deviceScaleFactor: 2
    });

    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Aguardar fontes do Google carregarem
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 600));

    const screenshot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: parseInt(width), height: parseInt(height) }
    });

    res.set('Content-Type', 'image/png');
    res.send(screenshot);

  } catch (err) {
    console.error('Erro no screenshot:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// -------------------------------------------------------
// POST /screenshots-batch
// Body: { renders: [{ html, width, height, num, tipo }] }
// Retorna: JSON com array de base64 PNGs
// -------------------------------------------------------
app.post('/screenshots-batch', async (req, res) => {
  const { renders } = req.body;

  if (!renders || !Array.isArray(renders)) {
    return res.status(400).json({ error: 'Campo "renders" é obrigatório e deve ser array.' });
  }

  const results = [];
  let page = null;

  try {
    const b = await getBrowser();

    for (const r of renders) {
      try {
        page = await b.newPage();
        await page.setViewport({
          width: parseInt(r.width || r.w || 1080),
          height: parseInt(r.height || r.h || 1080),
          deviceScaleFactor: 2
        });

        await page.setContent(r.html, {
          waitUntil: 'networkidle0',
          timeout: 30000
        });

        await page.evaluateHandle('document.fonts.ready');
        await new Promise(resolve => setTimeout(resolve, 600));

        const screenshot = await page.screenshot({
          type: 'png',
          clip: {
            x: 0, y: 0,
            width:  parseInt(r.width  || r.w || 1080),
            height: parseInt(r.height || r.h || 1080)
          }
        });

        results.push({
          num:    r.num,
          tipo:   r.tipo,
          width:  r.width  || r.w,
          height: r.height || r.h,
          png_b64: screenshot.toString('base64'),
          ok: true
        });

        await page.close();
        page = null;
        console.log(`Screenshot OK: slide ${r.num}`);

      } catch (err) {
        console.error(`Erro slide ${r.num}:`, err.message);
        results.push({ num: r.num, tipo: r.tipo, ok: false, error: err.message });
        if (page) { await page.close().catch(() => {}); page = null; }
      }
    }

    res.json({ results });

  } catch (err) {
    console.error('Erro batch:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', browser: browser?.isConnected() ? 'connected' : 'disconnected' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Screenshot service rodando na porta ${PORT}`);
  // Pre-inicializar o browser
  getBrowser().catch(console.error);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
