# Launch checklist

Everything in the repo is launch-ready. What is left needs a GitHub account, a
recording that already exists, and a few registrations. Do these in order.

## 1. Claim the name (availability checked 2026-07-24, all free)

- npm: reserve the unscoped name `werknario`.
- GitHub: create the org `github.com/werknario`.
- Domains: register `werknario.com` and `werknario.dev`.
- Trademark: verify manually in DPMAregister, EUIPO eSearch, TMview, and WIPO
  Global Brand Database before public use. Not yet register-verified; so far only
  a zero-web-footprint indicator.

## 2. Push the public mirror

The OSS product lives on the `feat/oss-product` branch of the private GitLab
repo. Push that state to the new GitHub repo as `main`:

```bash
git remote add github git@github.com:werknario/werknario.git
git push github feat/oss-product:main
```

Set the default branch to `main` in the GitHub repo settings.

## 3. Turn on CI and the badge

The first push triggers GitHub Actions (`.github/workflows/ci.yml`: typecheck,
`npm test`, `test:e2e`, build, offline smoke). Once it is green, enable the CI
badge: uncomment the badge line in `README.md` (search for `Live CI badge`).

## 4. The demo cast

The animated `docs/launch/demo.svg` is rendered from `docs/launch/demo.cast` with
svg-term and already shows in the README under "Watch it run". To re-record after
a change to the demo output:

```bash
npm run build
npm run demo:blocked                 # confirm the output first
npx svg-term-cli --in docs/launch/demo.cast --out docs/launch/demo.svg \
  --window --width 92 --height 24 --padding 16
```

The `.cast` also plays on asciinema.org for terminal-native channels. For a
static title frame (Reddit and Lobsters do not autoplay), screenshot the final
frame of the SVG or the terminal after `npm run demo:blocked`.

## 5. Open the good-first-issues

With the GitHub repo live and `gh` authenticated against it:

```bash
scripts/open-good-first-issues.sh
```

It creates the `adapter` label and the six adapter issues from
`docs/launch/good-first-issues.md`. Running it twice creates duplicates, so run
it once.

## 6. Post

Only after the demo cast is in the README (step 4 is already done, so this gate
is met once the repo is public). The Show HN title, the post body, the first
author comment, and the three objection replies are in `docs/launch/show-hn.md`.
The channel order and timing live in the marketing concept. Do not couple the
launch date to a star count.
