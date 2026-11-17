# Status monitor operations

## Purpose

This public Upptime repository monitors externally observable service surfaces across Kohnnn projects. GitHub Actions checks them every five minutes, starting at minute 2 of the hour (`2-59/5 * * * *` in `workflowSchedule.uptime`), records response history in Git, opens and closes incident Issues, and publishes a GitHub Pages status site.

That interval is intended, not guaranteed: GitHub Actions can delay or drop scheduled runs, and [public schedules are disabled after 60 days of repository inactivity](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule), so a passing check is not a detection deadline.

`.upptimerc.yml` is the configuration source of truth. Files under `.github/workflows/`, `api/`, `graphs/`, and `history/`, plus the generated status table in `README.md`, are Upptime outputs.

## Service inventory

| Site | Check | Healthy response | Meaning |
| --- | --- | --- | --- |
| VNIBB | `https://vnibb-web.vercel.app/dashboard` | 200 | Public analytics dashboard is available. |
| Gampo | `https://gampo-educational-simulator.netlify.app` | 200 | Public educational simulator is available. |
| Research Wiki | `/health/live` | 200 | Application process is live through the public tunnel. |
| Research Wiki | `/health/ready` | 200 | Application dependencies pass readiness checks. |
| Research Wiki | `/` | 401 | Protected application rejects anonymous access. |
| Research Wiki | `/mcp/research-brain/` | 401 | MCP route exists and rejects anonymous access. Keep the trailing slash. |
| 9Router | `/` | 200 or 307 | Public tunnel reaches the UI or its redirect. |
| 9Router | `/api/health` | 200 | Router API health surface is live. |
| 9Router | `/v1/models` | 401 | Protected OpenAI-compatible API rejects anonymous access. |
| Tele-proxy | `/api/health` | 200 | Anonymous constant `{"ok":true}` response proves the public gateway listener answers. It does not check providers, routing, storage, collectors, or traces. |
| Tele-proxy | `/` | 200 or 307 | Public UI or its redirect answers; not an authenticated workflow test. |
| Tele-proxy | `/v1/models` | 401 | Protected API rejects an anonymous request; not a model/provider availability test. |
| Grafana | `https://grafana.vnibb.xyz/api/health` | 200 | Grafana's health handler answers; not proof that every datasource, exporter or dashboard query works. |
| Grafana | `/api/datasources` | 401 | Anonymous requests cannot list datasource configuration. |
| Langfuse | `https://langfuse.vnibb.xyz/api/public/health` | 200 | Langfuse liveness handler answers; no trace-ingestion or completeness claim. |
| Langfuse | `/api/public/ready` | 200 | Langfuse's declared readiness handler passes; no end-to-end producer/export/trace guarantee. |
| Keith Digital Garden | `https://kohnnn.github.io/keith-digital-garden/` | 200 | Public knowledge garden is available. |
| Mechanical Watch | `https://kohnnn.github.io/interactive-explanation/mechanical-watch/` | 200 | Public interactive explainer is available. |
| AutoScientist | `https://adaptions-writeup.vercel.app/` | 200 | Public project write-up is available. |
| F1 Racing | `https://f1-demo.netlify.app/` | 200 | Public telemetry demo is available. |
| Chords Lab | `https://chords-lab-app.netlify.app/` | 200 | Public music-theory app is available. |

An expected 401 is a successful security check, not downtime. These checks require no credentials and must remain anonymous.

## Monitoring boundary

GitHub-hosted runners can reach public domains only. They cannot observe localhost ports, systemd unit uptime, PostgreSQL clusters, or whether two local Research Wiki candidates are simultaneously active. Public readiness and protected-route checks are the external source of truth.

A liveness check (Wiki `/health/live`, Tele-proxy `/api/health`) proves the process or listener answered; it says nothing about dependencies. A readiness check (Wiki `/health/ready`, Langfuse `/api/public/ready`) tests the application's declared readiness. A protected-route check proves the selected route rejects anonymous requests. None substitutes for another. Tele-proxy's `/api/health` is unconditional; its `/v1/models` check intentionally sends no key. Neither proves inference works.

[COVERAGE.md](COVERAGE.md) records the public/private coverage boundary and all seven expected Node Slots. Do not expose a private service merely to make this public dashboard look complete. The Fabric registry and authenticated telemetry remain authoritative for node resources, workers, private dependencies, backup evidence and admission.

For machine-local diagnosis, run:

```bash
systemctl status 9router.service cloudflared.service cloudflared-research.service vci-research-052.service vci-research-054.service
curl -fsS http://127.0.0.1:8080/health/ready
curl -fsS http://127.0.0.1:8081/health/ready
```

Do not add localhost URLs to `.upptimerc.yml`; GitHub Actions would check its own runner.

## Status-page design

`assets/openai-status.css` is the visual source of truth. `.upptimerc.yml` loads it through `status-website.themeUrl`. The design intentionally uses a narrow white canvas, restrained typography, one prominent overall-status banner, and compact component rows. Preserve Upptime's generated semantic HTML and accessibility; prefer CSS changes over custom JavaScript or a replacement frontend.

