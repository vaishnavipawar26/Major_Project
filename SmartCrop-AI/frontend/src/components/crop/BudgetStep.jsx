import { Flame, Scale, Shield, ShieldAlert, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import FormField from "../FormField";
import { useT } from "../../i18n/LanguageContext";
import { PRIORITIES, RISKS, costRange, formatBudget, rangeText } from "../../utils/budgetPlan";

const PRIORITY_ICON = { spend_less: Wallet, balanced: Scale, highest_profit: TrendingUp };
const RISK_ICON = { low: ShieldCheck, medium: Shield, high: ShieldAlert };

/** A radio group of option cards: icon, title and one line each. Selection is shown by border, check and `aria-checked`, not colour alone. */
function OptionCards({ name, labelId, value, options, icons, onChange }) {
  const t = useT();
  return (
    <div className="opt-cards" role="radiogroup" aria-labelledby={labelId}>
      {options.map((o) => {
        const Icon = icons[o] || Flame;
        const on = value === o;
        return (
          <button key={o} type="button" role="radio" aria-checked={on} data-testid={`${name}-${o}`}
            className={`opt-card${on ? " is-on" : ""}`} onClick={() => onChange(o)}>
            <Icon size={20} aria-hidden="true" />
            <span className="opt-card-title">{t(`crop.form.${name}.${o}`)}</span>
            <span className="opt-card-sub">{t(`crop.form.${name}.${o}Sub`)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** "Step 4 · Budget & priorities (optional)": money available, what matters most, how much risk. Empty = the standard recommendation. */
export default function BudgetStep({ form, set, setField, error, onBlur, economics, inflationPct, SectionHead }) {
  const t = useT();
  const range = costRange(economics, inflationPct, Number(form.planting_month), form.area_acres);
  return (
    <section className="cf-card cf-budget" aria-labelledby="budget-title">
      <SectionHead id="budget-title" icon={Wallet} title={t("crop.form.budgetTitle")} note={t("crop.form.budgetNote")} />
      <div className="grid gap-4">
        <FormField id="budget_inr" label={t("crop.form.budgetLabel")} error={error}
          hint={range ? t("crop.form.budgetHelp", { size: t(Number(form.area_acres) === 1 ? "cr.plan.acre" : "cr.plan.acres", { n: form.area_acres }), range: rangeText(range) }) : undefined}>
          <div className="input-unit">
            <span className="input-prefix" aria-hidden="true">₹</span>
            <input id="budget_inr" type="text" inputMode="numeric" autoComplete="off" placeholder={t("crop.form.budgetPlaceholder")}
              value={formatBudget(form.budget_inr)} onChange={set("budget_inr")} onBlur={onBlur} className="has-prefix" />
          </div>
        </FormField>

        <div className="field">
          <span className="label-like" id="priority-label">{t("crop.form.priorityTitle")}</span>
          <OptionCards name="priority" labelId="priority-label" value={form.priority} options={PRIORITIES} icons={PRIORITY_ICON} onChange={(v) => setField("priority", v)} />
        </div>

        <div className="field">
          <span className="label-like" id="risk-label">{t("crop.form.riskTitle")}</span>
          <OptionCards name="risk" labelId="risk-label" value={form.risk_level} options={RISKS} icons={RISK_ICON} onChange={(v) => setField("risk_level", v)} />
        </div>

        <p className="muted small !mb-0">{t("crop.form.budgetEmptyNote")}</p>
      </div>
    </section>
  );
}
