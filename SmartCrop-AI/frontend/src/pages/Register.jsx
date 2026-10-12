import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Alert from "../components/Alert";
import FormField from "../components/FormField";
import { startTour } from "../components/GuidedTour";
import PasswordInput from "../components/PasswordInput";
import { useToast } from "../components/Toast";
import SproutSpinner from "../components/SproutSpinner";
import { useAuth } from "../hooks/useAuth";
import { useKnownMessage, useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { isEmail, validatePassword } from "../utils/validation";

const ORDER = ["name", "email", "password", "confirm"];

export default function Register() {
  const t = useT();
  const known = useKnownMessage();
  const { register } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (form.name.trim().length < 2) errs.name = t("auth.errName");
    if (!isEmail(form.email)) errs.email = t("auth.errEmail");
    const pw = validatePassword(form.password, t);
    if (pw) errs.password = pw;
    if (form.confirm !== form.password) errs.confirm = t("auth.errMismatch");
    setErrors(errs);
    if (Object.keys(errs).length) { document.getElementById(ORDER.find((k) => errs[k]))?.focus(); return; }
    setSubmitting(true);
    setApiError(null);
    try {
      await register(form.name.trim(), form.email.trim(), form.password);
      // only reached after the server created the account
      notify({
        type: "success", celebrate: "register", title: t("toast.registerTitle"), message: t("toast.registerBody"),
        action: { label: t("toast.getStarted"), to: "/dashboard", onClick: startTour },
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setApiError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card auth-card stack" onSubmit={submit} noValidate aria-busy={submitting}>
      <div>
        <h1 className="auth-title">{t("auth.registerTitle")}</h1>
        <p className="text-2 !mb-0">{t("auth.registerSubtitle")}</p>
      </div>
      {apiError && <Alert type="error">{known(apiError)}</Alert>}
      <FormField id="name" label={t("auth.fullName")} error={errors.name}>
        <input id="name" autoComplete="name" value={form.name} onChange={set("name")} />
      </FormField>
      <FormField id="email" label={t("auth.email")} error={errors.email}>
        <input id="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={set("email")} />
      </FormField>
      <FormField id="password" label={t("auth.password")} hint={t("auth.passwordRule")} error={errors.password}>
        <PasswordInput id="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
      </FormField>
      <FormField id="confirm" label={t("auth.confirmPassword")} error={errors.confirm}>
        <PasswordInput id="confirm" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
      </FormField>
      <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
        {submitting && <SproutSpinner inButton />}{submitting ? t("auth.creating") : t("auth.createButton")}
      </button>
      <p className="small text-2 auth-switch">
        {t("auth.haveAccount")} <Link to="/login">{t("auth.loginLink")}</Link>
      </p>
    </form>
  );
}
