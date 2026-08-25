# OICR Monitor — metodologia e aggiornamento

App per i fondi comuni e le SICAV della gamma Fineco. Gemella di **ETF Monitor**, con lo
**stesso scheletro** e **metriche diverse**: qui c'è un gestore da giudicare, e le misure
relative alla categoria hanno un oggetto. Sugli ETF le stesse misure racconterebbero il
costo travestito da bravura, e infatti là sono state tolte.

> **Stato**: 25/08/2026. Questo file è la fonte di verità sull'impianto analitico e vive
> **nel repo**. Dove una cosa non è stata fatta, o non è ricostruibile, è detto
> esplicitamente invece di essere lasciata credere.
>
> ⚠️ **Il sito oggi non usa questo motore.** Vedi §1: `index.html` è una fotografia
> congelata. Ciò che segue descrive `api/data.js`, che gira ed è corretto, ma che nessuno
> chiama ancora.

---

## 1. Architettura — leggere prima di tutto

- Repo: `github.com/cb1816/oicr-monitor`
- Sito: `https://oicr-monitor.vercel.app` — l'URL va preso dalla sezione **Domains** di
  Vercel, mai da un link di anteprima di un singolo deployment (quelli contengono un hash
  e puntano a un deploy congelato).
- Deploy: automatico a ogni commit su `main`.
- File: `index.html`, `app.js`, `api/data.js` (dati e metriche), `data/isins.json`
  (perimetro Fineco), `data/series.json` (storici), `data/snapshot.json` (fallback).
- Gemella ETF: repo `etf-monitor`, sito `https://etf-monitor-italia.vercel.app`. Le due app
  si linkano col pulsantino fisso "⇄". La sua metodologia è in `METODOLOGIA.md` dentro quel
  repo, le prassi operative in `OPERATIVO.md`: **quei due file valgono anche qui** per tutto
  ciò che riguarda i canali di scrittura e le verifiche dopo il commit.

### ⚠️ Lo stato anomalo di `index.html`, verificato il 25/08/2026

`index.html` pesa 2,2 MB e contiene un `const DATA={…}` con i dati di 4.399 fondi incollati
dentro. **Non cita `app.js` e non chiama `/api/data`.** Il commit `8e820bb` del 20/08/2026
("Build statica 19/08/2026") ha sostituito la versione dinamica, che caricava `app.js?v=5` e
faceva `fetch('/api/data')`.

Conseguenze, tutte verificate:

- il sito serve una **fotografia del 19/08/2026** e non si aggiorna;
- `app.js` è **codice morto**: la sua prima riga è `const DATA=window.DATA`, non fa nessuna
  fetch. Era `index_6.html` a orchestrare fetch → filtro ISIN → iniezione di `app.js`, ed è
  tenuto in radice apposta come riferimento per il ricablaggio;
- `api/data.js` è **deployata e funzionante**, ma nessuno la chiama.

Prima di ricablare vanno sciolti i due nodi di §7 e §13.

### Regola operativa

Dopo ogni modifica ad `app.js`, alzare il cache-bust in `index.html` (`app.js?v=N` → `v=N+1`),
o il telefono continua a servire la versione vecchia dalla cache. Il service worker è
**network-first**, quindi online si vede sempre l'ultima versione, ma la cache HTTP del
browser no.

---

## 2. L'idea di fondo: due punteggi, non uno

Il rendimento di un OICR = **beta di categoria + scarto sulla categoria**.

| | **Score di allocazione** | **Selezione** |
|---|---|---|
| Risponde a | *Dove* mi posiziono | *Quale* fondo compro |
| Unità di analisi | la **categoria** | il **fondo** |
| Ingredienti | trend 6m, Mom. 12-1, accelerazione, ampiezza, dispersione | Mom. rel., consistenza, quartile di costo, stelle |
| Cambia | ogni mese | lentamente |

Non si mescolano mai in un unico numero. È lo stesso impianto di ETF Monitor §2; cambiano
gli ingredienti della colonna di destra, perché lì lo scarto sulla categoria non esiste per
costruzione e qui sì.

