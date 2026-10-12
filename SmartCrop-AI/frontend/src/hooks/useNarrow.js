import { useEffect, useState } from "react";

/** True while the window is narrower than `breakpoint` (phones), updated on resize. */
export function useNarrow(breakpoint = 640) {
  const get = () => typeof window !== "undefined" && window.innerWidth < breakpoint;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    const on = () => setNarrow(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakpoint]);
  return narrow;
}
