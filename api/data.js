// OICR Monitor — /api/data
// Scarica lo screener Morningstar Italia (universo FOITA), filtra sugli ISIN
// dell'allegato Fineco, deduplica le classi di quota e restituisce l'oggetto DATA
// gia' con tutte le metriche calcolate. Cache edge: 6 ore.
// In caso di errore Morningstar -> snapshot statico, convertito al volo.
//
// Impianto: stesso scheletro di ETF Monitor (METODOLOGIA.md nel repo etf-monitor),
// metriche diverse perche' diverso e' l'oggetto misurato.
//   - ALLOCAZIONE, sulla categoria: trend 6m, Mom. 12-1, accelerazione, ampiezza,
//     dispersione; score = percentile della categoria DENTRO LA SUA MACRO.
//   - SELEZIONE, sul fondo: Mom. rel., Mom. accel., consistenza, quartile di costo,
//     stelle. Qui c'e' un gestore da giudicare, quindi le misure relative alla
//     categoria hanno senso: sugli ETF sarebbero il TER travestito da bravura.
// Sotto MIN_N fondi la categoria non produce numeri relativi: e' la mediana di se'
// stessa. Meglio un "—" dichiarato che un numero finto.

const fs = require('fs');
const path = require('path');

const API = 'https://lt.morningstar.com/api/rest.svc/9vehuxllxs/security/screener';
const DATAPOINTS = [
  'isin', 'SecId', 'Name', 'categoryName',
  'GBRReturnW1', 'GBRReturnM0', 'GBRReturnM1', 'GBRReturnM3', 'GBRReturnM6',
  'GBRReturnM12', 'GBRReturnM36', 'GBRReturnM60',
  'starRatingM255', 'StandardDeviationM36', 'OngoingCostActual', 'closePriceDate'
].join('|');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'it-IT,it;q=0.9',
  'Referer': 'https://www.morningstar.it/',
  'Origin': 'https://www.morningstar.it'
};

// Soglia sotto la quale non si pubblica un numero relativo alla categoria.
const MIN_N = 5;

/* Macro — 10 voci, riallineate a ETF Monitor il 25/08/2026. Nove etichette sono
   in comune con l'app ETF; le differenze sono volute, non residui:
   - "Flessibili" qui c'e' e su ETF no. Sono 9 categorie e 552 fondi in cui e' il
     gestore a decidere l'esposizione: su strumenti passivi non avrebbe oggetto.
   - "Leva e Inverse (ETP)" non e' stata portata: sui fondi la leva non e' un fenomeno.
   - "Cripto" non e' stata portata: nell'universo Fineco non c'e' nessun fondo di
     categoria "Asset Digitali". Se ne entrasse uno finirebbe in "Altro"; il giorno
     che succede si aggiunge la voce qui e la riga corrispondente in macroOf().
   - "Materie Prime" senza il suffisso "(ETC)": qui l'involucro e' un fondo. */
const MACROS = ['Azionari', 'Obbligazionari', 'Convertibili', 'Bilanciati',
  'Flessibili', 'Monetari', 'Materie Prime', 'Immobiliare', 'Alternativi', 'Altro'];

// L'ordine dei test conta: le categorie si chiamano "Obbligazionari Convertibili ..."
// e "Bilanciati Flessibili ...", quindi i due casi ibridi vanno controllati PRIMA
// delle macro da cui prendono il prefisso.
function macroOf(cat) {
  const c = String(cat || '').trim();
  if (!c) return 'Altro';
  if (/^Materie [Pp]rime/i.test(c)) return 'Materie Prime';
  if (/^Immobiliar/i.test(c)) return 'Immobiliare';
  if (/Flessibil/i.test(c)) return 'Flessibili';
  if (/Convertibil/i.test(c)) return 'Convertibili';
  if (/^Azionari/i.test(c)) return 'Azionari';
  if (/^(Obbligazionari|Fondi Obiettivo)/i.test(c)) return 'Obbligazionari';   // target maturity
  if (/^Bilanciati/i.test(c)) return 'Bilanciati';
  if (/^(Monetari|Liquidit)/i.test(c)) return 'Monetari';
  if (/^(Alternativi|Hedge)/i.test(c)) return 'Alternativi';
  return 'Altro';
}

const r2 = v => (v === null || v === undefined || isNaN(v)) ? null : Math.round(v * 100) / 100;
const r1 = v => (v === null || v === undefined || isNaN(v)) ? null : Math.round(v * 10) / 10;
const num = v => (v === null || v === undefined || !isFinite(v)) ? null : v;