---

## 3. Sorgente dati

Istanza Integrated Web Tools, **nessuna autenticazione**. `tools.morningstar.it` è dismesso
dal 27/07/2026.

- Screener: `lt.morningstar.com/api/rest.svc/9vehuxllxs/security/screener`
- Serie storiche: `timeseries_cumulativereturn/1c6qh1t6k9`, frequenza mensile,
  `outputType=COMPACTJSON`, id nella forma `SECID]2]1]`

Parametri: `universeIds=FOITA$$ALL`, `pageSize=10000`, `currencyId=EUR`, `languageId=it-IT`.
La paginazione si ferma quando una pagina torna più corta della richiesta.

**Controllo di integrità**: se lo screener torna meno del 99% di `total` dichiarato, si
solleva un errore e scatta il fallback. Meglio lo snapshot di ieri che una classifica
costruita su metà universo.

**Limiti misurati**: il timeseries va in 429 dopo ~350-500 richieste; ~2.500 richieste al
giorno in totale, con 120-400 ms fra l'una e l'altra.

### Perimetro Fineco

`data/isins.json` contiene i **6.284 ISIN** dell'allegato prodotti di rete. Lo screener
viene filtrato su quell'insieme: è la differenza principale rispetto a ETF Monitor, che
lavora sull'universo intero di Borsa Italiana. Verificato il 25/08/2026 che i 4.399 fondi
del sito congelato stanno **tutti** dentro il perimetro: zero fuori.

---

## 4. Datapoint e copertura

Chiesti: `isin, SecId, Name, categoryName, GBRReturnW1, GBRReturnM0 (YTD), M1, M3, M6, M12,
M36, M60, starRatingM255, StandardDeviationM36, OngoingCostActual, closePriceDate`.

`closePriceDate`: la **moda** è la data di riferimento, esposta come `meta.dataChiusura`.
Arriva in ISO.

⚠️ Sui fondi, a differenza degli ETF, **~22 categorie tornano in inglese**. Non sono state
tradotte a mano.

---

## 5. Score di allocazione (livello categoria)

Tutto sulla **mediana della categoria**, mai sul singolo fondo.

- **Trend (6m)** = mediana dei rendimenti a 6 mesi. Assoluto, non relativo.
- **Mom. 12-1** = `(1+r12)/(1+m1) − 1` sulla mediana.
- **Accelerazione** = mediana di `4·m3 − 2·m6`.
  ⚠️ **Su scala diversa dal trend**: va mostrata in **punti (pt)**, non in %, per non farla
  leggere come un rendimento.
- **Ampiezza** = quota di **fondi** della categoria con 1 e 3 mesi entrambi positivi.
- **Dispersione** = scarto interquartile dei rendimenti a 3 mesi **fra i fondi** della categoria.
- **Score 0–100** = percentile della categoria **dentro la sua macro**.

### La differenza deliberata rispetto a ETF Monitor

Su ETF, ampiezza e dispersione sono calcolate **fra le categorie di una macro**, perché
dentro una categoria di ETF replicano tutti lo stesso indice e uscirebbe 0% o 100%. Qui no:
i fondi di una categoria seguono strategie diverse, quindi la quota di chi ha 1 e 3 mesi
positivi dice qualcosa. **Ampiezza e dispersione restano dentro la categoria.** È scritto
anche in `computeCats()`, accanto al codice.

**Scelta esplicita, non nella metodologia originale**: il composito da cui esce il percentile
è la **media semplice dei percentili** di trend, Mom. 12-1 e accelerazione. Si cambia in un
punto solo, `computeCats()` in `api/data.js`.

### Categorie troppo piccole

Sotto **5 fondi** (`MIN_N`) lo score e tutte le metriche relative sono `null`: una categoria
con pochi fondi è la mediana di sé stessa. In produzione sono **56 categorie su 207**.

### Limite noto delle macro piccole

Il percentile ha bisogno di **almeno 2 categorie ammesse** dentro la macro. Conseguenza
diretta: **Materie Prime** (una sola categoria, "Materie Prime - Generiche", 21 fondi) e
**Altro** non hanno score. Trend, Mom. 12-1 e accelerazione ci sono lo stesso, in assoluto.
È lo stesso compromesso che su ETF colpisce Cripto e Convertibili.

