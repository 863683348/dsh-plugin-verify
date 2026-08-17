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

## Usage

```
verify claim "the plugin pins zod in dependencies"           # evidence search in workspace
verify claim "this repo has 12 commits" scope ./some-dir
verify config ./cordis.patch.yml
verify url https://example.com
verify npm dsh-plugin-focus
verify repo 863683348/dsh-plugin-gate
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
