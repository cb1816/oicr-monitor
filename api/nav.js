// OICR Monitor — /api/nav
// Valore della quota (NAV) di OGNI classe della lista Fineco, con valuta e data.
// /api/data serve la pagina: una classe per fondo, rendimenti e metriche, niente
// prezzo. Chi deve VALORIZZARE una posizione (CRM, Magüt) ha bisogno del NAV
// della classe esatta che il cliente ha, quindi questo endpoint non deduplica.
//
//   GET /api/nav              tutte le classi della lista (data/isins.json)
//   GET /api/nav?isin=A,B,C   solo quelle (fino a 300), anche fuori lista
//
// Risposta: { meta, nav: { ISIN: [nav, valuta, 'AAAA-MM-GG', universo] }, mancanti: [ISIN] }
//
// Fonte: screener Morningstar (lo stesso di /api/data), campi ClosePrice,
// closePriceDate e currency. Verificato il 30/09/2026 sui 6.284 ISIN della lista:
//  - 6.129 nell'universo dei fondi italiani (FOITA$$ALL), tutti con NAV;
//  - 80 dei 155 restanti nell'universo europeo (FOEUR$$ALL): si cercano lì;
//  - 75 in nessun universo (classi chiuse o fuse dopo la lista): in `mancanti`;
//  - 242 classi hanno il NAV pubblicato in più valute (stesso valore convertito):
//    si tiene quello in EUR se c'è, altrimenti il più recente.
// Il NAV è nella valuta indicata, NON convertito: la conversione spetta a chi
// valorizza, con il cambio della stessa data.

const fs = require('fs');
const path = require('path');
const { API, HEADERS } = require('./data');

const PUNTI = 'isin|ClosePrice|closePriceDate|currency';
const PAGINA = 10000, BLOCCO = 100, MAX_ISIN = 300;
const BUDGET_MS = Math.max(5000, Number(process.env.OICR_BUDGET_MS) || 45000);
const UNIVERSI = ['FOITA$$ALL', 'FOEUR$$ALL'];

function loadJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', rel), 'utf8'));
}

const url = (universo, extra) => `${API}?page=${extra.page || 1}&pageSize=${extra.pageSize || PAGINA}&sortOrder=Name%20asc` +
  `&outputType=json&version=1&languageId=it-IT&currencyId=EUR&universeIds=${encodeURIComponent(universo)}` +
  `&securityDataPoints=${encodeURIComponent(PUNTI)}` + (extra.isin ? `&filters=${encodeURIComponent('ISIN:IN:' + extra.isin.join(':'))}` : '');

async function chiedi(u, t0) {
  const resta = BUDGET_MS - (Date.now() - t0);
  if (resta < 2000) throw new Error('budget scaduto');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), resta - 1000);
  try {
    const r = await fetch(u, { headers: HEADERS, signal: ctrl.signal });
    if (!r.ok) throw new Error('Morningstar HTTP ' + r.status);
    const j = await r.json();
    return { righe: j.rows || [], total: j.total || 0 };
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'timeout Morningstar' : String(e && e.message || e));
  } finally { clearTimeout(timer); }
}

// Tutto l'universo italiano a pagine (in parallelo dopo la prima)
async function universoIntero(t0) {
  const p1 = await chiedi(url(UNIVERSI[0], { page: 1 }), t0);
  const righe = p1.righe.slice();
  const n = Math.min(10, Math.ceil(p1.total / PAGINA));
  const altre = await Promise.all(Array.from({ length: n - 1 }, (_, i) => chiedi(url(UNIVERSI[0], { page: i + 2 }), t0)));
  for (const p of altre) righe.push(...p.righe);
  if (p1.total && righe.length < p1.total * 0.99) throw new Error('screener incompleto ' + righe.length + '/' + p1.total);
  return righe.map(r => Object.assign(r, { _u: UNIVERSI[0] }));
}
// Solo alcuni ISIN, a blocchi, in un universo
async function perIsin(universo, isin, t0) {
  const blocchi = [];
  for (let i = 0; i < isin.length; i += BLOCCO) blocchi.push(isin.slice(i, i + BLOCCO));
  const pagine = await Promise.all(blocchi.map(b => chiedi(url(universo, { pageSize: 2000, isin: b }), t0)));
  return pagine.flatMap(p => p.righe).map(r => Object.assign(r, { _u: universo }));
}