### I quattro stati

Classificati **per segno**, con il valore sempre accanto. Nessuna soglia inventata.

| trend | accel | stato |
|---|---|---|
| ≥ 0 | > 0 | 🚀 rafforzamento |
| ≥ 0 | ≤ 0 | ⚠️ raffreddamento |
| < 0 | > 0 | ↗️ possibile svolta |
| < 0 | ≤ 0 | 🔻 peggioramento |

---

## 6. Selezione del fondo

1. **Mom. rel.** = `0.5·(m3 − mediana_cat_m3) + 0.5·(m6 − mediana_cat_m6)` × `mediana_cat_sd/sd`,
   con clamp 0,5–2. **È la variante giusta per gli OICR**: isola l'esecuzione della strategia
   dal beta di categoria. Se la volatilità manca, il correttore vale 1.
2. **Mom. 12-1** = `(1+r12)/(1+m1) − 1`. Assoluta, si calcola sempre.
3. **Mom. accel.** = `0.5·(m1 − mediana_cat_m1) + 0.5·(accel − mediana_cat_accel)/4`. La più
   rapida e la più esposta ai falsi segnali.
4. **Consistenza** = su quanti dei 5 orizzonti (m1, m3, m6, r1, r3) il fondo batte la mediana
   di categoria, riportato a 0–5 quando gli orizzonti con dati sono meno di 5. Servono almeno
   3 orizzonti. **A metà si arrotonda per difetto**: la consistenza non si regala.
5. **Quartile di costo** = quartile di `OngoingCostActual` dentro la categoria (1 = più
   economico), dove ci sono almeno 4 valori. Quantile lineare tipo 7, confronto `≤`: **stessa
   convenzione di ETF Monitor**, adottata di proposito al posto di quella del vecchio build.
6. **Stelle Morningstar** — mostrate, ma sono relative alla categoria e guardano al passato.

**Spareggio**: a parità di metrica → Mom. rel., poi costo crescente, poi nome. Senza, le
metriche con pochi valori distinti escono in ordine alfabetico.

**Cautela obbligatoria nei testi dell'app**: la persistenza dei gestori attivi è debole, e
più solida sui peggiori che sui migliori. Va usata come **filtro di esclusione**, non come
segnale d'acquisto.

---

## 7. Deduplica per classe di quota — implementata il 25/08/2026

**Regola** (decisa da Corrado sui casi concreti dello snapshot): *"stesso fondo" = stesso
portafoglio a meno di valuta, cedola e classe di commissione; la copertura del cambio resta
una cosa a sé.*

Si **uniscono** le classi che differiscono solo per:

- **valuta** della quota (EUR / USD / GBP / CHF …);
- **cedola**: accumulo vs distribuzione (Acc / Inc / Dis / ANN / Cap);
- **classe di commissione** (A / E / R / Rd / L / I …).

Si **tengono separate** le versioni con **copertura del cambio** (`H`, `Hdg`, `H1`, e le
sigle di classe che portano la H: `AH`, `Bh`, `Bdh`, `AHX`, `CHR`): profilo di rischio
diverso, e Morningstar stessa spesso le mette in un'altra categoria.

### Come è scritta

`splitClasse(nome)` in `api/data.js` sfronda il nome **solo dalla coda** e si ferma al primo
token non riconosciuto: il nucleo del nome sta all'inizio e non viene mai intaccato. Due
vincoli tengono a bada i falsi accorpamenti, ed entrambi sono nati da casi veri:

1. **Al massimo una sigla di classe per nome.** Senza questo limite
   `Schroder ISF Global Eq Alp A` perde anche `Alp` e finisce addosso a `… Eq Yld A`.
2. **Nessuna cedola dopo la sigla di classe.** L'ordine Morningstar è
   `[nome] [classe] [cedola] [valuta] [copertura]`, quindi un `Inc` che compare a sinistra
   della classe è l'*Income* del nome (`Pan European Eq Inc`), non una cedola.

