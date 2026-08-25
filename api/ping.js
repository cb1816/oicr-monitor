/* OICR Monitor — /api/ping
   Sonda: Morningstar risponde a una chiamata che parte da Vercel?

   Nasce da una domanda che non si poteva rispondere altrimenti. /api/data
   restituisce 2 MB, quindi quando non risponde non si capisce se sia lento lui,
   lenta la rete, o irraggiungibile Morningstar. Questa risponde in poche
   centinaia di byte e dice quale delle tre.

   Se Morningstar risponde da qui, l'app puo' aggiornarsi da sola ogni sei ore e
   non serve piu' nessun browser sul Mac (vedi il punto 1 delle cose da fare).

     /api/ping          una pagina da 5 righe: raggiungibilita', in ~1 s
     /api/ping?full=1   il refresh vero, tutte le pagine: dice se sta nel budget

   Non tocca nulla e non ha cache: e' una domanda, non un dato. */

'use strict';
const D = require('./data.js');

const LIMITE_MS = 45000;

function url(pageSize) {
  return `${D.API}?page=1&pageSize=${pageSize}&sortOrder=Name%20asc&outputType=json` +
    `&version=1&languageId=it-IT&currencyId=EUR&universeIds=FOITA%24%24ALL` +
    `&securityDataPoints=${encodeURIComponent(D.DATAPOINTS)}`;
}

async function prova(pageSize, budgetMs) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budgetMs);
  try {
    const res = await fetch(url(pageSize), { headers: D.HEADERS, signal: ctrl.signal });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      return { ok: false, http: res.status, ms, motivo: corpo.slice(0, 120) };
    }
    const j = await res.json();
    const righe = (j.rows || j.securities || []).length;
    return { ok: true, http: res.status, ms: Date.now() - t0, righe, totale: j.total || null };
  } catch (e) {
    return {
      ok: false, ms: Date.now() - t0,
      motivo: (e && e.name === 'AbortError')
        ? 'nessuna risposta entro ' + budgetMs + ' ms'
        : String(e && e.message || e)
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const full = /[?&]full=1/.test(req.url || '');
  const t0 = Date.now();
  const out = { quando: new Date().toISOString(), regione: process.env.VERCEL_REGION || null };

  // 1. una pagina cortissima: basta a dire se l'host risponde
  out.raggiungibile = await prova(5, 15000);

  // 2. su richiesta, il refresh vero: e' l'unica misura che dice se sta nel budget
  if (full && out.raggiungibile.ok) {
    const p = [];
    let righe = 0, rotto = null;
    for (let page = 1; page <= 10; page++) {
      const resta = LIMITE_MS - (Date.now() - t0);
      if (resta <= 3000) { rotto = 'budget esaurito alla pagina ' + page; break; }
      const r = await prova(D.PAGE_SIZE, resta - 1000);
      p.push({ pagina: page, ms: r.ms, righe: r.righe || 0, ok: r.ok });
      if (!r.ok) { rotto = 'pagina ' + page + ': ' + (r.motivo || 'HTTP ' + r.http); break; }
      righe += r.righe;
      if (r.righe < D.PAGE_SIZE) break;
      if (r.totale && righe >= r.totale) break;
    }
    out.refreshCompleto = {
      ok: !rotto, righe, msTotali: Date.now() - t0, pagine: p,
      motivo: rotto || undefined,
      budget: 'il refresh vero si ferma a ' + (Number(process.env.OICR_BUDGET_MS) || 40000) + ' ms'
    };
  } else if (full) {
    out.refreshCompleto = { ok: false, motivo: 'saltato: la sonda corta ha gia fallito' };
  }

  out.verdetto = out.raggiungibile.ok
    ? (full
      ? (out.refreshCompleto.ok
        ? 'SI — Morningstar risponde da Vercel e il refresh completo sta nel budget'
        : 'PARZIALE — Morningstar risponde, ma il refresh completo non chiude: ' + out.refreshCompleto.motivo)
      : 'SI — Morningstar risponde da Vercel. Rilancia con ?full=1 per sapere se il refresh completo sta nel budget')
    : 'NO — da Vercel non si arriva a Morningstar: ' + (out.raggiungibile.motivo || 'HTTP ' + out.raggiungibile.http);

  res.status(200).json(out);
};
