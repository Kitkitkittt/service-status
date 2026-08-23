# Status monitor operations

## Purpose

This public Upptime repository monitors externally observable service surfaces hosted by one machine. GitHub Actions checks them every five minutes, records response history in Git, opens and closes incident Issues, and publishes a GitHub Pages status site.

`.upptimerc.yml` is the configuration source of truth. Files under `.github/workflows/`, `api/`, `graphs/`, and `history/`, plus the generated status table in `README.md`, are Upptime outputs.

## Service inventory

| Site | Check | Healthy response | Meaning |
| --- | --- | --- | --- |
| 9Router | `/` | 307 | Public tunnel reaches the UI redirect. |
| 9Router | `/api/health` | 200 | Router API health surface is live. |
| 9Router | `/v1/models` | 401 | Protected OpenAI-compatible API rejects anonymous access. |
| Research Wiki | `/health/live` | 200 | Application process is live through the public tunnel. |
| Research Wiki | `/health/ready` | 200 | Application dependencies pass readiness checks. |
| Research Wiki | `/` | 401 | Protected application rejects anonymous access. |
| Research Wiki | `/mcp/research-brain/` | 401 | MCP route exists and rejects anonymous access. Keep the trailing slash. |

An expected 401 is a successful security check, not downtime. These checks require no credentials and must remain anonymous.

## Monitoring boundary

GitHub-hosted runners can reach public domains only. They cannot observe localhost ports, systemd unit uptime, PostgreSQL clusters, or whether two local Research Wiki candidates are simultaneously active. Public readiness and protected-route checks are the external source of truth.

For machine-local diagnosis, run:

```bash
systemctl status 9router.service cloudflared.service cloudflared-research.service vci-research-052.service vci-research-054.service
curl -fsS http://127.0.0.1:8080/health/ready
curl -fsS http://127.0.0.1:8081/health/ready
```

Do not add localhost URLs to `.upptimerc.yml`; GitHub Actions would check its own runner.

## Change a domain

1. Confirm the new public domain resolves and its Cloudflare tunnel is active.
2. Probe every path in the inventory anonymously and record its HTTP code.
3. Replace every old-domain `url` in `.upptimerc.yml`; preserve paths and expected codes unless the application contract changed.
4. Validate YAML and inspect the diff.
5. Push to `master`, manually run `Uptime CI`, then run `Static Site CI`.
6. Confirm histories use the new URLs and no false incident remains open.

## Add or remove a service check

Each entry needs a unique stable `name`, a public HTTPS `url`, an explicit `expectedStatusCode`, and a bounded `timeout`. Prefer semantic surfaces over duplicate root checks: liveness for process health, readiness for dependencies, and an anonymous protected route for authentication enforcement.

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
curl -sS -o /dev/null -w '%{http_code}\n' https://9router.vnibb.xyz/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://9router.vnibb.xyz/v1/models
curl -sS -o /dev/null -w '%{http_code}\n' https://research.vnibb.xyz/health/live
curl -sS -o /dev/null -w '%{http_code}\n' https://research.vnibb.xyz/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' https://research.vnibb.xyz/mcp/research-brain/
```

Expected codes are `200`, `401`, `200`, `200`, and `401` respectively.

## GitHub administration

Upptime requires Actions workflow write permission so scheduled checks can update history and incident Issues. GitHub Pages publishes from the `gh-pages` branch after `Static Site CI` succeeds. A repository custom status domain is optional; without one the site uses `/service-status` on the account's GitHub Pages domain.

When workflows fail, fix `.upptimerc.yml` or template configuration first. Edit generated workflows only when upgrading or repairing the Upptime template itself.

## Agent completion criteria

An update is complete when configuration parses, anonymous probes return their declared codes, the diff contains no secret, Uptime CI succeeds, Static Site CI succeeds, and the public status page reflects every configured service.
