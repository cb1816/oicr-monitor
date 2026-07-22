# OICR Monitor — Vercel

Monitor dei fondi collocati Fineco (allegato 30/06/2026, 6.284 ISIN) con dati Morningstar Italia.

## Struttura
- `index.html` + `app.js` — l'app (identica al monitor esistente, ma carica i dati via fetch)
- `api/data.js` — serverless function: scarica lo screener Morningstar, filtra sugli ISIN Fineco, ricalcola macro/momentum e risponde con il JSON dati. Cache edge 6 ore.
- `data/isins.json` — universo Fineco (dall'allegato PDF)
- `data/series.json` — 872 storici NAV reali già raccolti
- `data/snapshot.json` — fallback completo (dati al 21/07/2026) se Morningstar rifiuta le richieste

## Deploy
1. Carica questa cartella in un repo GitHub (o `vercel deploy` da CLI)
2. Su vercel.com: Add New Project → importa il repo → Deploy (nessuna build, nessuna env var)
3. Apri `https://<progetto>.vercel.app` — in alto vedi la fonte dati:
   - "Morningstar Italia · via Vercel" → l'endpoint funziona da datacenter ✅
   - "... · snapshot (refresh fallito: ...)" → Morningstar blocca gli IP Vercel; l'app funziona comunque coi dati snapshot ⚠️

## Test rapido dell'endpoint
`https://<progetto>.vercel.app/api/data` — deve rispondere con JSON `{"funds":[...]}` in ~5-15 s alla prima chiamata (poi cache).

## Aggiornamenti
- **Rendimenti**: automatici, la cache si rinnova ogni 6 ore alla prima visita.
- **Allegato mensile Fineco**: rigenerare `data/isins.json` dal nuovo PDF (estrazione ISIN) e fare commit.
- **Storici NAV**: `data/series.json` va arricchito a lotti (limite 429 Morningstar) — si può aggiungere in seguito un cron giornaliero che ne raccoglie ~350 e li salva su Vercel Blob.
