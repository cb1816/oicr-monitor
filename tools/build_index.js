/* Ricablaggio di index.html su /api/data.
   Non riscrive la pagina: la trasforma. Prende l'index.html esistente, sostituisce
   il blocco `const DATA={...}` con un caricatore, e rende ri-eseguibile il codice
   dell'app perche' venga chiamato due volte — prima sulla copia locale, poi sui
   dati freschi. Tutto il resto (CSS, testata, pannello Info, pulsante ponte ⇄ ETF,
   PWA) resta byte per byte quello di prima: e' il modo di non perdere pezzi per
   strada, com'e' gia' successo una volta col ponte.
   node tools/build_index.js */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const righe = src.split('\n');

// --- individua il blocco dei dati incorporati -------------------------------
const iData = righe.findIndex(r => r.startsWith('const DATA={'));
if (iData < 0) throw new Error('non trovo la riga `const DATA={...}`');
const iFine = righe.findIndex(r => r.trim() === '</script>');
if (iFine < 0 || iFine < iData) throw new Error('non trovo la chiusura </script>');

const testa = righe.slice(0, iData);              // fino a <script> compreso
const coda = righe.slice(iFine);                  // </script> e quel che segue
let app = righe.slice(iData + 1, iFine).join('\n');

const pesoPrima = Buffer.byteLength(righe[iData], 'utf8');

// --- trasformazioni puntuali sul codice dell'app ----------------------------
const sostituisci = (da, a, etichetta) => {
  if (app.indexOf(da) < 0) throw new Error('non trovo: ' + etichetta);
  if (app.split(da).length > 2) throw new Error('trovato piu di una volta: ' + etichetta);
  app = app.replace(da, a);
};

// 1. i riferimenti ai dati diventano variabili riassegnabili: l'app viene
//    eseguita due volte, sulla copia locale e poi sui dati freschi.
sostituisci(
  "const F=DATA.funds,CATS=DATA.cats,MO=DATA.macroOrder,META=DATA.meta,SER=DATA.series||{};",
  "let DATA,F,CATS,MO,META,SER,macroCounts={};",
  'riga delle variabili dei dati'
);

// 2. il campo 22 (SecId) e' nuovo dello schema 2: serve per il link a Morningstar.
sostituisci(
  "drank:19,cons:20,ocq:21};",
  "drank:19,cons:20,ocq:21,sec:22};",
  'mappa dei campi'
);

// 3. la Δ rango si aggiunge una volta sola, altrimenti al secondo giro
//    comparirebbe due volte fra le metriche.
sostituisci(
  "if(DATA.meta.prevDate)METRICS.push(['⚡ Δ rango',19]);",
  "function aggiungiDeltaRango(){if(META&&META.prevDate&&!METRICS.some(m=>m[1]===19))METRICS.push(['⚡ Δ rango',19]);}",
  'push della Δ rango'
);

// 4. la testata: oltre al conteggio, dice se stai guardando la copia locale o i
//    dati freschi. Senza, l'aggiornamento in corso sarebbe invisibile.
sostituisci(
  "document.getElementById('cnt').innerHTML=META.nData.toLocaleString('it')+' fondi<br><b class=\"asof\">dati al '+META.date+'</b>';",
  `/* META.date e' il momento in cui e' stata fatta la chiamata, NON la chiusura
   dei prezzi: l'app diceva "dati al 25/08" mostrando prezzi del 24. Finche' i
   dati erano incorporati nella pagina le due date coincidevano quasi sempre,
   perche' la build si faceva il giorno dopo la rilevazione; a dati vivi no.
   dataChiusura invece e' la moda di closePriceDate: la data vera dei prezzi. */
function dataDeiPrezzi(){
  const c=META.dataChiusura;
  if(c&&/^\\d{4}-\\d{2}-\\d{2}$/.test(c)){const p=c.split('-');return p[2]+'/'+p[1]+'/'+p[0];}
  return META.date||'—';
}
function scriviTestata(stato){
  // nTot, non nData: e' il numero di fondi nel monitor. I pochi senza nemmeno un
  // rendimento (12 su 3.818) restano nelle liste e nei filtri, quindi contarli e'
  // piu' onesto che scontarli dalla testata.
  const n=(META.nTot||META.nData||0).toLocaleString('it');
  const nota=stato==='copia'?' <span class="agg">· aggiorno…</span>'
    :stato==='copia-ferma'?' <span class="agg">· copia locale</span>':'';
  document.getElementById('cnt').innerHTML=n+' fondi'+nota+'<br><b class="asof">dati al '+dataDeiPrezzi()+'</b>';
}`,
  'scrittura della testata'
);

