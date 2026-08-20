import { inGamePlayerName, type Player } from "@shared/index";

export default function LivePlayerName({
  player,
  nameClassName = "font-bold text-white",
  teamClassName = "text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400",
}: {
  player: Player;
  nameClassName?: string;
  teamClassName?: string;
}) {
  const name = inGamePlayerName(player.name);
  return (
    <div>
      {player.teamName ? <div className={teamClassName}>{player.teamName}</div> : null}
      <div className={nameClassName}>{name}</div>
    </div>
  );
}
