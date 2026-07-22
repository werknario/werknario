# FAQ

Short answers to the questions people ask first. Each one links to the page
that covers it in full. New here? Start with
[getting-started.md](getting-started.md).

## Why not just point a coding agent at a docs repo?

Aider or OpenHands will happily edit files and open a pull request. So will
werknario. The difference is not that an agent can write documents. An agent
here is software that carries a task through to the end, not just answers, and
plenty of tools do that much. The difference is what stands between the model
and a merged change, and whether you can check the result afterwards instead of
trusting it.

- A citation gate runs before the merge request exists. If the agent claims
  something and cites a file or line it never read this session, the proposal is
  blocked before anything is opened. A generic coding agent has no such gate, so
  a confident fabrication becomes a diff (a line-by-line list of exactly what
  changed). See [grounding.md](grounding.md).
- A path permission policy decides which paths the agent may write.
  `.werknario/policy.json` scopes an agent to path globs, so a task about one
  folder cannot rewrite the whole repository. See [permissions.md](permissions.md).
- The approver is a human reading a diff, not code. Every write and the merge
  itself pause for a human `yes` in the terminal, so a non-developer can hold the
  gate.
- The log is offline-verifiable. Every step is a hash-chained entry (each line
  carries a fingerprint of the line before it, so any later edit shows up), and
  `node packages/cli/dist/cli.js verify .werknario/audit.jsonl` exits non-zero if
  the chain breaks. See [audit-and-trust.md](audit-and-trust.md).

Said as one line: every change is a reviewable diff, proposed by a named agent
and approved by a named human, and the whole history can be verified rather than
trusted.

## Does my data leave the EU?

Your documents stay in your Git repository (GitLab or GitHub). The only thing
that leaves is what the agent sends to the model you configured, and you choose
that model.

The residency check is enforced at CLI startup, before any model call, not just
claimed in the docs. Every model in the registry
(`packages/shared/src/models.ts`) carries a `dataResidency` flag: `eu`,
`self-host`, or `non-eu`, and the router works out a route's residency like this:

- `mock` is exempt: it runs locally and no data leaves the machine.
- `bedrock` counts as EU only when `AWS_REGION` starts with `eu-` (for example
  `eu-central-1`); any other region is treated as non-EU.
- `anthropic`, the direct API, is US-based, so it is non-EU and blocked by
  default even for a Claude model id.
- `openai-compatible` follows the registry: `mistral-large-3` and the
  `*-ovhcloud` and `*-selfhost` entries are EU or self-host; the direct
  `kimi-k2` and `deepseek` entries are non-EU. A model id the registry does not
  recognise is treated as non-EU, so the failure is safe rather than a silent
  leak.

A non-EU route is blocked with a clear message before any model call. If you
have to use one, set `WERKNARIO_ALLOW_NON_EU=1`: the CLI prints a warning and
proceeds. Use that only for data that carries no personal information. The
production default, Anthropic via AWS Bedrock on the EU inference profile in an
`eu-` region, needs no override. See
[providers-and-models.md](providers-and-models.md) for the residency table and
[configuration.md](configuration.md) for the environment variables.

If you want nothing to leave your own network at all, run a self-hosted model
(an open-weights model running on a machine you control, so no request leaves
your network) and point the OpenAI-compatible provider at it. See the
self-hosting question below.

## Is the audit log a signature?

No. It is a hash chain, not a signature, and the difference matters. Each entry
is hashed together with the hash of the entry before it, so silent tampering in
the middle of the chain (editing an entry, deleting one, reordering, or
inserting one) breaks the links. `verify` replays the chain from the genesis and
exits non-zero if it does not check out.

What a hash chain does not do is prove who wrote an entry. Nothing yet signs
entries with a key that only the legitimate actor holds, so treat the log as
tamper-evident, not non-repudiable. There is also one case `verify` cannot catch
on its own: truncating the tail. Deleting the last entries leaves a chain that
still verifies from the genesis, because a local file has no way to know an entry
should follow its last one. The mitigation is an external anchor. When the CLI
opens a merge request it stamps the current chain head into the request
description, so a log later shortened below that point no longer matches the
anchor the Git server holds. Signing with Sigstore is planned, not built. The
full account of what the chain does and does not cover is in
[audit-and-trust.md](audit-and-trust.md).

## Does it write to my repository without my approval?

No. Every write and the merge itself pause for an explicit human `yes`, and
nothing reaches your repository until you give it. The agent shows you the diff
first each time.

`--yes` is the one explicit override: it runs unattended and auto-approves the
prompts, for a scripted or CI context where no human is at the terminal. That is
a deliberate opt-in, never the default. `--dry-run` goes the other way and
previews the whole run without opening anything.

If the approver is not a developer, they do not touch the terminal at all. They
review and confirm each step in the VS Code Web IDE extension surface, where the
same diff and the same `yes` show up as buttons rather than a command line.

A note on the policy file: `.werknario/policy.json` can list named approver roles
per path. That schema is defined and unit-tested, but nothing in the CLI or the
extension enforces it yet. Today "approve" means whoever runs the CLI or the
extension confirms the prompt; there is no check that they are one of the listed
approvers. Read the approver role as design, not an enforced control. See
[permissions.md](permissions.md).

