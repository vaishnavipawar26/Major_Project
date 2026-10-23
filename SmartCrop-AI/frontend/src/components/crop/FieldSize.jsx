import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import FormField from "../FormField";
import { useT } from "../../i18n/LanguageContext";
import { TABLE, bump, factorOf, fmtNum, fromAcres, otherUnit, toAcres } from "../../utils/fieldSize";

/**
 * Field size: always required, in acres or guntha (1 acre = 40 guntha). The form keeps the value in ACRES (what the API takes);
 * this component shows and edits it in the chosen unit, with a live conversion line and a guntha-acre table that is hidden until asked for.
 */
export default function FieldSize({ acres, onAcres, unit, onUnit, error, onBlur }) {
  const t = useT();
  const [text, setText] = useState(() => fromAcres(acres, unit));
  const [table, setTable] = useState(false);
  const f = factorOf(unit);

  // follow the form when it changes the value from outside (an example button, Clear all) or the unit is switched; never fight typing
  useEffect(() => {
    const n = Number(acres);
    if (String(acres).trim() === "" || !Number.isFinite(n)) return;
    const shown = Number(text);
    if (!(text.trim() !== "" && Number.isFinite(shown) && Math.abs(shown / f - n) < 1e-9)) setText(fromAcres(acres, unit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acres, unit]);

  const edit = (value) => { setText(value); onAcres(toAcres(value, unit)); };
  const other = otherUnit(text, unit);
  const unitWord = (u, n) => t(u === "guntha" ? "crop.form.gunthaWord" : Number(n) <= 1 ? "crop.form.acreWord" : "crop.form.acresWord");

  return (
    <FormField id="area_acres" label={t("crop.form.area")} required error={error}>
      <div className="fs-wrap">
        <div className="fs-row">
          <div className="stepper">
            <button type="button" onClick={() => edit(bump(text, unit, -1))} aria-label={t("crop.form.areaLess")}><Minus size={16} aria-hidden="true" /></button>
            <input id="area_acres" type="text" inputMode="decimal" autoComplete="off" value={text} onChange={(e) => edit(e.target.value)} onBlur={onBlur}
              onWheel={(e) => e.currentTarget.blur()} />
            <button type="button" onClick={() => edit(bump(text, unit, 1))} aria-label={t("crop.form.areaMore")}><Plus size={16} aria-hidden="true" /></button>
          </div>
          <div className="fs-units" role="radiogroup" aria-label={t("crop.form.areaUnitAria")}>
            {["acre", "guntha"].map((u) => (
              <button key={u} type="button" role="radio" aria-checked={unit === u} data-testid={`unit-${u}`} className={unit === u ? "is-on" : ""} onClick={() => onUnit(u)}>
                {t(u === "acre" ? "crop.form.areaUnitAcre" : "crop.form.areaUnitGuntha")}
              </button>
            ))}
          </div>
        </div>
        {other && <p className="fs-convert muted small" data-testid="area-convert">= {other.value} {unitWord(other.unit, other.value)}</p>}
        <button type="button" className="btn-link small fs-table-link" aria-expanded={table} onClick={() => setTable((v) => !v)} data-testid="area-table-toggle">
          {t(table ? "crop.form.areaTableHide" : "crop.form.areaTableShow")}
        </button>
        {table && (
          <ul className="fs-table" data-testid="area-table">
            {TABLE.map(([g, a]) => (
              <li key={g}>
                <button type="button" onClick={() => edit(fmtNum(unit === "guntha" ? g : a))}>
                  {g === 0.5 ? "½" : g} {t("crop.form.gunthaWord")} = {fmtNum(a)} {unitWord("acre", a)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FormField>
  );
}
