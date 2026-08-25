/* Prova la pagina in un browser vero: serve il repo su localhost con /api/data
   agganciato all'handler reale, poi apre index.html in Chromium e controlla che
   l'app parta, che le schede rispondano e che la scheda fondo si apra.
   node tools/test_pagina.js [--lento]   (--lento ritarda /api/data di 6s per
   vedere la copia locale reggere l'attesa)
   Il flag --shot salva gli screenshot in /tmp. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const LENTO = process.argv.includes('--lento');
const ROTTO = process.argv.includes('--rotto');
const NULLA = process.argv.includes('--nulla');   // niente API e niente copia locale
/* --date serve una /api/data finta in cui la data della CHIAMATA (25/08) e la
   chiusura dei PREZZI (24/08) sono diverse. E' il caso che si e' visto in
   produzione: la testata diceva "dati al 25/08" mostrando prezzi del 24. Senza
   rete l'handler vero ricade sullo snapshot, che dataChiusura non ce l'ha, e il
   caso non verrebbe mai esercitato. */
const DATE = process.argv.includes('--date');
const FINTA_DATE = { date: '25/08/2026', dataChiusura: '2026-08-24' };
const SHOT = process.argv.includes('--shot');
const apiHandler = require('../api/data.js');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/data') {
    if (ROTTO) { res.writeHead(500); return res.end('ko'); }
    if (LENTO) await new Promise(r => setTimeout(r, 6000));
    if (DATE) {
      const d = JSON.parse(fs.readFileSync(path.join(root, 'data', 'bootstrap.json'), 'utf8'));
      d.meta.date = FINTA_DATE.date;
      d.meta.dataChiusura = FINTA_DATE.dataChiusura;
      d.meta.source = 'Morningstar Italia · via Vercel';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(d));
    }
    const finto = {
      _h: {}, setHeader(k, v) { this._h[k] = v; }, status(c) { this._c = c; return this; },
      json(o) { res.writeHead(this._c || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }
    };
    return apiHandler(req, finto);
  }
  if (NULLA && url === '/data/bootstrap.json') { res.writeHead(404); return res.end('no'); }
  const f = path.join(root, url === '/' ? 'index.html' : url.slice(1));
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