## Which models can I use?

Four providers exist, all built and tested, selected with `LLM_PROVIDER`:

- `mock`: deterministic scripted responses, no network or credentials. Used by
  tests, CI, and the local offline demo.
- `anthropic`: calls `api.anthropic.com` directly. For environments explicitly
  allowed to bypass the EU-residency default.
- `bedrock`: Anthropic via AWS Bedrock on the EU inference profile. The
  production default.
- `openai-compatible`: any OpenAI-style chat-completions endpoint. This one
  provider covers Mistral, Kimi, DeepSeek, Qwen, and self-hosted vLLM or SGLang
  servers.

The model registry carries a price (input, output, cache write, cache read, with
a `verifiedOn` date, or `null` when not confirmed), a context window, a tool-use
flag, and the data-residency flag for each model. A deterministic router
(`--route`) can pick a cheaper model for simple steps and a stronger one for
sensitive paths, and a token budget (`--budget <usd>`) stops a run once it costs
a set amount. Adding a new model is one entry in the registry, not a rewrite of
the agent. Full detail in [providers-and-models.md](providers-and-models.md).

## Can I self-host the model fully?

Yes. Run an open-weights model on your own hardware with a vLLM or SGLang server
that speaks the OpenAI chat-completions format, then set:

```bash
export LLM_PROVIDER=openai-compatible
export LLM_OPENAI_COMPAT_BASE_URL=http://your-host:8000/v1
export LLM_OPENAI_COMPAT_API_KEY=...
export LLM_MODEL=kimi-k2-instruct-selfhost
```

On Windows, or to keep tokens out of your shell history, put these in a `.env`
file (copy `.env.example`) instead of `export`; the CLI reads it on startup.

Models the registry marks `self-host` (Kimi K2 self-hosted, for example) have no
token price, because the cost is your own compute rather than a per-token bill,
and `self-host` counts as EU-safe for the residency check when the box runs
inside the EU. Nothing then leaves your network. The rest of the stack (GitLab or
GitHub for documents, self-hosted Supabase where it applies) can run on your own
infrastructure too. See [self-hosting.md](self-hosting.md) and, for the model
side, [providers-and-models.md](providers-and-models.md).

## Is it really open source?

Yes, Apache-2.0. The full text is in [LICENSE](../LICENSE) at the repository
root. You can read, run, fork, and modify it. There is no open-core split or
paid tier gating the features described in these docs. Contributions are welcome;
see [CONTRIBUTING.md](../CONTRIBUTING.md). Security and conduct contact:
jonah@grosshanten.com.

## What is actually built, and what is only designed?

The line matters, so here it is plainly.

Built and tested:

- The CLI, full flow: read the repository, propose, human approves, open a
  merge or pull request, conflict check, human approves the merge, merge, revert.
- Backends: GitLab, GitHub, and an in-memory mock. GitHub's revert is a
  simplified tree swap, not a three-way `git revert`.
- Providers: mock, Anthropic, AWS Bedrock (EU), and one OpenAI-compatible
  provider for Mistral, Kimi, DeepSeek, Qwen, or self-hosted models.
- The model registry with prices and a data-residency flag, the deterministic
  router, the token budget, and prompt caching.
- The grounding gate: a citation to a file or line the agent never read
  hard-blocks the merge request. The number-coverage check is advisory, not a
  hard block.
- The path permission policy.
- The tamper-evident, hash-chained audit log and offline `verify`.
- The VS Code Web IDE extension, the LLM proxy server, and the gallery-proxy
  registry service.

Designed, not built yet:

- The live hosted browser demo. The extension, proxy, and registry are built and
  tested; what is missing is a DNS record and a Caddy entry on the host so a real
  GitLab Web IDE can reach them. See [DISTRIBUTION.md](DISTRIBUTION.md).
- Sigstore commit signing.
- A full CI-verify-and-auto-rollback loop. The conflict check runs, and
  `--verify-cmd` and `rollback` exist, but nothing yet reverts automatically off
  a post-merge CI signal.
- The deferred vector index, held behind a measured Recall@k threshold.

The full breakdown, with the monorepo layout, is in
[architecture-and-status.md](architecture-and-status.md).

## How do I see it work without setting anything up?

Run the local offline demo. No account, no key, no server: it runs the whole
flow against an in-memory repository with a scripted model. `npm run demo` works
the same on Windows, macOS, and Linux:

```bash
npm run demo
```

You will see a one-line policy notice, the agent reading a note and proposing a
new split-sheet file, `Merge request opened: mock://merge-request/1`, `Merged
!1.`, and an audit summary ending in `chain verified`. The bundled demo substrate
is a German-language music-label example, so the agent narrates in German and
follows the substrate's language. Point it at your own repository and the
language follows your documents. More in [DEMO.md](DEMO.md) and
[getting-started.md](getting-started.md); if something misbehaves, see
[troubleshooting.md](troubleshooting.md).