function median(a) {
  const v = a.filter(x => x !== null && x !== undefined && isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// quantile lineare (tipo 7, come R ed Excel) — stessa implementazione di ETF Monitor
function quantile(a, p) {
  const v = a.filter(x => x !== null && x !== undefined && isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  if (v.length === 1) return v[0];
  const h = (v.length - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return v[lo] + (h - lo) * (v[hi] - v[lo]);
}

// percentile di x dentro l'insieme a, 0-100; media dei ranghi sui pari merito
function percentile(a, x) {
  const v = a.filter(y => y !== null && y !== undefined && isFinite(y));
  if (v.length < 2 || x === null || x === undefined || !isFinite(x)) return null;
  let sotto = 0, pari = 0;
  for (const y of v) { if (y < x) sotto++; else if (y === x) pari++; }
  return Math.round(1000 * (sotto + pari / 2) / v.length) / 10;
}

// Mom. 12-1 = (1+r12)/(1+m1) - 1. Il classico, escluso l'ultimo mese che tende a invertire.
function mom121(r12, m1) {
  if (r12 === null || m1 === null) return null;
  const d = 1 + m1 / 100;
  if (d === 0) return null;
  return Math.round(((1 + r12 / 100) / d - 1) * 10000) / 100;
}

// Accelerazione grezza = 4*m3 - 2*m6 (3 mesi annualizzato meno 6 mesi annualizzato).
// Su scala diversa dai rendimenti: non va letta come una percentuale.
function accelGrezza(m3, m6) {
  if (m3 === null || m6 === null) return null;
  return 4 * m3 - 2 * m6;
}

function loadJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', rel), 'utf8'));
}

const PAGE_SIZE = 10000;
const MAX_PAGES = 10;

/* Budget di tempo del refresh (METODOLOGIA.md §12).
   La funzione ha `maxDuration` secondi in vercel.json: se il refresh li sfora,
   Vercel uccide il processo e l'utente vede un 504 con la pagina vuota — il
   fallback su snapshot NON scatta, perche' non c'e' piu' nessuno a eseguirlo.
   Qui il refresh si da' una scadenza PROPRIA, piu' corta del limite di
   piattaforma: quando la sfora lancia un errore normale, e da li' in poi e' il
   solito percorso di fallback a rispondere. Il 504 non e' piu' raggiungibile.
   Si regola senza toccare il codice con la variabile d'ambiente OICR_BUDGET_MS. */
const BUDGET_MS = Math.max(5000, Number(process.env.OICR_BUDGET_MS) || 40000);

const restante = t0 => BUDGET_MS - (Date.now() - t0);

async function fetchScreener(t0) {
  const rows = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${API}?page=${page}&pageSize=${PAGE_SIZE}&sortOrder=Name%20asc&outputType=json&version=1&languageId=it-IT&currencyId=EUR&universeIds=FOITA%24%24ALL&securityDataPoints=${encodeURIComponent(DATAPOINTS)}`;
    // ogni pagina non puo' durare piu' di quanto resta del budget: senza questo
    // una singola richiesta appesa si mangerebbe tutto il tempo della funzione
    const disponibile = restante(t0);
    if (disponibile <= 2000) throw new Error('Budget scaduto dopo ' + rows.length + ' righe');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), disponibile - 1000);
    let res;
    try {
      res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    } catch (e) {
      throw new Error(e && e.name === 'AbortError'
        ? 'Timeout Morningstar (budget ' + BUDGET_MS + 'ms)'
        : 'Morningstar irraggiungibile: ' + String(e && e.message || e));
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error('Morningstar HTTP ' + res.status);
    const j = await res.json();
    const batch = j.rows || j.securities || [];
    rows.push(...batch);
    total = j.total || total;
    // una pagina piu corta della richiesta significa fine dei dati
    if (batch.length < PAGE_SIZE) break;
    if (total && rows.length >= total) break;
  }
  if (rows.length === 0) throw new Error('Screener vuoto');
  // meglio lo snapshot che una classifica costruita su dati monchi
  if (total && rows.length < total * 0.99) throw new Error('Screener incompleto ' + rows.length + '/' + total);
  return rows;
}

/* ====================================================================== *
 *  DEDUPLICA PER CLASSE DI QUOTA  (METODOLOGIA.md §7)
 *
 *  Regola confermata il 25/08/2026: "stesso fondo" = stesso portafoglio a
 *  meno di VALUTA della quota, CEDOLA (Acc/Inc/Dis/ANN/Cap) e CLASSE DI
 *  COMMISSIONE (A/E/R/Rd/L/I...). La COPERTURA DEL CAMBIO resta una cosa a
 *  se': profilo di rischio diverso, e Morningstar stessa spesso classifica
 *  la versione hedged in una categoria diversa.
 *
 *  Il nome viene sfrondato SOLO dalla coda, fermandosi al primo token non
 *  riconosciuto: il nucleo del nome sta all'inizio e non viene mai intaccato.
 *  La precisione conta piu' della copertura — un accorpamento mancato lascia
 *  due righe (com'e' oggi), uno sbagliato fonde due fondi diversi.
 * ====================================================================== */

const CURR = new Set(['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'SEK', 'NOK', 'DKK', 'AUD', 'CAD',
  'SGD', 'HKD', 'CNH', 'CNY', 'RMB', 'PLN', 'CZK', 'HUF', 'ZAR', 'NZD', 'MXN', 'BRL', 'TRY',
  'ILS', 'KRW', 'RUB', 'THB', 'TWD', 'INR', 'IDR']);

const HEDGE_WORD = new Set(['H', 'HDG', 'HGD', 'HG', 'HEDGED', 'HEDGE', 'HEDG', 'HEDGD']);
const UNHEDGE_WORD = new Set(['UNHEDGED', 'UH']);

// Cedola / capitalizzazione: SOLO abbreviazioni.
// "INCOME", "CAPITAL", "GROWTH" non stanno qui, sono parole di nome fondo.
const DIST = new Set(['ACC', 'ACCUM', 'ACCUMULATION', 'ACCUMULATING', 'INC', 'DIS', 'DIST',
  'DISTR', 'DISTRIB', 'DISTRIBUTION', 'DISTRIBUTING', 'CAP', 'CAPITALISATION',
  'CAPITALIZATION', 'ANN', 'YDIS', 'QDIS', 'MDIS', 'SDIS', 'ADIS', 'YINC', 'QINC', 'MINC',
  'MTH', 'MTHLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL']);

const NOISE = new Set(['CLASS', 'CLASSE', 'CL', 'SHARES', 'SHARE', 'SHS', 'UNITS', 'UNIT',
  'RETAIL', 'INSTITUTIONAL', 'INST', 'INSTL', 'CLEAN', 'FOUNDER', 'SEED']);

/* Sigle di 2 lettere che NON sono classi di commissione ma pezzi di nome:
   paesi, aree, temi. Meglio perdere un accorpamento che unire due fondi diversi. */
const NON_CLASSE = new Set(['US', 'UK', 'EM', 'EU', 'IT', 'JP', 'CN', 'IN', 'ID', 'IE',
  'DE', 'FR', 'ES', 'CH', 'SE', 'NO', 'DK', 'FI', 'BE', 'PT', 'GR', 'PL', 'TR', 'ZA',
  'BR', 'MX', 'KR', 'TW', 'HK', 'SG', 'NZ', 'CA', 'RU', 'HY', 'IG', 'IL', 'GL',
  'AI', 'GO', 'AG', 'ETF', 'SRI', 'ESG']);

// Serie dello stesso comparto: "Core Target Alloc 25 (II)/(III)/(IV)" hanno lo
// stesso portafoglio e rendimenti a un decimo l'uno dall'altro.
const ROMANI = new Set(['II', 'III', 'IV', 'VI', 'VII', 'IX', 'XI', 'XII']);

function isHedgeTok(t) {
  if (HEDGE_WORD.has(t)) return true;
  if (/^H\d{1,2}$/.test(t)) return true;                                    // H1, H2
  if (/^H(EUR|USD|GBP|CHF|JPY|SEK|NOK|DKK|AUD|CAD|SGD|HKD|CNH|PLN|CZK|HUF)\d?$/.test(t)) return true;
  if (/^(EUR|USD|GBP|CHF|JPY|SEK|NOK|DKK|AUD|CAD|SGD|HKD|CNH|PLN|CZK|HUF)H(DG|GD)?\d?$/.test(t)) return true;
  return false;
}

/* Sigla di classe di commissione. Insieme volutamente stretto:
     1 lettera (+cifra)   A, B, E, R, I, L, A1, E2, C2 ...
     2 lettere (+cifra)   AC, AD, LC, LD, NC, ND, PA, RA, AH, AX ...
                          escluse le sigle geografiche/tematiche (US, EM, HY ...)
     maiuscole/minuscole  Bd, Bh, Bgd, Bdh, Nhd — ma solo con le minuscole
                          tipiche delle classi: cosi' "Bal", "Sty", "Alp",
                          "Yld", "Eq" restano parole di nome
     3 maiuscole          solo le coperte (AHX, CHR) e i numerali di serie:
                          LUX, MSI, CIB, ISF restano nel nome. */
function isClasse(tokOrig) {
  const m = /^([A-Za-z]{1,3})(\d{1,2})?$/.exec(tokOrig);
  if (!m) return false;
  const lettere = m[1];
  const up = lettere.toUpperCase();
  if (NON_CLASSE.has(up) || CURR.has(up) || DIST.has(up) || NOISE.has(up)) return false;
  if (/^[A-Z][a-z]+$/.test(lettere)) return /^[dhgcx]+$/.test(lettere.slice(1));
  if (lettere.length <= 2) return true;
  if (ROMANI.has(up)) return true;
  return up.includes('H');
}

// una classe che porta la H e' coperta dal cambio: AH, Bh, Bdh, AHX, CHR, Nh ...
const classeCoperta = t => /H/i.test(t.replace(/\d/g, ''));

function pieceKind(tokOrig) {
  const t = tokOrig.toUpperCase();
  if (!t) return null;
  if (CURR.has(t)) return 'valuta';
  if (isHedgeTok(t)) return 'hedge';
  if (UNHEDGE_WORD.has(t)) return 'noise';
  if (DIST.has(t)) return 'cedola';
  if (NOISE.has(t)) return 'noise';
  if (isClasse(tokOrig)) return 'classe';
  return null;   // numeri puri compresi: "Advisory 3", "Fondo Obiettivo 2030"
}

/* Un token puo' essere composto col trattino ("A-Acc-EUR", "H2-EUR", "Bdh-EUR"):
   lo si accetta solo se OGNI pezzo e' riconoscibile, altrimenti "Ex-Japan" e
   "Multi-Asset" finirebbero smontati. */
function tokenPieces(tok) {
  const out = [];
  for (const p of tok.split('-')) {
    if (!p) continue;
    const k = pieceKind(p);
    if (!k) return null;
    out.push([p, k]);
  }
  return out.length ? out : null;
}

function tokenizza(name) {
  return String(name || '')
    .replace(/€|â€š?Â?¬/g, ' EUR ')
    .replace(/£|Â£/g, ' GBP ')
    .replace(/[()\[\]{},;:/|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/* Separa "nome del fondo" e attributi di classe. Due vincoli tengono a bada i
   falsi accorpamenti:
     - al massimo UNA sigla di classe per nome. Senza questo limite
       "Schroder ISF Global Eq Alp A" perderebbe anche "Alp" e finirebbe addosso
       a "... Eq Yld A": due fondi diversi.
     - nessuna cedola DOPO la sigla di classe. Nei nomi Morningstar l'ordine e'
       [nome] [classe] [cedola] [valuta] [copertura], quindi un "Inc" che compare
       a sinistra della classe e' l'"Income" del nome ("Pan European Eq Inc"). */
function splitClasse(name) {
  const tok = tokenizza(name);
  let hedged = false, valuta = null, acc = false, dis = false, classeVista = false;
  let i = tok.length;

  while (i > 0) {
    const pezzi = tokenPieces(tok[i - 1]);
    if (!pezzi) break;
    const kinds = pezzi.map(p => p[1]);
    const nClasse = kinds.filter(k => k === 'classe').length;
    if (nClasse > 1) break;
    if (classeVista && (nClasse > 0 || kinds.includes('cedola'))) break;

    // guardia: non erodere il nome sotto 2 token / 6 caratteri
    const resto = tok.slice(0, i - 1);
    if (resto.length < 2 || resto.join(' ').length < 6) break;

    for (let j = pezzi.length - 1; j >= 0; j--) {
      const p = pezzi[j][0], k = pezzi[j][1], up = p.toUpperCase();
      if (k === 'hedge') hedged = true;
      else if (k === 'valuta') { if (!valuta) valuta = up; }
      else if (k === 'cedola') {
        if (/^ACC/.test(up) || /^CAP/.test(up)) acc = true; else dis = true;
      } else if (k === 'classe') {
        classeVista = true;
        if (classeCoperta(p)) hedged = true;
      }
    }
    i--;
  }

  return { base: tok.slice(0, i).join(' ').toUpperCase(), hedged, valuta, acc, dis };
}

/* Chiave di gruppo: nome base + copertura del cambio + domicilio (prefisso ISIN).
   Il domicilio e' una cintura di sicurezza: le classi di uno stesso comparto lo
   condividono sempre, due fondi omonimi di case diverse quasi mai. */
function groupKey(isin, name) {
  const s = splitClasse(name);
  return String(isin || '').slice(0, 2) + '|' + (s.hedged ? 'H' : '-') + '|' + s.base;
}

// compat: il badge "N classi" si appoggiava a questa; ora il conteggio arriva
// dal dedup, ma la funzione resta esportata per i test.
function baseName(name) { return splitClasse(name).base; }

// quanti datapoint valorizzati ha la riga — ultimo criterio di scelta
const NDATI = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16];
function quantiDati(f) {
  let n = 0;
  for (const i of NDATI) if (f[i] !== null && f[i] !== undefined) n++;
  return n;
}

/* Unisce le classi dello stesso fondo e tiene UNA riga per gruppo.
   Rappresentante, in ordine: storico reale > EUR > accumulazione > piu' dati >
   ISIN (per rendere la scelta deterministica). La riga tenuta si porta dietro
   tutto, categoria Morningstar compresa: quando i pezzi cadono in categorie
   diverse vince quella del rappresentante.
   `nc` (campo 15) = numero di classi raggruppate; si SOMMA, cosi' rilanciare il
   dedup sul risultato non cambia ne' il numero di fondi ne' il badge. */
function dedupe(funds, serieSet) {
  const conSerie = serieSet || new Set();
  const gruppi = new Map();
  for (const f of funds) {
    const k = groupKey(f[0], f[1]);
    if (!gruppi.has(k)) gruppi.set(k, []);
    gruppi.get(k).push(f);
  }

  const out = [];
  for (const [, membri] of gruppi) {
    const info = membri.map(f => {
      const s = splitClasse(f[1]);
      return {
        f,
        serie: conSerie.has(f[0]) ? 1 : 0,
        eur: s.valuta === 'EUR' ? 2 : (s.valuta === null ? 1 : 0),
        acc: s.acc ? 1 : 0,
        dati: quantiDati(f)
      };
    });
    info.sort((a, b) =>
      b.serie - a.serie ||
      b.eur - a.eur ||
      b.acc - a.acc ||
      b.dati - a.dati ||
      String(a.f[0]).localeCompare(String(b.f[0]))
    );
    const rep = info[0].f;
    let nc = 0;
    for (const m of membri) nc += (typeof m[15] === 'number' && m[15] > 0) ? m[15] : 1;
    rep[15] = nc;
    out.push(rep);
  }

  out.sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'it'));
  return out;
}

/* Aggregati di categoria, metriche relative sul fondo e score di allocazione.
   Estratta da build() perche' serve anche a rigenerare le metriche sullo snapshot
   vecchio (schema 1), evitando di riscrivere un file da 1 MB dall'editor web. */
function computeCats(funds) {
  const perCat = new Map();
  for (const f of funds) {
    if (!f[2]) continue;
    if (!perCat.has(f[2])) perCat.set(f[2], []);
    perCat.get(f[2]).push(f);
  }

  const cats = [];
  for (const [nome, membri] of perCat) {
    const med = i => median(membri.map(f => f[i]));
    const cm1 = med(5), cm3 = med(6), cm6 = med(7), cr1 = med(8), cr3 = med(9);
    const csd = med(12);
    const accs = membri.map(f => accelGrezza(f[6], f[7]));
    const cacc = median(accs);
    const grande = membri.length >= MIN_N;

    // --- metriche relative sul singolo fondo (solo se la categoria e' popolata) ---
    for (const f of membri) {
      f[14] = null; f[19] = f[19] === undefined ? null : f[19]; f[20] = null; f[21] = null;
      f[17] = mom121(f[8], f[5]);   // assoluta: si calcola sempre
      f[18] = null;
      if (!grande) continue;

      // Mom. rel. = eccesso su 3 e 6 mesi rispetto alla mediana di categoria,
      // corretto per volatilita' (clamp 0,5-2). Isola l'esecuzione della strategia
      // dal beta della categoria. Senza volatilita' il correttore vale 1.
      if (f[6] !== null && f[7] !== null && cm3 !== null && cm6 !== null) {
        const adj = (f[12] && csd) ? Math.min(2, Math.max(0.5, csd / f[12])) : 1;
        f[14] = r2((0.5 * (f[6] - cm3) + 0.5 * (f[7] - cm6)) * adj);
      }

      // Mom. accel. = meta' scarto sul mese, meta' scarto sull'accelerazione
      // riportata a scala mensile. La piu' rapida e la piu' esposta ai falsi segnali.
      const a = accelGrezza(f[6], f[7]);
      if (f[5] !== null && cm1 !== null && a !== null && cacc !== null) {
        f[18] = r2(0.5 * (f[5] - cm1) + 0.5 * (a - cacc) / 4);
      }

      // Consistenza: su quanti dei 5 orizzonti il fondo batte la mediana di
      // categoria, riportato a 0-5 quando gli orizzonti con dati sono meno di 5.
      // Servono almeno 3 orizzonti, altrimenti il numero non regge.
      const oriz = [[f[5], cm1], [f[6], cm3], [f[7], cm6], [f[8], cr1], [f[9], cr3]]
        .filter(([v, m]) => v !== null && v !== undefined && m !== null);
      if (oriz.length >= 3) {
        const vinti = oriz.filter(([v, m]) => v > m).length;
        // a meta' si arrotonda per difetto: la consistenza non si regala
        f[20] = Math.ceil(vinti / oriz.length * 5 - 0.5);
      }
    }

    // Quartile di costo dentro la categoria (1 = piu' economico), dove ci sono
    // almeno 4 valori. Quantile lineare, stessa convenzione di ETF Monitor.
    const ocs = membri.map(f => f[13]).filter(t => t !== null && t !== undefined);
    if (ocs.length >= 4) {
      const q1 = quantile(ocs, 0.25), q2 = quantile(ocs, 0.5), q3 = quantile(ocs, 0.75);
      for (const f of membri) {
        if (f[13] === null || f[13] === undefined) continue;
        f[21] = f[13] <= q1 ? 1 : f[13] <= q2 ? 2 : f[13] <= q3 ? 3 : 4;
      }
    }

    // --- ampiezza e dispersione: DENTRO la categoria, non fra le categorie ---
    // Qui e' la differenza voluta rispetto a ETF Monitor: sui fondi i membri di una
    // categoria seguono strategie diverse, quindi la quota di chi ha 1 e 3 mesi
    // entrambi positivi dice qualcosa. Sugli ETF, che replicano lo stesso indice,
    // uscirebbe 0% o 100% e l'ampiezza e' stata spostata a livello di macro.
    const conDati = membri.filter(f => f[5] !== null && f[6] !== null);
    const amp = conDati.length
      ? Math.round(1000 * conDati.filter(f => f[5] > 0 && f[6] > 0).length / conDati.length) / 10
      : null;
    const dq1 = quantile(membri.map(f => f[6]), 0.25);
    const dq3 = quantile(membri.map(f => f[6]), 0.75);
    const disp = (dq1 === null || dq3 === null) ? null : r2(dq3 - dq1);

    cats.push({
      nome, macro: macroOf(nome), n: membri.length,
      m1: r2(cm1), m3: r2(cm3), m6: r2(cm6), r1: r2(cr1), r3: r2(cr3),
      trend: r2(cm6),
      mom121: mom121(cr1, cm1),
      accel: r2(cacc),
      sd: r1(csd), ocMed: r2(median(membri.map(f => f[13]))),
      starMed: r1(median(membri.map(f => f[11]))),
      ampiezza: amp, disp,
      score: null
    });
  }

  // Score = percentile della categoria dentro la sua MACRO. Composito: media
  // semplice dei percentili di trend, Mom. 12-1 e accelerazione. La metodologia
  // non fissa i pesi — scelta esplicita, si cambia qui e in un punto solo.
  const perMacro = new Map();
  for (const c of cats) {
    if (!perMacro.has(c.macro)) perMacro.set(c.macro, []);
    perMacro.get(c.macro).push(c);
  }
  for (const [, gruppo] of perMacro) {
    const amm = gruppo.filter(c => c.n >= MIN_N);
    const vT = amm.map(c => c.trend), vM = amm.map(c => c.mom121), vA = amm.map(c => c.accel);
    for (const c of gruppo) {
      if (c.n < MIN_N) continue;
      const p = [percentile(vT, c.trend), percentile(vM, c.mom121), percentile(vA, c.accel)]
        .filter(x => x !== null);
      c.score = p.length ? Math.round(p.reduce((a, b) => a + b, 0) / p.length * 10) / 10 : null;
    }
  }

  cats.sort((a, b) => {
    const oa = MACROS.indexOf(a.macro), ob = MACROS.indexOf(b.macro);
    if (oa !== ob) return oa - ob;
    if (a.score !== b.score) {
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    }
    return a.nome.localeCompare(b.nome, 'it');
  });

  return cats;
}

// I quattro stati, per SEGNO di trend e accelerazione. Nessuna soglia inventata:
// il valore viaggia sempre accanto allo stato.
function statoOf(trend, accel) {
  if (trend === null || accel === null) return null;
  if (trend >= 0) return accel > 0 ? 'rafforzamento' : 'raffreddamento';
  return accel > 0 ? 'svolta' : 'peggioramento';
}

function build(rows, isinSet, series) {
  const seen = new Set();
  const classi = [];

  // data di riferimento = moda di closePriceDate
  const dm = {};
  for (const r of rows) if (r.closePriceDate) dm[r.closePriceDate] = (dm[r.closePriceDate] || 0) + 1;
  const modaData = Object.keys(dm).sort((a, b) => dm[b] - dm[a])[0] || null;

  for (const r of rows) {
    const isin = r.isin || r.Isin;
    if (!isin || !isinSet.has(isin)) continue;
    if (seen.has(isin)) continue; // stesso ISIN quotato in piu valute = una riga sola
    seen.add(isin);
    const cat = r.categoryName ? String(r.categoryName).trim() : null;
    const m3 = r2(r.GBRReturnM3), m6 = r2(r.GBRReturnM6);
    const mom = (m3 !== null && m6 !== null) ? r2((m3 + m6) / 2) : (m3 !== null ? m3 : m6);
    classi.push([
      isin,                          // 0
      r.Name ? String(r.Name).trim() : isin, // 1
      cat,                           // 2
      macroOf(cat),                  // 3
      r2(r.GBRReturnM0),             // 4  ytd
      r2(r.GBRReturnM1),             // 5  m1
      m3,                            // 6
      m6,                            // 7
      r2(r.GBRReturnM12),            // 8  1 anno
      r2(r.GBRReturnM36),            // 9  3 anni p.a.
      r2(r.GBRReturnM60),            // 10 5 anni p.a.
      r.starRatingM255 || null,      // 11 stelle
      r1(r.StandardDeviationM36),    // 12 volatilita' 36m
      r2(r.OngoingCostActual),       // 13 costo corrente
      mom,                           // 14 Mom. rel. (ricalcolato in computeCats)
      1,                             // 15 nc, ricalcolato nel dedup
      r2(r.GBRReturnW1),             // 16 1 settimana
      null,                          // 17 Mom. 12-1
      null,                          // 18 Mom. accel.
      null,                          // 19 delta rango (serve un archivio: vedi meta.prevDate)
      null,                          // 20 consistenza
      null,                          // 21 quartile di costo
      r.SecId || isin                // 22 SecId, per il link alla scheda Morningstar
    ]);
  }

  // Dedup PRIMA degli aggregati: le mediane di categoria vanno calcolate sui
  // fondi, non sulle classi, altrimenti una casa con molte classi in gamma pesa
  // di piu' solo per questo.
  const nClassi = classi.length;
  const funds = dedupe(classi, new Set(Object.keys(series)));

  const cats = computeCats(funds);

  // serie storiche solo per ISIN presenti
  const inUniverse = new Set(funds.map(f => f[0]));
  const ser = {};
  let nSeries = 0;
  for (const [k, v] of Object.entries(series)) if (inUniverse.has(k)) { ser[k] = v; nSeries++; }

  const nData = funds.filter(f => f[8] !== null || f[4] !== null).length;
  const date = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });

  return {
    funds, cats,
    catNames: cats.map(c => c.nome),
    macroOrder: MACROS,
    series: ser,
    meta: {
      date, dataChiusura: modaData,
      source: 'Morningstar Italia · via Vercel',
      nTot: funds.length, nClassi, nData, nSeries,
      nCat: cats.length,
      nCatSottoSoglia: cats.filter(c => c.n < MIN_N).length,
      nNoOc: funds.filter(f => f[13] === null).length,
      minN: MIN_N,
      prevDate: null,
      schema: 2
    }
  };
}

/* Porta uno snapshot vecchio (schema 1, 18 campi, 17 = SecId, macro a 6 voci) al
   formato nuovo: rimappa le macro, deduplica le classi e ricalcola tutto.
   Meglio un fallback ricalcolato che un fallback che mostra numeri di un altro
   impianto. */
function upgradeSnapshot(snap, serieSet) {
  if (!snap || !snap.funds) return snap;
  if (snap.meta && snap.meta.schema >= 2) return snap;
  const classi = snap.funds.map(f => {
    const g = f.slice(0, 17);
    while (g.length < 17) g.push(null);
    g[3] = macroOf(g[2]);
    g[15] = 1;               // il vecchio nc veniva da un'altra regola: si riparte da 1
    g[17] = null; g[18] = null; g[19] = null; g[20] = null; g[21] = null;
    g[22] = f[17] || f[0];   // nello schema 1 il SecId stava in 17
    return g;
  });
  const nClassi = classi.length;
  const funds = dedupe(classi, serieSet);
  snap.funds = funds;
  snap.cats = computeCats(funds);
  snap.catNames = snap.cats.map(c => c.nome);
  snap.macroOrder = MACROS;
  snap.meta = snap.meta || {};
  snap.meta.schema = 2;
  snap.meta.nTot = funds.length;
  snap.meta.nClassi = nClassi;
  snap.meta.nData = funds.filter(f => f[8] !== null || f[4] !== null).length;
  snap.meta.nCat = snap.cats.length;
  snap.meta.nCatSottoSoglia = snap.cats.filter(c => c.n < MIN_N).length;
  snap.meta.nNoOc = funds.filter(f => f[13] === null).length;
  snap.meta.minN = MIN_N;
  snap.meta.prevDate = snap.meta.prevDate || null;
  snap.meta.source += ' · schema 1 convertito';
  return snap;
}

/* Corre `p` contro la scadenza del budget. Serve anche fuori dalla fetch: a
   freddo il costo sta pure nel parse dei JSON e nel calcolo, non solo in rete. */
function conScadenza(p, t0) {
  let timer;
  const scadenza = new Promise((_, rej) => {
    timer = setTimeout(
      () => rej(new Error('Refresh oltre il budget di ' + BUDGET_MS + 'ms (avvio a freddo)')),
      Math.max(1000, restante(t0))
    );
    if (timer.unref) timer.unref();
  });
  return Promise.race([p, scadenza]).finally(() => clearTimeout(timer));
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  // fuori dal try: servono anche allo snapshot in caso di fallback
  let series = {};
  try { series = loadJSON('series.json'); } catch (e) {}
  const serieSet = new Set(Object.keys(series));
  try {
    const data = await conScadenza((async () => {
      const isinSet = new Set(loadJSON('isins.json'));
      const rows = await fetchScreener(t0);
      return build(rows, isinSet, series);
    })(), t0);
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.setHeader('X-OICR-Source', 'morningstar');
    res.status(200).json(data);
  } catch (err) {
    // Fallback: snapshot statico incluso nel repo, riportato allo schema 2.
    // Ci arriva anche il timeout, non piu' solo l'errore di Morningstar.
    try {
      const snap = upgradeSnapshot(loadJSON('snapshot.json'), serieSet);
      const inUniverse = new Set(snap.funds.map(f => f[0]));
      const ser = {};
      for (const [k, v] of Object.entries(series)) if (inUniverse.has(k)) ser[k] = v;
      snap.series = ser;
      snap.meta.nSeries = Object.keys(ser).length;
      snap.meta.source += ' · snapshot (refresh fallito: ' + String(err.message || err).slice(0, 80) + ')';
      // cache breve: la prossima richiesta ritenta il refresh, ma intanto
      // nessuno resta davanti a una pagina vuota
      res.setHeader('Cache-Control', 's-maxage=900');
      res.setHeader('X-OICR-Source', 'snapshot');
      res.status(200).json(snap);
    } catch (e2) {
      res.status(500).json({ error: String(err.message || err) });
    }
  }
};

// esportati per i test nel container
module.exports.build = build;
module.exports.computeCats = computeCats;
module.exports.upgradeSnapshot = upgradeSnapshot;
module.exports.macroOf = macroOf;
module.exports.baseName = baseName;
module.exports.splitClasse = splitClasse;
module.exports.groupKey = groupKey;
module.exports.isClasse = isClasse;
module.exports.dedupe = dedupe;
module.exports.statoOf = statoOf;
module.exports.mom121 = mom121;
module.exports.accelGrezza = accelGrezza;
module.exports.percentile = percentile;
module.exports.quantile = quantile;
module.exports.median = median;
