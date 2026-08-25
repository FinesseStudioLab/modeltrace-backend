import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobQueue } from "./queue.js";

function tempQueueFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "job-queue-test-"));
  return join(dir, "queue.json");
}

const noSleep = () => Promise.resolve();
const noJitter = () => 0;

test("a job handler runs exactly once even if run() is called twice", async () => {
  const filePath = tempQueueFile();
  const queue = new JobQueue({ filePath, sleep: noSleep, random: noJitter });
  let calls = 0;
  queue.registerHandler("noop", async () => {
    calls++;
  });
  const job = queue.enqueue("noop", {});

  await queue.run(job.id);
  await queue.run(job.id);

  assert.equal(calls, 1);
  assert.equal(queue.get(job.id)?.status, "completed");
});

test("idempotency survives a simulated crash-and-restart against the same durable file", async () => {
  const filePath = tempQueueFile();
  let calls = 0;

  const queue1 = new JobQueue({ filePath, sleep: noSleep, random: noJitter });
  queue1.registerHandler("submit-tx", async () => {
    calls++;
  });
  const job = queue1.enqueue("submit-tx", { xdr: "abc" });
  await queue1.run(job.id);
  assert.equal(calls, 1);

  // Simulate a process restart: a brand new queue instance backed by the
  // same durable file, as would happen after a crash and redeploy.
  const queue2 = new JobQueue({ filePath, sleep: noSleep, random: noJitter });
  queue2.registerHandler("submit-tx", async () => {
    calls++;
  });
  const rerun = await queue2.run(job.id);

  assert.equal(calls, 1, "handler must not run twice across a restart");
  assert.equal(rerun.status, "completed");
});

test("a job that keeps failing is retried up to maxAttempts then dead-lettered", async () => {
  const filePath = tempQueueFile();
  const queue = new JobQueue({
    filePath,
    sleep: noSleep,
    random: noJitter,
    defaultMaxAttempts: 3,
  });
  let attempts = 0;
  queue.registerHandler("flaky", async () => {
    attempts++;
    throw new Error("always fails");
  });
  const job = queue.enqueue("flaky", {});

  const result = await queue.run(job.id);

  assert.equal(attempts, 3);
  assert.equal(result.status, "dead-letter");
  assert.equal(queue.deadLetterQueue().length, 1);
  assert.equal(queue.deadLetterQueue()[0]?.lastError, "always fails");
});

test("metrics report queue depth and failure rate", async () => {
  const filePath = tempQueueFile();
  const queue = new JobQueue({
    filePath,
    sleep: noSleep,
    random: noJitter,
    defaultMaxAttempts: 1,
  });
  queue.registerHandler("ok", async () => {});
  queue.registerHandler("bad", async () => {
    throw new Error("nope");
  });

  const okJob = queue.enqueue("ok", {});
  const badJob = queue.enqueue("bad", {});
  const pendingJob = queue.enqueue("ok", {});

  await queue.run(okJob.id);
  await queue.run(badJob.id);

  const metrics = queue.metrics();
  assert.equal(metrics.deadLetterCount, 1);
  assert.equal(metrics.depth, 1); // pendingJob never run
  assert.equal(metrics.failureRate, 0.5); // 1 dead-letter of 2 terminal jobs
  assert.ok(metrics.oldestPendingAgeMs >= 0);
  void pendingJob;
});
