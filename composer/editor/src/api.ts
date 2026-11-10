import type { ReelSpec } from "../../src/reel/types";
import { token, signOut } from "./auth";

/** fetch with the signed-in user's token (cloud); plain fetch locally. */
export async function af(url: string, init: RequestInit = {}): Promise<Response> {
  const t = await token();
  const r = await fetch(url, t ? { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } } : init);
  if (r.status === 401 && t) signOut();
  return r;
}

export interface CloudConfig {
  mode: "local" | "cloud";
  auth: "dev" | "supabase";
  supabaseUrl: string;
  supabaseAnonKey: string;
  cutout: boolean;
  limits?: { uploadMb: number; clipSeconds: number; projects: number; rendersPerDay: number };
  providers: { id: string; label: string; example: string; needsBase: boolean }[];
}
export interface ModelConnection {
  id: string;
  provider: string;
  model: string;
  apiBase: string;
  keyLast4: string;
  caps: { ok?: boolean; tools?: boolean; vision?: boolean; latency?: number };
  isDefault: boolean;
}
export interface MemoryItem {
  id: string;
  kind: "spelling" | "preference" | "style";
  text: string;
  value: Record<string, any> | null;
  status: "active" | "proposed";
  source: "user" | "agent";
}
export interface RenderRow {
  name: string;
  url: string;
  aspect: string;
  quality: string;
}

/** Signed URLs for "@proj/..." files in the spec (cloud). */
let MEDIA: Record<string, string> = {};
/** A link we already hold for the same file and that is good for another half hour: keep it, so the player
 *  doesn't reload the video every time the spec is fetched again (e.g. after an edit from the user's AI app). */
const stillGood = (old: string | undefined, next: string) => {
  if (!old || old.split("?")[0] !== next.split("?")[0]) return false;
  const exp = Number(new URLSearchParams(old.split("?")[1] || "").get("exp"));
  return exp - Date.now() / 1000 > 1800;
};
export const addMedia = (m?: Record<string, string>) => {
  if (!m) return;
  const next = { ...MEDIA };
  for (const [k, url] of Object.entries(m)) if (!stillGood(next[k], url)) next[k] = url;
  MEDIA = next;
};
const abs = (u: string) => (u.startsWith("/") ? location.origin + u : u);

