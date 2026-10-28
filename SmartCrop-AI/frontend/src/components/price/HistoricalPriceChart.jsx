import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { ACTUAL_GAP_DAYS, isoOf, ts } from "../../utils/forecastWindow";
import { fmtDate, rupees, shortDate } from "../../utils/format";
import { priceAxis } from "./SimplePriceChart";

const DAY = 86400000;
const SHOW_DAYS = 180;

/** Rows of real reports only: a stretch with no report longer than ACTUAL_GAP_DAYS is a break in the line, never a joined segment. */
export function historyRows(observed) {
  const real = (observed || []).filter((p) => Number.isFinite(p.price)).sort((a, b) => ts(a.date) - ts(b.date));
  if (!real.length) return [];
  const from = ts(real.at(-1).date) - SHOW_DAYS * DAY;
  const hist = real.filter((p) => ts(p.date) >= from);
  const rows = [];
  hist.forEach((p, i) => {
    if (i > 0 && ts(p.date) - ts(hist[i - 1].date) > ACTUAL_GAP_DAYS * DAY) rows.push({ t: ts(hist[i - 1].date) + DAY, date: null, price: null });
    rows.push({ t: ts(p.date), date: p.date, price: p.price });
  });
  return rows;
}

function Tip({ active, payload, t, crop, market }) {
  const r = active && payload?.[0]?.payload;
  if (!r || r.price == null) return null;
  return (
    <div className="chart-tooltip">
      <strong>{fmtDate(r.date)}</strong><br />
      {rupees(r.price)} {t("unit.perQuintal")}<br />
      <span className="muted small">{crop} · {market}</span><br />
      <span className="small" style={{ color: "var(--series-actual)", fontWeight: 700 }}>{t("pfc.tip.actual")}</span>
    </div>
  );
}

/**
 * The market's real reported prices over the last months of its records, drawn on their own date axis (never joined to a forecast). Used when
 * no daily forecast can be defended, so the farmer still sees what the market actually did. Nothing here is estimated.
 */
export default function HistoricalPriceChart({ observed, crop, market }) {
  const t = useT();
  const narrow = useNarrow();
  const rows = historyRows(observed);
  if (!rows.length) return null;
  const real = rows.filter((r) => r.price != null);
  const { domain, ticks } = priceAxis(Math.min(...real.map((r) => r.price)), Math.max(...real.map((r) => r.price)));
  const x0 = rows[0].t, x1 = rows.at(-1).t;
  const n = narrow ? 3 : 5;
  const xt = Array.from({ length: n }, (_, i) => Math.round(x0 + ((x1 - x0) * i) / (n - 1)));
  const last = real.at(-1);
  return (
    <div data-testid="hist-chart">
      <p className="hist-title">{t("pfc.hist.title")}</p>
      <div style={{ width: "100%", height: narrow ? 200 : 240 }} role="img" aria-label={t("pfc.hist.title")}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 10, right: narrow ? 14 : 24, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={[x0, x1]} ticks={xt} interval={0} tickLine={false} stroke="var(--axis)"
              tickFormatter={(v) => shortDate(isoOf(v))} tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12.5 }} height={26} />
            <YAxis domain={domain} ticks={ticks} interval={0} width={narrow ? 56 : 64} tickLine={false} axisLine={false}
              tickFormatter={(v) => rupees(v)} tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12.5 }} />
            <Tooltip content={<Tip t={t} crop={crop} market={market} />} />
            <Line dataKey="price" stroke="var(--series-actual)" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="muted small" data-testid="hist-note">
        {t("pfc.hist.note", { price: rupees(last.price), date: fmtDate(last.date), first: fmtDate(real[0].date) })}
      </p>
    </div>
  );
}
