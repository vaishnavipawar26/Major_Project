import { MoveRight, TrendingDown, TrendingUp } from "lucide-react";

const MAP = {
  Increasing: { cls: "badge-up", icon: TrendingUp, text: "Increasing" },
  Decreasing: { cls: "badge-down", icon: TrendingDown, text: "Decreasing" },
  Stable: { cls: "badge-stable", icon: MoveRight, text: "Stable" },
};

export default function DirectionBadge({ direction }) {
  const m = MAP[direction] || MAP.Stable;
  const Icon = m.icon;
  return <span className={`badge ${m.cls}`}><Icon size={14} aria-hidden="true" />{m.text}</span>;
}
