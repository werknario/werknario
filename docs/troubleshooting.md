# Troubleshooting

Common problems and what to do about them. Each entry states the symptom you
see, the cause underneath it, and the fix. An agent here means software that
carries a task through to the end, not just answers, so several of these entries
are about the agent doing exactly the right thing (blocking a merge, refusing to
invent a number) in a way that can read as a failure the first time.

If your problem is not here, [faq.md](faq.md) covers the "why does it work this
way" questions, and [configuration.md](configuration.md) is the full list of
every environment variable and flag the code actually reads.

## `werknario: command not found`

**Symptom.** After `npm install` and `npm run build`, running
`werknario "some task"` prints `command not found` (`zsh: command not found:
werknario` or similar).

**Cause.** A source build bundles the CLI to a single file at
`packages/cli/dist/cli.js`. Nothing in `npm install` puts a `werknario` command
on your PATH. The bare command exists only inside the Docker image, which places
it on PATH deliberately.

**Fix.** Run the built file directly with node, and use this form in every
runnable step:

```bash
node packages/cli/dist/cli.js "some task"
node packages/cli/dist/cli.js verify .werknario/audit.jsonl
```

Optional, once, if you would rather type the short name: link it onto your PATH.

```bash
cd packages/cli && npm link
werknario "some task"
```

After `npm link` the short `werknario` form works. Do not mix the two forms
inside one sequence you copy-paste; pick node or pick the linked name.

## The demo output is in German

**Symptom.** The local offline demo narrates in German (`Ich lese zuerst die
Notiz`, `Entwurf vorgelegt …`) and writes files under `mock-substrate-musik/`,
even though your terminal and prompt are in English.

**Cause.** The bundled demo substrate is a German-language music-label example.
The mock backend is seeded with one German session note, and the agent follows
the substrate's language. Nothing about werknario is fixed to German.

