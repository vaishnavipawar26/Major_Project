import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { cropName } from "../../utils/format";

/** Searchable single choice for the city / nearest mandi (keyboard: type, arrows, Enter, Escape). */
export default function CitySelect({ id, value, cities, onChange }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const shown = cities.filter((c) => cropName(t, c, "city").toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    const away = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const pick = (c) => { onChange(c); setOpen(false); setQuery(""); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && open) { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="city-select" ref={root}>
      <div className="input-unit">
        <input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" autoComplete="off"
          value={open ? query : cropName(t, value, "city")} placeholder={cropName(t, value, "city")}
          onFocus={() => { setOpen(true); setQuery(""); setActive(0); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }} onKeyDown={onKey} />
        <span className="input-unit-text" aria-hidden="true">{open ? <Search size={16} /> : <ChevronDown size={16} />}</span>
      </div>
      {open && (
        <ul id={`${id}-list`} role="listbox" className="city-list">
          {shown.length === 0 && <li className="city-empty">{t("crop.form.cityNone")}</li>}
          {shown.map((c, i) => (
            <li key={c} role="option" aria-selected={c === value} className={`${i === active ? "is-active" : ""}${c === value ? " is-selected" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setActive(i)}>
              {cropName(t, c, "city")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