export interface Look {
  id: string;
  name: string;
  description: string;
  user?: boolean;
  patch: Record<string, any>;
}
export interface Catalog {
  looks: Look[];
  captionStyles: { id: string; name: string; group: string }[];
  formats: { id: string; name: string; description: string }[];
  effects: { id: string; name: string; family: "camera" | "transition" | "entrance" }[];
  titles: { id: string; name: string }[];
  endCards: string[];
  grades: { id: string; name: string }[];
  overlays: string[];
  sfx: string[];
  fonts: string[];
}
export interface Job {
  id: string;
  kind: string;
  project: string | null;
  status: "running" | "done" | "error";
  queued?: boolean;
  position?: number | null;
  progress: number;
  log: string[];
  result: any;
}
export interface ProjectRow {
  id: string;
  title?: string;
  ready: boolean;
  status?: string;
  updated: number;
  renders: (string | RenderRow)[];
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = r.statusText;
    try {
      msg = (await r.json()).detail || msg;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export type ConnectorLink = { on: boolean; url: string; lastUsed: number | null };

export const api = {
  catalog: () => af("/api/catalog").then((r) => j<Catalog>(r)),
  projects: () => af("/api/projects").then((r) => j<ProjectRow[]>(r)),
  spec: (pid: string) =>
    af(`/api/projects/${pid}/spec`)
      .then((r) => j<{ spec: ReelSpec; issues: string[]; media?: Record<string, string>; version?: number; author?: string; summary?: string; clips?: { name: string; start: number; seconds: number }[]; canUndo?: boolean; canRedo?: boolean }>(r))
      .then((r) => (addMedia(r.media), r)),
  save: (pid: string, spec: ReelSpec) =>
    af(`/api/projects/${pid}/spec`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) }).then((r) =>
      j<{ ok: boolean; issues: string[]; canUndo?: boolean; canRedo?: boolean }>(r),
    ),
  undo: (pid: string) =>
    af(`/api/projects/${pid}/undo`, { method: "POST" })
      .then((r) => j<{ spec: ReelSpec; media?: Record<string, string>; canUndo?: boolean; canRedo?: boolean }>(r))
      .then((r) => (addMedia(r.media), r)),
  redo: (pid: string) =>
    af(`/api/projects/${pid}/redo`, { method: "POST" })
      .then((r) => j<{ spec: ReelSpec; media?: Record<string, string>; canUndo?: boolean; canRedo?: boolean }>(r))
      .then((r) => (addMedia(r.media), r)),
  look: (pid: string, look: string) =>
    af(`/api/projects/${pid}/look`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ look }) }).then((r) =>
      j<{ spec: ReelSpec; media?: Record<string, string> }>(r).then((x) => (addMedia(x.media), x)),
    ),
  create: (form: FormData) => af("/api/projects", { method: "POST", body: form }).then((r) => j<{ project: string; job: string }>(r)),
  upload: (pid: string, file: File) => {
    const f = new FormData();
    f.append("file", file);
    return af(`/api/projects/${pid}/upload`, { method: "POST", body: f })
      .then((r) => j<{ path: string; url?: string; seconds?: number }>(r))
      .then((r) => (r.url && addMedia({ [r.path]: r.url }), r));
  },
  render: (pid: string, quality: string, aspects: string[]) =>
    af(`/api/projects/${pid}/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quality, aspects }) }).then((r) =>
      j<{ job: string }>(r),
    ),
  addClips: (pid: string, files: File[]) => {
    const f = new FormData();
    files.forEach((x) => f.append("files", x));
    return af(`/api/projects/${pid}/clips`, { method: "POST", body: f }).then((r) => j<{ job: string }>(r));
  },
  /** Other cameras of the same shoot: synced by sound, then (by default) cut to whoever is talking. */
  addAngles: (pid: string, files: File[]) => {
    const f = new FormData();
    files.forEach((x) => f.append("files", x));
    return af(`/api/projects/${pid}/angles`, { method: "POST", body: f }).then((r) => j<{ job: string }>(r));
  },
  autoZoom: (pid: string) => af(`/api/projects/${pid}/autozoom`, { method: "POST" }).then((r) => j<{ job: string }>(r)),
  autoCams: (pid: string) => af(`/api/projects/${pid}/autocam`, { method: "POST" }).then((r) => j<{ job: string }>(r)),
  bake: (pid: string) => af(`/api/projects/${pid}/bake`, { method: "POST" }).then((r) => j<{ job: string }>(r)),
  luts: (pid: string) => af(`/api/projects/${pid}/luts`).then((r) => j<{ id: string; img: string }[]>(r)),
  broll: (pid: string) => af(`/api/projects/${pid}/broll`, { method: "POST" }).then((r) => j<{ job: string }>(r)),
  remove: (pid: string) => af(`/api/projects/${pid}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),
  config: async (): Promise<CloudConfig> => {
    const r = await fetch("/api/config");
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !ct.includes("json")) return { mode: "local", auth: "dev", supabaseUrl: "", supabaseAnonKey: "", cutout: true, providers: [] };
    return r.json();
  },
  me: () => af("/api/me").then((r) => j<{ email: string; projects: number; rendersToday: number; hasModel: boolean; storageBytes: number; limits: { projects: number; rendersPerDay: number } }>(r)),
  head: (pid: string) => af(`/api/projects/${pid}/head`).then((r) => j<{ version: number | null; author: string; summary: string }>(r)),
  connector: () => af("/api/connector").then((r) => j<ConnectorLink>(r)),
  makeConnector: () => af("/api/connector", { method: "POST" }).then((r) => j<ConnectorLink>(r)),
  removeConnector: () => af("/api/connector", { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),
  models: () => af("/api/models").then((r) => j<ModelConnection[]>(r)),
  addModel: (b: { provider: string; model: string; apiKey: string; apiBase?: string }) =>
    af("/api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => j<ModelConnection>(r)),
  defaultModel: (id: string) => af(`/api/models/${id}/default`, { method: "POST" }).then((r) => j<{ ok: boolean }>(r)),
  removeModel: (id: string) => af(`/api/models/${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),
  memory: () => af("/api/memory").then((r) => j<MemoryItem[]>(r)),
  addMemory: (b: { kind: string; text: string; value?: Record<string, any> | null }) =>
    af("/api/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => j<MemoryItem>(r)),
  editMemory: (id: string, b: Record<string, any>) =>
    af(`/api/memory/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => j<MemoryItem>(r)),
  removeMemory: (id: string) => af(`/api/memory/${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),
  /** Download a text export (needs the auth header, so a plain link won't do in the cloud). */
  exportFile: async (pid: string, kind: string, name: string) => {
    const r = await af(`/api/projects/${pid}/export/${kind}`);
    if (!r.ok) throw new Error("export failed");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = `${name}.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  /** `t` is the moment a note is about, in reel seconds, or null when it is about the whole reel. */
  notes: (pid: string, notes: { t: number | null; text: string }[]) =>
    af(`/api/projects/${pid}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }) }).then((r) =>
      j<{ job: string }>(r),
    ),
  mimic: (form: FormData) => af("/api/mimic", { method: "POST", body: form }).then((r) => j<{ job: string }>(r)),
  job: (id: string) => af(`/api/jobs/${id}`).then((r) => j<Job>(r)),
  brand: () => af("/api/brand").then((r) => j<Record<string, string>>(r)),
  saveBrand: (b: Record<string, string>) =>
    af("/api/brand", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => j<Record<string, string>>(r)),
};

/** Poll a job until it finishes. */
export function watchJob(id: string, onUpdate: (j: Job) => void): () => void {
  let stop = false;
  const tick = async () => {
    if (stop) return;
    try {
      const job = await api.job(id);
      onUpdate(job);
      if (job.status !== "running") return;
    } catch {}
    setTimeout(tick, 800);
  };
  tick();
  return () => {
    stop = true;
  };
}

const MEDIA_KEYS = new Set(["src", "matte", "graded", "gradedMatte", "music", "media", "background", "sound"]);

/** Local: absolute paths -> /api/file URLs. Cloud: "@proj/..." -> signed URLs. For the in-browser player. */
export function forPlayer<T>(v: T, key?: string): T {
  if (Array.isArray(v)) return v.map((x) => forPlayer(x, key)) as any;
  if (v && typeof v === "object") {
    const out: any = {};
    for (const [k, x] of Object.entries(v)) out[k] = forPlayer(x, k);
    return out;
  }
  if (typeof v === "string" && v.startsWith("@proj/")) return (MEDIA[v] ? abs(MEDIA[v]) : "") as any;
  // absolute http URL: resolveAsset() treats a bare "/..." as a filesystem path
  if (typeof v === "string" && key && MEDIA_KEYS.has(key) && v.startsWith("/")) return `${location.origin}/api/file?p=${encodeURIComponent(v)}` as any;
  return v;
}

/** URL for showing one media value (thumbnail, link) outside the player. */
export const mediaUrl = (v: string): string => (v.startsWith("@proj/") ? (MEDIA[v] ? abs(MEDIA[v]) : "") : v.startsWith("/") && !v.startsWith("/api/") ? `/api/file?p=${encodeURIComponent(v)}` : v);
