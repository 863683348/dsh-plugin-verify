# dsh-plugin-verify

**Verification toolkit for DeepSeek Harness agents** — evidence-based claim checking, config validation, and read-only network probes (URL / npm / GitHub).

## Tools

| Tool | Mode | What it does |
|---|---|---|
| `verify` | `claim` | Verify a statement against workspace files: keyword extraction, per-keyword hits with **line-level citations**, verdict `verified` / `partial` / `unsupported` |
| | `config` | Validate a config file — JSON strict parse or YAML structural smoke check |
| | `url` | HTTP(S) availability: status, redirect target, latency |
| | `npm` | Registry check: exists, latest version, `dsh.bundle` manifest, publish time |
| | `repo` | GitHub submission-readiness: exists, age, `dsh-plugin` topic, approximate commit count |
| | `batch` | Run many checks at once (`claims` / `configs` / `urls` / `packages` / `repos`) with bounded concurrency, a summary table and a per-result confidence grade |

## Usage

```
verify claim "the plugin pins zod in dependencies"           # evidence search in workspace
verify claim "this repo has 12 commits" scope ./some-dir
verify config ./cordis.patch.yml
verify url https://example.com
verify npm dsh-plugin-focus
verify repo 863683348/dsh-plugin-gate
verify batch claims:["the plugin pins zod"] urls:["https://example.com"] packages:["dsh-plugin-focus"]
```

## Notes

- Read-only: never writes files, never executes scanned content.
- Claim verification is a heuristic (keyword evidence), not proof — an `unsupported` verdict means "no evidence found", treat it as unconfirmed.
- YAML check is a structural smoke check (balanced quotes/brackets, indentation), not a full YAML parser.

## Development

```bash
node --check lib/*.js
node test/verify.test.mjs
```

## License

MIT


## Roadmap

See [ROADMAP.md](./ROADMAP.md) — next five versions (v1.1.0 – v1.5.0): batch & confidence, reports & regression, strict validation, probe hardening, submission-readiness expansion.
