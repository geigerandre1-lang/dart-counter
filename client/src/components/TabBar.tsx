export type AppTab = "play" | "stats" | "admin";

interface Props {
  tab: AppTab;
  admin: boolean;
  onTab: (tab: AppTab) => void;
}

export default function TabBar({ tab, admin, onTab }: Props) {
  const items: { id: AppTab; label: string }[] = [
    { id: "play", label: "Spiel" },
    { id: "stats", label: "Statistiken" },
    ...(admin ? [{ id: "admin" as const, label: "Admin" }] : []),
  ];
  return (
    <nav className="safe-pad flex gap-2 px-4 pt-4">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onTab(item.id)}
          className={`min-h-touch flex-1 rounded-2xl text-sm font-bold uppercase tracking-wide ${
            tab === item.id ? "bg-amber-glow text-ink-950" : "bg-ink-800 text-slate-300"
          }`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
