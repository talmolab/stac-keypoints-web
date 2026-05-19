// @vitest-environment happy-dom
//
// Exercises the run/pending pattern from useAutoIk in isolation. The hook
// itself needs React + a testing-library; we don't want that dep just for one
// test. The pattern under test:
//
//   if (running) { pending = true; return; }
//   running = true; pending = false;
//   try { await run(); } finally {
//     running = false;
//     if (pending) { pending = false; selfCall(); }
//   }
//
// Before the fix, edits during an in-flight run were silently dropped.
// After the fix, the last edit always triggers a final run.

import { describe, it, expect } from "vitest";

function makeQueue(work: () => Promise<void>) {
  let running = false;
  let pending = false;
  let runCount = 0;
  async function trigger() {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    pending = false;
    try {
      runCount++;
      await work();
    } finally {
      running = false;
      if (pending) {
        pending = false;
        trigger();
      }
    }
  }
  return { trigger, get runs() { return runCount; }, isRunning: () => running };
}

// Each work() call gets a fresh promise so we can release runs independently.
function makeReleasable() {
  let release: () => void = () => {};
  const work = () => new Promise<void>((res) => { release = res; });
  return { work, release: () => release() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("auto-IK run/pending queue", () => {
  it("re-runs once after the in-flight pass when an edit arrived mid-run", async () => {
    const r = makeReleasable();
    const q = makeQueue(r.work);

    void q.trigger();                  // first run starts, not yet resolved
    expect(q.runs).toBe(1);
    expect(q.isRunning()).toBe(true);

    void q.trigger();                  // mid-flight edit: queued
    void q.trigger();                  // another mid-flight edit: coalesced
    expect(q.runs).toBe(1);

    r.release();                       // finish first run
    await tick();

    expect(q.runs).toBe(2);            // exactly one re-run, not two
    expect(q.isRunning()).toBe(true);  // re-run is now in flight

    r.release();                       // finish re-run
    await tick();
    expect(q.runs).toBe(2);
    expect(q.isRunning()).toBe(false);
  });

  it("does not re-run if no edits arrived during the run", async () => {
    const r = makeReleasable();
    const q = makeQueue(r.work);

    void q.trigger();
    r.release();
    await tick();

    expect(q.runs).toBe(1);
    expect(q.isRunning()).toBe(false);
  });

  it("each successive edit while idle triggers its own run", async () => {
    const r = makeReleasable();
    const q = makeQueue(r.work);

    void q.trigger();
    r.release();
    await tick();
    void q.trigger();
    r.release();
    await tick();

    expect(q.runs).toBe(2);
  });
});
