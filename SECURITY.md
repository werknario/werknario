# Security policy

werknario runs an agent against your documents and holds tokens for GitLab,
GitHub, and model providers, so security reports are taken seriously.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
"Report a vulnerability" flow on this repository, or email the maintainers
(see the repository's contact). Include how to reproduce it and the impact you see.

You can expect an acknowledgement within a few working days.

## Scope

Areas we care about most:

- **Audit log integrity.** The hash chain in `packages/shared/src/audit.ts` must
  detect any edit, deletion, reordering, or insertion. A way to alter history
  without `verify()` catching it is a serious bug.
- **Permission bypass.** A path that escapes a `deny` rule in the policy model, or
  a way for the agent to write outside its allowed globs.
- **Secret exposure.** A token or key ending up in a log, an error message, the
  audit detail, or a merge request.
- **Approval bypass.** A team-visible write (merge request, comment, merge) that
  happens without the human approval step.

## Supported versions

This is pre-1.0 (0.x). Fixes land on the main branch. Pin a commit if you need a
stable base until a tagged release exists.
