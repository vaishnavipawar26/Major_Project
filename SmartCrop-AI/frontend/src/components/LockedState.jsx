import { useId } from "react";
import { Lock } from "lucide-react";
import { useT } from "../i18n/LanguageContext";
import { cropName } from "../utils/format";

/**
 * The state, locked: a label and a grey pill with a lock icon. It is not a form control (no input, no dropdown, not focusable), so it is
 * exposed to screen readers as a group named by its label ("State", "Maharashtra"). One component for the crop and the price forms so
 * both look the same. `hint` is an optional small grey line under the pill.
 */
export default function LockedState({ label, value = "Maharashtra", hint }) {
  const t = useT();
  const id = useId();
  return (
    <div className="field" role="group" aria-labelledby={`${id}-label`}>
      <span className="label-like" id={`${id}-label`}>{label ?? t("crop.form.state")}</span>
      <span className="state-chip"><Lock size={14} aria-hidden="true" />{cropName(t, value, "state")}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