let ko = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  KO   ') + m); if (!c) ko++; };

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const errori = [];
  page.on('pageerror', e => errori.push(String(e.message)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    // in --rotto il 500 su /api/data e' lo scenario, non un difetto
    if ((ROTTO || NULLA) && /Failed to load resource/.test(m.text())) return;
    errori.push('console: ' + m.text());
  });

  const t0 = Date.now();
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });

  if (NULLA) {
    await page.waitForSelector('.empty', { timeout: 20000 });
    const t = (await page.textContent('#view')).trim();
    const c = (await page.textContent('#cnt')).trim();
    console.log('\n1) niente API, niente copia locale');
    console.log('   vista:   "' + t.replace(/\s+/g, ' ') + '"');
    console.log('   testata: "' + c.replace(/\s+/g, ' ') + '"');
    ok(/Non riesco a caricare/.test(t), 'compare la schermata di errore');
    ok((await page.locator('#view button').count()) > 0, 'c\'e\' il pulsante Riprova');
    await browser.close(); server.close();
    console.log(ko === 0 ? '\nTUTTO OK\n' : '\n' + ko + ' CONTROLLI FALLITI\n');
    return process.exit(ko === 0 ? 0 : 1);
  }

  // 1. primo contenuto sullo schermo
  await page.waitForSelector('.card', { timeout: 20000 });
  const tPrimo = Date.now() - t0;
  const testataPrima = (await page.textContent('#cnt')).replace(/\s+/g, ' ').trim();
  console.log('\n1) primo disegno');
  console.log('   ' + tPrimo + ' ms  ·  testata: "' + testataPrima + '"');
  ok(tPrimo < (LENTO ? 5000 : 20000), LENTO ? 'la copia locale compare prima dei dati freschi' : 'la pagina si disegna');

  // 2. arrivo dei dati freschi
  if (!ROTTO) {
    await page.waitForFunction(() => !document.querySelector('#cnt .agg'), null, { timeout: 30000 });
    const testataDopo = (await page.textContent('#cnt')).replace(/\s+/g, ' ').trim();
    console.log('\n2) dati freschi');
    console.log('   ' + (Date.now() - t0) + ' ms  ·  testata: "' + testataDopo + '"');
    ok(!/aggiorno/.test(testataDopo), 'la scritta "aggiorno…" sparisce');
    const nCard = await page.locator('.card').count();
    ok(nCard > 0, 'la lista resta popolata dopo lo scambio (' + nCard + ' righe)');
  }

  if (ROTTO) {
    await page.waitForTimeout(1200);
    const t = (await page.textContent('#cnt')).replace(/\s+/g, ' ').trim();
    console.log('\n2) refresh fallito');
    console.log('   testata: "' + t + '"');
    ok(/copia locale/.test(t), 'la testata dichiara che stai guardando la copia locale');
    ok(!/aggiorno/.test(t), 'non resta "aggiorno…" a girare a vuoto');
  }

  // 2b. la data in testata deve essere la CHIUSURA dei prezzi, non il momento
  //     della chiamata: l'app diceva "dati al 25/08" mostrando prezzi del 24
  if (!ROTTO) {
    const t = (await page.textContent('#cnt')).replace(/\s+/g, ' ').trim();
    const meta = await page.evaluate(() => ({
      chiusura: (window.__DATA_META || {}).dataChiusura || null,
      date: (window.__DATA_META || {}).date || null,
      nTot: (window.__DATA_META || {}).nTot || null,
      nData: (window.__DATA_META || {}).nData || null
    }));
    console.log('\n2b) testata');
    console.log('   "' + t + '"');
    console.log('   meta: dataChiusura=' + meta.chiusura + ' · date=' + meta.date +
      ' · nTot=' + meta.nTot + ' · nData=' + meta.nData);
    if (meta.chiusura) {
      const p = meta.chiusura.split('-');
      const attesa = p[2] + '/' + p[1] + '/' + p[0];
      ok(t.includes(attesa), 'mostra la data di chiusura dei prezzi (' + attesa + ')');
      if (meta.date && meta.date !== attesa) {
        ok(!t.includes(meta.date), 'NON mostra la data della chiamata (' + meta.date + ')');
      }
    }
    // il separatore delle migliaia dipende dall'ICU: si confrontano le cifre
    const cifre = x => String(x).replace(/\D/g, '');
    if (meta.nTot) ok(cifre(t).startsWith(cifre(meta.nTot)), 'conta tutti i fondi (nTot ' + meta.nTot + ')');
    if (DATE) {
      ok(t.includes('24/08/2026'), 'mostra la chiusura dei prezzi 24/08/2026');
      ok(!t.includes('25/08/2026'), 'NON mostra 25/08/2026, che e\' solo il momento della chiamata');
    }
  }

  // 3. nessuna metrica duplicata dopo il doppio avvio
  const chips = await page.locator('#metricChips .chip').allTextContents();
  console.log('\n3) chip delle metriche');
  console.log('   ' + chips.join(' · '));
  ok(new Set(chips).size === chips.length, 'nessuna chip ripetuta');

  // 4. le cinque schede
  console.log('\n4) schede');
  for (const t of ['rank', 'topflop', 'cat', 'mappa', 'idee']) {
    await page.click(`nav button[data-tab="${t}"]`);
    await page.waitForTimeout(250);
    const n = (await page.textContent('#view')).trim().length;
    ok(n > 200, t + ' — ' + n + ' caratteri');
  }

  // 5. scheda del fondo + link Morningstar
  console.log('\n5) scheda fondo');
  await page.click('nav button[data-tab="rank"]');
  await page.waitForTimeout(200);
  await page.locator('.card').first().click();
  await page.waitForSelector('#ov.on', { timeout: 5000 });
  const titolo = (await page.textContent('#sheet h2')).trim();
  const badge = await page.locator('#sheet .pill').allTextContents();
  const link = await page.locator('#sheet a.msLink').count();
  const href = link ? await page.locator('#sheet a.msLink').first().getAttribute('href') : '(nessuno)';
  console.log('   ' + titolo);
  console.log('   ' + badge.join(' | '));
  console.log('   link: ' + href);
  ok(titolo.length > 3, 'il titolo del fondo c\'e\'');
  ok(badge.some(b => /class/i.test(b)), 'il badge delle classi c\'e\'');
  ok((await page.locator('#sheet svg').count()) > 0, 'il grafico c\'e\'');
  if (!ROTTO) ok(link > 0, 'link alla scheda Morningstar');
  if (SHOT) await page.screenshot({ path: '/tmp/oicr-scheda.png' });
  await page.click('#sheet .closex');

  // 6. filtri e ricerca
  console.log('\n6) filtri');
  await page.locator('#q').fill('azion');
  await page.waitForTimeout(300);
  ok((await page.locator('.card').count()) > 0, 'la ricerca produce risultati');
  await page.locator('#q').fill('');
  await page.waitForTimeout(200);
  const macro = page.locator('#macroChips .chip').nth(1);
  const nomeMacro = await macro.textContent();
  await macro.click();
  await page.waitForTimeout(300);
  ok((await page.locator('.card').count()) > 0, 'il filtro macro "' + nomeMacro.trim() + '" produce risultati');

  // 7. il pulsante ponte verso ETF Monitor — gia' perso una volta
  console.log('\n7) pulsante ponte');
  const ponte = await page.locator('a[href*="etf-monitor"]').count();
  ok(ponte > 0, 'il pulsante ⇄ ETF c\'e\' ancora');
  if (SHOT) await page.screenshot({ path: '/tmp/oicr-home.png', fullPage: false });

  console.log('\n8) errori JavaScript');
  if (errori.length) errori.slice(0, 8).forEach(e => console.log('   ! ' + e));
  ok(errori.length === 0, errori.length + ' errori in pagina');

  await browser.close();
  server.close();
  console.log(ko === 0 ? '\nTUTTO OK\n' : '\n' + ko + ' CONTROLLI FALLITI\n');
  process.exit(ko === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
