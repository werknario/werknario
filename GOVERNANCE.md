# Governance

This is a small project with an honest structure. This file says who decides
what, how that can change, and what stays fixed regardless of who is involved.

## Current model

There is one maintainer: Jonah Großhanten (jonah@grosshanten.com). One person
holds merge rights, tags releases, and has the final say on scope and direction.

That is the accurate state today, not an aspiration to keep it that way. The
process below exists so a second maintainer can be added without renegotiating
everything.

Because the project is Apache-2.0 with a DCO and no contributor license
agreement, anyone can fork it and carry it forward if the sole maintainer steps
away; the license already grants that right, so continuity does not depend on
any single person.

## How decisions are made

Most decisions happen in the open, on the merge request or issue that raises
them. The default is to write down the reasoning where the change lives, so the
record is part of the history rather than a separate account of it.

- Routine changes (bug fixes, docs, tests, a new adapter that follows the
  existing `ToolBackend` or provider contract) are decided by review on the pull
  or merge request. One maintainer approval merges.
- Changes that alter a public contract, a security-relevant guarantee, or the
  direction of the project get discussed in an issue first. That includes the
  audit log format, the permission policy model, the grounding gate, the model
  registry's residency flags, and anything that changes what `verify` checks.
- When there is no consensus, the maintainer decides and records why. With a
  single maintainer that is most decisions; the point is that the reason is
  written down, not that it is unanimous.

Disagreements are settled on the merits, in writing, referencing the code or the
spec. Seniority does not win an argument; a reproducible objection does.

## Becoming a maintainer

There is no application form. Maintainership follows demonstrated work:

- Several merged pull requests, not a single one.
- Substantial contributions, meaning changes with tests that touch real
  behavior, not only typo fixes.
- Review that holds up: catching problems in others' changes, and responding
  well to review on your own.
- Reliability over a stretch of time, so the record shows judgment and not a
  single good week.

When a contributor meets that bar, the maintainer proposes adding them in a
public issue and, absent a serious objection, grants merge rights. A new
maintainer starts by reviewing and merging others' work, not by pushing large
unreviewed changes of their own.

Maintainers who go inactive can be moved to emeritus. This is bookkeeping about
who is currently on the hook for reviews, not a judgment about past work.

## Sign-off: the DCO

Every commit must be signed off under the
[Developer Certificate of Origin](https://developercertificate.org/). The
sign-off is your statement that you wrote the change or otherwise have the right
to submit it under this project's license.

Add it with:

```bash
git commit -s
```

That appends a `Signed-off-by: Your Name <you@example.com>` line using your
`git config` name and email. A contribution without a matching sign-off cannot
be merged. This is a lightweight assertion of provenance, not a copyright
assignment; you keep the copyright to what you write.

## License and the verifiable core

The whole codebase is [Apache-2.0](LICENSE) and stays that way. There is no
open-core split, and specifically no plan to move the parts that make the
project worth trusting behind a different license.

Those parts are the verifiable core: the hash-chained audit log and its `verify`
command, the permission policy model, the grounding and citation gate, the human
approval step, and the model registry with its data-residency flags. The whole
point of the project is that every change is a reviewable diff, proposed by a
named agent and approved by a named human, and the whole history can be verified
rather than trusted. A guarantee you cannot inspect is not a guarantee, so the
code behind those guarantees is not going to become inspectable-for-a-fee.

Contributions are accepted under Apache-2.0 with the DCO sign-off above. No
separate contributor license agreement, and no relicensing of your contribution
to something more restrictive later.

## See also

- [CONTRIBUTING.md](CONTRIBUTING.md) for how to build, test, and open a change.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for behavior in project spaces.
- [SECURITY.md](SECURITY.md) for reporting a vulnerability privately.
- [docs/architecture-and-status.md](docs/architecture-and-status.md) for what is
  built today versus designed but not built yet.