// 5. le chip delle metriche si ricostruiscono da zero a ogni giro.
sostituisci(
  `const mc=document.getElementById('metricChips');
METRICS.forEach(([lbl,idx])=>{const c=document.createElement('div');
  c.className='chip'+(idx===14?' mom':'')+(idx===state.metric?' on':'');c.textContent=lbl;c.dataset.i=idx;
  c.onclick=()=>{state.metric=idx;[...mc.children].forEach(x=>x.classList.toggle('on',+x.dataset.i===idx));catCache={};render()};mc.appendChild(c);});`,
  `const mc=document.getElementById('metricChips');
function buildMetricChips(){mc.innerHTML='';
  METRICS.forEach(([lbl,idx])=>{const c=document.createElement('div');
  c.className='chip'+(idx===14?' mom':'')+(idx===state.metric?' on':'');c.textContent=lbl;c.dataset.i=idx;
  c.onclick=()=>{state.metric=idx;[...mc.children].forEach(x=>x.classList.toggle('on',+x.dataset.i===idx));catCache={};render()};mc.appendChild(c);});}`,
  'costruzione delle chip metriche'
);

// 6. i conteggi per macro si ricalcolano sui dati nuovi.
sostituisci(
  "const macroCounts={};F.forEach(f=>{if(f[I.macro])macroCounts[f[I.macro]]=(macroCounts[f[I.macro]]||0)+1});",
  "function contaMacro(){macroCounts={};F.forEach(f=>{if(f[I.macro])macroCounts[f[I.macro]]=(macroCounts[f[I.macro]]||0)+1});}",
  'conteggi per macro'
);

// 7. link alla scheda Morningstar, dal SecId (campo 22, nuovo nello schema 2).
sostituisci(
  `b+='<div class="note"><span class="pill">Classe rappr. di '+(f[I.nc]||1)+' classi</span></div>'+`,
  `b+='<div class="note"><span class="pill">Classe rappr. di '+(f[I.nc]||1)+' '+((f[I.nc]||1)===1?'classe':'classi')+'</span></div>'+
    (f[I.sec]&&f[I.sec]!==f[I.isin]?'<a class="msLink" target="_blank" rel="noopener" href="https://www.morningstar.it/it/funds/snapshot/snapshot.aspx?id='+encodeURIComponent(f[I.sec])+'">Scheda Morningstar ↗</a>':'')+`,
  'badge delle classi'
);

// 8. l'avvio non e' piu' in coda al file: lo governa il caricatore.
sostituisci(
  "buildMacroChips();buildCatSel();render();",
  `function boot(d,stato){
  DATA=d; F=d.funds||[]; CATS=d.cats||[]; MO=d.macroOrder||[]; META=d.meta||{}; SER=d.series||{};
  window.__DATA_META=META;                  // serve solo a tools/test_pagina.js
  catCache={};
  aggiungiDeltaRango();
  scriviTestata(stato);
  contaMacro();
  buildMetricChips(); buildMacroChips(); buildCatSel(); render();
}
// le chiamate arrivano dagli onclick nell'HTML: devono restare globali
window.detail=detail; window.closeOv=closeOv; window.setSort=setSort; window.pickCat=pickCat;
window.__boot=boot; window.__testata=scriviTestata;`,
  'avvio in coda al file'
);

// 9. "1° su 1 — ultimo quartile" non vuol dire niente: sotto MIN_N la categoria
//    è la mediana di se stessa, e i badge già lo rispettano. La nota no.
sostituisci(
  "+' ('+(r.q===1?'top quartile':r.q===4?'ultimo quartile':r.q+'° quartile')+').</div>'",
  "+(r.n>=5?' ('+(r.q===1?'top quartile':r.q===4?'ultimo quartile':r.q+'° quartile')+')':' — troppo pochi fondi per parlare di quartili')+'.</div>'",
  'nota del quartile nella scheda fondo'
);

/* 10. Il grafico a 5 anni scriveva "oggi" a destra anche quando la serie si
       ferma a giugno: la stessa bugia della data in testata, su un altro campo.
       Le serie sono statiche (METODOLOGIA.md §11), quindi la loro fine e' una
       costante — meta.serieFine — e va scritta dove si guarda il grafico. */
sostituisci(
  "'<div class=\"chleg\"><span>'+leftLabel+'</span><span>'+srcLabel+'</span><span>oggi</span></div></div>';",
  "'<div class=\"chleg\"><span>'+leftLabel+'</span><span>'+srcLabel+'</span><span>'+(rightLabel||'oggi')+'</span></div></div>';",
  'etichette del grafico storico'
);
sostituisci(
  "function svgLine(vals,up,srcLabel,leftLabel){",
  `const MESI=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
// "giu 2026" da "2026-06-30": le serie sono mensili, il giorno non aggiunge nulla
function fineSerie(){
  const c=META&&META.serieFine;
  if(!c||!/^\\d{4}-\\d{2}/.test(c))return null;
  const p=c.split('-');
  return MESI[+p[1]-1]+' '+p[0];
}
function svgLine(vals,up,srcLabel,leftLabel,rightLabel){`,
  'firma di svgLine'
);
sostituisci(
  "      return svgLine(vals,up,'storico Morningstar · base 100',left);",
  "      return svgLine(vals,up,'storico Morningstar · base 100',left,fineSerie());",
  'chiamata del grafico storico'
);

