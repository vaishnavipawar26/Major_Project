import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import FarmExplanation from "./FarmExplanation";

/** Collapsed-by-default wrapper around the existing detailed explanation (location, planting, soil, weather, profit, budget, final summary). */
export default function DetailedExplanation({ result, response, inputs }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className={`card inf-collapse${open ? " is-open" : ""}`}>
      <button type="button" className="inf-collapse-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
        <span className="inf-collapse-text">
          <span className="inf-collapse-title">{t("cr.det.title")}</span>
          <span className="inf-collapse-sub">{t("cr.det.subtitle")}</span>
        </span>
        <span className="inf-collapse-action">
          {t(open ? "cr.det.hide" : "cr.det.show")}
          <ChevronDown size={18} aria-hidden="true" className="inf-chevron" />
        </span>
      </button>
      <div id={bodyId} className="inf-collapse-body" hidden={!open}>
        {open && <FarmExplanation result={result} response={response} inputs={inputs} />}
      </div>
    </section>
  );
}
