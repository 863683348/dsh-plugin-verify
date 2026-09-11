import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BATCH_TASKS,
  confidenceOf,
  mapPool,
  normalizeTasks,
  renderBatchTable,
  summarizeBatch,
} from "../lib/batch.js";

test("normalizeTasks groups by kind in a stable order", () => {
  const tasks = normalizeTasks({ claims: ["a"], configs: ["c.json"], urls: ["https://x"], packages: ["pkg"], repos: ["o/r"] });
  assert.deepEqual(tasks.map((t) => t.kind), ["claim", "config", "url", "npm", "repo"]);
  assert.equal(tasks[0].value, "a");
  assert.equal(tasks[4].value, "o/r");
});

test("normalizeTasks skips blanks, accepts scalars and caps the list", () => {
  assert.deepEqual(normalizeTasks({ claims: ["  ", ""] }), []);
  assert.equal(normalizeTasks({ urls: "https://x" }).length, 1, "scalar accepted");
  const many = normalizeTasks({ urls: Array.from({ length: 80 }, (_, i) => "https://x/" + i) });
  assert.equal(many.length, MAX_BATCH_TASKS);
  assert.deepEqual(normalizeTasks({}), []);
});

test("mapPool preserves order and bounds concurrency", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = [1, 2, 3, 4, 5, 6];
  const out = await mapPool(items, 2, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 2, "concurrency respected, peak=" + peak);
});

test("mapPool handles empty input and limit larger than list", async () => {
  assert.deepEqual(await mapPool([], 4, async () => 1), []);
  const out = await mapPool([1, 2], 99, async (n) => n + 1);
  assert.deepEqual(out, [2, 3]);
});

test("confidenceOf grades each task kind", () => {
  assert.equal(confidenceOf({ kind: "claim", verdict: "verified", summary: { found: 3 } }).level, "high");
  assert.equal(confidenceOf({ kind: "claim", verdict: "verified", summary: { found: 1 } }).level, "medium");
  assert.equal(confidenceOf({ kind: "claim", verdict: "partial", summary: { found: 1 } }).level, "low");
  assert.equal(confidenceOf({ kind: "claim", verdict: "unsupported", summary: {} }).level, "low");
  assert.equal(confidenceOf({ kind: "url", summary: { status: 200 } }).level, "high");
  assert.equal(confidenceOf({ kind: "url", summary: { status: 301 } }).level, "medium");
  assert.equal(confidenceOf({ kind: "url", summary: {} }).level, "low");
  assert.equal(confidenceOf({ kind: "npm", summary: { exists: true } }).level, "high");
  assert.equal(confidenceOf({ kind: "npm", summary: { exists: false } }).level, "high");
  assert.equal(confidenceOf({ kind: "repo", error: "timeout", summary: { exists: true } }).level, "low");
  assert.equal(confidenceOf({ kind: "config", ok: true }).level, "high");
  assert.equal(confidenceOf({ kind: "config", error: "ENOENT" }).level, "low");
  assert.equal(confidenceOf({ kind: "mystery" }).level, "low");
  assert.ok(Array.isArray(confidenceOf({ kind: "url", summary: { status: 200 } }).basis));
});

test("summarizeBatch rolls up kinds, confidence and failures", () => {
  const results = [
    { kind: "claim", ok: true, confidence: { level: "high" } },
    { kind: "claim", ok: false, confidence: { level: "low" } },
    { kind: "url", ok: true, confidence: { level: "medium" } },
  ];
  const s = summarizeBatch(results);
  assert.equal(s.total, 3);
  assert.deepEqual(s.byKind, { claim: 2, url: 1 });
  assert.deepEqual(s.confidence, { high: 1, medium: 1, low: 1 });
  assert.equal(s.failed, 1);
  assert.ok(s.conclusion.includes("1 of 3"));
  assert.equal(summarizeBatch([]).conclusion, "no tasks supplied");
});

test("renderBatchTable renders and escapes markdown", () => {
  const table = renderBatchTable([
    { kind: "url", value: "https://x", ok: true, confidence: { level: "high" }, detail: "HTTP 200" },
    { kind: "npm", value: "a|b", ok: false, confidence: { level: "low" }, detail: "line1\nline2" },
  ]);
  assert.ok(table.startsWith("| # | Kind | Target | Result | Confidence | Detail |"));
  assert.ok(table.includes("| 1 | url | https://x | ok | high | HTTP 200 |"));
  assert.ok(table.includes("a\\|b"), "pipe escaped in target");
  assert.ok(table.includes("line1 line2"), "newlines flattened");
  assert.equal(renderBatchTable([]), "(no tasks)");
});
