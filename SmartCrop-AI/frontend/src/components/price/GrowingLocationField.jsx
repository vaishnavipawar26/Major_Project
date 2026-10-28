import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, MapPin, Star } from "lucide-react";
import FormField from "../FormField";
import { useT } from "../../i18n/LanguageContext";
import { priceService } from "../../services/priceService";

const DEBOUNCE_MS = 350;
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/** "19.9973° N, 73.7910° E" */
export const fmtCoords = (lat, lon) => `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;

/** Popular places whose name starts with (or, from the third letter, contains) the typed place name. */
export function filterPopular(popular, text) {
  const q = norm(String(text || "").split(",")[0]);
  if (!q) return popular;
  return popular.filter((p) => { const n = norm(p.name); return n.startsWith(q) || (q.length >= 3 && n.includes(q)); });
}

/**
 * Where the crop is grown. Clicking the field shows popular Maharashtra places at once (the project's own cities, with verified
 * coordinates); typing filters them immediately and also searches every other village, town or district with the location search. The
 * farmer picks a place with the mouse, a tap or the keyboard (arrow keys + Enter), so the coordinates used for weather and soil are a real
 * place the farmer has seen and confirmed. ``value`` is { text, place, down }: ``place`` is the chosen place (null until one is picked),
 * ``down`` is true when the search service could not be reached. ``onChange`` is a state setter (called with an updater function).
 * Separate from the selling market.
 */
export default function GrowingLocationField({ value, onChange, error }) {
  const t = useT();
  const [popular, setPopular] = useState([]);
  const [found, setFound] = useState([]);              // search results for the current text
  const [status, setStatus] = useState("idle");        // idle | searching | done | down
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  // once a place is chosen, the box shows its label; opening the list again then offers the popular places to switch
  const query = value.place ? "" : value.text.trim();

  useEffect(() => {
    let live = true;
    priceService.popularLocations().then((r) => live && setPopular(r.results || [])).catch(() => { /* typing still searches */ });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (query.length < 2) { setFound([]); setStatus("idle"); return undefined; }
    const n = ++seq.current;
    setStatus("searching");
    const timer = setTimeout(() => {
      priceService.locations(query)
        .then((r) => {
          if (n !== seq.current) return;
          setFound(r.results || []); setStatus("done");
          onChange((v) => (v.down ? { ...v, down: false } : v));
        })
        .catch((e) => {
          if (n !== seq.current) return;
          setFound([]);
          if (e?.response?.status === 422) { setStatus("done"); return; }
          setStatus("down");
          onChange((v) => ({ ...v, down: true }));
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, onChange]);

  // what the list shows: popular places matching the text first (instantly), then other places the search found
  const options = useMemo(() => {
    const local = filterPopular(popular, query);
    if (query.length < 2) return local;
    const seen = new Set(local.map((p) => p.label));
    return [...local, ...found.filter((p) => !seen.has(p.label))];
  }, [popular, found, query]);
  useEffect(() => { setActive(-1); }, [query]);

  const pick = (p) => { onChange(() => ({ text: p.label, place: p, down: false })); setOpen(false); setActive(-1); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else if (options.length) setActive((i) => (i + 1) % options.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (options.length) setActive((i) => (i <= 0 ? options.length - 1 : i - 1)); }
    else if (e.key === "Enter" && open && active >= 0 && options[active]) { e.preventDefault(); pick(options[active]); }
    else if (e.key === "Escape") setOpen(false);
  };
  const listOpen = open && options.length > 0;
  const showHeader = listOpen && query.length < 2;
  const searchedNothing = open && query.length >= 2 && !options.length;

  return (
    <div className="growing-field">
      <FormField id="growing_location" label={t("price.form.growing")} error={error} hint={t("price.form.growingHint")} required>
        <input id="growing_location" type="text" autoComplete="off" spellCheck={false} placeholder={t("price.form.growingPlaceholder")}
          value={value.text} onKeyDown={onKey} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => setOpen(false)}
          role="combobox" aria-expanded={listOpen} aria-controls="growing_location-list" aria-autocomplete="list"
          aria-activedescendant={listOpen && active >= 0 ? `growing-opt-${active}` : undefined}
          onChange={(e) => { const text = e.target.value; onChange(() => ({ text, place: null, down: false })); setOpen(true); }} />
      </FormField>

      {listOpen && (
        <div className="loc-panel">
          {showHeader && <p className="loc-head" id="growing_location-head">{t("price.form.growingPopular")}</p>}
          <ul className="loc-list" id="growing_location-list" role="listbox" aria-label={t(showHeader ? "price.form.growingPopular" : "price.form.growingPick")}
            data-testid="growing-suggestions">
            {options.map((p, i) => (
              <li key={`${p.label}-${p.latitude}`} id={`growing-opt-${i}`} role="option" aria-selected={i === active}
                data-popular={p.popular ? "true" : undefined}
                className={`loc-option${i === active ? " is-active" : ""}`} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
                {p.popular ? <Star size={15} aria-hidden="true" /> : <MapPin size={15} aria-hidden="true" />}
                <span>{p.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && status === "searching" && query.length >= 2 && (
        <p className="muted small loc-status" data-testid="growing-searching">{t("price.form.growingSearching")}</p>
      )}
      {searchedNothing && status === "done" && <p className="small loc-status is-warn" data-testid="growing-none">{t("price.form.growingNone")}</p>}
      {status === "down" && !options.length && <p className="small loc-status is-warn" data-testid="growing-down">{t("price.form.growingDown")}</p>}
      {value.place && (
        <p className="loc-resolved" data-testid="growing-resolved">
          <CircleCheck size={16} aria-hidden="true" />
          <span><strong>{value.place.label}</strong><span className="muted small"> · {fmtCoords(value.place.latitude, value.place.longitude)}</span></span>
        </p>
      )}
    </div>
  );
}