const numero = v => typeof v === 'number' && isFinite(v) && v > 0;
const giorno = d => d ? String(d).slice(0, 10) : null;

/* Una riga per ISIN. Fra più valute: EUR se c'è (è lo stesso NAV convertito e
   risparmia un cambio a chi valorizza), poi la data più recente, poi il primo
   universo della lista. */
function scegli(righe) {
  const valide = righe.filter(r => numero(r.ClosePrice));
  if (!valide.length) return null;
  valide.sort((a, b) => (b.currency === 'EUR') - (a.currency === 'EUR') ||
    String(giorno(b.closePriceDate) || '').localeCompare(String(giorno(a.closePriceDate) || '')) ||
    UNIVERSI.indexOf(a._u) - UNIVERSI.indexOf(b._u));
  const r = valide[0];
  return [+r.ClosePrice.toPrecision(10), r.currency || null, giorno(r.closePriceDate), r._u];
}

function costruisci(isinChiesti, righe) {
  const perIsinMap = new Map();
  const voluti = new Set(isinChiesti);
  for (const r of righe) if (r.isin && voluti.has(r.isin)) (perIsinMap.get(r.isin) || perIsinMap.set(r.isin, []).get(r.isin)).push(r);
  const nav = {}, mancanti = [];
  for (const isin of isinChiesti) {
    const s = scegli(perIsinMap.get(isin) || []);
    if (s) nav[isin] = s; else mancanti.push(isin);
  }
  const date = {};
  for (const v of Object.values(nav)) if (v[2]) date[v[2]] = (date[v[2]] || 0) + 1;
  const dataChiusura = Object.keys(date).sort((a, b) => date[b] - date[a])[0] || null;
  const vecchi = Object.values(nav).filter(v => v[2] && dataChiusura && v[2] < dataChiusura).length;
  return {
    meta: {
      generato: new Date().toISOString(), fonte: 'Morningstar, screener (' + UNIVERSI.join(', ') + ')',
      dataChiusura, nChiesti: isinChiesti.length, nTrovati: Object.keys(nav).length, nMancanti: mancanti.length,
      nPrimaDellaChiusura: vecchi, nonEur: Object.values(nav).filter(v => v[1] !== 'EUR').length,
      formato: 'nav[ISIN] = [valore della quota, valuta, data AAAA-MM-GG, universo Morningstar]',
    },
    nav, mancanti,
  };
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
function isinDaQuery(q) {
  if (!q) return null;
  const v = [...new Set(String(q).toUpperCase().split(/[\s,;]+/).filter(x => ISIN_RE.test(x)))];
  return v.slice(0, MAX_ISIN);
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const q = req.query && req.query.isin !== undefined ? isinDaQuery(req.query.isin) : null;
    if (q !== null && !q.length) { res.status(400).send(JSON.stringify({ errore: 'nessun ISIN valido in ?isin=' })); return; }
    const lista = q || loadJSON('isins.json');
    let righe = q ? await perIsin(UNIVERSI[0], lista, t0) : await universoIntero(t0);
    // chi manca nell'universo italiano si cerca in quello europeo
    const trovati = new Set(righe.filter(r => numero(r.ClosePrice)).map(r => r.isin));
    const resto = lista.filter(x => !trovati.has(x));
    if (resto.length) righe = righe.concat(await perIsin(UNIVERSI[1], resto, t0));
    const out = costruisci(lista, righe);
    out.meta.ms = Date.now() - t0;
    // il NAV cambia una volta al giorno: 3 ore di cache, poi si rinnova in background
    res.setHeader('Cache-Control', 's-maxage=10800, stale-while-revalidate=86400');
    res.status(200).send(JSON.stringify(out));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).send(JSON.stringify({ errore: String(e && e.message || e) }));
  }
};
module.exports.scegli = scegli;
module.exports.costruisci = costruisci;
module.exports.isinDaQuery = isinDaQuery;
