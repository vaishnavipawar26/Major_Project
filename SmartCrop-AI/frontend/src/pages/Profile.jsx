import { useState } from "react";
import { KeyRound, UserRound } from "lucide-react";
import Alert from "../components/Alert";
import FormField from "../components/FormField";
import PasswordInput from "../components/PasswordInput";
import SproutSpinner from "../components/SproutSpinner";
import { useAuth } from "../hooks/useAuth";
import { useKnownMessage, useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { authService } from "../services/authService";
import { fmtDate } from "../utils/format";
import { validatePassword } from "../utils/validation";

export default function Profile() {
  const t = useT();
  const known = useKnownMessage();
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState(null); // { form: "name" | "password", type, text }
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [busyForm, setBusyForm] = useState(null); // which form shows the spinner

  const save = async (formName, body, errs) => {
    setErrors(errs);
    if (Object.keys(errs).length) { document.getElementById(Object.keys(errs)[0])?.focus(); return; }
    setBusy(true);
    setBusyForm(formName);
    setMsg(null);
    try {
      const u = await authService.updateProfile(body);
      setUser(u);
      setMsg({ form: formName, type: "success", text: t(formName === "name" ? "profile.savedName" : "profile.savedPassword") });
      setPw({ current: "", next: "", confirm: "" });
    } catch (e) {
      setMsg({ form: formName, type: "error", text: known(errorMessage(e)) });
    } finally {
      setBusy(false);
      setBusyForm(null);
    }
  };

  const saveName = (e) => {
    e.preventDefault();
    save("name", { name: name.trim() }, name.trim().length < 2 ? { name: t("profile.errName") } : {});
  };
  const savePassword = (e) => {
    e.preventDefault();
    const errs = {};
    if (!pw.current) errs.current = t("profile.errCurrent");
    const v = validatePassword(pw.next, t);
    if (v) errs.next = v;
    if (pw.confirm !== pw.next) errs.confirm = t("auth.errMismatch");
    save("password", { current_password: pw.current, new_password: pw.next }, errs);
  };
  const message = (formName) => msg?.form === formName && <Alert type={msg.type}>{msg.text}</Alert>;

  return (
    <>
      <div className="page-header"><div><h1>{t("profile.title")}</h1><p>{t("profile.subtitle")}</p></div></div>
      <div className="profile-head card">
        <span className="profile-avatar" aria-hidden="true">{(user.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</span>
        <div className="min-w-0">
          <strong className="profile-name">{user.name}</strong>
          <dl className="kv profile-kv">
            <dt>{t("profile.email")}</dt><dd>{user.email}</dd>
            <dt>{t("profile.memberSince")}</dt><dd>{fmtDate(user.created_at)}</dd>
          </dl>
        </div>
      </div>
      <div className="grid grid-2 mt-4">
        <form className="card stack" onSubmit={saveName} noValidate>
          <h2 className="section-title"><UserRound size={19} aria-hidden="true" />{t("profile.nameTitle")}</h2>
          {message("name")}
          <FormField id="name" label={t("profile.name")} error={errors.name}>
            <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <div><button className="btn btn-primary" disabled={busy}>{busyForm === "name" && <SproutSpinner inButton />}{t("profile.saveName")}</button></div>
        </form>
        <form className="card stack" onSubmit={savePassword} noValidate>
          <h2 className="section-title"><KeyRound size={19} aria-hidden="true" />{t("profile.passwordTitle")}</h2>
          {message("password")}
          <FormField id="current" label={t("profile.current")} error={errors.current}>
            <PasswordInput id="current" autoComplete="current-password" value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </FormField>
          <FormField id="next" label={t("profile.new")} error={errors.next} hint={t("auth.passwordRule")}>
            <PasswordInput id="next" autoComplete="new-password" value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </FormField>
          <FormField id="confirm" label={t("profile.confirmNew")} error={errors.confirm}>
            <PasswordInput id="confirm" autoComplete="new-password" value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </FormField>
          <div><button className="btn btn-primary" disabled={busy}>{busyForm === "password" && <SproutSpinner inButton />}{t("profile.changePassword")}</button></div>
        </form>
      </div>
    </>
  );
}
