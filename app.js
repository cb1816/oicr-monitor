const DATA=window.DATA;
const F=DATA.funds,CATS=DATA.cats,MO=DATA.macroOrder,META=DATA.meta,SER=DATA.series||{};
const I={isin:0,name:1,cat:2,macro:3,ytd:4,m1:5,m3:6,m6:7,r1:8,r3:9,r5:10,star:11,sd:12,oc:13,mom:14,nc:15,w1:16,sec:17};
const METRICS=[['1 sett.',16],['1 mese',5],['YTD',4],['1 anno',8],['3 anni p.a.',9],['5 anni p.a.',10],['🔥 Momentum',14]];
let state={metric:8,macro:null,cat:null,q:'',tab:'rank',catSort:'val'};
const isMom=()=>state.metric===14;
const mLabel=()=>METRICS.find(m=>m[1]===state.metric)[0];

document.getElementById('cnt').textContent=META.nData.toLocaleString('it')+' fondi · '+META.source+' · '+META.date;

const mc=document.getElementById('metricChips');
METRICS.forEach(([lbl,idx])=>{const c=document.createElement('div');
  c.className='chip'+(idx===14?' mom':'')+(idx===state.metric?' on':'');c.textContent=lbl;c.dataset.i=idx;
  c.onclick=()=>{state.metric=idx;[...mc.children].forEach(x=>x.classList.toggle('on',+x.dataset.i===idx));catCache={};render()};mc.appendChild(c);});

const macroCounts={};F.forEach(f=>{if(f[I.macro])macroCounts[f[I.macro]]=(macroCounts[f[I.macro]]||0)+1});
const mch=document.getElementById('macroChips');
function buildMacroChips(){mch.innerHTML='';
  const all=document.createElement('div');all.className='chip'+(state.macro===null?' on':'');all.textContent='Tutti';
  all.onclick=()=>{state.macro=null;state.cat=null;buildMacroChips();buildCatSel();render()};mch.appendChild(all);
  MO.forEach(m=>{if(!macroCounts[m])return;const c=document.createElement('div');
    c.className='chip'+(state.macro===m?' on':'');c.textContent=m+' ('+macroCounts[m]+')';
    c.onclick=()=>{state.macro=(state.macro===m?null:m);state.cat=null;buildMacroChips();buildCatSel();render()};mch.appendChild(c);});}
const catSel=document.getElementById('catSel');
function buildCatSel(){const pool=F.filter(f=>f[I.cat]&&(!state.macro||f[I.macro]===state.macro));
  const cnts={};pool.forEach(f=>cnts[f[I.cat]]=(cnts[f[I.cat]]||0)+1);
  const list=Object.keys(cnts).sort((a,b)=>a.localeCompare(b,'it'));
  catSel.innerHTML='<option value="">'+(state.macro?('Tutte le categorie '+state.macro):'Tutte le categorie Morningstar')+'</option>'+
    list.map(c=>'<option value="'+c.replace(/"/g,'&quot;')+'">'+c+' ('+cnts[c]+')</option>').join('');catSel.value=state.cat||'';}
catSel.onchange=()=>{state.cat=catSel.value||null;render()};
document.getElementById('q').oninput=e=>{state.q=e.target.value.trim().toLowerCase();render()};
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;
  document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x===b));render();});

