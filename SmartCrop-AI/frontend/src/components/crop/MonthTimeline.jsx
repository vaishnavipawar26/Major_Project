import { useT } from "../../i18n/LanguageContext";
import { monthShort } from "../../utils/format";

/** Twelve small month cells with the stretch from planting to selling highlighted (P = planting, S = selling). */
export default function MonthTimeline({ plant, sell }) {
  const t = useT();
  const span = ((sell - plant + 12) % 12) || 12;
  const inSpan = (m) => ((m - plant + 12) % 12) <= span;
  return (
    <ol className="month-line" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
        <li key={m} className={`${inSpan(m) ? "is-on" : ""}${m === plant ? " is-plant" : ""}${m === sell ? " is-sell" : ""}`} title={`${monthShort(m)}${m === plant ? ` · ${t("crop.form.plantingMonth")}` : ""}${m === sell ? ` · ${t("crop.form.sellingMonth")}` : ""}`}>
          <span>{monthShort(m).slice(0, 1)}</span>
        </li>
      ))}
    </ol>
  );
}
