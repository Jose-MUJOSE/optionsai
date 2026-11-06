"use client";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export function useLocalPreference<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  const defaults = useRef(fallback);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw === null ? defaults.current : JSON.parse(raw);
      const base = defaults.current;
      let restored = base;
      if (Array.isArray(base) && Array.isArray(parsed) && parsed.every(v => typeof v === typeof base[0])) restored = parsed as T;
      else if (base && typeof base === "object" && !Array.isArray(base) && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        restored = { ...base };
        for (const name of Object.keys(base) as (keyof T)[]) if (typeof parsed[name] === typeof base[name]) restored[name] = parsed[name];
      } else if (typeof parsed === typeof base && parsed !== null) restored = parsed;
      // Browser preferences must be restored after SSR hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(restored);
    } catch { /* keep usable defaults */ }
    setReady(true);
  }, [key]);
  useEffect(() => { if (ready) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* optional preference */ } } }, [key, ready, value]);
  return [value, setValue];
}
