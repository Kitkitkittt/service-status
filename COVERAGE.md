# Monitoring coverage

Reconciled 17 November 2026. This is a coverage inventory, not a live node-health report.

<!-- generated public checks -->

The public status page tracks **24 HTTPS checks across 8 groups**.

| Group | Check | Expected HTTP | What it checks |
| --- | --- | --- | --- |
| VNIBB | VNIBB Dashboard | 200 | The public analytics dashboard responds. |
| Gampo | Gampo Simulator | 200 | The public education simulator responds. |
| Research Wiki | Research Wiki Liveness | 200 | The Wiki listener answers. |
| Research Wiki | Research Wiki Readiness | 200 | The Wiki reports its dependencies ready. |
| Research Wiki | Research Wiki Application Auth Boundary | 401 | The Wiki rejects anonymous application access. |
| Research Wiki | Research Wiki MCP Auth Boundary | 401 | The Wiki rejects anonymous MCP access. |
| 9Router | 9Router Web UI | 200, 307 | The router web entry point or its redirect answers. |
| 9Router | 9Router API Health | 200 | The router API listener answers. |
| 9Router | 9Router API Auth Boundary | 401 | The router rejects anonymous access to models. |
| Tele-proxy | Tele-proxy API Health | 200 | The public gateway listener answers. |
| Tele-proxy | Tele-proxy Web UI | 200, 307 | The web entry point or its redirect answers. |
| Tele-proxy | Tele-proxy API Auth Boundary | 401 | The models API rejects requests without credentials. |
| Grafana | Grafana API Health | 200 | The Grafana health handler answers. |
| Grafana | Grafana API Auth Boundary | 401 | Grafana rejects anonymous access to datasource configuration. |
| Grafana | Grafana Web UI | 200 | The native Grafana login route answers. |
| Langfuse | Langfuse Liveness | 200 | The Langfuse listener answers. |
| Langfuse | Langfuse Readiness | 200 | Langfuse reports its dependencies ready. |
| Langfuse | Langfuse Web UI | 200 | The native Langfuse sign-in route answers. |
| Langfuse | Langfuse API Auth Boundary | 401 | Langfuse rejects anonymous access to projects. |
| Other projects | Keith Digital Garden | 200 | The public knowledge garden responds. |
| Other projects | Mechanical Watch Explainer | 200 | The interactive watch explainer responds. |
| Other projects | AutoScientist Write-up | 200 | The public project write-up responds. |
| Other projects | F1 Racing Demo | 200 | The public telemetry demo responds. |
| Other projects | Chords Lab | 200 | The public music theory app responds. |

<!-- generated public checks -->

Fifteen requested operator-UI/service targets have no live completed public contract here. Status custom-hostname verification and private-origin probes remain gated separately under the respective owners. These rows record only public HTTPS UI-route and anonymous auth-boundary observations; they do not establish authenticated functional acceptance, deployment state, private origin health, or an automatic-observation guarantee. Existing 9Router public checks are reused unchanged.

## Node coverage

Seven expected physical/VM Node Slots are known. `pilot` is an orchestration role, not an eighth confirmed host. None has a node-uptime check in this public monitor. A Grafana or gateway response must not be copied into a node's health state.

| Node Slot | Required private evidence |
| --- | --- |
| dev-01 | Host heartbeat, resource age, operator/agent session health and recovery evidence |
| sandbox-01 | Inventory presence, correct host identity, host versus VM resources and admission evidence |
| compute-01 | Disk runway, CPU/memory pressure, GPU health and per-harness collection coverage |
| deploy-01 | Storage/mount presence, disk and inode runway, dependency health and verified backup/restore evidence |
| cloud-01 | Current storage-capacity reconciliation, application/dependency health and backup ownership |
| cloud-02 | Independent checker/relay sample age, reason codes and timestamped recovery receipts |
| cloud-03 | Controller/worker heartbeat, CI health and actual producer-to-collector telemetry coverage |

Node existence, admission, connectivity, instrumentation and running work are separate dimensions. Never turn a missing measurement into healthy, idle or zero. Retain source revision, observation time and measurement scope. The Fabric's private inventory and issue owners retain authority; this document adds no admission or runtime grants.

## Hosted services outside the public monitor

| Surface | Appropriate monitoring |
| --- | --- |
| Prometheus, Loki, Alloy and internal observability dependencies | Existing private checks, scrape age, collector errors and a bounded ingestion/readback witness |
| ClickHouse, PostgreSQL, Redis and object storage | Private dependency readiness, storage runway, retention and restore evidence |
| Gatus/Dozzle and other private operator tools | Their existing private health and access contracts; source configuration alone does not prove deployment |
| CI/controller services, agent runtimes and Herdr workbench | Private runtime heartbeat, exact task/session ownership, failure and recovery evidence |
| Pilot Home / OmO | Current documentation and runtime qualification; Home is documentation, not a standalone public web service |

Do not put loopback URLs, private addresses, tokens or authenticated collectors in this public repository. Do not publish new ingress merely to add a green row. Add another public service only after its owner supplies an intended public HTTPS endpoint and its anonymous response contract is directly verified.

## Reliability improvements

1. **Check freshness:** the page combines saved-check timestamps with the latest successful monitor run and its exact endpoint configuration, with a warning after 20 minutes. Healthy probes do not rewrite history on every run. Intended five-minute GitHub scheduling is not a detection deadline. Unknown timestamps and future clock errors remain unknown. The page refreshes its snapshot every minute.
2. **Inventory reconciliation:** keep all seven Node Slots visible in the private registry and dashboard, even while admission or measurement is missing. Supersede individual dated facts, not entire host histories.
3. **Private coverage:** complete resource, dependency and worker evidence through the existing monitoring owners. Keep monitoring failures distinct from service outages and attach actual recovery receipts.

Configuration and operating procedures: [OPERATIONS.md](OPERATIONS.md). The public [Pilot Home](https://github.com/Kitkitkittt/pilot-dashboard) documents canonical ownership and the current Home/OmO/Herdr direction.
