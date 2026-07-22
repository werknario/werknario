# Backends

A backend is the thing werknario talks to when it reads the substrate and
turns an approved proposal into a real change. The agent loop and the tool
executor (grounding and citation checks, the human approval gate,
path-traversal guards) are identical no matter which backend is active; only
the backend changes. Three exist today: GitLab, GitHub, and an in-memory
mock.

Two interfaces are involved, and the split matters:

- `ToolBackend` (`packages/shared/src/executor.ts`) is what the agent sees:
  list files, read a file, stage a proposed edit, commit the staged edits and
  open a merge or pull request, add a comment. Nothing here merges anything.
- `MergeGateway` (`packages/cli/src/closeLoop.ts`) is the CLI-driven,
  human-approved half: check whether a request is mergeable, merge it, revert
  it. These are deliberately not tools the agent can call. A named human
  approves before the CLI merges or reverts.

Selecting a backend: set `WERKNARIO_BACKEND` to `gitlab`, `github`, or
`mock`. If it is unset, the CLI defaults to GitHub when `GITHUB_REPO` is
present and to GitLab otherwise (`packages/cli/src/config.ts`). See
[configuration.md](configuration.md) for the full variable list.

## What propose, merge, and revert map to

| Step | GitLab | GitHub | mock |
|---|---|---|---|
| `propose_edit` | Staged in memory; new-vs-update decided once via `fileExists` | Same staging, same decision | Same staging |
| Open request | Create branch, one atomic Commit API call for all files, open a **merge request** | Create branch, Git Data API (blob → tree → commit → ref), open a **pull request** | Mutate in-memory files, return a `mock://` URL |
| `checkMergeable` | `detailed_merge_status` must be `mergeable` or `can_be_merged` | `mergeable === true` and `mergeable_state === "clean"` | Always mergeable |
| Merge | `PUT …/merge`, returns `merge_commit_sha` | `PUT …/merge` (squash), returns the merge SHA | Synthetic SHA |
| Revert | GitLab's own `…/revert` endpoint, a real three-way revert, wrapped in a merge request | Simplified tree swap (see below), wrapped in a pull request | Synthetic branch name |

The vocabulary differs between the two forges but the shape does not.
GitLab's "merge request" is GitHub's "pull request"; the `iid` is GitHub's PR
number; a GitLab note is a GitHub issue comment. `backend.ts` translates the
terms so the agent-facing contract stays the same.

## GitLab

Client: `packages/gitlab-client` (`GitlabClient` + `GitLabRestBackend`), a
`fetch`-based REST client that runs in Node and in a browser extension host.

Configuration: `GITLAB_BASE_URL` (defaults to `https://gitlab.com`),
`GITLAB_PROJECT_ID`, and `GITLAB_TOKEN` (or `GITLAB_PAT`). The project id can
be numeric or the URL-encoded `group/project` path.

### Token scope

The client reads the project and its file tree, creates branches, commits,
opens and merges merge requests, adds notes, and can call GitLab's revert
endpoint. That is read and write access to the project, so the token needs
the `api` scope.

### Commit mechanism

GitLab's Commit API accepts multiple file actions (`create` / `update` /
`delete` / `move`) in a single request. `createMergeRequest` creates the
source branch off the target, sends every staged edit as one atomic commit,
then opens the merge request against it. A `closesIssueIid` is appended to the
description as `Closes #<n>`.

### Merge

`mergeMergeRequest` calls `PUT …/merge_requests/:iid/merge` and returns the
merged request with its `merge_commit_sha`. The gateway checks mergeability
first and merges only when GitLab explicitly reports `mergeable` (or
`can_be_merged`). Every other status — `ci_still_running`,
`discussions_not_resolved`, `conflict`, `unchecked`, `draft` — blocks, so an
unattended `--yes` run never merges past a pipeline that has not finished or a
review that is not done.

### Revert