const val=f=>f[state.metric];
function fmt(v){if(v===null||v===undefined)return'—';return(v>0?'+':'')+v.toFixed(1)+'%'}
function cls(v){if(v===null||v===undefined)return'zero';return v>0.05?'pos':(v<-0.05?'neg':'zero')}
function stars(n){return n?'★'.repeat(n)+'☆'.repeat(5-n):''}
function esc(s){return(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function withData(l){return l.filter(f=>val(f)!==null&&val(f)!==undefined)}
function pool(){return F.filter(f=>{
  if(state.macro&&f[I.macro]!==state.macro)return false;
  if(state.cat&&f[I.cat]!==state.cat)return false;
  if(state.q){const s=(f[I.name]+' '+f[I.isin]+' '+(f[I.cat]||'')).toLowerCase();if(!s.includes(state.q))return false;}
  return true;});}
let catCache={};
function catRank(f){const key=f[I.cat]+'|'+state.metric;
  if(!catCache[key]){const a=F.filter(x=>x[I.cat]===f[I.cat]&&val(x)!=null).sort((x,y)=>val(y)-val(x));catCache[key]=a.map(x=>x[I.isin]);}
  const a=catCache[key];const i=a.indexOf(f[I.isin]);return i<0?null:{rank:i+1,n:a.length,q:Math.ceil((i+1)/a.length*4),
    score:a.length>1?Math.round((a.length-i-1)/(a.length-1)*100):50};}
function badges(f){let h='<div class="badges">';const r=f[I.cat]?catRank(f):null;
  if(isMom()&&r)h+='<span class="qbadge mbadge">Mom '+r.score+'/100</span>';
  if(r&&r.n>=5){if(r.q===1)h+='<span class="qbadge q1">Top cat. '+r.rank+'/'+r.n+'</span>';
    else if(r.q===4)h+='<span class="qbadge q4">Coda cat. '+r.rank+'/'+r.n+'</span>';}
  return h+'</div>';}
function rowCard(f,rank,rc){const v=val(f);
  return '<div class="card" onclick="detail(\''+f[I.isin]+'\')">'+(rank?'<div class="rank '+(rc||'')+'">'+rank+'</div>':'')+
    '<div class="info"><div class="nm">'+esc(f[I.name])+'</div><div class="ct">'+esc(f[I.cat]||'—')+'</div>'+badges(f)+'</div>'+
    '<div class="val"><div class="pct '+cls(v)+'">'+fmt(v)+'</div>'+(f[I.star]?'<div class="stars">'+stars(f[I.star])+'</div>':'')+'</div></div>';}

function viewRank(){const list=withData(pool()).sort((a,b)=>val(b)-val(a));
  if(!list.length)return'<div class="empty">Nessun fondo con dati per questa selezione.</div>';
  let h='<div class="sec'+(isMom()?' hot':'')+'">'+(isMom()?'Momentum (media 3-6 mesi)':'Classifica per rendimento '+mLabel())+' · '+list.length+' fondi</div>';
  h+=list.slice(0,300).map((f,i)=>rowCard(f,i+1,i<3?'t':'')).join('');
  if(list.length>300)h+='<div class="empty">Mostrati i primi 300. Affina con filtri o ricerca.</div>';return h;}
function viewTopFlop(){const list=withData(pool()).sort((a,b)=>val(b)-val(a));
  if(list.length<2)return'<div class="empty">Dati insufficienti.</div>';
  const n=Math.min(10,Math.floor(list.length/2)||1);
  const scope=state.cat?('cat. '+state.cat):(state.macro||'assoluto');
  const lbl=isMom()?'per momentum':'per rend. '+mLabel();
  let h='<div class="sec top">▲ Migliori '+lbl+' — '+esc(scope)+'</div>'+list.slice(0,n).map((f,i)=>rowCard(f,i+1,'t')).join('');
  h+='<div class="sec flop">▼ Peggiori '+lbl+' — '+esc(scope)+'</div>';
  h+=list.slice(-n).reverse().map((f,i)=>rowCard(f,list.length-i,'b')).join('');return h;}

function median(a){if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function viewCat(){const p=pool().filter(f=>f[I.cat]);const g={};p.forEach(f=>{(g[f[I.cat]]=g[f[I.cat]]||[]).push(f)});
  let keys=Object.keys(g);if(!keys.length)return'<div class="empty">Nessuna categoria.</div>';
  const stat=k=>{const v=withData(g[k]).map(val);return{n:g[k].length,nd:v.length,med:median(v)};};
  const S={};keys.forEach(k=>S[k]=stat(k));
  if(state.catSort==='val')keys.sort((a,b)=>((S[b].med??-1e9)-(S[a].med??-1e9)));
  else keys.sort((a,b)=>a.localeCompare(b,'it'));
  const valName=isMom()?'momentum':'rend. '+mLabel();
  let h='<div class="sortrow"><div class="sc'+(state.catSort==='val'?' on':'')+'" onclick="setSort(\'val\')">Ordina per '+valName+' ▼</div>'+
        '<div class="sc'+(state.catSort==='az'?' on':'')+'" onclick="setSort(\'az\')">A-Z</div></div>';
  h+='<div class="sec'+(isMom()?' hot':'')+'">'+keys.length+' categorie · mediana '+valName+'</div>';
  keys.forEach(k=>{const st=S[k];const gg=withData(g[k]).sort((a,b)=>val(b)-val(a));
    h+='<div class="catcard"><div class="cathead" onclick="this.parentNode.classList.toggle(\'open\')">'+
      '<div class="cn">'+esc(k)+'</div><div class="cval"><div class="cv '+cls(st.med)+'">'+fmt(st.med)+'</div>'+
      '<div class="cmeta">'+st.n+' fondi</div></div></div>'+
      '<div class="catbody">'+
      (gg.length?'<div class="mlbl">▲ Migliore</div>'+miniRow(gg[0])+'<div class="mlbl">▼ Peggiore</div>'+miniRow(gg[gg.length-1])+
       (gg.length>2?'<div class="mlbl">Tutti ('+gg.length+')</div>'+gg.map(miniRow).join(''):''):'<div class="mlbl">Nessun dato</div>')+
      '</div></div>';});
  return h;}
function setSort(s){state.catSort=s;render();}
function miniRow(f){const v=val(f);return '<div class="mini" onclick="event.stopPropagation();detail(\''+f[I.isin]+'\')"><div class="mn">'+esc(f[I.name])+'</div><div class="pct '+cls(v)+'" style="font-size:13px">'+fmt(v)+'</div></div>';}

function viewIdee(){const metricLbl=isMom()?'momentum (3-6m)':'rend. '+mLabel();
  let h='<div class="note" style="margin:12px 4px">Spunti sui fondi con dati Morningstar, per '+metricLbl+'. Filtra per macro in alto per restringere.</div>';
  const macros=state.macro?[state.macro]:MO.filter(m=>macroCounts[m]);
  // categorie in salita (per momentum/metrica)
  if(!state.cat){const p=F.filter(f=>f[I.cat]&&(!state.macro||f[I.macro]===state.macro)&&val(f)!=null);
    const g={};p.forEach(f=>{(g[f[I.cat]]=g[f[I.cat]]||[]).push(val(f))});
    const rows=Object.keys(g).filter(k=>g[k].length>=3).map(k=>[k,median(g[k]),g[k].length]).sort((a,b)=>b[1]-a[1]);
    if(rows.length){h+='<div class="sec hot">Categorie più in salita ('+metricLbl+')</div>';
      rows.slice(0,6).forEach(r=>{h+='<div class="card" onclick="pickCat(\''+r[0].replace(/\\/g,"\\\\").replace(/'/g,"\\'")+'\')"><div class="info"><div class="nm">'+esc(r[0])+'</div><div class="ct">'+r[2]+' fondi</div></div><div class="val"><div class="pct '+cls(r[1])+'">'+fmt(r[1])+'</div></div></div>';});}}
  macros.forEach(m=>{const g=withData(F.filter(f=>f[I.macro]===m&&(!state.q||(f[I.name]+' '+f[I.isin]).toLowerCase().includes(state.q)))).sort((a,b)=>val(b)-val(a));
    if(!g.length)return;h+='<div class="sec top">'+m+' — migliori per '+metricLbl+'</div>'+g.slice(0,5).map((f,i)=>rowCard(f,i+1,'t')).join('');
    const qual=g.filter(f=>{const r=catRank(f);return f[I.star]>=4&&r&&r.q===1}).slice(0,5);
    if(qual.length){h+='<div class="sec">'+m+' — qualità (≥4★ e top quartile categoria)</div>'+qual.map(f=>rowCard(f,null)).join('');}
    const ac=g.filter(f=>f[I.mom]!=null&&f[I.mom]>0&&(accel(f)||0)>0.5).sort((a,b)=>accel(b)-accel(a)).slice(0,5);
    if(ac.length){h+='<div class="sec top">'+m+' — 🚀 in accelerazione (early trend)</div>'+ac.map(f=>rowCard(f,null)).join('');}
    const sv=g.filter(f=>f[I.mom]!=null&&f[I.mom]<0&&(accel(f)||0)>0.5&&f[I.star]>=3).sort((a,b)=>accel(b)-accel(a)).slice(0,5);
    if(sv.length){h+='<div class="sec">'+m+' — ↗️ possibili svolte (momentum negativo, in risalita)</div>'+sv.map(f=>rowCard(f,null)).join('');}});
  return h;}
function pickCat(c){state.cat=c;state.tab='cat';document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x.dataset.tab==='cat'));buildCatSel();render();}

function viewMappa(){const p=pool().filter(f=>f[I.cat]&&val(f)!=null);
  const g={};p.forEach(f=>{(g[f[I.cat]]=g[f[I.cat]]||[]).push(f)});
  let keys=Object.keys(g);if(!keys.length)return'<div class="empty">Nessun dato per questa selezione.</div>';
  const stat={};keys.forEach(k=>stat[k]={med:median(g[k].map(val)),n:g[k].length,macro:g[k][0][I.macro]});
  keys.sort((a,b)=>stat[b].med-stat[a].med);
  const mx=Math.max(1,...keys.map(k=>Math.abs(stat[k].med)));
  const valName=isMom()?'momentum (3-6m)':'rend. '+mLabel();
  const MC={Azionari:'#4f9cff',Obbligazionari:'#22c55e',Bilanciati:'#f5b642',Flessibili:'#a78bfa',Monetari:'#38bdf8',Alternativi:'#fb7185',Altro:'#94a3b8'};
  let h='<div class="sec'+(isMom()?' hot':'')+'">Mappa '+valName+' · '+keys.length+' categorie</div>'+
    '<div class="note" style="margin:0 4px 8px">Barra = mediana della categoria (verde &gt;0, rosso &lt;0), ordinata dalla più in salita. Tocca per aprire la categoria. Filtra per macro in alto.</div>';
  keys.forEach(k=>{const s=stat[k],v=s.med,w=Math.abs(v)/mx*50,pos=v>=0;
    h+='<div class="maprow" onclick="pickCat(\''+k.replace(/\\/g,"\\\\").replace(/'/g,"\\'")+'\')">'+
      '<div class="mlbl2" style="border-left:3px solid '+(MC[s.macro]||"#888")+'"><span class="cn2">'+esc(k)+'</span> <small>('+s.n+')</small></div>'+
      '<div class="mbarwrap"><div class="mzero"></div><div class="mbar '+(pos?'mp':'mn')+'" style="'+(pos?'left:50%;width:'+w+'%':'right:50%;width:'+w+'%')+'"></div></div>'+
      '<div class="mval2 '+cls(v)+'">'+fmt(v)+'</div></div>';});
  return h;}
function svgLine(vals,up,srcLabel,leftLabel){
  const W=320,H=100,pad=6,N=vals.length;
  let mn=Math.min(...vals),mx=Math.max(...vals);if(mn===mx){mn-=1;mx+=1;}const rng=mx-mn;
  const X=i=>pad+(N<2?0:i/(N-1))*(W-2*pad);
  const Y=v=>pad+(1-(v-mn)/rng)*(H-2*pad);
  const pts=vals.map((v,i)=>X(i).toFixed(1)+','+Y(v).toFixed(1)).join(' ');
  const col=up?'#22c55e':'#f4536b';const y100=Y(100);
  const area=pts+' '+X(N-1).toFixed(1)+','+(H-pad)+' '+X(0).toFixed(1)+','+(H-pad);
  return '<div class="chartbox"><svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+
    '<polygon points="'+area+'" fill="'+col+'" opacity="0.08"/>'+
    (100>=mn&&100<=mx?'<line x1="'+pad+'" y1="'+y100.toFixed(1)+'" x2="'+(W-pad)+'" y2="'+y100.toFixed(1)+'" stroke="#2b3a57" stroke-width="1" stroke-dasharray="3 3"/>':'')+
    '<polyline points="'+pts+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>'+
    '<div class="chleg"><span>'+leftLabel+'</span><span>'+srcLabel+'</span><span>oggi</span></div></div>';
}
function growthChart(f){
  // storico reale se disponibile
  const raw=SER[f[I.isin]];
  if(raw){ const cum=raw.split(',').map(Number).filter(x=>isFinite(x));
    if(cum.length>=6){ const vals=cum.map(v=>100*(1+v/100)); const up=vals[vals.length-1]>=vals[0];
      const mo=cum.length-1; const left=mo>=60?'5 anni fa':mo>=36?'~3 anni fa':(mo+' mesi fa');
      return svgLine(vals,up,'storico Morningstar · base 100',left);
    }
  }
  const P=[];const push=(mo,val)=>{if(val!=null&&isFinite(val))P.push([mo,val]);};
  push(0,100);if(f[I.w1]!=null)push(0.25,100/(1+f[I.w1]/100));push(1,100/(1+f[I.m1]/100));push(3,100/(1+f[I.m3]/100));push(6,100/(1+f[I.m6]/100));
  if(f[I.ytd]!=null)push(6.7,100/(1+f[I.ytd]/100));
  push(12,100/(1+f[I.r1]/100));
  if(f[I.r3]!=null)push(36,100/Math.pow(1+f[I.r3]/100,3));
  if(f[I.r5]!=null)push(60,100/Math.pow(1+f[I.r5]/100,5));
  if(P.length<2)return'';
  P.sort((a,b)=>b[0]-a[0]); // dal più vecchio (mesi alti) a oggi
  const W=320,H=100,pad=6,maxMo=P[0][0];
  const vals=P.map(p=>p[1]);let mn=Math.min(...vals),mx=Math.max(...vals);if(mn===mx){mn-=1;mx+=1;}
  const rng=mx-mn;
  const X=mo=>pad+(1-mo/maxMo)*(W-2*pad);
  const Y=v=>pad+(1-(v-mn)/rng)*(H-2*pad);
  const pts=P.map(p=>X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1)).join(' ');
  const up=P[P.length-1][1]>=P[0][1];const col=up?'#22c55e':'#f4536b';
  const y100=Y(100);
  const area='M'+X(P[0][0]).toFixed(1)+','+Y(P[0][0]).toFixed(1)+' '; // placeholder unused
  let marks=P.map(p=>'<circle cx="'+X(p[0]).toFixed(1)+'" cy="'+Y(p[1]).toFixed(1)+'" r="2.4" fill="'+col+'"/>').join('');
  const lbl=mo=>mo>=12?(mo/12)+'a':(mo+'m');
  return '<div class="chartbox"><svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+
    '<line x1="'+pad+'" y1="'+y100.toFixed(1)+'" x2="'+(W-pad)+'" y2="'+y100.toFixed(1)+'" stroke="#2b3a57" stroke-width="1" stroke-dasharray="3 3"/>'+
    '<polyline points="'+pts+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'+marks+'</svg>'+
    '<div class="chleg"><span>'+(maxMo>=60?'5 anni fa':maxMo>=36?'3 anni fa':(Math.round(maxMo)+' mesi fa'))+'</span><span>stima dai rendimenti · base 100</span><span>oggi</span></div></div>';
}
function render(){buildCatSel();const v=document.getElementById('view');
  v.innerHTML=state.tab==='rank'?viewRank():state.tab==='topflop'?viewTopFlop():state.tab==='cat'?viewCat():state.tab==='mappa'?viewMappa():viewIdee();
  window.scrollTo(0,0);}

function detail(isin){const f=F.find(x=>x[I.isin]===isin);if(!f)return;
  const r=f[I.cat]?catRank(f):null;
  const kv=(k,v,sm)=>'<div class="kv"><div class="k">'+k+'</div><div class="v'+(sm?' sm':'')+'">'+v+'</div></div>';
  const p=(v)=>'<span class="'+cls(v)+'">'+fmt(v)+'</span>';
  let b='<button class="closex" onclick="closeOv()">✕</button><h2>'+esc(f[I.name])+'</h2>'+
    '<div class="mc"><span class="pill">'+f[I.isin]+'</span>'+esc(f[I.cat]||'categoria n/d')+'</div>'+
    '<div class="mlbl">Andamento (crescita di 100 €)</div>'+growthChart(f)+
    '<div class="mlbl">Rendimenti recenti</div><div class="grid">'+kv('1 sett.',p(f[I.w1]),1)+kv('1 mese',p(f[I.m1]),1)+kv('3 mesi',p(f[I.m3]),1)+kv('6 mesi',p(f[I.m6]),1)+kv('YTD',p(f[I.ytd]),1)+'</div>'+
    '<div class="mlbl">Rendimenti annualizzati</div><div class="grid">'+kv('1 anno',p(f[I.r1]),1)+kv('3 anni p.a.',p(f[I.r3]),1)+kv('5 anni p.a.',p(f[I.r5]),1)+'</div>'+
    '<div class="mlbl">Rischio & rating</div><div class="grid">'+kv('Rating',(f[I.star]?'<span style="color:var(--warn)">'+stars(f[I.star])+'</span>':'—'),1)+kv('Volat. 3a',f[I.sd]!=null?f[I.sd].toFixed(1)+'%':'—',1)+kv('Costo',f[I.oc]!=null?f[I.oc].toFixed(2)+'%':'—',1)+'</div>';
  if(f[I.mom]!=null&&r){b+='<div class="mlbl">Momentum (media 3-6 mesi) — punteggio nella categoria</div>'+
    '<div class="kv"><div class="k">'+esc(f[I.cat])+'</div><div class="v">'+p(f[I.mom])+' &nbsp;·&nbsp; '+
    (f[I.cat]?scoreOf(f)+'/100':'')+'</div><div class="mombar"><i style="width:'+scoreOf(f)+'%"></i></div></div>';}
  var AC=accState(f),av=accel(f);
  if(AC&&av!=null)b+='<div class="mlbl">Accelerazione (1 mese vs passo del trend)</div><div class="kv"><div class="k">'+(av>0?'+':'')+av.toFixed(1)+' punti/mese</div><div class="v">'+AC.ico+' '+AC.lbl+'</div></div>';
  if(r)b+='<div class="note">Nella categoria <b>'+esc(f[I.cat])+'</b>: '+r.rank+'° su '+r.n+' per '+(isMom()?'momentum':'rend. '+mLabel())+' ('+(r.q===1?'top quartile':r.q===4?'ultimo quartile':r.q+'° quartile')+').</div>';
  if(f[I.sec]&&String(f[I.sec]).length===10)b+='<a target="_blank" rel="noopener" style="display:inline-block;margin:10px 0 2px;padding:9px 14px;background:#2563eb;color:#fff;border-radius:9px;text-decoration:none;font-weight:600;font-size:13px" href="https://www.morningstar.it/it/funds/snapshot/snapshot.aspx?id='+f[I.sec]+'">Scheda completa Morningstar ↗</a>';
  b+='<div class="note"><span class="pill">Classe rappr. di '+(f[I.nc]||1)+' classi</span></div>'+
    '<div class="note">Fonte: Morningstar Italia · rendimenti in EUR al '+META.date+'. Informativa, non sollecitazione all\'investimento.</div>';
  document.getElementById('sheet').innerHTML=b;document.getElementById('ov').classList.add('on');}
function scoreOf(f){const key=f[I.cat]+'|14';if(!catCache[key]){const a=F.filter(x=>x[I.cat]===f[I.cat]&&x[I.mom]!=null).sort((x,y)=>y[I.mom]-x[I.mom]);catCache[key]=a.map(x=>x[I.isin]);}
  const a=catCache[key];const i=a.indexOf(f[I.isin]);return i<0?50:(a.length>1?Math.round((a.length-i-1)/(a.length-1)*100):50);}
function accel(f){var m1=f[I.m1],m3=f[I.m3],m6=f[I.m6];if(m1==null||(m3==null&&m6==null))return null;
  var p=[];if(m3!=null)p.push(m3/3);if(m6!=null)p.push(m6/6);
  return Math.round((m1-p.reduce(function(a,b){return a+b},0)/p.length)*10)/10;}
function accState(f){var a=accel(f),m=f[I.mom];if(a==null||m==null)return null;var th=0.3;
  if(a>th)return m>=0?{ico:'🚀',lbl:'Trend in rafforzamento'}:{ico:'↗️',lbl:'Possibile svolta (in risalita)'};
  if(a<-th)return m>=0?{ico:'⚠️',lbl:'Trend in raffreddamento'}:{ico:'🔻',lbl:'In peggioramento'};
  return {ico:'→',lbl:'Andamento stabile'};}
function openInfo(){
  const s='<button class="closex" onclick="closeOv()">✕</button>'+
    '<h2>Come funziona OICR Monitor</h2>'+
    '<div class="mc">Monitoraggio dei fondi per categoria e generazione di idee</div>'+
    '<div class="ip">Mette i fondi <b>in classifica per categoria</b> per vedere a colpo d\'occhio i migliori e i peggiori e trovare spunti. Dati <b>Morningstar</b>: categoria ufficiale, rendimenti, rating, volatilità e costo.</div>'+
    '<div class="ihead">Le schede</div>'+
    '<div class="ip"><b>Classifica</b> (tutti i fondi ordinati) · <b>Top/Flop</b> (i 10 migliori e peggiori) · <b>Categorie</b> (mediana e migliore/peggiore) · <b>Mappa</b> (tutte le categorie a confronto) · <b>Idee</b>. In alto: filtri per macro-categoria e categoria, e ricerca per nome o ISIN.</div>'+
    '<div class="ihead">Le metriche</div>'+
    '<div class="ip">Con un tocco scegli il criterio con cui l\'app ordina e confronta: <b>1 sett., 1 mese, YTD, 1 anno, 3 e 5 anni</b> e <b>🔥 Momentum</b>. La scelta si applica ovunque — classifiche, categorie e mappa.</div>'+
    '<div class="ibox">'+
    '<div class="ihead hot" style="margin-top:0">🔥 Il criterio Momentum</div>'+
    '<div class="ip"><b>Cos\'è.</b> Misura la <b>forza recente</b> di un fondo: quanto sta andando bene negli ultimi mesi. L\'idea è che ciò che corre tende a mantenere la spinta nel breve. <b>Come si calcola:</b> media dei rendimenti a <b>3 e 6 mesi</b> (un solo numero, senza il rumore della singola settimana).</div>'+
    '<div class="ip" style="margin-bottom:2px"><b>Come è declinato nell\'app:</b></div>'+
    '<div class="istep"><div class="n">1</div><div><b>Momentum del fondo</b> — oltre al valore %, un <b>punteggio 0–100</b> = la sua posizione <b>dentro la categoria</b> (100 = il più forte). Confronti solo fondi comparabili.</div></div>'+
    '<div class="istep"><div class="n">2</div><div><b>Momentum della categoria</b> — la <b>mediana</b> dei suoi fondi dice quali categorie sono <b>"in salita"</b> ora. La <b>Mappa</b> le ordina dalla più calda alla più fredda.</div></div>'+
    '<div class="istep"><div class="n">3</div><div><b>Idee</b> — l\'app incrocia momentum e <b>qualità</b>: fondi con forte momentum <b>e</b> rating ≥4★ in cima alla loro categoria.</div></div>'+
    '<div class="istep"><div class="n">4</div><div><b>Accelerazione</b> — confronta il rendimento a 1 mese col passo medio del trend: 🚀 in accelerazione, ⚠️ in raffreddamento, ↗️ possibile svolta (momentum negativo ma in risalita), 🔻 in peggioramento. Nella scheda del fondo e nelle Idee.</div></div>'+
    '<div class="ip" style="margin:6px 0 0;font-size:11.5px;color:var(--mut)"><b style="color:var(--hot)">Esempio:</b> nella Mappa vedi le categorie più calde → entri e prendi i fondi in testa con buon rating → spunto pronto, già confrontato con i pari.</div>'+
    '</div>'+
    '<div class="note">Il momentum è un segnale di <b>breve periodo</b>, non una previsione: va combinato con rischio, costo e obiettivo del cliente. Strumento informativo, non consulenza né sollecitazione all\'investimento. Le performance passate non sono indicative di quelle future.</div>';
  document.getElementById('sheet').innerHTML=s;
  document.getElementById('ov').classList.add('on');
}
document.getElementById('infoBtn').onclick=openInfo;
function closeOv(){document.getElementById('ov').classList.remove('on')}
document.getElementById('ov').onclick=e=>{if(e.target.id==='ov')closeOv()};
buildMacroChips();buildCatSel();render();
