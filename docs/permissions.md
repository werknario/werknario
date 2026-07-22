# Permissions

`.werknario/policy.json` answers two questions before the tool trusts an
agent with real files: which paths may this agent write, and (as a schema,
see the caveat below) who is allowed to approve a change touching a given
path. It's a small, glob-based JSON file, deliberately not a roles engine.

Source: `packages/shared/src/policy.ts`. Path override: `WERKNARIO_POLICY` /
`--policy <path>`, default `.werknario/policy.json`.

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
- `agents.<id>.deny`: paths the agent may never write, regardless of `allow`.
- `approvers.<glob>`: human ids allowed to approve a change touching a
  matching path. The most specific glob (longest pattern string) wins when
  more than one matches.

### Glob syntax

`matchGlob(pattern, path)`: `**` spans slashes (matches across directories),
a single `*` stays within one path segment. There's no other wildcard syntax
(no `?`, no character classes).

## How a write decision is made

`canWrite(policy, agentId, path)`, called from the CLI's `writeGuard` before
`propose_edit` stages a file:

1. No policy file at all. `writeGuard` is never even constructed by the CLI
   (`existsSync(config.policyPath)` guards it), so every write is allowed.
2. Policy file present, but no entry for this agent id. Allowed.
3. `deny` wins over `allow`. If any `deny` glob matches the path, the write
   is blocked, no matter what `allow` says.
4. `allow` present and non-empty. The path must match at least one `allow`
   glob, or the write is blocked with a reason explaining that the path
   falls outside the agent's allowed area.
5. No `deny` match, and no non-empty `allow` list. Allowed.

Default is permissive at every level: no file, no entry, or an agent entry
with no rules all resolve to "allowed." A policy only restricts an agent once
you name that agent and give it `allow` and/or `deny` rules.

A blocked write doesn't crash the run. The tool executor returns the reason
to the agent as a tool error, so it can choose a different path or ask the
human instead of the whole task failing.

### Agent id matching

The CLI strips a leading `agent:` prefix before matching:
`WERKNARIO_AGENT_ID=agent:hr-bot` matches a policy key `"hr-bot"`, not
`"agent:hr-bot"`. Write policy keys as the bare id.

## `approvers`: defined in the schema, not enforced yet

Be precise about this: `approversFor(policy, path)` exists, is unit-tested,
and correctly resolves the most-specific-glob-wins list of approvers for a
path. But nothing in the CLI or the extension currently calls it to gate an
approval. Today, "approve" simply means whoever is running the CLI
interactively (or set `--yes`) confirms the prompt. There's no check that
they're one of the names listed under `approvers` for the path being changed.

Treat `approvers` as a schema you can populate now, ready for a future or
external check to read, not as an enforced access-control gate in this
release.

## Validation

`parsePolicy(input)` validates an untrusted, parsed JSON value into a
`WerknarioPolicy` and throws a descriptive error on a malformed shape (wrong
type for `agents`, `allow`, `deny`, or `approvers`; non-string-array values;
etc.). One thing worth knowing if you're consuming these errors
programmatically: the error and write-denial reason strings in
`policy.ts` are hardcoded German (e.g. `Policy muss ein Objekt sein.`)
regardless of the `--de` / `WERKNARIO_LOCALE` setting. Unlike the CLI's
merge-conflict and backend-error messages, this layer isn't wired through the
localized `friendlyError` path.
