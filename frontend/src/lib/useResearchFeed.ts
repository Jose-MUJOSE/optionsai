"use client";
import { useCallback, useEffect, useState } from "react";
import { listResearchJobs, type ResearchJob } from "./researchJobs";
import { isActiveJob } from "./researchDisplay";

export function useResearchFeed() {
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const rows = await listResearchJobs(); setJobs(rows); setError(""); setLoaded(true); return rows;
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 15000;
      try { const rows = await listResearchJobs(); if (!stopped) { setJobs(rows); setLoaded(true); setError(""); } if (rows.some(isActiveJob)) delay = 2500; }
      catch (e) { if (!stopped) { setError(e instanceof Error ? e.message : String(e)); setLoaded(true); } delay = 5000; }
      if (!stopped) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  return { jobs, error, loaded, refresh };
}
