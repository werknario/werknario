# Permissions

`.werknario/policy.json` answers two questions before the tool trusts an
agent with real files: which paths may this agent write, and who is allowed
to approve a change touching a given path. (An agent here is software that
carries a task through to the end, not just answers.) It is a small,
glob-based JSON file, deliberately not a roles engine. The first question is
enforced today; the second is defined and tested but not yet enforced, and
this page is precise about which is which.

Source: `packages/shared/src/policy.ts`, wired into the CLI in
`packages/cli/src/cli.ts`. Path override: `WERKNARIO_POLICY` or
`--policy <path>`, default `.werknario/policy.json`. See
[configuration](configuration.md) for the full flag and environment table.

## The default: no policy, no restrictions

There is no policy file out of the box, and that is a deliberate choice so
the tool works before you write one. When `.werknario/policy.json` is
absent, the CLI never even builds a write guard, so every path the agent
proposes is allowed. It prints a one-line notice so this is never silent:

```
Note: no policy file at .werknario/policy.json — agent:assistant may write any path. See docs/permissions.md.
```

A policy only starts restricting an agent once the file exists, names that
agent, and gives it rules. Everything below describes what happens once you
opt in by writing the file.

## Lock it down first (regulated environments)

If you work in a law firm, clinic, or public body, do not start from the
permissive default. Start closed. The repo ships a start-closed template at
`.werknario/policy.starter.json`: it gives `agent:assistant` a non-empty
`allow` list of just `inbox/**` and `drafts/**`. A non-empty `allow` list
inverts the default: the agent may write only paths that match one of those
globs, and every other path is refused with a reason (see the decision steps
below). Nothing outside the folders you named is writable until you say so.

Copy the template to the path the CLI actually reads, then edit it:

```
cp .werknario/policy.starter.json .werknario/policy.json
```

On Windows use `copy .werknario\policy.starter.json .werknario\policy.json`
in cmd, or `Copy-Item` in PowerShell.

Then widen `allow` deliberately, one folder at a time, as you come to trust
the agent with more of the tree. Add a glob to `allow` only when you have
decided that area is safe for the agent to write. Leave `deny` for the
exceptions inside an allowed area (the salary example under
[Shape](#shape)). The starter also seeds an `approvers` block, but read the
caveat below before you rely on it: it records intent, it does not gate
anything yet.

## Shape

```json
{
  "agents": {
    "hr-bot": {
      "allow": ["hr/**"],
      "deny": ["hr/salaries/**"]
    }
  },
  "approvers": {
    "vertraege/**": ["human:legal"],
    "vertraege/**/split-sheet_*.typ": ["human:legal", "human:finance"]
  }
}
```

- `agents.<id>.allow`: if present and non-empty, the agent may only write
  paths matching one of these globs.
- `agents.<id>.deny`: paths the agent may never write, regardless of
  `allow`.
- `approvers.<glob>`: human ids allowed to approve a change touching a
  matching path. The most specific glob (longest pattern string) wins when
  more than one matches. Read the caveat below before you rely on this.

## Glob syntax

`matchGlob(pattern, path)`: `**` spans slashes (matches across
directories), a single `*` stays within one path segment. There is no other
wildcard syntax, so no `?` and no character classes.

Before matching, `canWrite` normalizes the path: repeated slashes collapse
to one and a trailing slash is dropped. That stops a path like
`vertraege//split.typ` or `vertraege/split.typ/` from slipping past a rule
written for `vertraege/split.typ`.

## How a write decision is made

`canWrite(policy, agentId, path)` runs inside the executor's write guard,
called before `propose_edit` stages a file:

1. No policy file at all. The CLI never constructs the write guard
   (`existsSync(config.policyPath)` guards it), so every write is allowed.
2. Policy file present, but no entry for this agent id. Allowed.
3. `deny` wins over `allow`. If any `deny` glob matches the path, the write
   is blocked, whatever `allow` says.
4. `allow` present and non-empty. The path must match at least one `allow`
   glob, or the write is blocked with a reason that the path falls outside
   the agent's allowed area.
5. No `deny` match and no non-empty `allow` list. Allowed.

The default is permissive at every level: no file, no entry, or an agent
entry with no rules all resolve to allowed. A policy only restricts an agent
once you name that agent and give it `allow` and/or `deny` rules.

A blocked write does not crash the run. The tool executor returns the reason
to the agent as a tool error, so the agent can pick a different path or ask
the human instead of the whole task failing. The change also never reaches a
merge request, so it never reaches the audit log as an applied edit. See
[audit and trust](audit-and-trust.md) for what does get recorded.

### Agent id matching

The CLI strips a leading `agent:` prefix before matching. The agent id
defaults to `agent:assistant` and comes from `--agent` or
`WERKNARIO_AGENT_ID`; `WERKNARIO_AGENT_ID=agent:hr-bot` matches a policy key
`"hr-bot"`, not `"agent:hr-bot"`. Write policy keys as the bare id.

## `approvers`: enforced in the CLI, bound to the backend identity

`approversFor(policy, path)` resolves the most-specific-glob-wins list of
approvers for a path, and the CLI now enforces it. Before the merge prompt, it
checks the acting human against the `approvers` rules for every path the change
touched. If a touched path names approvers and the human is not on that list,
the merge is blocked, a `merge_denied` entry is written to the audit log, and
`--yes` does not bypass it.

What makes this a control rather than an honour system is where the human
identity comes from. For a real backend the CLI reads it from the access token
(`GET /user` on GitLab or GitHub), so the approver is the authenticated token
holder, not a name typed into `--human`. The in-memory mock keeps its
self-declared demo name, because there is nothing to authenticate against; the
enforcement still runs, it just trusts the demo label.

Honest scope. This enforcement is in the CLI. The VS Code Web IDE extension
surface does not yet run the same check, so on that surface the approver label
is still self-declared. Organisation-wide identity (one SSO across every
surface) and a signed, non-repudiable log (Sigstore) are on the roadmap. Until
the extension path is wired, treat the extension approver as intent, not
identity, and keep your own review discipline there.

### Who actually approves, and how

There are two surfaces:

- A developer runs the CLI and answers the interactive confirm prompt in the
  terminal (or passes `--yes` for an unattended run). For a real GitLab/GitHub
  backend the approver identity is the authenticated token holder, and the
  `approvers` policy is enforced against it: an unauthorised person is refused
  the merge.
- A non-technical approver uses the VS Code Web IDE extension surface, which
  shows the staged change and its diff and offers the same accept action
  without a terminal. That surface does not yet enforce the `approvers` list,
  so pair it with your own review process until cross-surface enforcement
  lands.

## Validation

`parsePolicy(input)` validates an untrusted, parsed JSON value into a
`WerknarioPolicy` and throws a descriptive error on a malformed shape: a
wrong type for `agents`, `allow`, `deny`, or `approvers`, a non-string-array
value, and so on. One thing worth knowing if you consume these errors
programmatically: the error strings and the write-denial reasons in
`policy.ts` are hardcoded German (for example `Policy muss ein Objekt sein.`
and `Pfad "…" ist für … gesperrt.`) regardless of the `--de` /
`WERKNARIO_LOCALE` setting. Unlike the CLI's merge-conflict and
backend-error messages, this layer is not wired through the localized
`friendlyError` path.

## Related

- [Getting started](getting-started.md) for the first run and where the
  `.werknario/` directory comes from.
- [Grounding](grounding.md) for the other guardrail on what an agent may do,
  which blocks fabricated citations before a merge request opens.
- [Audit and trust](audit-and-trust.md) for how approved changes are
  recorded and verified.
