"use client";
import { useCallback, useEffect, useState } from "react";
import type { AppView } from "@/components/Sidebar";

const views = new Set<AppView>(["workbench", "trader", "tasks", "reports", "dashboard", "options", "strategies", "scanner", "watchlist", "news", "paper", "patterns", "alerts"]);
export function parseAppRoute(hash: string): { view: AppView; reportId: string } {
  const [page, id] = hash.replace(/^#/, "").split("/");
  if (page === "report" && /^[0-9a-f]{32}$/.test(id || "")) return { view: "report", reportId: id };
  return { view: views.has(page as AppView) ? page as AppView : "workbench", reportId: "" };
}
export function useAppNavigation() {
  const [route, setRoute] = useState<{ view: AppView; reportId: string }>({ view: "workbench", reportId: "" });
  const apply = useCallback(() => {
    const next = parseAppRoute(window.location.hash); setRoute(next);
    try { localStorage.setItem("optionsai.lastView.v1", window.location.hash); } catch { /* optional persistence */ }
    document.getElementById("app-main")?.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    if (!window.location.hash) {
      let last = "#workbench"; try { last = localStorage.getItem("optionsai.lastView.v1") || last; } catch { /* defaults */ }
      window.history.replaceState(null, "", last);
    }
    // Reconcile the browser URL once after hydration, then subscribe to navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    apply();
    window.addEventListener("hashchange", apply); return () => window.removeEventListener("hashchange", apply);
  }, [apply]);
  const setView = useCallback((view: AppView) => { window.location.hash = view === "report" || view === "settings" ? "reports" : view; }, []);
  const openReport = useCallback((id: string) => { window.location.hash = `report/${id}`; }, []);
  return { ...route, setView, openReport };
}
