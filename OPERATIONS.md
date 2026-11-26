# Status monitor operations

## Purpose

This public Upptime repository monitors externally observable service surfaces across Kohnnn projects. GitHub Actions checks them every five minutes, starting at minute 2 of the hour (`2-59/5 * * * *` in `workflowSchedule.uptime`), records response history in Git, opens and closes incident Issues, and publishes a GitHub Pages status site.

That interval is intended, not guaranteed: GitHub Actions can delay or drop scheduled runs, and [public schedules are disabled after 60 days of repository inactivity](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule), so a passing check is not a detection deadline.

`.upptimerc.yml` is the configuration source of truth. Upptime owns the generated data under `api/`, `graphs/`, and `history/`, plus its README status table. This repository owns the Pages and snapshot workflows. Upptime template regeneration happens through reviewed changes so it cannot replace those workflows.

## Service inventory

[COVERAGE.md](COVERAGE.md) lists the generated public checks and their meaning. Each check uses an explicit slug for stable history. An expected 401 means an anonymous access boundary passed.

## Monitoring boundary

GitHub-hosted runners can reach public domains only. They cannot observe localhost ports, systemd unit uptime, PostgreSQL clusters, or whether two local Research Wiki candidates are simultaneously active. Public readiness and protected-route checks are the external source of truth.

A liveness check (Wiki `/health/live`, Tele-proxy `/api/health`) proves the process or listener answered; it says nothing about dependencies. A readiness check (Wiki `/health/ready`, Langfuse `/api/public/ready`) tests the application's declared readiness. A protected-route check proves the selected route rejects anonymous requests. None substitutes for another. Tele-proxy's `/api/health` is unconditional; its `/v1/models` check intentionally sends no key. Neither proves inference works.

Grafana `/login` and Langfuse `/auth/sign-in` are public UI-route checks: an anonymous HTTP 200 means the route answered, not that the page rendered or that an authenticated workflow succeeded. The Langfuse `/api/public/projects` HTTP 401 check proves anonymous rejection, not project access or trace readiness. See [Monitoring coverage](COVERAGE.md) for the remaining endpoint gaps.

For the three new Grafana/Langfuse slugs only, `maxRedirects: 0` makes the native Upptime v1.46.5 request accept the observed route status without following a redirect. `requestTimeout: 15` and `connectTimeout: 10` are per-request/per-connection seconds; they do not bound the total observation. `maxRetries: 1` sets one inner request attempt per Upptime retry pass; an outer retry loop in the pinned workflow remains under separate review. The legacy `timeout: 15000` milliseconds declaration is retained for this repository's validator and existing contracts; it is not the Upptime transport timeout.

[COVERAGE.md](COVERAGE.md) records the public/private coverage boundary and all seven expected Node Slots. Do not expose a private service merely to make this public dashboard look complete. The Fabric registry and authenticated telemetry remain authoritative for node resources, workers, private dependencies, backup evidence and admission.

For machine-local diagnosis, run:

```bash
systemctl status 9router.service cloudflared.service cloudflared-research.service vci-research-052.service vci-research-054.service
curl -fsS http://127.0.0.1:8080/health/ready
curl -fsS http://127.0.0.1:8081/health/ready
```

Do not add localhost URLs to `.upptimerc.yml`; GitHub Actions would check its own runner.

## Status data and publishing

The Status data job publishes two feeds from one snapshot and one monitor receipt. `status.json` is schema 1 with exactly the historical 21 slugs and their existing order, metadata and evidence; an old queued workflow that passes only `--output` still receives this legacy-compatible feed. `--output-v2` is an explicit opt-in that writes `status-v2.json` with every configured row. Both files are staged in one publisher commit. The browser tries schema 2 first; before a valid v2 exists it falls back to schema 1 with an explicit limited-coverage notice. Once v2 is adopted, a failed refresh keeps the last good v2 with the stale/refresh warning and never downgrades. A same-SHA, same-run promotion carries identical evidence into both feeds.

Both projections are public-only. Private #87 origin work remains open: it needs a dedicated protected coverage view or separately reviewed sanitized outcomes. A relay HTTP 200 or an access redirect is never origin health.

