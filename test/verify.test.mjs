import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkGitHubRepo,
  checkNpmPackage,
  checkUrl,
  escapeRegExp,
  extractKeywords,
  scoreClaim,
  validateJson,
  validateYamlSmoke,
} from "../lib/verify.js";

test("extractKeywords keeps CJK runs, real words, numbers; drops stopwords and dupes", () => {
  const kw = extractKeywords("这个插件是否使用了 fetch 进行网络请求 with the URL https://example.com in 2026?");
  const terms = kw.map((k) => k.term);
  assert.ok(terms.includes("这个插件是否使用了"), "CJK run kept: " + terms.join(","));
  assert.ok(terms.includes("fetch"));
  assert.ok(terms.includes("url"));
  assert.ok(terms.includes("2026"), "number kept");
  assert.ok(!terms.includes("with") && !terms.includes("the") && !terms.includes("in"));
  assert.equal(new Set(terms).size, terms.length, "dedup");
});

test("extractKeywords respects the max", () => {
  const kw = extractKeywords("one two three four five six seven eight nine ten eleven twelve thirteen", { max: 5 });
  assert.ok(kw.length <= 5);
});

test("scoreClaim verdict thresholds", () => {
  assert.equal(scoreClaim([{ term: "a", hits: 1 }, { term: "b", hits: 1 }, { term: "c", hits: 0 }]).verdict, "verified");
  assert.equal(scoreClaim([{ term: "a", hits: 1 }, { term: "b", hits: 0 }]).verdict, "partial");
  assert.equal(scoreClaim([{ term: "a", hits: 0 }, { term: "b", hits: 0 }]).verdict, "unsupported");
  assert.equal(scoreClaim([]).verdict, "unsupported");
  assert.equal(scoreClaim([{ term: "a", hits: 2 }]).pct, 100);
});

test("escapeRegExp neutralizes special characters", () => {
  const re = new RegExp(escapeRegExp("a.b(c)"), "i");
  assert.ok(re.test("see a.b(c) here"));
  assert.ok(!re.test("see axbxc here"));
});

test("validateJson accepts valid and rejects invalid", () => {
  const ok = validateJson('{"a": [1, 2, {"b": true}]}');
  assert.equal(ok.ok, true);
  assert.equal(ok.kind, "object");
  const bad = validateJson('{"a": }');
  assert.equal(bad.ok, false);
  assert.ok(bad.error);
});

test("validateYamlSmoke balances quotes and brackets", () => {
  assert.equal(validateYamlSmoke("key: value\nlist:\n  - a\n  - b\n").ok, true);
  const unclosed = validateYamlSmoke("key: 'value");
  assert.equal(unclosed.ok, false);
  assert.match(unclosed.error, /quote/);
  const unbalanced = validateYamlSmoke("a: [1, 2");
  assert.equal(unbalanced.ok, false);
  assert.match(unbalanced.error, /unclosed|unbalanced/);
  assert.equal(validateYamlSmoke("   ").ok, false);
});

test("checkUrl reports status and redirect target", async () => {
  const fake = async (url, init) => ({ ok: true, status: 200, url: "https://final.example/x" });
  const r = await checkUrl(fake, "https://example.com/");
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.finalUrl, "https://final.example/x");
  const fail = async () => { throw new Error("ECONNREFUSED"); };
  const e = await checkUrl(fail, "https://x.example");
  assert.equal(e.ok, false);
  assert.match(e.error, /ECONNREFUSED/);
});

test("checkNpmPackage detects dsh bundle and missing packages", async () => {
  const fake = async (url) => {
    if (url.includes("missing-pkg")) return { status: 404 };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        name: "fake",
        "dist-tags": { latest: "2.0.0" },
        description: "a fake package",
        time: { "2.0.0": "2026-01-01T00:00:00.000Z" },
        versions: { "2.0.0": { version: "2.0.0", dsh: { bundle: { patch: "x.yml" } } } },
      }),
    };
  };
  const good = await checkNpmPackage(fake, "fake");
  assert.equal(good.exists, true);
  assert.equal(good.latest, "2.0.0");
  assert.equal(good.hasDshBundle, true);
  const missing = await checkNpmPackage(fake, "missing-pkg");
  assert.equal(missing.exists, false);
});

test("checkGitHubRepo reads topics, age and commit count from Link header", async () => {
  const fake = async (url) => {
    if (url.includes("nope%2Fnope")) return { status: 404, ok: false };
    if (url.includes("/commits?per_page=1")) {
      return { ok: true, headers: { get: () => '<https://api.github.com/repos/o/r/commits?per_page=1&page=42>; rel="last"' } };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        full_name: "o/r",
        created_at: "2026-01-01T00:00:00Z",
        pushed_at: "2026-08-01T00:00:00Z",
        default_branch: "main",
        topics: ["dsh-plugin", "cordis"],
        description: "desc",
      }),
    };
  };
  const r = await checkGitHubRepo(fake, "o/r");
  assert.equal(r.exists, true);
  assert.equal(r.hasDshTopic, true);
  assert.ok(r.ageDays >= 30);
  assert.equal(r.commitCount, 42);
  const missing = await checkGitHubRepo(fake, "nope/nope", {});
  assert.equal(missing.exists, false);
});
