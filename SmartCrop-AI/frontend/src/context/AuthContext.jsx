import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { tokenStore } from "../services/api";
import { authService } from "../services/authService";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // Restore the session from a stored token on first load.
  useEffect(() => {
    if (!tokenStore.get()) { setInitializing(false); return; }
    authService.me().then(setUser).catch(logout).finally(() => setInitializing(false));
  }, [logout]);

  // Any 401 from the API (expired token) logs the user out.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("smartcrop:unauthorized", onUnauthorized);
    return () => window.removeEventListener("smartcrop:unauthorized", onUnauthorized);
  }, []);

  const handleAuth = useCallback((res) => {
    tokenStore.set(res.access_token);
    setUser(res.user);
    return res.user;
  }, []);

  const login = useCallback((email, password) =>
    authService.login({ email, password }).then(handleAuth), [handleAuth]);
  const register = useCallback((name, email, password) =>
    authService.register({ name, email, password }).then(handleAuth), [handleAuth]);

  const value = useMemo(() => ({ user, setUser, initializing, login, register, logout }),
    [user, initializing, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
