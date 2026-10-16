import CropArt from "../CropArt";
import { useT } from "../../i18n/LanguageContext";
import { cropName } from "../../utils/format";

/** Chooses which crop the detail sections below describe. The chart and table select it too. */
export default function CropPicker({ results, selected, bestName, onSelect }) {
  const t = useT();
  return (
    <nav className="crop-picker-bar" aria-label={t("cr.picker.aria")}>
      <span className="picker-label">{t("cr.picker.label")}</span>
      <div className="flex flex-wrap items-center gap-2">
        {results.map((r) => (
          <button key={r.crop_name} type="button" onClick={() => onSelect(r.crop_name)} aria-pressed={selected === r.crop_name}
            className={`crop-pill ${selected === r.crop_name ? "is-active" : ""}`}>
            <CropArt crop={r.crop_name} size={24} decorative />{cropName(t, r.crop_name)}
            {r.crop_name === bestName && <span className="pill-tag">{t("cr.picker.best")}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}