// 11. e la stessa cosa a parole, nella nota in fondo alla scheda del fondo
sostituisci(
  "    '<div class=\"note\">Fonte: Morningstar Italia · rendimenti in EUR al '+META.date+'. Informativa, non sollecitazione all\\'investimento.</div>';",
  "    '<div class=\"note\">Fonte: Morningstar Italia · rendimenti al '+dataDeiPrezzi()+' nella valuta della classe'+(fineSerie()?' · grafico storico fino a '+fineSerie():'')+'. Informativa, non sollecitazione all\\'investimento.</div>';",
  'nota della fonte nella scheda fondo'
);

// --- il caricatore ---------------------------------------------------------
const caricatore = `
/* Caricamento dei dati — METODOLOGIA.md §1.
   Due sorgenti, chieste insieme e non in cascata:
     - data/bootstrap.json, statico e servito dalla CDN, per avere qualcosa sullo
       schermo subito. E' l'ultima fotografia buona, gia' in schema 2 e gia'
       deduplicata: la genera tools/build_bootstrap.js con lo stesso codice di
       api/data.js, quindi non esiste una seconda regola che possa divergere.
     - /api/data, che prende il posto della copia appena risponde.
   Le due risposte arrivano in ordine imprevedibile — un /api/data che fallisce
   subito puo' benissimo precedere una copia da 1,5 MB — quindi qui non si
   disegna "quando arriva qualcosa": ogni esito aggiorna lo stato, e lo stato
   decide cosa mostrare. La schermata d'errore appare solo quando SONO FALLITE
   TUTTE E DUE. */
(function(){
  var fresco=false, disegnato=false, refreshKO=false;

  function vuoto(d){ return !d || !d.funds || !d.funds.length; }

  function mostra(d,stato){
    if(fresco) return;                          // i dati freschi non si sovrascrivono
    if(stato==='fresco') fresco=true;
    disegnato=true;
    try{ window.__boot(d,stato); }catch(e){ console.error('boot',e); }
  }

  function errore(){
    document.getElementById('view').innerHTML=
      '<div class="empty">Non riesco a caricare i dati.<br><br>'+
      '<button class="chip on" onclick="location.reload()">Riprova</button></div>';
    document.getElementById('cnt').innerHTML='<b class="asof">dati non disponibili</b>';
  }

  var pCopia=fetch('data/bootstrap.json',{cache:'force-cache'})
    .then(function(r){ if(!r.ok) throw 0; return r.json(); })
    .then(function(d){ if(vuoto(d)) throw 0; return d; })
    .catch(function(){ return null; });

  var pFresco=fetch('/api/data')
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .then(function(d){ if(vuoto(d)) throw new Error('risposta senza fondi'); return d; })
    .catch(function(){ return null; });

  pCopia.then(function(d){
    if(d) mostra(d, refreshKO ? 'copia-ferma' : 'copia');
  });

  pFresco.then(function(d){
    if(d){ mostra(d,'fresco'); return; }
    refreshKO=true;
    // se la copia sta gia' reggendo, smetti di promettere un aggiornamento
    if(disegnato){ try{ window.__testata('copia-ferma'); }catch(_){ } }
  });

  Promise.all([pCopia,pFresco]).then(function(){ if(!disegnato) errore(); });
})();
`;

// --- stile per i due pezzi nuovi -------------------------------------------
const stileNuovo = `.agg{color:var(--warn);font-weight:600}
.msLink{display:inline-block;margin-top:6px;font-size:12px;color:var(--accent);text-decoration:none;border:1px solid var(--line);border-radius:8px;padding:5px 10px}`;

const out = testa.join('\n')
  .replace('</style>', stileNuovo + '\n</style>')
  + '\n' + app + '\n' + caricatore + '\n' + coda.join('\n');

fs.writeFileSync(path.join(root, 'index.html'), out);

const pesoDopo = Buffer.byteLength(out, 'utf8');
console.log('blocco dati incorporato rimosso : ' + (pesoPrima / 1048576).toFixed(2) + ' MB');
console.log('index.html                      : ' + (Buffer.byteLength(src, 'utf8') / 1048576).toFixed(2) +
  ' MB -> ' + (pesoDopo / 1024).toFixed(0) + ' KB');
