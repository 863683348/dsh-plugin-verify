/**
 * dsh-plugin-verify — verification toolkit for DeepSeek Harness agents.
 *
 * A Cordis plugin. Registers the verify model tool plus prompt guidance.
 * Modes:
 *   claim   — evidence-based statement checking against workspace files
 *             (keywords + line-level citations, verdict verified/partial/unsupported).
 *   config  — JSON strict / YAML smoke validation of a config file.
 *   url     — HTTP(S) availability check (status, redirect target, latency).
 *   npm     — package existence / latest version / dsh.bundle manifest.
 *   repo    — GitHub repo submission-readiness (exists, age, topics, commits).
 *
 * Read-only: never writes files, never executes scanned content.
 *
 * @module dsh-plugin-verify
 */
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  checkGitHubRepo,
  checkNpmPackage,
  checkUrl,
  escapeRegExp,
  extractKeywords,
  scoreClaim,
  validateJson,
  validateYamlSmoke,
} from "./verify.js";

/** Cordis plugin name. */
const name = "verify";

/** Services this plugin must resolve before it applies (host face). */
const inject = ["tools", "fs", "systemPrompt"];

/** Composition-row configuration. */
const Config = z.object({
  /** Hard cap on files walked for claim evidence. */
  maxFiles: z.number().default(500),
  /** Per-file byte cap when reading for claim evidence. */
  maxFileBytes: z.number().default(1024 * 1024),
  /** Cap on total evidence entries returned. */
  maxEvidence: z.number().default(20),
  /** Network probe timeout. */
  timeoutMs: z.number().default(20000),
  /** Register the prompt-guidance section. */
  promptSection: z.boolean().default(true),
  /** Order of the prompt section. */
  sectionOrder: z.number().default(6),
});

/** Prompt guidance for the agent. */
const VERIFY_SECTION_TEXT = "Verification toolkit: use the verify tool before stating something as fact, before trusting a URL/package/repo, and before claiming a file is valid.\n\n- verify claim \"<statement>\" — searches the workspace (or a scope dir) for evidence and returns line-level citations with a verified/partial/unsupported verdict.\n- verify config <path> — validates JSON strictly or YAML structurally (smoke check).\n- verify url <url> — checks HTTP availability.\n- verify npm <package> — checks registry existence, latest version and the dsh.bundle manifest.\n- verify repo <owner/repo> — checks GitHub existence, age, topics (incl. dsh-plugin) and approximate commit count — run it before submitting a plugin to the marketplace.\n\nTreat an unsupported claim verdict as unconfirmed: do not assert it without further evidence.";

/** Walk a directory through ctx.fs and return {rel, target} file lists. */
async function collectFiles(fs, rootTarget, opts, signal) {
  const { maxFiles = 500 } = opts;
  const files = [];
  const queue = [{ target: rootTarget, rel: "." }];
  while (queue.length > 0) {
    const { target, rel } = queue.shift();
    let entries;
    try {
      entries = await fs.listDir(target, signal);
    } catch {
      return files;
    }
    for (const entry of entries) {
      const childRel = rel === "." ? entry.name : rel + "/" + entry.name;
      if (entry.type === "directory") {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".npm-cache") continue;
        queue.push({ target: entry.target, rel: childRel });
      } else if (entry.type === "file") {
        if (entry.name === ".DS_Store") continue;
        if (files.length >= maxFiles) return files;
        files.push({ rel: childRel, target: entry.target });
      }
    }
  }
  return files;
}

/** Read a file as text through ctx.fs with a byte cap; null when unreadable/oversized/binary. */
async function readTextCapped(fs, target, maxBytes, signal) {
  try {
    const text = await fs.readText(target, signal);
    return text.length <= maxBytes ? text : null;
  } catch {
    try {
      const bytes = await fs.readBytes(target, signal, maxBytes);
      let nul = 0;
      for (let i = 0; i < bytes.length && i < 4096; i++) if (bytes[i] === 0) nul += 1;
      return nul > 8 ? null : Buffer.from(bytes).toString("utf8").slice(0, maxBytes);
    } catch {
      return null;
    }
  }
}

