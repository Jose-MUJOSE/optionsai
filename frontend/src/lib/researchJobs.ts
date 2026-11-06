import type { ManagerDecision, ResearcherResult, TraderMode } from "./api";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000") + "/api/research-jobs";
export interface ResearchJob {
  id: string; ticker: string; mode: TraderMode; locale: "zh" | "en";
  request_id?: string; batch_name?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  phase: string; created_at: string; updated_at: string; started_at: string | null;
  phase_started_at: string | null; finished_at: string | null;
  model: string; reasoning_effort: string; error: string | null;
  researcher_count?: number; active_count: number; selected_researchers: string[];
  researchers: ResearcherResult[]; manager: ManagerDecision | null;
  manager_context: string | null; parent_id?: string;
  summary?: ReportSummary | null;
  events: { at: string; type: string; phase: string; researcher?: string }[];
}
export interface ReportSummary {
  decision?: string; conviction?: number; thesis?: string; main_risks?: string[]; key_catalysts?: string[];
  time_horizon?: string; entry_zone?: string; target_price?: string; stop_loss?: string; structure?: string; expiration?: string;
}
export interface ReportChatTurn {
  id: string; question: string; answer: string | null; error: string | null;
  status: "queued" | "running" | "completed" | "failed" | "interrupted";
  created_at: string; finished_at: string | null; model: string; reasoning_effort: string; report_updated_at: string;
}
export interface ReportConversation { report_id: string; turns: ReportChatTurn[] }
async function request<T>(path = "", body?: unknown): Promise<T> {
  const response = await fetch(BASE + path, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "请求失败，请检查服务 / Request failed");
  return data;
}
export const listResearchJobs = () => request<ResearchJob[]>();
export const getResearchJob = (id: string) => request<ResearchJob>(`/${id}`);
export const submitResearchJobs = (data: { tickers: string[]; mode: TraderMode; locale: "zh" | "en"; selected_researchers: string[]; request_id: string; batch_name?: string }) => request<ResearchJob[]>("", data);
export const cancelResearchJob = (id: string) => request<ResearchJob>(`/${id}/cancel`, {});
export const retryResearchJob = (id: string) => request<ResearchJob>(`/${id}/retry`, {});
export const researchExportURL = (id: string, format: "json" | "docx") => `${BASE}/${id}/export/${format}`;
export const researchZipURL = (ids: string[]) => `${BASE}/export.zip?ids=${encodeURIComponent(ids.join(","))}`;
export const importResearchHistory = (entries: unknown[]) => request<ResearchJob[]>("/import", { entries });
export const getQueueSettings = () => request<{ parallel_jobs: number }>("/queue-settings");
export const setQueueParallel = (parallel_jobs: number) => request<{ parallel_jobs: number }>("/queue-settings", { parallel_jobs });
export const getReportChat = (id: string) => request<ReportConversation>(`/${id}/chat`);
export const askReportQuestion = (id: string, data: { question: string; request_id: string; locale: "zh" | "en" }) => request<ReportConversation>(`/${id}/chat`, data);
