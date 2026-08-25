// Test della deduplica (METODOLOGIA.md §7) sui nomi reali dello snapshot.
// node tools/test_dedup.js
const fs = require('fs');
const path = require('path');
const D = require('../api/data.js');

const root = path.join(__dirname, '..');
const snap = JSON.parse(fs.readFileSync(path.join(root, 'data', 'snapshot.json'), 'utf8'));
const series = JSON.parse(fs.readFileSync(path.join(root, 'data', 'series.json'), 'utf8'));
const serieSet = new Set(Object.keys(series));

let ko = 0;
const ok = (cond, msg) => { if (!cond) { ko++; console.log('  FALLITO: ' + msg); } };

/* ---------- 1. la chiave separa e unisce quello che deve ---------- */
console.log('\n1) casi singoli');
const k = (i, n) => D.groupKey(i, n);
const casi = [
  ['unisce le valute', ['LU0000000001', 'AB American Growth A EUR'], ['LU0000000002', 'AB American Growth A USD'], true],
  ['unisce le cedole', ['LU1', 'Fidelity Global Bond A-Acc-EUR'], ['LU2', 'Fidelity Global Bond A-Dis-EUR'], true],
  ['unisce le classi', ['LU1', 'Schroder ISF Global Eq A Acc EUR'], ['LU2', 'Schroder ISF Global Eq B Acc EUR'], true],
  ['unisce ANN e Acc', ['LU1', 'AB All Market Income ANN EUR'], ['LU2', 'AB All Market Income Acc EUR'], true],
  ['SEPARA la copertura', ['LU1', 'AB American Growth A EUR'], ['LU2', 'AB American Growth A EUR H'], false],
  ['SEPARA hedged scritto nella classe', ['LU1', 'MS INVF Global Brands A'], ['LU2', 'MS INVF Global Brands AH EUR'], false],
  ['SEPARA fondi diversi (Alp/Yld)', ['LU1', 'Schroder ISF Global Eq Alp A Acc EUR'], ['LU2', 'Schroder ISF Global Eq Yld A Acc EUR'], false],
  ['SEPARA Advisory 4 e 5', ['IE1', 'Fineco AM Advisory 4 L EUR Acc'], ['IE2', 'Fineco AM Advisory 5 L EUR Acc'], false],
  ['SEPARA Bal e Sty', ['LU1', 'BNP Paribas Sust Mul Ast Bal Cl Acc'], ['LU2', 'BNP Paribas Sust Mul Ast Sty Cl Acc'], false],
  ['SEPARA comparti diversi (CIB/MSI)', ['LU1', 'Capital Group CIB (LUX) B'], ['LU2', 'Capital Group MSI (LUX) B'], false],
  ['SEPARA scadenze diverse', ['IT1', 'Fondo Obiettivo 2030 A EUR'], ['IT2', 'Fondo Obiettivo 2035 A EUR'], false],
  ['SEPARA domicili diversi', ['LU1', 'Pippo Global Equity A EUR'], ['IE1', 'Pippo Global Equity A EUR'], false]
];
for (const [nome, a, b, atteso] of casi) {
  const uguali = k(a[0], a[1]) === k(b[0], b[1]);
  ok(uguali === atteso, nome + '  (' + a[1] + ' vs ' + b[1] + ')');
}

/* ---------- 2. dedup sull'universo vero ---------- */
console.log('\n2) universo reale');
const classi = snap.funds.map(f => {
  const g = f.slice(0, 17);
  while (g.length < 17) g.push(null);
  g[15] = 1;
  for (let i = 17; i <= 22; i++) g[i] = null;
  return g;
});
const uno = D.dedupe(classi.map(r => r.slice()), serieSet);
console.log('   classi in ingresso : ' + classi.length);
console.log('   fondi dopo dedup   : ' + uno.length);
console.log('   riduzione          : ' + (100 - 100 * uno.length / classi.length).toFixed(1) + '%');

/* ---------- 3. idempotenza ---------- */
console.log('\n3) idempotenza');
const due = D.dedupe(uno.map(r => r.slice()), serieSet);
const tre = D.dedupe(due.map(r => r.slice()), serieSet);
console.log('   2a passata: ' + due.length + '   3a passata: ' + tre.length);
ok(uno.length === due.length && due.length === tre.length, 'il numero di fondi cambia rilanciando il dedup');
const isin1 = uno.map(f => f[0]).sort().join(',');
const isin2 = due.map(f => f[0]).sort().join(',');
ok(isin1 === isin2, 'cambiano gli ISIN tenuti fra la 1a e la 2a passata');
const nc1 = uno.map(f => f[15]).join(',');
const nc2 = due.map(f => f[15]).join(',');
ok(nc1 === nc2, 'cambia il badge nc fra la 1a e la 2a passata');
ok(uno.reduce((s, f) => s + f[15], 0) === classi.length, 'la somma degli nc non torna al numero di classi');

/* ---------- 4. scelta del rappresentante ---------- */
console.log('\n4) rappresentante');
const perKey = new Map();
for (const f of classi) {
  const key = D.groupKey(f[0], f[1]);
  if (!perKey.has(key)) perKey.set(key, []);
  perKey.get(key).push(f);
}
let senzaSerieMaDisponibile = 0, nonEurMaDisponibile = 0;
for (const f of uno) {
  const membri = perKey.get(D.groupKey(f[0], f[1]));
  if (membri.length < 2) continue;
  const qualcunoConSerie = membri.some(m => serieSet.has(m[0]));
  if (qualcunoConSerie && !serieSet.has(f[0])) senzaSerieMaDisponibile++;
  const eur = m => D.splitClasse(m[1]).valuta === 'EUR';
  if (!qualcunoConSerie && membri.some(eur) && !eur(f)) nonEurMaDisponibile++;
}
ok(senzaSerieMaDisponibile === 0, senzaSerieMaDisponibile + ' gruppi tengono una classe senza storico pur avendone una con storico');
ok(nonEurMaDisponibile === 0, nonEurMaDisponibile + ' gruppi tengono una classe non EUR pur avendone una in EUR');

/* ---------- 5. le mediane si spostano ---------- */
console.log('\n5) effetto sulle mediane di categoria');
const catPre = D.computeCats(classi.map(r => r.slice()));
const catPost = D.computeCats(uno.map(r => r.slice()));
const mPre = new Map(catPre.map(c => [c.nome, c]));
let spostate = 0, tot = 0;
for (const c of catPost) {
  const p = mPre.get(c.nome);
  if (!p || p.m6 === null || c.m6 === null) continue;
  tot++;
  if (Math.abs(p.m6 - c.m6) > 0.05) spostate++;
}
console.log('   categorie: ' + catPre.length + ' -> ' + catPost.length +
  ';  mediana 6m diversa in ' + spostate + '/' + tot);

console.log(ko === 0 ? '\nTUTTO OK\n' : '\n' + ko + ' CONTROLLI FALLITI\n');
process.exit(ko === 0 ? 0 : 1);