/**
 * Register the verify tool and (when configured) the prompt section.
 * @param ctx - registrant context (tools, fs, systemPrompt).
 * @param config - validated plugin configuration.
 */
function apply(ctx, config) {
  /** Walk the workspace for keyword evidence backing a claim. */
  async function runClaim(target, scopeSpec, exec, cwd) {
    const keywords = extractKeywords(target, { max: 12 });
    const rootSpec = scopeSpec || (cwd || ".");
    const rootTarget = await ctx.fs.resolve(rootSpec, cwd !== undefined ? { cwd, signal: exec.signal } : { signal: exec.signal });
    const files = await collectFiles(ctx.fs, rootTarget, { maxFiles: config.maxFiles }, exec.signal);
    const evidence = [];
    const stats = keywords.map((k) => ({ term: k.term, hits: 0 }));
    let filesScanned = 0;
    for (const f of files) {
      const content = await readTextCapped(ctx.fs, f.target, config.maxFileBytes, exec.signal);
      if (content === null) continue;
      filesScanned += 1;
      for (let ki = 0; ki < keywords.length; ki++) {
        const re = new RegExp(escapeRegExp(keywords[ki].term), "gi");
        let count = 0;
        let m;
        while ((m = re.exec(content)) !== null && count < 5) {
          count += 1;
          if (evidence.length < config.maxEvidence) {
            const lineNo = content.slice(0, m.index).split(/\r?\n/).length;
            const lineStart = content.lastIndexOf("\n", m.index - 1) + 1;
            const lineEnd = content.indexOf("\n", m.index);
            evidence.push({
              file: f.rel,
              line: lineNo,
              term: keywords[ki].term,
              snippet: content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd).trim().slice(0, 160),
            });
          }
        }
        stats[ki].hits += count;
      }
    }
    const result = scoreClaim(stats);
    return { verdict: result.verdict, score: result.pct, summary: { found: result.foundCount, total: result.totalCount, pct: result.pct }, evidence, filesScanned };
  }

  ctx.tools.register(defineTool({
    name: "verify",
    description: "Verification toolkit: verify a claim against workspace files with line-level evidence (claim), validate a config file (config, JSON strict / YAML smoke), check an HTTP URL (url), an npm package (npm, incl. dsh.bundle manifest), or a GitHub repo's marketplace submission readiness (repo, incl. dsh-plugin topic, age, commit count). Examples: verify claim \"the plugin pins zod in dependencies\"; verify config ./cordis.patch.yml; verify url https://example.com; verify npm dsh-plugin-focus; verify repo 863683348/dsh-plugin-gate. Batch mode runs many checks at once (claims / configs / urls / packages / repos) with bounded concurrency and grades each result with a confidence level: verify batch claims:[...] urls:[...] packages:[...].",
    parameters: {
      action: {
        type: "string",
        required: true,
        enum: ["claim", "config", "url", "npm", "repo", "batch"],
        description: "What to verify.",
      },
      target: {
        type: "string",
        required: true,
        description: "For claim: the statement. For config: file path. For url: the URL. For npm: package name. For repo: owner/repo.",
      },
      scope: {
        type: "string",
        description: "For claim only: directory to search for evidence (defaults to the session workspace).",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", required: true },
          ok: { type: "boolean", required: true },
          detail: { type: "string", required: true },
          verdict: { type: "string" },
          score: { type: "integer" },
          evidence: { type: "array", items: { type: "object", additionalProperties: false } },
          summary: { type: "object", additionalProperties: false },
        },
      },
      render: (_args, value) => {
        const lines = ["[verify:" + value.action + "] " + (value.ok ? "OK" : "FAIL") + " — " + value.detail];
        if (value.verdict) lines.push("verdict: " + value.verdict + (value.score !== undefined ? " (score " + value.score + ")" : ""));
        if (value.summary) lines.push("summary: " + JSON.stringify(value.summary));
        if (value.table) lines.push("", value.table);
        for (const e of (value.evidence || []).slice(0, 12)) {
          lines.push("  " + e.file + ":" + e.line + " — " + String(e.snippet || "").slice(0, 120));
        }
        return [{ type: "text", text: lines.join("\n") }];
      },
    },
    execute: async (args, exec) => {
      const { action } = args;
      const target = String(args.target || "").trim();
      const cwd = exec.agent && exec.agent.session && exec.agent.session.header ? exec.agent.session.header.cwd : undefined;

      if (action === "batch") {
        const tasks = normalizeTasks({
          claims: args.claims, configs: args.configs, urls: args.urls, packages: args.packages, repos: args.repos,
        });
        if (tasks.length === 0) throw new Error("verify: batch needs at least one of claims / configs / urls / packages / repos");
        const limit = Number.isInteger(args.concurrency) && args.concurrency > 0 ? Math.min(args.concurrency, 8) : 4;
        const raw = await mapPool(tasks, limit, async (task) => {
          try {
            if (task.kind === "claim") {
              const r = await runClaim(task.value, String(args.scope || "").trim(), exec, cwd);
              return { kind: "claim", value: task.value, ok: r.verdict !== "unsupported", verdict: r.verdict, summary: r.summary, detail: r.verdict + " (" + r.summary.found + "/" + r.summary.total + " keywords)" };
            }
            if (task.kind === "config") {
              const t = await ctx.fs.resolve(task.value, cwd !== undefined ? { cwd, signal: exec.signal } : { signal: exec.signal });
              const content = await ctx.fs.readText(t, exec.signal);
              const lower = task.value.toLowerCase();
              if (/^[\s]*[\[{]/.test(content) || lower.endsWith(".json") || lower.endsWith(".jsonc")) {
                const r = validateJson(content);
                return { kind: "config", value: task.value, ok: r.ok, summary: { format: "json" }, detail: r.ok ? "valid JSON" : "invalid JSON: " + r.error };
              }
              const r = validateYamlSmoke(content);
              return { kind: "config", value: task.value, ok: r.ok, summary: { format: "yaml" }, detail: r.ok ? "YAML smoke check passed" : "YAML smoke check failed: " + r.error };
            }
            if (task.kind === "url") {
              const r = await checkUrl(fetch, task.value, { timeoutMs: config.timeoutMs });
              return { kind: "url", value: task.value, ok: r.ok, summary: { status: r.status }, detail: r.ok ? "HTTP " + r.status + " (" + r.timeMs + "ms)" : "unreachable: " + r.error, error: r.ok ? undefined : r.error };
            }
            if (task.kind === "npm") {
              const r = await checkNpmPackage(fetch, task.value, { timeoutMs: config.timeoutMs });
              return { kind: "npm", value: task.value, ok: r.ok && r.exists === true, summary: { exists: r.exists, latest: r.latest, hasDshBundle: r.hasDshBundle }, detail: r.ok ? (r.exists ? task.value + "@" + r.latest : task.value + " does not exist on npm") : "error: " + r.error, error: r.ok ? undefined : r.error };
            }
            const r = await checkGitHubRepo(fetch, task.value, { timeoutMs: config.timeoutMs });
            return { kind: "repo", value: task.value, ok: r.ok && r.exists === true, summary: { exists: r.exists, ageDays: r.ageDays, hasDshTopic: r.hasDshTopic, commitCount: r.commitCount }, detail: r.ok ? (r.exists ? task.value + " exists (" + (r.ageDays === null ? "age n/a" : r.ageDays + " days") + ")" : task.value + " does not exist") : "error: " + r.error, error: r.ok ? undefined : r.error };
          } catch (e) {
            const message = String(e && e.message || e);
            return { kind: task.kind, value: task.value, ok: false, error: message, detail: "error: " + message };
          }
        });
        const graded = raw.map((r) => ({ ...r, confidence: confidenceOf(r) }));
        const batchSummary = summarizeBatch(graded);
        return {
          action: "batch",
          ok: batchSummary.failed === 0,
          detail: batchSummary.conclusion,
          summary: batchSummary,
          results: graded,
          table: renderBatchTable(graded),
        };
      }

      if (target.length === 0) throw new Error("verify: target is required");

      if (action === "claim") {
        const r = await runClaim(target, String(args.scope || "").trim(), exec, cwd);
        return {
          action: "claim",
          ok: r.verdict !== "unsupported",
          detail: "claim evidence check across " + r.filesScanned + " files",
          verdict: r.verdict,
          score: r.score,
          summary: r.summary,
          evidence: r.evidence,
        };
      }

      if (action === "config") {
        const target = await ctx.fs.resolve(args.target, cwd !== undefined ? { cwd, signal: exec.signal } : { signal: exec.signal });
        const content = await ctx.fs.readText(target, exec.signal);
        const lower = String(args.target).toLowerCase();
        const looksJson = /^[\s]*[\[{]/.test(content);
        if (looksJson || lower.endsWith(".json") || lower.endsWith(".jsonc")) {
          const r = validateJson(content);
          return { action: "config", ok: r.ok, detail: r.ok ? "valid JSON" : "invalid JSON: " + r.error, summary: r.ok ? { format: "json", depth: r.depth } : { format: "json" } };
        }
        const r = validateYamlSmoke(content);
        return {
          action: "config",
          ok: r.ok,
          detail: r.ok ? "YAML smoke check passed" : "YAML smoke check failed: " + r.error,
          summary: r.ok ? { format: "yaml", depth: r.depth, note: r.note } : { format: "yaml" },
        };
      }

      if (action === "url") {
        const r = await checkUrl(fetch, target, { timeoutMs: config.timeoutMs });
        return { action: "url", ok: r.ok, detail: r.ok ? "HTTP " + r.status + " (" + r.timeMs + "ms)" : "unreachable: " + r.error, summary: { status: r.status, finalUrl: r.finalUrl, timeMs: r.timeMs } };
      }

      if (action === "npm") {
        const r = await checkNpmPackage(fetch, target, { timeoutMs: config.timeoutMs });
        return {
          action: "npm",
          ok: r.ok && r.exists === true,
          detail: r.ok ? (r.exists ? target + "@" + r.latest + (r.hasDshBundle ? " (dsh bundle)" : " (no dsh.bundle)") : target + " does not exist on npm") : "error: " + r.error,
          summary: { exists: r.exists, latest: r.latest, hasDshBundle: r.hasDshBundle, publishedAt: r.publishedAt, description: r.description },
        };
      }

      if (action === "repo") {
        const r = await checkGitHubRepo(fetch, target, { timeoutMs: config.timeoutMs });
        return {
          action: "repo",
          ok: r.ok && r.exists === true,
          detail: r.ok ? (r.exists ? target + " — " + (r.ageDays === null ? "age n/a" : r.ageDays + " days old") + (r.hasDshTopic ? ", dsh-plugin topic" : ", no dsh-plugin topic") + (r.commitCount ? ", ~" + r.commitCount + " commits" : "") : target + " does not exist") : "error: " + r.error,
          summary: {
            exists: r.exists,
            defaultBranch: r.defaultBranch,
            ageDays: r.ageDays,
            pushedAt: r.pushedAt,
            topics: r.topics,
            hasDshTopic: r.hasDshTopic,
            commitCount: r.commitCount,
            description: r.description,
          },
        };
      }

      throw new Error("verify: unknown action " + action);
    },
    presentCall: (args) => ({
      card: "generic",
      title: "Verify: " + args.action + " " + String(args.target || "").slice(0, 40),
      kind: "other",
      rawInput: args,
    }),
  }));

  if (config.promptSection) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: "verify:instructions",
      order: config.sectionOrder,
      text: VERIFY_SECTION_TEXT,
    }), "verify.section()");
  }
}

export { Config, VERIFY_SECTION_TEXT, apply, inject, name };
