// Audit della deduplica: gruppi piu' grandi, categorie miste, sigle lette come
// classe, gruppi sospetti per spread di rendimento. Usa la regola vera, quella
// di api/data.js — qui non c'e' una seconda copia che possa divergere.
// node tools/audit_dedup.js
const fs = require('fs');
const path = require('path');
const D = require('../api/data.js');

const root = path.join(__dirname, '..');
const funds = JSON.parse(fs.readFileSync(path.join(root, 'data', 'snapshot.json'), 'utf8')).funds;

const g = new Map();
for (const f of funds) {
  const k = D.groupKey(f[0], f[1]);
  if (!g.has(k)) g.set(k, []);
  g.get(k).push(f);
}
console.log('classi: ' + funds.length + '  ->  gruppi: ' + g.size);

const dim = {};
for (const [, m] of g) dim[m.length] = (dim[m.length] || 0) + 1;
console.log('\n== dimensione dei gruppi ==');
console.log(Object.keys(dim).map(Number).sort((a, b) => a - b).map(n => n + ':' + dim[n]).join('  '));

console.log('\n== 10 gruppi piu grandi ==');
for (const [k, m] of [...g.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
  console.log('[' + m.length + '] ' + k);
  for (const f of m) console.log('      ' + f[1] + '   | ' + f[2]);
}

console.log('\n== sigle lette come classe ==');
const cnt = {};
for (const f of funds) {
  const tokens = String(f[1]).replace(/[()\[\]{},;:/|-]/g, ' ').split(/\s+/).filter(Boolean);
  const base = D.splitClasse(f[1]).base;
  for (const t of tokens) if (D.isClasse(t) && !base.includes(t.toUpperCase())) cnt[t] = (cnt[t] || 0) + 1;
}
console.log(Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join('  '));

/* Sospetti: i rendimenti arrivano nella valuta della quota, quindi uno spread
   grande dentro un gruppo puo' essere solo il cambio — ma vale la pena guardarli. */
console.log('\n== gruppi con spread a 1 anno > 5 punti ==');
const bad = [];
for (const [k, m] of g) {
  const v = m.map(f => f[8]).filter(x => x !== null && x !== undefined);
  if (v.length < 2) continue;
  const sp = Math.max(...v) - Math.min(...v);
  if (sp > 5) bad.push([sp, k, m]);
}
bad.sort((a, b) => b[0] - a[0]);
console.log('(' + bad.length + ' gruppi)');
for (const [sp, k, m] of bad.slice(0, 15)) {
  console.log('--- spread ' + sp.toFixed(1) + '  ' + k);
  for (const f of m) console.log('     ' + String(f[1]).padEnd(46) + ' 1a ' + f[8] + ' | ' + f[2]);
}
