/* OICR Monitor — /api/ping
   Sonda: Morningstar risponde a una chiamata che parte da Vercel, e il refresh
   completo regge?

   Nasce da una domanda che non si poteva rispondere altrimenti. /api/data
   restituisce 2 MB, quindi quando non risponde non si capisce se sia lento lui,
   lenta la rete, o irraggiungibile Morningstar. Questa risponde in poche
   migliaia di byte e dice quale delle tre.

     /api/ping          una pagina da 5 righe: raggiungibilita', in ~1 s
     /api/ping?full=1   il refresh vero, e poi lo passa al setaccio (sotto)

   Non tocca nulla e non ha cache: e' una domanda, non un dato.

   ── Perche' il setaccio ─────────────────────────────────────────────────────
   Misura del 25/08/2026: sei pagine da 10.000 righe, 31,7 s in fila, e
   `righe: 60000` a fronte di un `total: 54585` dichiarato. Sono 5.415 righe in
   piu' di quante l'universo ne dovrebbe avere: o le pagine non sono tutte
   diverse — cioe' il parametro `page` viene ignorato e stiamo guardando sei
   volte le stesse 10.000 — oppure `total` conta un'altra cosa. Le due ipotesi
   hanno conseguenze opposte, e nessuna si distingue dai conteggi: servono gli
   ISIN. Da qui `isinDistinti` e il primo/ultimo ISIN di ogni pagina.

   Il conto che decide davvero e' pero' l'ultimo: quanti ISIN del perimetro
   Fineco vengono ritrovati. Se le pagine si ripetessero, li' si vedrebbe subito
   un buco. */

'use strict';
const fs = require('fs');
const path = require('path');
const D = require('./data.js');

const LIMITE_MS = 45000;

function url(page, pageSize) {
  return `${D.API}?page=${page}&pageSize=${pageSize}&sortOrder=Name%20asc&outputType=json` +
    `&version=1&languageId=it-IT&currencyId=EUR&universeIds=FOITA%24%24ALL` +
    `&securityDataPoints=${encodeURIComponent(D.DATAPOINTS)}`;
}

