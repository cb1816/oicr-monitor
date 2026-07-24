// OICR Monitor — /api/data
// Scarica lo screener Morningstar Italia (universo FOITA), filtra sugli ISIN
// dell'allegato Fineco e restituisce l'oggetto DATA usato dal frontend.
// Cache edge: 6 ore. In caso di errore Morningstar -> snapshot statico.

const fs = require('fs');
const path = require('path');

const API = 'https://tools.morningstar.it/api/rest.svc/klr5zyak8x/security/screener';
const DATAPOINTS = [
  'isin', 'SecId', 'Name', 'categoryName',
  'GBRReturnW1', 'GBRReturnM0', 'GBRReturnM1', 'GBRReturnM3', 'GBRReturnM6',
  'GBRReturnM12', 'GBRReturnM36', 'GBRReturnM60',
  'starRatingM255', 'StandardDeviationM36', 'OngoingCostActual'
].join('|');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'it-IT,it;q=0.9',
  'Referer': 'https://www.morningstar.it/',
  'Origin': 'https://www.morningstar.it'
};

const MACROS = ['Azionari', 'Obbligazionari', 'Bilanciati', 'Flessibili', 'Monetari', 'Alternativi', 'Altro'];

function macroOf(cat) {
  if (!cat) return null;
  for (const m of MACROS) if (cat.startsWith(m)) return m;
  if (/^PIR\b/i.test(cat)) return 'Altro';
  return 'Altro';
}

const r2 = v => (v === null || v === undefined || isNaN(v)) ? null : Math.round(v * 100) / 100;
const r1 = v => (v === null || v === undefined || isNaN(v)) ? null : Math.round(v * 10) / 10;

function loadJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', rel), 'utf8'));
}

async function fetchScreener() {
  const rows = [];
  for (let page = 1; page <= 6; page++) {
    const url = `${API}?page=${page}&pageSize=15000&sortOrder=Name%20asc&outputType=json&version=1&languageId=it-IT&currencyId=EUR&universeIds=FOITA%24%24ALL&securityDataPoints=${encodeURIComponent(DATAPOINTS)}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error('Morningstar HTTP ' + res.status);
    const j = await res.json();
    const batch = j.rows || j.securities || [];
    rows.push(...batch);
    const total = j.total || 0;
    if (rows.length >= total || batch.length === 0) break;
  }
  if (rows.length === 0) throw new Error('Screener vuoto');
  return rows;
}

// normalizza il nome per raggruppare le classi dello stesso fondo (per il badge "N classi")
function baseName(name) {
  return (name || '')
    .toUpperCase()
    .replace(/\b(CLASS(E|IC)?|CL|R\/?[AD]?|RE\/?[AD]?|H-?(EUR|USD|GBP|CHF)|EUR|USD|GBP|CHF|JPY|ACC(UMULAT\w*)?|DIS(T(RIBUT\w*)?)?|INC|CAP(ITALIS\w*)?|HEDGED|HDG|[A-Z]\d?|\d+)\b/g, ' ')
    .replace(/[^A-Z]+/g, ' ')
    .trim();
}

function build(rows, isinSet, series) {
  const seen = new Set();
  const funds = [];
  for (const r of rows) {
    const isin = r.isin || r.Isin;
    if (!isin || !isinSet.has(isin)) continue;
    const secId = r.SecId || isin;
    if (seen.has(secId)) continue;
    seen.add(secId);
    const cat = r.categoryName || null;
    const m3 = r2(r.GBRReturnM3), m6 = r2(r.GBRReturnM6);
    const mom = (m3 !== null && m6 !== null) ? r2((m3 + m6) / 2) : (m3 !== null ? m3 : m6);
    funds.push([
      isin,
      r.Name || isin,
      cat,
      macroOf(cat),
      r2(r.GBRReturnM0),        // ytd
      r2(r.GBRReturnM1),        // m1
      m3, m6,
      r2(r.GBRReturnM12),       // 1a
      r2(r.GBRReturnM36),       // 3a p.a.
      r2(r.GBRReturnM60),       // 5a p.a.
      r.starRatingM255 || null, // stelle
      r1(r.StandardDeviationM36),
      r2(r.OngoingCostActual),
      mom,
      1,                        // nc (ricalcolato sotto)
      r2(r.GBRReturnW1),
      secId               // 17: per link scheda Morningstar
    ]);
  }

  // nc = numero di classi Fineco monitorate dello stesso fondo
  const groups = {};
  for (const f of funds) { const k = baseName(f[1]); groups[k] = (groups[k] || 0) + 1; }
  for (const f of funds) f[15] = groups[baseName(f[1])] || 1;

  funds.sort((a, b) => a[1].localeCompare(b[1], 'it'));

  // categorie ordinate per numerosità
  const catCount = {};
  for (const f of funds) if (f[2]) catCount[f[2]] = (catCount[f[2]] || 0) + 1;
  const cats = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a]);

  // serie storiche solo per ISIN presenti
  const inUniverse = new Set(funds.map(f => f[0]));
  const ser = {};
  let nSeries = 0;
  for (const [k, v] of Object.entries(series)) if (inUniverse.has(k)) { ser[k] = v; nSeries++; }

  const nData = funds.filter(f => f[8] !== null || f[4] !== null).length;
  const date = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });

  return {
    funds, cats,
    macroOrder: MACROS,
    series: ser,
    meta: { date, source: 'Morningstar Italia · via Vercel', nTot: funds.length, nData, nSeries }
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const isinSet = new Set(loadJSON('isins.json'));
    const series = loadJSON('series.json');
    const rows = await fetchScreener();
    const data = build(rows, isinSet, series);
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (err) {
    // Fallback: snapshot statico incluso nel repo
    try {
      const snap = loadJSON('snapshot.json');
      snap.meta.source += ' · snapshot (refresh fallito: ' + String(err.message || err).slice(0, 80) + ')';
      res.setHeader('Cache-Control', 's-maxage=900');
      res.status(200).json(snap);
    } catch (e2) {
      res.status(500).json({ error: String(err.message || err) });
    }
  }
};
