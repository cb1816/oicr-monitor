import { useEffect, useState } from "react";
import TodayScreen from "../components/TodayScreen";
import DiaryScreen from "../components/DiaryScreen";
import GuideScreen from "../components/GuideScreen";
import { loadContrarian } from "../lib/data";
import { loadTrades, saveTrades, type Trade } from "../lib/journal";
import type { Contrarian } from "../lib/types";

export default function AppShell() {
  const [data, setData] = useState<Contrarian | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"oggi" | "diario">("oggi");
  const [showGuide, setShowGuide] = useState(false);
  const [trades, setTrades] = useState<Trade[]>(() => loadTrades());

  useEffect(() => {
    let alive = true;
    loadContrarian().then((d) => alive && setData(d)).catch((e) => alive && setError(String(e)));
    return () => { alive = false; };
  }, []);

  function updateTrades(next: Trade[]) { setTrades(next); saveTrades(next); }
  const suggestions = data ? data.candidates.map((c) => c.ticker) : [];

  return (
    <div className="min-h-screen w-full bg-outer flex justify-center">
      <div className="relative flex min-h-screen w-full max-w-phone flex-col bg-frame text-zinc-100 shadow-2xl shadow-black/60">
        <button
          onClick={() => setShowGuide(true)}
          aria-label="Come funziona"
          title="Come funziona"
          className="absolute right-3 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/80 text-sm font-bold italic text-amber-400 backdrop-blur"
          style={{ top: "max(0.75rem, calc(env(safe-area-inset-top) + 0.25rem))" }}
        >
          i
        </button>
        <main
          className="no-scrollbar flex-1 overflow-y-auto pb-20"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          {error && (
            <div className="m-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">Errore nel caricamento: {error}</div>
          )}
          {!error && !data && tab === "oggi" && (
            <div className="flex h-64 items-center justify-center text-sm text-zinc-500">Caricamento…</div>
          )}
          {tab === "oggi" && data && <TodayScreen data={data} trades={trades} />}
          {tab === "diario" && <DiaryScreen trades={trades} onChange={updateTrades} suggestions={suggestions} prices={data?.snapshot ?? {}} />}
        </main>
        <nav className="absolute inset-x-0 bottom-0 z-20 border-t border-zinc-800 bg-frame/95 backdrop-blur" style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-phone">
            {(["oggi", "diario"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 py-3 text-sm font-semibold transition-colors ${tab === t ? "text-amber-400" : "text-zinc-500"}`}>
                {t === "oggi" ? "Oggi" : "Diario"}
              </button>
            ))}
          </div>
        </nav>
        {showGuide && <GuideScreen onClose={() => setShowGuide(false)} />}
      </div>
    </div>
  );
}
