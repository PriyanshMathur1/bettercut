// Pipeline mode in the editor: pure helpers (editor, tests).

export type StageStatus = "todo" | "doing" | "review" | "done";

export interface StageRow {
  id: string;
  name: string;
  approve: boolean;
  status: StageStatus;
  summary: string;
  note: string;
}

export interface PipelineView {
  pipeline: string;
  name: string;
  brief: string;
  stage: number;
  finished: boolean;
  stages: StageRow[];
  now: { status: string; name?: string; goal?: string; say?: string; creatorNote?: string };
}

/** What the strip says about the pipeline right now, in a few words. */
export function headline(p: PipelineView): string {
  if (p.finished) return `${p.name}: finished`;
  const cur = p.stages[p.stage];
  const n = `${p.stage + 1} of ${p.stages.length}`;
  if (cur.status === "review") return `${cur.name} is ready for you (${n})`;
  if (cur.note) return `Claude is redoing ${cur.name} (${n})`;
  return `Claude is on ${cur.name} (${n})`;
}

/** Share of the stages done, 0..1. A stage waiting for review counts as nearly done. */
export function progress(p: PipelineView): number {
  if (p.finished) return 1;
  const done = p.stages.filter((s) => s.status === "done").length + (p.stages[p.stage]?.status === "review" ? 0.9 : 0);
  return Math.round((done / Math.max(1, p.stages.length)) * 100) / 100;
}

/** The waiting stage, when the creator has something to approve. */
export function waiting(p: PipelineView | null): StageRow | null {
  if (!p || p.finished) return null;
  const cur = p.stages[p.stage];
  return cur && cur.status === "review" ? cur : null;
}