async function prova(page, pageSize, budgetMs) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budgetMs);
  try {
    const res = await fetch(url(page, pageSize), { headers: D.HEADERS, signal: ctrl.signal });
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      return { ok: false, pagina: page, http: res.status, ms: Date.now() - t0, motivo: corpo.slice(0, 120) };
    }
    const j = await res.json();
    const righe = j.rows || j.securities || [];
    const isin = r => r.isin || r.Isin || null;
    // la data dei prezzi dal campione: basta a dire se i dati sono freschi,
    // ed e' l'unica cosa che il controllo settimanale ha bisogno di sapere
    const date = righe.map(r => r.closePriceDate).filter(Boolean).sort();
    return {
      ok: true, pagina: page, http: res.status, ms: Date.now() - t0,
      righe: righe.length, totale: j.total || null,
      chiusura: date.length ? date[date.length - 1] : null,
      primo: righe.length ? isin(righe[0]) : null,
      ultimo: righe.length ? isin(righe[righe.length - 1]) : null,
      _righe: righe
    };
  } catch (e) {
    return {
      ok: false, pagina: page, ms: Date.now() - t0,
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
  const corta = await prova(1, 5, 15000);
  delete corta._righe;
  out.raggiungibile = corta;

  if (full && corta.ok) {
    /* Le pagine si chiedono IN PARALLELO, non in fila. In fila sono 31,7 s
       misurati, dentro un budget di 40: passa, ma senza margine, e al refresh
       vero restano da fare parse, filtro, deduplica e mediane. Queste richieste
       non hanno motivo di aspettarsi a vicenda — la prima serve solo a sapere
       quante sono. */
    const p1 = await prova(1, D.PAGE_SIZE, LIMITE_MS - (Date.now() - t0) - 1000);
    let pagine = [p1];
    if (p1.ok) {
      const totale = p1.totale || 0;
      const n = Math.min(10, Math.max(1, Math.ceil(totale / D.PAGE_SIZE)));
      const resta = () => LIMITE_MS - (Date.now() - t0) - 1000;
      const altre = [];
      for (let i = 2; i <= n; i++) altre.push(prova(i, D.PAGE_SIZE, resta()));
      pagine = pagine.concat(await Promise.all(altre));
    }

    const buone = pagine.filter(p => p.ok);
    const rotta = pagine.find(p => !p.ok);
    const righe = [].concat(...buone.map(p => p._righe || []));
    const isinDistinti = new Set(righe.map(r => r.isin || r.Isin).filter(Boolean));

    /* Due cose diverse, che i soli conteggi confondono:
       - PAGINE RIPETUTE: il parametro `page` viene ignorato e ci ritorna sempre
         la stessa fetta. Si riconosce dai confini: due pagine che cominciano
         con lo stesso ISIN. Questo sarebbe un guaio — meta' universo invisibile.
       - ISIN RIPETUTI dentro un universo paginato bene: lo stesso titolo
         compare piu' volte perche' e' quotato in piu' valute o su piu' mercati.
         Fisiologico: build() tiene una riga per ISIN e amen. */
    const primi = buone.map(p => p.primo).filter(Boolean);
    const paginaRipetuta = new Set(primi).size !== primi.length;

    out.refreshCompleto = {
      ok: !rotta,
      msTotali: Date.now() - t0,
      modo: 'pagine in parallelo',
      righe: righe.length,
      isinDistinti: isinDistinti.size,
      isinRipetuti: righe.length - isinDistinti.size,
      paginaRipetuta,
      totaleDichiarato: p1.totale || null,
      pagine: pagine.map(p => ({
        pagina: p.pagina, ms: p.ms, righe: p.righe || 0, ok: p.ok,
        primo: p.primo, ultimo: p.ultimo, motivo: p.motivo
      })),
      motivo: rotta ? ('pagina ' + rotta.pagina + ': ' + (rotta.motivo || 'HTTP ' + rotta.http)) : undefined
    };

    // 2. il conto che decide: quanti ISIN del perimetro Fineco si ritrovano,
    //    e a quanti fondi si riducono dopo la deduplica. Sono i numeri veri
    //    sull'universo live, finora misurati solo sulla fotografia di luglio.
    if (!rotta) {
      try {
        const perimetro = JSON.parse(
          fs.readFileSync(path.join(process.cwd(), 'data', 'isins.json'), 'utf8'));
        const set = new Set(perimetro);
        /* Le serie servono davvero, non sono un ornamento: la scelta del
           rappresentante mette lo storico reale al primo posto, e con
           rappresentanti diversi vincono categorie diverse. Passando {} la sonda
           contava 199 categorie dove /api/data ne conta 203 — due numeri veri
           per due domande diverse, che pero' sembravano un errore. */
        let serie = {};
        try {
          serie = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'series.json'), 'utf8'));
        } catch (e) {}
        const trovati = new Set();
        for (const i of isinDistinti) if (set.has(i)) trovati.add(i);

        const tCalc = Date.now();
        const dati = D.build(righe, set, serie);
        out.perimetroFineco = {
          isinNelRepo: perimetro.length,
          ritrovatiNelloScreener: trovati.size,
          nonTrovati: perimetro.length - trovati.size,
          classi: dati.meta.nClassi,
          fondiDopoDedup: dati.meta.nTot,
          conDati: dati.meta.nData,
          categorie: dati.meta.nCat,
          serieStoriche: dati.meta.nSeries,
          dataChiusura: dati.meta.dataChiusura,
          serieFinoA: dati.meta.serieFine,
          msCalcolo: Date.now() - tCalc
        };
      } catch (e) {
        out.perimetroFineco = { errore: String(e && e.message || e) };
      }
    }
  } else if (full) {
    out.refreshCompleto = { ok: false, motivo: 'saltato: la sonda corta ha gia fallito' };
  }

  const r = out.refreshCompleto, f = out.perimetroFineco;
  out.verdetto = !corta.ok
    ? 'NO — da Vercel non si arriva a Morningstar: ' + (corta.motivo || 'HTTP ' + corta.http)
    : !full
      ? 'SI — Morningstar risponde da Vercel. Rilancia con ?full=1 per il refresh completo'
      : !r.ok
        ? 'PARZIALE — Morningstar risponde, ma il refresh non chiude: ' + r.motivo
        : r.paginaRipetuta
          ? 'ROTTO — due pagine cominciano con lo stesso ISIN: il parametro `page` viene ignorato e meta universo non lo stiamo vedendo'
          : 'SI — refresh completo in ' + (r.msTotali / 1000).toFixed(1) + ' s · paginazione corretta' +
            (r.isinRipetuti ? ' · ' + r.isinRipetuti + ' ISIN ripetuti (stesso titolo quotato piu volte: build() ne tiene una riga)' : '') +
            (f && !f.errore ? ' · ' + f.classi + ' classi -> ' + f.fondiDopoDedup + ' fondi' : '');

  res.status(200).json(out);
};
