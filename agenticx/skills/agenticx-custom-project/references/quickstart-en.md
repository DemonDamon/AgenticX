# Quick start (English)

For readers who do not read Chinese. The script prints Chinese text, but `classify --json` returns English keys (`action`, `allow_submit_issue`, `allow_submit_pr`, `must_check_upstream`, `upstream_claim`) that any agent can act on. On Windows, use `py -3` instead of `python3` and backslashes in paths. Set `PYTHONUTF8=1` if Chinese output is garbled.

## When to use

- Starting a custom or client project on AgenticX.
- Deciding whether a bug or feature stays in your repo, or goes upstream to [DemonDamon/AgenticX](https://github.com/DemonDamon/AgenticX) as an issue or pull request.
- Drafting that issue or PR without leaking client data.

Not for: chatting in the Near desktop app, or a five-minute hello-world agent.

## Three commands

```bash
python3 scripts/custom_project.py doctor          # Python, git, agx, network, PyPI version, new agx commands
python3 scripts/custom_project.py plan --mode depend --stack python --name my-agent
python3 scripts/custom_project.py classify --kind bug --where runtime --cause-clear yes --size small --json
```

`plan --write` creates a business skeleton only. It never clones upstream, never changes git remotes, and refuses to overwrite a non-empty folder.

## Init modes

| Situation | Flags |
| --- | --- |
| Business code in Python, framework untouched | `--mode depend --stack python` (default) |
| Another language calling the local `agx serve` | `--mode depend --stack node` |
| Only using the desktop app | `--mode depend --stack desktop` |
| Must patch framework source and track upstream | `--mode fork` (client code in a separate repo) |
| Can only carry a small slice of the runtime | `--mode vendor` |

## `--where` values

| Value | Meaning |
| --- | --- |
| `business` | Client flows, copy, rules, UI in your own repo |
| `runtime` (alias `harness`) | Python runtime, SDK, `agx`, engine bridges |
| `desktop` | Near desktop app |
| `protocol` | Interfaces both sides must agree on |
| `enterprise` | Upstream `enterprise/` (portal, admin console, gateway) |
| `client` (aliases `mobile`, `extension`) | Upstream `mobile/` app and `extension/` browser extension |

## Decision summary

| Case | Outcome |
| --- | --- |
| Client copy, styling, rules | Stay local. Do not check upstream |
| Small bug with a known root cause, even in the shared runtime | Fix locally. No network, no PR now |
| Reusable new capability, upstream not checked | Check only the related directories and matching issues |
| Upstream already has it | Upgrade or port the minimum. Do not rewrite |
| Checked, upstream lacks it, generic | Minimal upstream PR with tests. Client parts stay local |
| `enterprise` or `client` | Issue first. PR only after a maintainer agrees in that issue |
| Secret leaked in a business repo | Rotate locally. No public issue |

Business delivery never waits for upstream review or merge.

## Never

- Claim an issue or PR was submitted unless `submit --execute` returned a link.
- Put client names, secrets, internal addresses, or real business data into public text. Use `draft --hide "<name>"`.
- Push to upstream `main`, or reset/rebase/overwrite the user's work.
- Run `agx case compile --push` without explicit user approval. By default the case entry stays local.

Release check before publishing this skill: `python3 scripts/custom_project.py self-test` (offline; also checks that `SKILL.md` versions, reference links, and documented `--where` values match the script).
