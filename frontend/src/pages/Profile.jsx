import { useState } from "react";
import Alert from "../components/Alert";
import FormField from "../components/FormField";
import { useAuth } from "../hooks/useAuth";
import { errorMessage } from "../services/api";
import { authService } from "../services/authService";
import { fmtDate } from "../utils/format";
import { validatePassword } from "../utils/validation";

export default function Profile() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const save = async (body, errs) => {
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setMsg(null);
    try {
      const u = await authService.updateProfile(body);
      setUser(u);
      setMsg({ type: "success", text: "Saved." });
      setPw({ current: "", next: "", confirm: "" });
    } catch (e) {
      setMsg({ type: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveName = (e) => {
    e.preventDefault();
    save({ name: name.trim() }, name.trim().length < 2 ? { name: "Enter at least 2 characters." } : {});
  };
  const savePassword = (e) => {
    e.preventDefault();
    const errs = {};
    if (!pw.current) errs.current = "Enter your current password.";
    const v = validatePassword(pw.next);
    if (v) errs.next = v;
    if (pw.confirm !== pw.next) errs.confirm = "Passwords do not match.";
    save({ current_password: pw.current, new_password: pw.next }, errs);
  };

  return (
    <>
      <div className="page-header"><div><h1>Profile</h1><p>Your account details.</p></div></div>
      {msg && <div style={{ marginBottom: "1rem" }}><Alert type={msg.type}>{msg.text}</Alert></div>}
      <div className="grid grid-2">
        <form className="card stack" onSubmit={saveName} noValidate>
          <h2>Account</h2>
          <dl className="kv">
            <dt>Email</dt><dd>{user.email}</dd>
            <dt>Member since</dt><dd>{fmtDate(user.created_at)}</dd>
          </dl>
          <FormField id="name" label="Name" error={errors.name}>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <div><button className="btn btn-primary" disabled={busy}>Save name</button></div>
        </form>
        <form className="card stack" onSubmit={savePassword} noValidate>
          <h2>Change password</h2>
          <FormField id="current" label="Current password" error={errors.current}>
            <input id="current" type="password" autoComplete="current-password" value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </FormField>
          <FormField id="next" label="New password" error={errors.next} hint="At least 8 characters, with a letter and a number.">
            <input id="next" type="password" autoComplete="new-password" value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </FormField>
          <FormField id="confirm" label="Confirm new password" error={errors.confirm}>
            <input id="confirm" type="password" autoComplete="new-password" value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </FormField>
          <div><button className="btn btn-primary" disabled={busy}>Change password</button></div>
        </form>
      </div>
    </>
  );
}