`revertCommit` calls GitLab's own `POST /repository/commits/:sha/revert`
endpoint, a real three-way `git revert`, not a reconstructed diff. The CLI
wraps the resulting revert commit in a merge request like any other change, so
a human approves the rollback the same way they would approve a forward
change.

## GitHub

Client: `packages/github-client` (`GitHubClient` + `GitHubRestBackend`).

Configuration: `GITHUB_TOKEN`, `GITHUB_REPO` (`owner/repo`), and an optional
`GITHUB_API_URL` for GitHub Enterprise Server (defaults to
`https://api.github.com`).

### Token scope

A classic PAT needs the `repo` scope. A fine-grained PAT needs Contents
(read and write) and Pull requests (read and write) on the target repository:
the client reads file contents, creates branches, commits via the Git Data
API, opens and merges pull requests, and comments.

### Commit mechanism

GitHub has no single "commit several files" endpoint the way GitLab does.
`commitFiles` goes through the Git Data API instead: create a blob per file,
build a tree on top of the branch's current tree, create a commit pointing at
that tree, then fast-forward the branch ref to the new commit. That is several
requests per commit rather than one, but the final ref update makes it atomic
from the branch's point of view: either the ref moves to the new commit or it
does not move at all.

### Merge

`mergePullRequest` calls `PUT …/pulls/:number/merge` with the squash method.
The gateway passes only when GitHub reports `mergeable === true` and
`mergeable_state === "clean"`. Anything else — `blocked`, `unstable`,
`behind`, `draft`, `dirty`, `unknown` — fails safe and does not merge.

### Revert: read this before relying on it

GitHub revert is a simplified tree swap, not a three-way `git revert`. Here is
the source comment on `revertViaBranch` in
`packages/github-client/src/client.ts`:

> This is NOT a real `git revert` — there is no three-way merge. If `base`
> picked up unrelated, legitimate changes after `commitSha` landed, this
> wipes those out too, since it swaps the whole tree rather than inverting
> `commitSha`'s specific diff. Good enough for "undo the merge we just did a
> moment ago"; do not reach for this as a general-purpose revert tool.

In practice it creates a new branch on top of the base branch's current tip,
with its tree forced back to whatever the target commit's first-parent tree
looked like. If anything else merged into the base branch between the original
change and the revert, that other change silently disappears from the new
branch's tree too. Use it right after a merge you want to immediately undo.
Do not reach for it as a "revert commit X" tool days or weeks later.

Rollback also needs the merge commit SHA captured at merge time
(`packages/cli/src/gateways.ts`). Without it the CLI raises an error telling
you to trigger the revert through the GitHub UI instead.

## mock

`packages/cli/src/mockBackend.ts`: in-memory, zero setup, no network calls.
Seeded with one file, a German session note, so the offline demo task has
something real to read and act on:

```
mock-substrate-musik/vertraege/session-notiz_landgang_2026-05-30.md
```

`checkMergeable` always reports mergeable, `merge` returns a synthetic SHA,
and `revert` returns a synthetic branch name; nothing persists past the
process. Use it with `LLM_PROVIDER=mock` for a fully offline, deterministic
run with no credentials at all:

```bash
LLM_PROVIDER=mock WERKNARIO_BACKEND=mock \
  node packages/cli/dist/cli.js "Draft the split sheet from the session note" --yes
```

The bundled demo substrate is a German-language music-label example, so the
agent narrates in German and reads and writes files under
`mock-substrate-musik/`. Point it at your own repo (GitLab or GitHub) to work
in another language. The same mock backend also drives the credential-free
end-to-end test in `e2e/flagship.test.ts`.

## See also

- [getting-started.md](getting-started.md) — the onboarding spine, including
  the offline demo.
- [configuration.md](configuration.md) — every environment variable, in one
  place.
- [audit-and-trust.md](audit-and-trust.md) — the hash-chained audit log every
  backend writes to, and how `verify` checks it.
