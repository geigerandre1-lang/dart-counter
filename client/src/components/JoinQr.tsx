import QRCode from "qrcode";
import { useEffect, useState } from "react";

interface Props {
  url: string;
  compact?: boolean;
}

export default function JoinQr({ url, compact = true }: Props) {
  const [dataUrl, setDataUrl] = useState<string>("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, {
      margin: 1,
      width: 512,
      errorCorrectionLevel: "M",
      color: { dark: "#05070d", light: "#ffffff" },
    }).then((next) => {
      if (!cancelled) setDataUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-2xl bg-white p-2 text-left text-ink-950 shadow-lg ${compact ? "w-[7.5rem]" : "w-44"}`}
      >
        {dataUrl ? (
          <img src={dataUrl} alt="QR-Code zum Beitreten" className="h-auto w-full" />
        ) : (
          <div className="aspect-square w-full animate-pulse bg-slate-200" />
        )}
        <div className="mt-1 text-center text-[10px] font-bold uppercase tracking-wide">Mit Handy beitreten</div>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-5 text-ink-950"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Mit Handy beitreten"
          >
            <p className="text-center text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
              Mit Handy beitreten
            </p>
            {dataUrl && <img src={dataUrl} alt="" className="mx-auto mt-3 w-full max-w-[280px]" />}
            <p className="mt-3 break-all text-center font-mono text-sm text-slate-700">{url}</p>
            <button
              type="button"
              className="mt-4 min-h-touch w-full rounded-2xl bg-ink-950 font-bold text-white"
              onClick={() => setOpen(false)}
            >
              Schließen
            </button>
          </div>
        </div>
      )}
    </>
  );
}
