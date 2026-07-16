# Distribution — getting the extension into the real Web IDE

Chosen route: full Web-IDE distribution (not the local test harness). The
extension appears in the Extensions view of the real GitLab Web IDE on
gitlab.xconcapps.de and installs like any other.

## How it works

The Web IDE reads whatever `vscode_extension_marketplace` on the instance points
at. Today that's `preset: open_vsx` (open-vsx.org). We switch it to
`preset: custom` and point it at a small registry service we host. That service
is a thin shim in front of open-vsx.org:

- Every extension that is not ours: passed straight through to open-vsx.org.
  Open-vsx returns absolute file URLs, so those extensions load directly from
  open-vsx and our service is never in their path.
- Our one extension (`xconcapps.werknario-webide-agent`): served locally and
  injected into search and install queries.

The flip is instance-wide — it changes the marketplace for every user on the
instance. The proxy design is what makes that safe: a bug in our code can stop
our own extension from installing, but it cannot break anyone else's Extensions
view, because their traffic is a faithful pass-through.

Full protocol notes and the service contract are in
[`../registry/SPEC.md`](../registry/SPEC.md).

## Pieces

| Piece | Where | State |
|---|---|---|
| Registry service (`@werknario/registry`) | `registry/` | built + tested |
| Extension web `.vsix` | built from `packages/extension` by `registry/scripts/build-ext-store.sh` | built |
| Container + CI deploy | `registry/Dockerfile`, `deploy:registry` in `.gitlab-ci.yml` | built |
| Public host + TLS | Caddy on the Hetzner app host | **needs you** |
| DNS record | `vsx.xconcapps.de` | **needs you** |
| Marketplace flip | instance setting, one API call | done at cut-over |

## Deploy pattern (mirrors bauvex — no SSH)

The Hetzner app host runs a GitLab shell runner tagged `hetzner-shell` whose
user can run Docker. CI builds the image and runs the container on that host
directly. Caddy on the host terminates TLS (Let's Encrypt, automatic) and
reverse-proxies the public subdomain to the container's local port. No manual
SSH, same shape as `baunario-api` / `baunario-web`.

```
vsx.xconcapps.de ──TLS──▶ Caddy ──▶ localhost:8091 ──▶ container werknario-vsx (:8080)
                                                             │ ours ─▶ EXT_STORE
                                                             └ others ─▶ open-vsx.org
```

## What you need to do (infra — I cannot do these)

1. **DNS.** Add an A record `vsx.xconcapps.de` → the public IP of the Hetzner app
   host that runs the `baunario-*` containers (the `hetzner-shell` runner host).
   Confirm that IP; it may differ from the GitLab box (188.245.212.175).

2. **Caddy.** On that host, add to `/etc/caddy/Caddyfile`:
   ```
   vsx.xconcapps.de {
       reverse_proxy localhost:8091
   }
   ```
   then `caddy reload`. (This is the one step the CI job deliberately does not
   touch — Caddy config is managed on the host, same as for baunario.)

(A third step — enabling the `hetzner-shell` runner for this project — turned
out unnecessary: runner 4 is an instance-wide runner with that tag and is
already available here, verified via the API on 2026-07-16.)

Tell me when 1–2 are done. I'll run the deploy pipeline, confirm the service is
healthy over HTTPS, then do the cut-over.

## Deploy (manual, after 1–2 above)

The `deploy:registry` CI job is **manual on main** — it does not auto-run. Once
DNS + Caddy are in place, trigger it (the play button on the latest main
pipeline, or I can via the API). It builds the image on the Hetzner host, probes
the candidate on a spare port (health + a real gallery query that must contain
our extension), and only then swaps the live container — rolling back to the
previous image if the swap fails its health check. So triggering it is safe even
if something's off; a bad build never replaces a working container.

## Cut-over (I do this, once the service is live and healthy)

1. Verify `https://vsx.xconcapps.de/healthz` returns 200 and that a proxied
   query (`POST /vscode/gallery/extensionquery`) returns real open-vsx results.
2. Flip the instance marketplace to custom (one API call):
   ```
   PUT /api/v4/application/settings
   {"vscode_extension_marketplace":{"enabled":true,"preset":"custom","custom_values":{
     "service_url":"https://vsx.xconcapps.de/vscode/gallery",
     "item_url":"https://vsx.xconcapps.de/vscode/item",
     "resource_url_template":"https://vsx.xconcapps.de/vscode/unpkg/{publisher}/{name}/{version}/{path}"}}}
   ```
3. Open the Web IDE on fleetlicht-demo, search "Fleetlicht" or "werknario" in the
   Extensions view, install, run "Fleetlicht KI: Chat öffnen".

## Rollback

One call puts it back to open-vsx.org for everyone:
```
PUT /api/v4/application/settings
{"vscode_extension_marketplace":{"enabled":true,"preset":"open_vsx"}}
```
Keep this handy during cut-over. If anything about the Extensions view looks
wrong for other users after the flip, revert first, diagnose second.