The public status page gets group names, descriptions, check results, history and evidence times from these versioned JSON feeds. The Status data workflow builds them from one checkout of `master` and a completed Uptime CI run, then publishes them to the `status-data` branch. The browser refreshes each minute and retains the last available feed if a refresh fails.

Upptime writes history timestamps on status changes and response-time runs. When the same probe contract exists at the latest successful Uptime CI run's commit and there is a saved record for its URL, the snapshot can use the run start as conservative evidence. A warning appears after 20 minutes. A last-known outage remains visible beside its evidence age. Incident-free days are counted from Upptime history.

The Performance view uses recorded response times from Upptime commits for each check slug. It includes positive durations for passing or degraded checks with an expected HTTP response. Failed checks stay in the Uptime view. Days are UTC and the period average weights each recorded sample equally. Gaps mark days with no recorded timing. Upptime records timings during response-time runs and status transitions, so these charts measure sampled public HTTP latency. The last successful sample time remains visible when the selected range has no timings.

Static Site CI publishes only from `master` on source changes, its daily schedule or a manual dispatch. Pull requests run read-only catalog, snapshot and UI tests. The previous setup and template regeneration workflows have been retired because template regeneration would replace the publishing guard. Update Upptime workflow versions in a reviewed PR and preserve the production branch check. Existing Uptime, Response Time, Summary and Graphs jobs continue to run.

## Tele-proxy contract pilot

The Tele-proxy owning repo stores the public contract in `ops/public-status-contract.json`. After its change is reviewed, copy those public bytes into `contracts/tele-proxy.json` in a branch here, run `python3 scripts/status_data.py sync`, and open a PR for the resulting diff. The sync command projects the Tele-proxy checks into Upptime and regenerates coverage. The snapshot reads the same metadata for the UI. A changed label keeps its slug, and removal of an existing slug requires an explicit migration. Review the export before copying because the destination repository is public.

For other services, edit `.upptimerc.yml` and `catalog.yml`, then run the same sync command to regenerate coverage. A missing or duplicated check fails validation.

## Change a domain

1. Confirm the new public domain resolves and its Cloudflare tunnel is active.
2. Probe every path in the inventory anonymously and record its HTTP code.
3. Update the existing check URLs and keep their slugs. For Tele-proxy, update the owning contract and sync its export.
4. Validate YAML and inspect the diff.
5. Push to `master`, manually run `Uptime CI`, then run `Static Site CI`.
6. Confirm histories use the new URLs and no false incident remains open.

## Add or remove a service check

Each entry needs a unique stable `name`, a public HTTPS `url`, an explicit `expectedStatusCodes` list, and a bounded `timeout`. Prefer semantic surfaces over duplicate root checks: liveness for process health, readiness for dependencies, and an anonymous protected route for authentication enforcement.

Never place API keys, cookies, passwords, tunnel tokens, or Authorization headers in this public repository. If a future check truly requires authentication, use a least-privilege GitHub Actions secret and document its rotation separately without recording its value.

Keep the explicit slug when updating a label or domain. Review history retention before retiring a slug.

## Validation

Run before changing monitor configuration or the status page:

```bash
python3 scripts/status_data.py check
python3 tests/status_data_test.py
node --test tests/uptime-bars.test.js
git diff --check
```

The Python scripts use PyYAML. Probe changed endpoints anonymously with a finite timeout and verify their declared HTTP codes. After the workflows run, verify the live groups, snapshot source revision, and relevant history links.

## GitHub administration

Upptime requires Actions workflow write permission so scheduled checks can update history and incident Issues. GitHub Pages publishes from the `gh-pages` branch after `Static Site CI` succeeds. A repository custom status domain is optional; without one the site uses `/service-status` on the account's GitHub Pages domain.

The Pages publishing job retains the repository's existing GitHub App or PAT authentication. The snapshot job uses the repository workflow token to write only the generated data branch.

## Agent completion criteria

An update is complete when configuration parses, anonymous probes return their declared codes, the diff contains no secret, Uptime CI succeeds, Static Site CI succeeds, and the public status page reflects every configured service.
