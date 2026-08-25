import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { Job } from "./types.js";

/**
 * Durable persistence for the queue: every mutation is written to disk with
 * a write-to-temp-then-rename so a crash mid-write never leaves a
 * half-written, unparseable file behind. This is deliberately a plain JSON
 * snapshot rather than BullMQ/Redis — the acceptance criteria only require
 * that jobs survive a restart, and a file gives us that without adding an
 * external service dependency to run this repo's tests or CI.
 */
export class JobStore {
  private jobs = new Map<string, Job>();
  /** Job ids whose handler has been observed to run to completion at least
   * once — consulted by the queue so a job replayed after a crash is not
   * re-executed if it already finished. */
  private processed = new Set<string>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load() {
    if (!existsSync(this.filePath)) return;
    const raw = readFileSync(this.filePath, "utf-8").trim();
    if (!raw) return;
    const data = JSON.parse(raw) as { jobs: Job[]; processed: string[] };
    for (const job of data.jobs) this.jobs.set(job.id, job);
    for (const id of data.processed) this.processed.add(id);
  }

  private flush() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    const data = {
      jobs: [...this.jobs.values()],
      processed: [...this.processed],
    };
    writeFileSync(tmpPath, JSON.stringify(data));
    renameSync(tmpPath, this.filePath);
  }

  put(job: Job) {
    this.jobs.set(job.id, job);
    this.flush();
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  all(): Job[] {
    return [...this.jobs.values()];
  }

  markProcessed(id: string) {
    this.processed.add(id);
    this.flush();
  }

  hasProcessed(id: string): boolean {
    return this.processed.has(id);
  }
}
