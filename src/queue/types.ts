export type JobStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "dead-letter";

export interface Job<P = unknown> {
  id: string;
  type: string;
  payload: P;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export type JobHandler<P = unknown> = (payload: P, job: Job<P>) => Promise<void>;

export interface QueueMetrics {
  /** Jobs waiting to run. */
  depth: number;
  /** Age in ms of the oldest pending job, or 0 if the queue is empty. */
  oldestPendingAgeMs: number;
  /** completed / (completed + failed-terminal) over all jobs seen. */
  failureRate: number;
  deadLetterCount: number;
}