Più tre filtri sul vocabolario, tarati sull'universo vero: le sigle di 2 lettere geografiche
o tematiche (`US`, `EM`, `HY`, `ESG` …) non sono classi; le sigle di 3 lettere maiuscole non
lo sono mai tranne quelle con la H e i numerali di serie (così `LUX`, `MSI`, `CIB`, `ISF`
restano nel nome); le sigle miste maiuscolo/minuscolo valgono solo con le minuscole tipiche
delle classi (`Bd`, `Bh`, `Bgd`, `Bdh`), così `Bal`, `Sty`, `Alp`, `Yld`, `Eq` restano parole
di nome. I numeri interi non si toccano mai: `Advisory 4` ≠ `Advisory 5`,
`Obiettivo 2030` ≠ `Obiettivo 2035`. Alla chiave si aggiunge il **prefisso ISIN** (domicilio)
come cintura di sicurezza.

La precisione conta più della copertura: un accorpamento mancato lascia due righe — com'era
prima —, uno sbagliato fonde due fondi diversi.

### Rappresentante

`dedupe()` tiene **una riga per gruppo**, scelta in quest'ordine: **storico reale** → **EUR**
→ **accumulazione** → **più datapoint** → ISIN (per rendere la scelta deterministica). La
riga tenuta si porta dietro tutto, **categoria Morningstar compresa**: quando i pezzi cadono
in categorie diverse vince quella del rappresentante.

⚠️ L'EUR non è una preferenza estetica: i rendimenti Morningstar arrivano **nella valuta
della quota**, non convertiti. `Pictet-Short-Term Money Market USD R` segna +7,2% a 1 anno e
la gemella `EUR R` +1,8%. Tenere la classe EUR è ciò che rende confrontabili le righe.

### Numeri e idempotenza

Sullo snapshot del 27/07/2026: **6.162 classi → 3.833 fondi** (−37,8%). Le **mediane di
categoria si calcolano dopo** il dedup e si spostano di oltre 0,05 punti in **117 categorie
su 203**. `nc` (campo 15) = numero di classi raggruppate, e si **somma**: rilanciando il
dedup sul risultato non cambiano né il numero di fondi né il badge (verificato su tre
passate, `tools/test_dedup.js`). `meta.nClassi` porta il conteggio pre-dedup.

### Residuo noto

Per una manciata di fondi la valuta **è** il portafoglio, non la classe: i monetari a breve
termine (`Pictet-Short-Term Money Market EUR / USD / CHF / JPY`, `LO Funds Short-Term Money
Market`) e i comparti scritti con la valuta fra parentesi (`GAM Star Credit Opps (EUR)` vs
`(USD)`, `BNY Mellon Glbl Rl Ret (EUR)` vs `(USD)`). La regola li unisce, tenendo la versione
EUR. Sono ~6 gruppi su 3.833. Non è stata aggiunta un'eccezione perché il segnale che li
distinguerebbe — la valuta scritta fra parentesi — è lo stesso che in T. Rowe Price indica
invece la valuta della *classe* (`T. Rowe Price EM Eq A (EUR)`): l'eccezione farebbe più
danni di quanti ne ripara.

---

## 8. Rischio

Volatilità 36m a livello di fondo e mediana di categoria. Max drawdown e rendimento/volatilità
**non sono raccolti** su questo universo: i datapoint `MaxDrawdownM36` e `SharpeM36` non sono
fra quelli chiesti. Correlazioni e drawdown a 5 anni si potrebbero calcolare dalle serie in
`data/series.json`: non fatto.

---

## 9. Cosa NON si porta da ETF Monitor, e perché

| Metrica ETF | Sugli OICR |
|---|---|
| **Coppie e spread** | **Non portabile.** Sottrarre due strumenti isola l'unica differenza solo se replicano lo stesso indice. Fra due gestori attivi la differenza *è* il gestore: la sottrazione non isola niente. |
| **Efficienza di replica / gruppo-indice** | **Non ha oggetto**: non c'è un indice replicato. |
| **Esclusione di leva e inversi** | **Non serve**: sui fondi la leva non è un fenomeno. |
| **TER come primo criterio di selezione** | **Ridimensionato** a uno dei criteri: qui il costo compra una gestione, e la domanda è se la ripaga. |
| **Ampiezza di macro** | **Ridefinita** come ampiezza dentro la categoria (§5). |

