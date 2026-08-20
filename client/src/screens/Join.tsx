import { useState } from "react";

interface Props {
  onJoin: (code: string) => void;
  onBack: () => void;
  error: string | null;
}

export function Join({ onJoin, onBack, error }: Props) {
  const [code, setCode] = useState("");
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-10">
      <p className="text-xs font-black uppercase tracking-[0.4em] text-amber-glow">Raum</p>
      <h1 className="mt-2 font-display text-5xl uppercase">Beitreten</h1>
      <p className="mt-3 text-white/60">Code vom Spielgerät eingeben.</p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        maxLength={6}
        placeholder="z. B. K7RP"
        className="num-display mt-8 w-full rounded-2xl border border-white/15 bg-black/40 px-4 py-5 text-center text-5xl tracking-[0.3em] outline-none focus:border-amber-glow"
        autoCapitalize="characters"
        autoCorrect="off"
      />
      {error && <p className="mt-3 text-crimson">{error}</p>}
      <button
        className="pad-btn pad-btn-accent mt-6 min-h-[72px] text-xl"
        onClick={() => onJoin(code)}
        disabled={code.trim().length < 3}
      >
        Beitreten
      </button>
      <button className="pad-btn pad-btn-mute mt-3 min-h-[56px]" onClick={onBack}>
        Zurück
      </button>
    </div>
  );
}
