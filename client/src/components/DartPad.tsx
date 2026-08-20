import { useState } from "react";
import type { DartThrow } from "@shared/index";

const NUMBERS = [
  1, 2, 3, 4, 5,
  6, 7, 8, 9, 10,
  11, 12, 13, 14, 15,
  16, 17, 18, 19, 20,
];

interface Props {
  disabled?: boolean;
  onDart: (dart: DartThrow) => void;
  onUndo: () => void;
  onConfirm: () => void;
  canUndo: boolean;
  canConfirm: boolean;
}

export default function DartPad({ disabled, onDart, onUndo, onConfirm, canUndo, canConfirm }: Props) {
  const [mod, setMod] = useState<1 | 2 | 3>(1);

  function send(segment: number, multiplier: 1 | 2 | 3) {
    onDart({ segment, multiplier });
    setMod(1);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <button
          className={`pad-btn ${mod === 1 ? "bg-ink-600 text-white" : "bg-ink-800 text-slate-300"}`}
          onClick={() => setMod(1)}
          disabled={disabled}
        >
          Single
        </button>
        <button
          className={`pad-btn ${mod === 2 ? "bg-amber-glow text-ink-950" : "bg-ink-800 text-amber-glow"}`}
          onClick={() => setMod(2)}
          disabled={disabled}
        >
          Double
        </button>
        <button
          className={`pad-btn ${mod === 3 ? "bg-crimson text-white" : "bg-ink-800 text-crimson"}`}
          onClick={() => setMod(3)}
          disabled={disabled}
        >
          Triple
        </button>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {NUMBERS.map((n) => (
          <button
            key={n}
            className="pad-btn bg-ink-700 text-white active:bg-ink-600"
            onClick={() => send(n, mod)}
            disabled={disabled}
          >
            {mod === 2 ? `D${n}` : mod === 3 ? `T${n}` : n}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          className="pad-btn bg-amber-glow/90 text-ink-950 text-lg"
          onClick={() => send(25, mod === 3 ? 2 : (mod as 1 | 2))}
          disabled={disabled}
        >
          {mod === 2 ? "DBull" : "Bull"}
        </button>
        <button
          className="pad-btn bg-slate-200 text-ink-950 text-lg"
          onClick={() => send(0, 1)}
          disabled={disabled}
        >
          Daneben
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          className="pad-btn bg-ink-800 text-slate-200 disabled:opacity-40"
          onClick={onUndo}
          disabled={disabled || !canUndo}
        >
          Rückgängig
        </button>
        <button
          className="pad-btn bg-emerald-500 text-ink-950 disabled:opacity-40"
          onClick={onConfirm}
          disabled={disabled || !canConfirm}
        >
          Visit bestätigen
        </button>
      </div>
    </div>
  );
}
