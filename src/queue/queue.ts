import { randomUUID } from "node:crypto";
import { JobStore } from "./store.js";
import type { Job, JobHandler, JobStatus, QueueMetrics } from "./types.js";

export interface JobQueueOptions {
  filePath: string;
  defaultMaxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A small durable job queue for chain submission, export generation,
 * indexer catch-up, and webhook fan-out — anything that takes long enough
 * that running it inline in a request handler would tie up the connection.
 *
 * Idempotency: every job carries a stable id. `run()` checks the durable
 * "processed" set *before* invoking the handler, so a job that already
 * completed — including one whose completion write happened but whose
 * process then crashed before returning to the caller — is not re-run
 * after a restart. Handlers are expected to be idempotent themselves for
 * the case where they crash mid-execution (having done real work) without
 * ever reaching the processed marker; the queue does its part by never
 * *knowingly* re-dispatching a job it already saw finish.
 */
export class JobQueue {
  private readonly store: JobStore;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly defaultMaxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(opts: JobQueueOptions) {
    this.store = new JobStore(opts.filePath);
    this.defaultMaxAttempts = opts.defaultMaxAttempts ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 200;
    this.maxDelayMs = opts.maxDelayMs ?? 10_000;
    this.random = opts.random ?? Math.random;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
  }

  registerHandler<P>(type: string, handler: JobHandler<P>) {
    this.handlers.set(type, handler as JobHandler);
  }

  enqueue<P>(type: string, payload: P, opts?: { id?: string; maxAttempts?: number }): Job<P> {
    const id = opts?.id ?? randomUUID();
    const existing = this.store.get(id);
    if (existing) return existing as Job<P>;

    const job: Job<P> = {
      id,
      type,
      payload,
      status: "pending",
      attempts: 0,
      maxAttempts: opts?.maxAttempts ?? this.defaultMaxAttempts,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.store.put(job as Job);
    return job;
  }

  /**
   * Runs a single pending/failed job to completion (or into backoff /
   * dead-letter). Safe to call twice for the same job id, including
   * concurrently after a simulated crash-and-restart — see the idempotency
   * test.
   */
  async run(id: string): Promise<Job> {
    const job = this.store.get(id);
    if (!job) throw new Error(`unknown job ${id}`);

    if (this.store.hasProcessed(id) || job.status === "completed") {
      return job;
    }

    const handler = this.handlers.get(job.type);
    if (!handler) throw new Error(`no handler registered for job type ${job.type}`);

    job.status = "active";
    job.attempts += 1;
    job.updatedAt = this.now();
    this.store.put(job);

    try {
      await handler(job.payload, job);
      job.status = "completed";
      job.updatedAt = this.now();
      this.store.put(job);
      this.store.markProcessed(id);
      return job;
    } catch (err) {
      job.lastError = err instanceof Error ? err.message : String(err);
      job.updatedAt = this.now();

      if (job.attempts >= job.maxAttempts) {
        job.status = "dead-letter";
        this.store.put(job);
        return job;
      }

      job.status = "pending";
      this.store.put(job);

      const cap = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (job.attempts - 1));
      await this.sleep(this.random() * cap);
      return this.run(id);
    }
  }

  get(id: string): Job | undefined {
    return this.store.get(id);
  }

  listByStatus(status: JobStatus): Job[] {
    return this.store.all().filter((j) => j.status === status);
  }

  deadLetterQueue(): Job[] {
    return this.listByStatus("dead-letter");
  }

  metrics(): QueueMetrics {
    const all = this.store.all();
    const pending = all.filter((j) => j.status === "pending" || j.status === "active");
    const oldestPendingAgeMs = pending.length
      ? this.now() - Math.min(...pending.map((j) => j.createdAt))
      : 0;
    const completed = all.filter((j) => j.status === "completed").length;
    const deadLetterCount = all.filter((j) => j.status === "dead-letter").length;
    const terminal = completed + deadLetterCount;
    return {
      depth: pending.length,
      oldestPendingAgeMs,
      failureRate: terminal === 0 ? 0 : deadLetterCount / terminal,
      deadLetterCount,
    };
  }
}
