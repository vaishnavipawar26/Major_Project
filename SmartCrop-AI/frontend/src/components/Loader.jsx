import { useKnownMessage, useT } from "../i18n/LanguageContext";
import SproutSpinner from "./SproutSpinner";

export default function Loader({ label }) {
  const t = useT();
  const known = useKnownMessage();
  return (
    <div className="loader" role="status" aria-live="polite">
      <SproutSpinner size={30} />
      <span>{label ? known(label) : t("common.loading")}</span>
    </div>
  );
}
