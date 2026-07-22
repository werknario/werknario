# Backends

A backend implements the `ToolBackend` interface
(`packages/shared/src/executor.ts`): list files, read a file, stage a
proposed edit, commit staged edits and open a merge/pull request, add a
comment. Three implementations exist today: GitLab, GitHub, and an in-memory
mock. The agent loop and the tool executor (grounding checks, the human
approval gate, path-traversal guards) are identical across all three; only
the backend changes.

## GitLab

Client: `packages/gitlab-client` (`GitlabClient` + `GitLabRestBackend`), a
`fetch`-based REST client that runs in Node and in a browser extension host.

Configuration: `GITLAB_BASE_URL`, `GITLAB_PROJECT_ID`, `GITLAB_TOKEN` (or
`GITLAB_PAT`). See [`configuration.md`](./configuration.md).

#### Token scope

The client reads the project and its file tree, creates branches, commits,
opens and merges merge requests, adds notes, and can call GitLab's revert
endpoint. That's read and write access to the project, so the token needs the
`api` scope.

#### Commit mechanism

GitLab's Commit API accepts multiple file actions (`create` / `update` /
`delete` / `move`) in a single request. `createMergeRequest` sends every
staged edit as one atomic commit call, then opens the merge request against
it.

#### Revert

`revertCommit` calls GitLab's own `POST /repository/commits/:sha/revert`
endpoint, a real three-way `git revert`, not a reconstructed diff. The CLI
wraps the resulting revert commit in a merge request like any other change,
so a human approves the rollback the same way they'd approve a forward
change.

## GitHub

Client: `packages/github-client` (`GitHubClient` + `GitHubRestBackend`).

Configuration: `GITHUB_TOKEN`, `GITHUB_REPO` (`owner/repo`), optional
`GITHUB_API_URL` for GitHub Enterprise Server.

#### Token scope

A classic PAT needs the `repo` scope. A fine-grained PAT needs Contents
(read and write) and Pull requests (read and write) on the target
repository: the client reads file contents, creates branches, commits via
the Git Data API, opens and merges pull requests, and comments.

#### Commit mechanism

GitHub's REST API has no single "commit several files" endpoint the way
GitLab does. `commitFiles()` goes through the Git Data API instead: create a
blob per file, build a tree on top of the branch's current tree, create a
commit pointing at that tree, then fast-forward the branch ref to the new
commit. That's several requests per commit rather than one, but the final ref
update makes it atomic from the branch's point of view: either the ref moves
to the new commit, or it doesn't move at all.

#### Revert: read this before relying on it

`revertViaBranch()` is a simplified tree swap, not a real `git revert`.
Straight from the source comment in `packages/github-client/src/client.ts`:

> This is NOT a real `git revert` — there is no three-way merge. If `base`
> picked up unrelated, legitimate changes after `commitSha` landed, this
> wipes those out too, since it swaps the whole tree rather than inverting
> `commitSha`'s specific diff. Good enough for "undo the merge we just did a
> moment ago"; do not reach for this as a general-purpose revert tool.

In practice: it creates a new branch on top of the base branch's current tip,
with its tree forced back to whatever the target commit's parent tree looked
like. If anything else merged into the base branch between the original
change and the revert, that other change silently disappears from the new
branch's tree too. Use it right after a merge you want to immediately undo.
Don't reach for it as a "revert commit X" tool days or weeks later.

Rollback also needs the merge commit SHA captured at merge time
(`packages/cli/src/gateways.ts`). Without it, the CLI raises an error telling
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
  werknario "Draft the split sheet from the session note" --yes
```

It's also what `e2e/flagship.test.ts` drives for a deterministic,
credential-free end-to-end test.
