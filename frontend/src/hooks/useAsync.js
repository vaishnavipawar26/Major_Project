import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../services/api";

/** Run an async loader and expose {data, loading, error, reload}. */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const active = useRef(true);

  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    return loader()
      .then((data) => active.current && setState({ data, loading: false, error: null }))
      .catch((e) => active.current && setState({ data: null, loading: false, error: errorMessage(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    active.current = true;
    run();
    return () => { active.current = false; };
  }, [run]);

  return { ...state, reload: run };
}