---

## 10. Schema del record — `schema: 2`

`DATA.funds`, array posizionale a **23 campi**:

`0 isin, 1 name, 2 cat, 3 macro, 4 ytd, 5 m1, 6 m3, 7 m6, 8 r1, 9 r3, 10 r5, 11 star, 12 sd,
13 oc, 14 mom_rel, 15 nc, 16 w1, 17 mom_121, 18 mom_accel, 19 drank, 20 cons, 21 ocq,
22 secId`.

⚠️ **Il campo 22 è nuovo.** Nello **schema 1** (lo snapshot in repo, 18 campi) il SecId stava
in **17**; nel build congelato il 17 è invece `mom_121` e il SecId non c'è. `upgradeSnapshot()`
legge il vecchio 17 e lo riscrive in 22.

`DATA.cats`, **oggetti** (nel build congelato erano solo nomi): `nome, macro, n, m1, m3, m6,
r1, r3, trend, mom121, accel, sd, ocMed, starMed, ampiezza, disp, score`.

Più `catNames`, `macroOrder`, `series`, `meta{date, dataChiusura, source, nTot, nClassi,
nData, nSeries, nCat, nCatSottoSoglia, nNoOc, minN, prevDate, schema}`.

`nTot` è il numero di **fondi dopo la deduplica** (§7), `nClassi` quello delle classi in
ingresso. Il campo 15 `nc` è il numero di classi raggruppate in quella riga.

### Macro (10)

`Azionari, Obbligazionari, Convertibili, Bilanciati, Flessibili, Monetari, Materie Prime,
Immobiliare, Alternativi, Altro`

Riallineate a ETF Monitor il 25/08/2026. **Nove etichette in comune**; le differenze sono
volute:

- **Flessibili** qui c'è e su ETF no — 9 categorie e 551 fondi in cui è il gestore a decidere
  l'esposizione. Su strumenti passivi non avrebbe oggetto.
- **Leva e Inverse (ETP)** non è stata portata (§9).
- **Cripto** non è stata portata: nel perimetro Fineco non c'è nessun fondo "Asset Digitali".
  Se ne entrasse uno finirebbe in Altro; il giorno che succede si aggiungono due righe in
  `MACROS` e `macroOf()`.
- **Materie Prime** senza il suffisso "(ETC)": qui l'involucro è un fondo.

⚠️ **Attenzione all'ordine dei test in `macroOf()`**: le categorie si chiamano *"Obbligazionari
Convertibili …"* e *"Bilanciati Flessibili …"*, quindi i due casi ibridi vanno controllati
**prima** delle macro da cui prendono il prefisso.

I **Fondi Obiettivo** (target maturity) stanno negli **Obbligazionari**, come su ETF.

Ripartizione al 25/08/2026, su 6.138 classi non deduplicate: Azionari 2.774 · Obbligazionari
1.878 · Bilanciati 605 · Flessibili 551 · Alternativi 84 · Convertibili 64 · Monetari 61 ·
Altro 57 · Immobiliare 43 · Materie Prime 21.

---

## 11. Fallback e serie storiche

**`data/snapshot.json`** — copia statica servita se Morningstar non risponde. Quella in repo è
del **27/07/2026 in schema 1**, con le macro vecchie a 6 voci. Non è stata riscritta: 1 MB
dall'editor web sono pesanti e fragili. Al suo posto `upgradeSnapshot()` la converte al volo —
rimappa le macro, ricalcola le 207 categorie e lo score. Provato sul file vero: produce 151
categorie con score. Quando capiterà di rigenerarlo, farlo con `git` da un container.

**`data/series.json`** — **3.063 serie** mensili a 5 anni, formato `isin -> "0.0,6.7,…"`,
cumulato % con base 0.

