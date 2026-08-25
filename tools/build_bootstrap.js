/* Genera data/bootstrap.json: la fotografia statica che l'app mostra all'istante
   mentre aspetta /api/data. La produce lo STESSO codice dell'endpoint
   (upgradeSnapshot di api/data.js), quindi e' gia' in schema 2, gia' deduplicata
   e con le stesse categorie: non esiste una seconda regola che possa divergere.
   Da rilanciare ogni volta che si rigenera data/snapshot.json.
   node tools/build_bootstrap.js */
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('../api/data.js');

const root = path.join(__dirname, '..');
const leggi = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));

const series = leggi('series.json');
const serieSet = new Set(Object.keys(series));
const snap = D.upgradeSnapshot(leggi('snapshot.json'), serieSet);

// solo le serie dei fondi rimasti dopo il dedup
const dentro = new Set(snap.funds.map(f => f[0]));
const ser = {};
for (const k of Object.keys(series)) if (dentro.has(k)) ser[k] = series[k];
snap.series = ser;
snap.meta.nSeries = Object.keys(ser).length;
snap.meta.source = 'Morningstar Italia · copia locale del ' + (snap.meta.date || '?');
snap.meta.bootstrap = true;

const out = path.join(root, 'data', 'bootstrap.json');
fs.writeFileSync(out, JSON.stringify(snap));
const m = snap.meta;
console.log('data/bootstrap.json  ' + (fs.statSync(out).size / 1048576).toFixed(2) + ' MB');
console.log('  ' + m.nClassi + ' classi -> ' + m.nTot + ' fondi · ' + m.nCat + ' categorie · ' +
  m.nSeries + ' serie storiche · dati al ' + m.date);
