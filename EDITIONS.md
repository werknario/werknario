# Editions and the boundary

This file draws one line and commits to it: what stays free forever, and what a
future commercial edition may charge for. It exists so you can decide to build
on werknario without worrying that the part you depend on gets closed later.

An agent here is software that carries a task through to the end, not just
answers. The whole point of the project is that every change is a reviewable
diff, proposed by a named agent and approved by a named human, and the whole
history can be verified rather than trusted. Everything that makes that sentence
true is in the free tier and stays there.

## The promise

These stay Apache-2.0, forever: the agent loop, the grounding gate, the
hash-chained audit log, `werknario verify`, and every backend and provider
adapter. Nothing that makes a change verifiable sits behind a paywall.

That is not a marketing line you have to take on faith. The code behind each of
those guarantees is in this repository under [Apache-2.0](LICENSE), and you can
read it now. The list is deliberately concrete so it cannot be quietly narrowed
later.

## What the free tier contains

Everything you need to run the loop against a single repository and check the
result offline. Named, so the boundary is unambiguous:

- **The agent loop** in `packages/shared` — read the repo, propose an edit as a
  diff, pause for a human `yes` on every write and on the merge itself, open a
  merge or pull request, run the conflict check, merge, revert.
- **The grounding gate.** A citation to a file or line the agent never read this
  session hard-blocks the merge request. The number-coverage check is advisory,
  not a hard block; only fabricated provenance stops the merge.
- **The path permission policy.** `.werknario/policy.json` controls which paths
  the agent may write, so a task about one folder cannot rewrite the whole repo.
- **The hash-chained audit log and `werknario verify`.** Each entry seals the
  one before it. `verify` is a hash chain, not a signature; it exits non-zero if
  the chain breaks, so an edit, a reorder, or an insertion after the fact is
  detectable offline. Optional Ed25519 signing (`keygen`, then
  `verify --pubkey`) is an opt-in on top, for proving who produced a log.
- **The model registry and residency router.** Prices, context windows, and a
  data-residency flag per model; the router refuses to send personal data to a
  non-EU route unless you override it. This describes where a route sits; it is
  not a compliance certification.
- **Every backend and provider adapter.** GitLab, GitHub, and the in-memory
  mock; the mock, Anthropic, Bedrock, and openai-compatible providers; and any
  adapter contributed later under the same interfaces. Adapters never move to a
  paid tier. See [ADAPTERS.md](ADAPTERS.md).

If you run werknario against your own repositories one at a time, you never hit
the boundary below.

## Where the line runs

The seam is single user or single repository on one side, organization on the
other. The free tier is the full loop on a repo. A future commercial edition
covers only the org-wide layer that a single person does not need and a
regulated organization does. It aggregates across repos and teams rather than
adding anything to the loop itself.

Candidates for the commercial edition, none of which remove a capability from
the free tier:

- Auditor export across many repositories and teams.
- SSO, and binding an agent's identity to an org directory.
- Cost attribution per team.
- Self-hosted Rekor / Sigstore for signed transparency logs, and managed
  hosting with an SLA.

One honest caveat on that last item. Fulcio and Rekor are public transparency
logs by default. Self-hosting Rekor is a precondition before a self-hosted
signature can be described as EU-resident, so that route is not advertised as an
EU-residency feature until the self-hosted log is in place.

The commercial features live in a separate repository under their own license.
That keeps this repository entirely Apache-2.0 and means no relicensing right
over community contributions is ever needed.

## Contributions: DCO, not a CLA

Contributions to this repository are accepted under Apache-2.0 with a Developer
Certificate of Origin sign-off (`git commit -s`). There is no contributor
license agreement, so you are not signing over a right to relicense your work
into something more restrictive later. Because the commercial features sit in a
separate repository, this project never needs that right. See
[GOVERNANCE.md](GOVERNANCE.md) for the sign-off and the maintainer model, and
[CONTRIBUTING.md](CONTRIBUTING.md) for how to build and test a change.

## See also

- [LICENSE](LICENSE) — the Apache-2.0 text this promise rests on.
- [GOVERNANCE.md](GOVERNANCE.md) — who decides, and why the core stays inspectable.
- [ADAPTERS.md](ADAPTERS.md) — the backends, providers, and models built today
  versus open for contribution.
- [docs/architecture-and-status.md](docs/architecture-and-status.md) — what runs
  today versus designed but not built yet.
