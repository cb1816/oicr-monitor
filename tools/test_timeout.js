// Test del timeout serverless (METODOLOGIA.md §12).
// Simula uno screener che non risponde mai e verifica che /api/data risponda
// comunque 200 con lo snapshot, dentro il budget, invece di andare in 504.
// node tools/test_timeout.js
process.env.OICR_BUDGET_MS = '5000';           // budget corto, per non star qui un minuto
const BUDGET = 5000;

const fs = require('fs');
const path = require('path');
const handler = require('../api/data.js');

// un ISIN che sta davvero nell'universo Fineco: build() filtra su isins.json
const ISIN_VERO = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'isins.json'), 'utf8'))[0];

function finto() {
  const res = {
    _headers: {}, statusCode: null, body: null,
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; if (this._resolve) this._resolve(this); return this; }
  };
  res.finito = new Promise(r => { res._resolve = r; });
  return res;
}

let ko = 0;
const ok = (c, m) => { if (!c) { ko++; console.log('  FALLITO: ' + m); } };

async function caso(nome, fakeFetch, attesa) {
  const vero = global.fetch;
  global.fetch = fakeFetch;
  const res = finto();
  const t0 = Date.now();
  try {
    await handler({}, res);
  } finally {
    global.fetch = vero;
  }
  const dt = Date.now() - t0;
  console.log('\n' + nome);
  console.log('   HTTP ' + res.statusCode + '  ·  ' + dt + ' ms  ·  fonte ' + res._headers['x-oicr-source']);
  console.log('   ' + (res.body && res.body.meta ? res.body.meta.source : '(nessun meta)'));
  ok(res.statusCode === 200, 'non ha risposto 200 (sarebbe la pagina vuota)');
  ok(res._headers['x-oicr-source'] === attesa, 'fonte attesa ' + attesa);
  ok(res.body && res.body.funds && res.body.funds.length > 0, 'nessun fondo nella risposta');
  ok(dt < BUDGET + 3000, 'ha sforato il budget (' + dt + ' ms): con maxDuration piu' + "'" + ' basso sarebbe 504');
  return { res, dt };
}

(async () => {
  // 1. la rete resta appesa: e' il caso del 504 osservato il 25/08
  const { res: r1 } = await caso(
    '1) screener appeso (nessuna risposta)',
    (url, opt) => new Promise((_, rej) => {
      if (opt && opt.signal) opt.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; rej(e);
      });
    }),
    'snapshot'
  );
  ok(/[Tt]imeout|budget/.test(r1.body.meta.source), 'il motivo del fallback non nomina il timeout');

  // 2. risposta lenta ma dentro il budget: niente fallback inutile
  await caso(
    '2) screener lento ma dentro il budget',
    () => new Promise(r => setTimeout(() => r({
      ok: true,
      json: async () => ({ total: 1, rows: [{ isin: ISIN_VERO, Name: 'Finto Global Equity A EUR', categoryName: 'Azionari Internazionali Large Cap Blend' }] })
    }), 800)),
    'morningstar'
  );

  // 3. Morningstar risponde con un errore: il vecchio percorso di fallback
  await caso(
    '3) screener in errore HTTP',
    async () => ({ ok: false, status: 503, json: async () => ({}) }),
    'snapshot'
  );

  // 4. il dedup vale anche sullo snapshot di fallback
  const res4 = finto();
  const vero = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await handler({}, res4);
  global.fetch = vero;
  const m = res4.body.meta;
  console.log('\n4) fallback deduplicato');
  console.log('   classi ' + m.nClassi + ' -> fondi ' + m.nTot + '  ·  categorie ' + m.nCat);
  ok(m.nClassi > m.nTot, 'lo snapshot di fallback non risulta deduplicato');
  ok(m.schema === 2, 'lo snapshot di fallback non e\' in schema 2');

  // 5. le pagine dello screener vanno chieste in parallelo, non in fila.
  //    Misurato in produzione: 31,7 s in fila contro 15,6 s insieme.
  console.log('\n5) pagine in parallelo');
  {
    const TOT = 54585, PAG = 10000;
    const finte = [];
    for (let i = 0; i < TOT; i++) {
      finte.push({ isin: i === 0 ? ISIN_VERO : 'XX' + String(i).padStart(10, '0'),
        Name: 'Finto ' + i + ' A EUR', categoryName: 'Azionari Internazionali Large Cap Blend',
        closePriceDate: '2026-08-24' });
    }
    const chieste = []; let inVolo = 0, max = 0;
    const vero = global.fetch;
    global.fetch = async (u) => {
      const page = +/[?&]page=(\d+)/.exec(u)[1];
      chieste.push(page); inVolo++; max = Math.max(max, inVolo);
      await new Promise(r => setTimeout(r, 120));
      inVolo--;
      return { ok: true, status: 200,
        json: async () => ({ total: TOT, rows: finte.slice((page - 1) * PAG, page * PAG) }) };
    };
    const res = finto();
    const t0 = Date.now();
    await handler({}, res);
    const dt = Date.now() - t0;
    global.fetch = vero;
    console.log('   pagine ' + chieste.sort((a, b) => a - b).join(',') +
      '  ·  in volo insieme ' + max + '  ·  ' + dt + ' ms (in fila sarebbero ~' + (chieste.length * 120) + ')');
    ok(chieste.length === 6, 'chiede tutte e sei le pagine');
    ok(max > 1, 'le pagine partono insieme, non una dopo l\'altra');
    ok(res._headers['x-oicr-source'] === 'morningstar', 'i dati arrivano da Morningstar, non dallo snapshot');
  }

  // 6. se una pagina cade, si va sullo snapshot: meglio i dati di ieri che
  //    una classifica costruita su mezzo universo
  console.log('\n6) una pagina cade a meta strada');
  {
    const vero = global.fetch;
    global.fetch = async (u) => {
      const page = +/[?&]page=(\d+)/.exec(u)[1];
      if (page === 4) return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, status: 200,
        json: async () => ({ total: 54585, rows: new Array(10000).fill(0).map((_, i) =>
          ({ isin: 'XX' + page + String(i).padStart(9, '0'), Name: 'F', categoryName: 'X' })) }) };
    };
    const res = finto();
    await handler({}, res);
    global.fetch = vero;
    console.log('   HTTP ' + res.statusCode + '  ·  fonte ' + res._headers['x-oicr-source']);
    ok(res._headers['x-oicr-source'] === 'snapshot', 'ricade sullo snapshot invece di pubblicare mezzo universo');
    ok(res.body.funds.length > 0, 'lo snapshot ha comunque dei fondi');
  }

  console.log(ko === 0 ? '\nTUTTO OK\n' : '\n' + ko + ' CONTROLLI FALLITI\n');
  process.exit(ko === 0 ? 0 : 1);
})();
