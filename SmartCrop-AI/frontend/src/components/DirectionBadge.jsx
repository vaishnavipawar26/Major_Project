import { MoveRight, TrendingDown, TrendingUp } from "lucide-react";
import { useT } from "../i18n/LanguageContext";

// Keys are the API's direction values; only the visible words are translated.
const MAP = {
  Increasing: { cls: "badge-up", icon: TrendingUp, text: "direction.Increasing" },
  Decreasing: { cls: "badge-down", icon: TrendingDown, text: "direction.Decreasing" },
  Stable: { cls: "badge-stable", icon: MoveRight, text: "direction.Stable" },
};

export default function DirectionBadge({ direction }) {
  const t = useT();
  const m = MAP[direction] || MAP.Stable;
  const Icon = m.icon;
  return <span className={`badge ${m.cls}`}><Icon size={14} aria-hidden="true" />{t(m.text)}</span>;
}