**Fix.** Nothing to fix; this is expected. To see the agent work in English,
point it at your own repository, where it reads and writes in that repo's
language. See [backends.md](backends.md) for the GitLab and GitHub setup and
[getting-started.md](getting-started.md#step-4--your-first-real-run) for a first
real run.

## Build fails, or the CLI errors on a syntax it should accept

**Symptom.** `npm install` warns `EBADENGINE`, or `npm run build` fails, or
`node packages/cli/dist/cli.js …` throws a syntax error that looks like the
runtime does not understand modern JavaScript.

**Cause.** Node older than 20. The repo's `engines` field requires `>=20`, and
the build and runtime assume it.

**Fix.** Check your version and upgrade if needed.

```bash
node --version   # must be 20 or newer
```

If the version is fine but the build is still broken, do a clean install so a
stale `node_modules` is not the problem:

```bash
rm -rf node_modules
npm install
npm run build
```

`npm run build` re-bundles the CLI to `packages/cli/dist/cli.js`, which is the
file every command in the docs runs.

## `verify` reports `BROKEN` instead of `verified`

**Symptom.** Instead of

```
Audit .werknario/audit.jsonl — chain verified (8 entries, genesis mock/demo).
```

you get

```
Audit .werknario/audit.jsonl — chain BROKEN at entry 4: hash does not match recomputed value.
```

and the command exits non-zero.

**Cause.** A line in the audit file was edited, deleted, reordered, or inserted.
The log is a hash chain, not a signature: every entry's `hash` is computed over
its own fields plus the previous line's `hash`, so any change makes the first
affected entry stop matching its recomputed value. `verify` walks the chain from
the start and reports the earliest entry that no longer holds up. This is the log
working as designed; it is tamper-evident.

**Fix.** Do not hand-edit `.werknario/audit.jsonl`. It is append-only, written by
the CLI. If the break is unexpected, restore the file from version control or
re-run the flow to produce a fresh log.

Two honest limits that also produce a surprising result here:

- If the log was created for a specific repository and you want the strict check
  that also catches a rewritten first entry, pass the original genesis:
  `node packages/cli/dist/cli.js verify .werknario/audit.jsonl --genesis owner/repo`.
  Without `--genesis`, verify reads the genesis from the file's own first line,
  which still catches tampering in the middle of the chain.
- `verify` cannot detect tail truncation on its own. A log with its last entries
  chopped off is still a valid chain from the start, so it verifies clean. The
  mitigation is external: when the CLI opens a merge request it stamps the current
  chain head into the request description, so the Git server holds a reference the
  local file cannot rewrite. The full account is in
  [audit-and-trust.md](audit-and-trust.md).

A related message, `No audit file at <path>`, means the path is wrong or the run
never produced a log; check you are in the working directory where the run
happened.

## Provider auth fails at the first model call

**Symptom.** The run starts, reads a file or two, then throws as soon as it needs
the model. The exact message depends on which provider you selected.

**Cause.** `LLM_PROVIDER` is set, but the credentials or endpoint that provider
needs are missing or wrong. Each provider reads its own environment, and a
missing value surfaces only when the first call is made. Known shapes:

- `openai-compatible` with no base URL throws
  `LLM_PROVIDER=openai-compatible braucht LLM_OPENAI_COMPAT_BASE_URL (z. B.
  https://api.mistral.ai/v1).`
- `bedrock` without the optional SDK throws `LLM_PROVIDER=bedrock requires the
  optional "@anthropic-ai/bedrock-sdk" package, which is not installed.`
- `anthropic` or any `openai-compatible` endpoint with a missing or invalid key
  returns an HTTP `401`/`403` from the vendor, which werknario surfaces (for
  team-visible actions, as "Access to the document store was denied" with the
  hint to check the token).

**Fix.** Set the environment for the provider you chose. The variables each one
reads:

| `LLM_PROVIDER` | Needs |
|---|---|
| `mock` | Nothing. Fully offline, no credentials. |
| `anthropic` | `CLAUDE_API_TOKEN` (or `ANTHROPIC_API_KEY`). |
| `bedrock` | `AWS_REGION`, AWS credentials, and the optional `@anthropic-ai/bedrock-sdk` package installed. |
| `openai-compatible` | `LLM_OPENAI_COMPAT_BASE_URL`, `LLM_OPENAI_COMPAT_API_KEY`, and `LLM_MODEL`. |

To confirm the rest of your setup without any credentials, run the flow against
the mock provider first:

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

Full per-provider configuration is in
[providers-and-models.md](providers-and-models.md) and
[configuration.md](configuration.md).

## GitLab or GitHub backend errors, including token scope

**Symptom.** One of two things. Either the CLI refuses to start with

```
GitLab backend needs GITLAB_TOKEN and GITLAB_PROJECT_ID (and optionally GITLAB_BASE_URL).
```

or

```
GitHub backend needs GITHUB_TOKEN and GITHUB_REPO (owner/repo).
```

Or the run gets as far as opening or merging a request and then fails with a
message about denied access or missing permission (a `401` or `403` from the
forge).

**Cause.** For the first form, the backend is selected but its required
environment is missing. For the second, the token is present but does not carry
the scope the action needs. werknario reads the project and its file tree,
creates branches, commits, opens and merges requests, and comments, so a
read-only token is not enough.

**Fix.** Set the environment, then check the token scope.

- GitLab: `WERKNARIO_BACKEND=gitlab`, `GITLAB_BASE_URL` (defaults to
  `https://gitlab.com`), `GITLAB_PROJECT_ID` (numeric or the URL-encoded
  `group/project` path), and `GITLAB_TOKEN` with the `api` scope.
- GitHub: `WERKNARIO_BACKEND=github`, `GITHUB_REPO=owner/repo`, and
  `GITHUB_TOKEN`. A classic PAT needs the `repo` scope; a fine-grained PAT needs
  Contents (read and write) and Pull requests (read and write) on the target
  repository.

If `WERKNARIO_BACKEND` is unset, the CLI defaults to GitHub when `GITHUB_REPO`
is present and to GitLab otherwise, so an unexpected backend usually means you
set one repo variable but meant the other. One rollback caveat: a GitHub revert
needs the merge commit SHA captured at merge time; without it the CLI tells you
to trigger the revert through the GitHub UI instead. GitHub revert is a
simplified tree swap, not a three-way `git revert`. See [backends.md](backends.md)
for both forges in detail.

## Things that look like failures but are working as intended

**A merge does not go through.** The gateway merges only when the forge reports
the request as mergeable. Every other status blocks: a pipeline still running,
unresolved discussions, a conflict, a draft. An unattended `--yes` run will not
merge past an unfinished check. Resolve the underlying state on the forge, then
re-run. See [backends.md](backends.md).

**The merge request is hard-blocked over a citation.** The grounding gate blocks
a fabricated citation, a claim that cites a file or line the agent never read in
this session, and it hard-blocks the merge request or comment. This is not a bug;
it is the agent being stopped from asserting something it cannot ground. The
separate number-coverage check is advisory and does not block. Details in
[grounding.md](grounding.md).

**The run stops partway with `stopped: "budget"`.** You passed `--budget <usd>`
(or set `WERKNARIO_BUDGET_USD`) and the accumulated cost reached the limit. The
run closes out cleanly rather than mid-call. Raise the budget or drop the flag to
let it finish. There is a warning at 80% of the limit before it stops.

**A write is refused by the path policy.** A permission policy at
`.werknario/policy.json` controls which paths the agent may write. A proposal
outside the allowed paths is refused. If you see the offline demo print
`no policy file at .werknario/policy.json — agent:assistant may write any path`,
that is the opposite case: with no policy present, nothing constrains the paths.
A named approver role is defined and tested but not yet enforced, so treat the
path policy as the live guardrail today. See [permissions.md](permissions.md).

## See also

- [getting-started.md](getting-started.md) — the onboarding spine, offline demo
  through first real run.
- [configuration.md](configuration.md) — every environment variable and flag.
- [providers-and-models.md](providers-and-models.md) — provider setup and the
  data-residency flag.
- [audit-and-trust.md](audit-and-trust.md) — the hash chain and where its
  guarantee stops.
- [faq.md](faq.md) — the questions behind the behavior.
