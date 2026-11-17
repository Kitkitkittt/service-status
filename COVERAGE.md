# Monitoring coverage

Reconciled 17 November 2026. This is a coverage inventory, not a live node-health report.

The public status page monitors **21 HTTPS surfaces across eight display groups**. Existing component names are retained so their histories continue. Newly added checks start collecting history when Upptime first runs them; earlier days remain unknown.

| Group | Checks | What passing establishes |
| --- | ---: | --- |
| VNIBB | 1 | Public dashboard responds |
| Gampo | 1 | Public simulator responds |
| Research Wiki | 4 | Liveness, readiness and two anonymous authentication boundaries |
| 9Router | 3 | UI/redirect, API liveness and anonymous authentication boundary |
| Tele-proxy | 3 | UI/redirect, API liveness and anonymous authentication boundary |
| Grafana | 2 | Health handler and protected datasource-list boundary |
| Langfuse | 2 | Application liveness and declared readiness |
| Other public projects | 5 | Five separately monitored project pages respond |

The table contains eight display groups; “Other public projects” contains five independent products. A passed HTTP check does not establish successful inference, complete traces, a working datasource query, backup recoverability or accepted agent work.

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

1. **Check freshness:** the page combines saved-check timestamps with the latest successful monitor run and its exact endpoint configuration, with a warning after 20 minutes. Healthy probes do not rewrite history on every run. Intended five-minute GitHub scheduling is not a detection deadline. Unknown timestamps and future clock errors remain unknown; reload to refresh loaded evidence.
2. **Inventory reconciliation:** keep all seven Node Slots visible in the private registry and dashboard, even while admission or measurement is missing. Supersede individual dated facts, not entire host histories.
3. **Private coverage:** complete resource, dependency and worker evidence through the existing monitoring owners. Keep monitoring failures distinct from service outages and attach actual recovery receipts.

Configuration and operating procedures: [OPERATIONS.md](OPERATIONS.md). The public [Pilot Home](https://github.com/Kitkitkittt/pilot-dashboard) documents canonical ownership and the current Home/OmO/Herdr direction.
