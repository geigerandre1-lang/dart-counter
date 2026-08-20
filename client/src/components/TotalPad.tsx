import { useState } from "react";
import { isPossibleVisitTotal } from "@shared/index";

interface Props {
  disabled?: boolean;
  onSubmit: (total: number) => void;
  onUndo: () => void;
  canUndo: boolean;
  error?: string | null;
}

export default function TotalPad({ disabled, onSubmit, onUndo, canUndo, error }: Props) {
  const [value, setValue] = useState("");

  function digit(d: string) {
    setValue((v) => {
      const next = (v + d).replace(/^0+(?=\d)/, "");
      if (next.length > 3) return v;
      const n = Number(next);
      if (n > 180) return v;
      return next;
    });
  }

  function confirm() {
    if (value === "") return;
    const n = Number(value);
    if (!isPossibleVisitTotal(n)) {
      onSubmit(n);
      return;
    }
    onSubmit(n);
    setValue("");
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-2xl bg-ink-800 px-4 py-3 text-center">
        <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Visit-Summe</div>
        <div className="score-num text-amber-glow" style={{ fontSize: "3.4rem" }}>
          {value === "" ? "0" : value}
        </div>
        {(!isPossibleVisitTotal(Number(value || "0")) && value !== "" && value !== "0") && (
          <div className="mt-1 text-sm font-semibold text-crimson">Unmögliche 3-Dart-Summe</div>
        )}
        {error && <div className="mt-1 text-sm font-semibold text-crimson">{error}</div>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((k) => (
          <button key={k} className="pad-btn bg-ink-700 text-white" disabled={disabled} onClick={() => digit(k)}>
            {k}
          </button>
        ))}
        <button className="pad-btn bg-ink-800 text-slate-200" disabled={disabled} onClick={() => setValue("")}>
          C
        </button>
        <button className="pad-btn bg-ink-700 text-white" disabled={disabled} onClick={() => digit("0")}>
          0
        </button>
        <button
          className="pad-btn bg-ink-800 text-slate-200"
          disabled={disabled}
          onClick={() => setValue((v) => v.slice(0, -1))}
        >
          ⌫
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className="pad-btn bg-ink-800 text-slate-200 disabled:opacity-40" disabled={disabled || !canUndo} onClick={onUndo}>
          Rückgängig
        </button>
        <button className="pad-btn bg-emerald-500 text-ink-950 disabled:opacity-40" disabled={disabled || value === ""} onClick={confirm}>
          Bestätigen
        </button>
      </div>
    </div>
  );
}