⚠️ **Due cose non tornano e vanno sistemate:**

1. Il file è **statico**, committato il 20/08/2026, e **la data dell'ultimo punto non è scritta
   da nessuna parte**. Su ETF questo è stato risolto con una costante `SERIE_FINE` in
   `api/data.js`, esposta come `meta.serieFine` e mostrata nell'app. Qui **non c'è ancora**:
   l'app non dichiara fin dove arrivano le serie.
2. Il file copre 3.063 ISIN, ma il sito congelato ne dichiara **4.388**. L'endpoint ne serve
   3.052 su 6.138. La copertura reale è molto più bassa di quella annunciata.

---

## 12. Timeout della funzione serverless — chiuso il 25/08/2026

Osservato il 25/08/2026: la prima chiamata a `/api/data` dopo un deploy è andata in **504
FUNCTION_INVOCATION_TIMEOUT**; la seconda ha risposto in una decina di secondi. Il fallback
non copriva questo caso: scattava sull'errore di Morningstar, non sul timeout della funzione,
che uccide il processo prima — nessuno resta a eseguire il `catch`.

**Fix**: il refresh si dà una **scadenza propria più corta del limite di piattaforma**
(`BUDGET_MS`, 40 s di default, regolabile con la variabile d'ambiente `OICR_BUDGET_MS` senza
toccare il codice), mentre `vercel.json` resta a `maxDuration: 60`. Quando la sfora, lancia un
errore **normale**, e da lì in poi risponde il solito percorso di fallback su
`data/snapshot.json`. Il 504 non è più raggiungibile: la funzione si ferma sempre 20 s prima
che ci arrivi.

Due livelli, perché a freddo il costo non è solo di rete:

- ogni pagina dello screener parte con un `AbortController` armato su **quanto resta** del
  budget: una singola richiesta appesa non si mangia più tutto il tempo della funzione;
- l'intero refresh — fetch, parse, calcolo — corre contro la stessa scadenza
  (`conScadenza()`).

La risposta di fallback esce con `Cache-Control: s-maxage=900` (la richiesta successiva
ritenta il refresh) e l'intestazione `X-OICR-Source: morningstar | snapshot` dice da dove
arrivano i dati senza doverli guardare.

`tools/test_timeout.js` copre i tre casi: screener appeso, screener lento ma dentro il
budget, screener in errore HTTP. Con budget a 5 s la risposta al primo caso esce in ~4,2 s,
HTTP 200, dallo snapshot.

> Se il piano Vercel del progetto ha Fluid Compute, `maxDuration` si può alzare fino a 300 s;
> non serve al fix, ma darebbe respiro se un giorno lo screener rallentasse davvero. Alzarlo
> oltre il tetto del piano fa **fallire il deploy**, quindi va verificato prima sul cruscotto.

---

## 13. Prossimi passi, in ordine

1. ~~Deduplica (§7) e timeout (§12)~~ — **fatti il 25/08/2026**, erano i due prerequisiti del
   ricablaggio. Test: `node tools/test_dedup.js`, `node tools/test_timeout.js`; audit dei
   raggruppamenti: `node tools/audit_dedup.js`.
2. **Dichiarare la staticità delle serie** (§11), sul modello di `SERIE_FINE` di ETF.
3. **Ricablare `index.html`** su `/api/data`, riscrivere `app.js` per lo schema 2 e i campi di
   categoria, alzare il cache-bust. Poi eliminare `index_6.html`.
4. **Ponte OICR ↔ ETF**: per ogni categoria, l'ETF di riferimento. "Questo gestore attivo vale
   il suo costo?" diventa una sottrazione visibile. Ora è possibile: le macro combaciano e lo
   score è calcolato allo stesso modo nelle due app.
5. **Δ rango** (campo 19, `meta.prevDate`) — richiede un archivio di rilevazioni nel repo. È
   predisposto e si accende da solo quando i dati ci sono.
6. **Pesi del composito** (§5) e eventuale banda morta sugli stati, se dopo qualche settimana i
   segnali risultano rumorosi.