`assets/uptime-bars.js` is the data-driven exception. It groups generated component articles into native expandable product sections, reads Upptime's public `history/summary.json` and per-service `startTime`/`lastUpdated`, then renders daily states for products and components over the selected 30-day, 1-year, or all-time range. Keep VNIBB, Gampo, Research Wiki, 9Router, Tele-proxy, Grafana and Langfuse before the collapsed Other projects group. Primary groups with an outage or missing fresh evidence open automatically; Other projects stays collapsed by default. Keep pre-monitoring days and days after the last sample gray. Upptime records operational and outage time, not latency degradation, so the strip must not infer degraded states from response time.

The page displays each check's source timestamp and age. Samples over 20 minutes old, invalid/missing timestamps, and clocks more than one minute ahead produce an explicit freshness warning and an unknown group status. This is a display threshold, not an outage declaration or alert-delivery guarantee. A one-minute browser timer ages the loaded samples; reload the page to obtain newer data. Historical incident totals remain recorded history. If GitHub schedules are delayed, investigate Actions and use the existing independent private monitor rather than equating old green samples with current availability.

After changing the stylesheet or uptime-bar script, push `master`, run `Static Site CI`, wait for the Pages deployment, then verify desktop and mobile layouts in a browser. Check the operational, degraded, active-incident, and history-page states before changing selectors that target `article.up`, `article.down`, `article.degraded`, or `.live-status`.

## Change a domain

1. Confirm the new public domain resolves and its Cloudflare tunnel is active.
2. Probe every path in the inventory anonymously and record its HTTP code.
3. Replace every old-domain `url` in `.upptimerc.yml`; preserve paths and expected codes unless the application contract changed.
4. Validate YAML and inspect the diff.
5. Push to `master`, manually run `Uptime CI`, then run `Static Site CI`.
6. Confirm histories use the new URLs and no false incident remains open.

## Add or remove a service check

Each entry needs a unique stable `name`, a public HTTPS `url`, an explicit `expectedStatusCodes` list, and a bounded `timeout`. Prefer semantic surfaces over duplicate root checks: liveness for process health, readiness for dependencies, and an anonymous protected route for authentication enforcement.

Never place API keys, cookies, passwords, tunnel tokens, or Authorization headers in this public repository. If a future check truly requires authentication, use a least-privilege GitHub Actions secret and document its rotation separately without recording its value.

Removing or renaming a check changes generated history identifiers. Preserve the name when only its domain changes so its uptime history remains continuous.

## Validation

Run before every configuration push:

```bash
python3 - <<'PY'
import yaml
with open('.upptimerc.yml', encoding='utf-8') as stream:
    yaml.safe_load(stream)
print('YAML OK')
PY
git diff --check
git status --short
```

Probe configured behavior from an external network when possible:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://vnibb-web.vercel.app/dashboard
curl -sS -o /dev/null -w '%{http_code}\n' https://gampo-educational-simulator.netlify.app
curl -sS -o /dev/null -w '%{http_code}\n' https://research.vnibb.xyz/health/live
curl -sS -o /dev/null -w '%{http_code}\n' https://research.vnibb.xyz/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' https://research.vnibb.xyz/
curl -sS -o /dev/null -w '%{http_code}\n' https://research.vnibb.xyz/mcp/research-brain/
curl -sS -o /dev/null -w '%{http_code}\n' https://9router.vnibb.xyz/
curl -sS -o /dev/null -w '%{http_code}\n' https://9router.vnibb.xyz/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://9router.vnibb.xyz/v1/models
curl -sS -o /dev/null -w '%{http_code}\n' https://tele-proxy.vnibb.xyz/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://kohnnn.github.io/keith-digital-garden/
curl -sS -o /dev/null -w '%{http_code}\n' https://kohnnn.github.io/interactive-explanation/mechanical-watch/
curl -sS -o /dev/null -w '%{http_code}\n' https://adaptions-writeup.vercel.app/
curl -sS -o /dev/null -w '%{http_code}\n' https://f1-demo.netlify.app/
curl -sS -o /dev/null -w '%{http_code}\n' https://chords-lab-app.netlify.app/
```

The examples above cover the original fifteen checks. The complete, current probe list and expected codes are in `.upptimerc.yml`, including the six checks added on 17 November. Probe those too before publishing; use anonymous requests with a finite timeout and preserve their explicit status contracts.

Run `node tests/uptime-bars.test.js` and `node --check assets/uptime-bars.js` after changing grouping or freshness behavior.

## GitHub administration

Upptime requires Actions workflow write permission so scheduled checks can update history and incident Issues. GitHub Pages publishes from the `gh-pages` branch after `Static Site CI` succeeds. A repository custom status domain is optional; without one the site uses `/service-status` on the account's GitHub Pages domain.

When workflows fail, fix `.upptimerc.yml` or template configuration first. Edit generated workflows only when upgrading or repairing the Upptime template itself.

## Agent completion criteria

An update is complete when configuration parses, anonymous probes return their declared codes, the diff contains no secret, Uptime CI succeeds, Static Site CI succeeds, and the public status page reflects every configured service.
