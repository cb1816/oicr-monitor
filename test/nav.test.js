// node --test test/  (nessuna rete: solo la logica di /api/nav)
const test = require('node:test');
const assert = require('node:assert');
const N = require('../api/nav');

test('scegli: EUR fra più valute, poi la data più recente; NAV non validi scartati', () => {
  const r = (currency, ClosePrice, closePriceDate, _u = 'FOITA$$ALL') => ({ currency, ClosePrice, closePriceDate, _u });
  assert.deepStrictEqual(N.scegli([r('USD', 6.736, '2026-09-29'), r('EUR', 5.94, '2026-09-29')]), [5.94, 'EUR', '2026-09-29', 'FOITA$$ALL']);
  assert.deepStrictEqual(N.scegli([r('USD', 266.7, '2026-09-29'), r('NOK', 2551.11, '2026-09-25')]), [266.7, 'USD', '2026-09-29', 'FOITA$$ALL']);
  assert.deepStrictEqual(N.scegli([r('EUR', 0, '2026-09-29'), r('EUR', null, '2026-09-29')]), null);
  assert.deepStrictEqual(N.scegli([r('EUR', 20.1, '2026-09-29T00:00:00', 'FOEUR$$ALL')]), [20.1, 'EUR', '2026-09-29', 'FOEUR$$ALL']);
});

test('costruisci: una riga per ISIN chiesto, mancanti elencati, data di chiusura = moda', () => {
  const righe = [
    { isin: 'LU0000000001', ClosePrice: 10, currency: 'EUR', closePriceDate: '2026-09-29', _u: 'FOITA$$ALL' },
    { isin: 'LU0000000002', ClosePrice: 11, currency: 'USD', closePriceDate: '2026-09-29', _u: 'FOITA$$ALL' },
    { isin: 'LU0000000003', ClosePrice: 12, currency: 'EUR', closePriceDate: '2026-09-23', _u: 'FOEUR$$ALL' },
    { isin: 'XX0000000009', ClosePrice: 99, currency: 'EUR', closePriceDate: '2026-09-29', _u: 'FOITA$$ALL' },   // non chiesto
  ];
  const o = N.costruisci(['LU0000000001', 'LU0000000002', 'LU0000000003', 'FR0000000004'], righe);
  assert.deepStrictEqual(Object.keys(o.nav), ['LU0000000001', 'LU0000000002', 'LU0000000003']);
  assert.deepStrictEqual(o.mancanti, ['FR0000000004']);
  assert.strictEqual(o.meta.dataChiusura, '2026-09-29');
  assert.strictEqual(o.meta.nPrimaDellaChiusura, 1);
  assert.strictEqual(o.meta.nonEur, 1);
});

test('isinDaQuery: pulisce, toglie i doppi, scarta ciò che non è un ISIN', () => {
  assert.deepStrictEqual(N.isinDaQuery('lu1877326386, LU1877326386;IT0001047437 x123'), ['LU1877326386', 'IT0001047437']);
  assert.deepStrictEqual(N.isinDaQuery(''), null);
  assert.strictEqual(N.isinDaQuery(Array.from({ length: 400 }, (_, i) => 'LU' + String(i).padStart(9, '0') + '1').join(',')).length, 300);
});
