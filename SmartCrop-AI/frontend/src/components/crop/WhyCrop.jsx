import { CircleCheck, TriangleAlert } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { whyReasons } from "../../utils/cropReasons";
import { cropName } from "../../utils/format";

/** "Why this crop is recommended": at most three short, input-specific reasons, then the crop model's own notes. */
export default function WhyCrop({ result, response, inputs }) {
  const t = useT();
  const { reasons, modelNotes } = whyReasons(result, response, inputs, t);
  const best = result.crop_name === response.best_overall;
  return (
    <section className="card why-crop" aria-labelledby="why-title">
      <h2 id="why-title" className="cr-h2">
        {best ? t("cr.reason.title") : t("cr.reason.titleOther", { crop: cropName(t, result.crop_name) })}
      </h2>
      <ul className="why-list">
        {reasons.map((x) => {
          const Icon = x.tone === "good" ? CircleCheck : TriangleAlert;
          return (
            <li key={x.key} className={`why-item is-${x.tone}`}>
              <span className="why-icon"><Icon size={18} aria-hidden="true" /><span className="sr-only">{t(x.tone === "good" ? "cr.reason.good" : "cr.reason.attention")}</span></span>
              <div><strong>{t(`cr.reason.k.${x.key}`)}</strong><p>{x.text}</p></div>
            </li>
          );
        })}
      </ul>
      {modelNotes.length > 0 && (
        <div className="why-model">
          <h3>{t("cr.reason.modelTitle")}</h3>
          <ul>{modelNotes.map((n) => <li key={n.feature} className={n.supports ? "is-for" : "is-against"}>{n.text}</li>)}</ul>
          <p className="muted small">{t("cr.reason.modelNote")}</p>
        </div>
      )}
      <p className="muted small why-note">{t("cr.reason.note")}</p>
    </section>
  );
}
