const assert = require("node:assert/strict");
const {
  aggregateState,
  buildDays,
  dayState,
  groupForSlug,
  incidentFreePercent,
  lastUpdatedFromHistory,
  periodDays,
  periodLabel,
  startDayFromHistory,
  sampleFreshness,
  groupStatus,
} = require("../assets/uptime-bars.js");

assert.deepEqual(buildDays(new Date("2026-08-23T23:59:59Z"), 3), [
  "2026-08-21",
  "2026-08-22",
  "2026-08-23",
]);
assert.equal(dayState("2026-08-20", "2026-08-21", { dailyMinutesDown: {}, status: "up" }, "2026-08-23"), "unknown");
assert.equal(dayState("2026-08-21", "", { dailyMinutesDown: {}, status: "up" }, "2026-08-23"), "unknown");
assert.equal(dayState("2026-08-21", "2026-08-21", { dailyMinutesDown: {}, status: "up" }, "2026-08-23"), "operational");
assert.equal(dayState("2026-08-22", "2026-08-21", { dailyMinutesDown: { "2026-08-22": 12 }, status: "up" }, "2026-08-23"), "partial-outage");
assert.equal(dayState("2026-08-22", "2026-08-21", { dailyMinutesDown: { "2026-08-22": 1440 }, status: "up" }, "2026-08-23"), "full-outage");
assert.equal(dayState("2026-08-23", "2026-08-21", { dailyMinutesDown: {}, status: "down" }, "2026-08-23"), "partial-outage");
assert.equal(startDayFromHistory("startTime: 2026-08-23T13:28:10.028Z\n"), "2026-08-23");
assert.equal(startDayFromHistory("status: up\n"), "");
assert.equal(aggregateState(["unknown", "operational"]), "unknown");
assert.equal(aggregateState(["operational", "partial-outage"]), "partial-outage");
assert.equal(aggregateState(["operational", "full-outage"]), "partial-outage");
assert.equal(aggregateState(["full-outage", "full-outage"]), "full-outage");
assert.equal(incidentFreePercent(["unknown", "operational", "operational", "partial-outage"]).toFixed(1), "66.7");
assert.equal(incidentFreePercent(["unknown"]), null);
assert.equal(groupForSlug("vnibb-dashboard").title, "VNIBB");
assert.equal(groupForSlug("research-wiki-readiness").title, "Research Wiki");
assert.equal(groupForSlug("unconfigured-project").title, "Other projects");
assert.equal(groupForSlug("tele-proxy-api-health").title, "Tele-proxy");
assert.equal(groupForSlug("grafana-api-health").title, "Grafana");
assert.equal(groupForSlug("langfuse-readiness").title, "Langfuse");
const now = new Date("2026-11-17T11:00:00Z");
assert.equal(lastUpdatedFromHistory("lastUpdated: 2026-11-17T10:55:00Z\n"), "2026-11-17T10:55:00Z");
assert.equal(sampleFreshness("2026-11-17T10:55:00Z", now).state, "fresh");
assert.equal(sampleFreshness("2026-11-17T10:40:00Z", now).state, "fresh");
assert.equal(sampleFreshness("2026-11-17T10:39:59Z", now).state, "stale");
assert.equal(sampleFreshness("", now).state, "unknown");
assert.equal(sampleFreshness("invalid", now).state, "unknown");
assert.equal(sampleFreshness("2026-11-17T11:02:00Z", now).state, "unknown");
assert.equal(sampleFreshness("2026-11-17T11:00:30Z", now).state, "fresh");
assert.equal(dayState("2026-11-17", "2026-11-10", { lastUpdated: "2026-11-16T23:00:00Z", status: "up" }, "2026-11-17"), "unknown");
const article = (state, status) => ({ dataset: { sampleState: state }, classList: { contains: (name) => name === status } });
assert.equal(groupStatus([article("stale", "up")]).className, "unknown");
assert.equal(groupStatus([article("fresh", "up"), article("unknown", "up")]).className, "unknown");
assert.equal(groupStatus([article("fresh", "up"), article("fresh", "down")]).className, "down");
assert.equal(groupStatus([article("fresh", "degraded")]).className, "degraded");
assert.equal(groupStatus([article("fresh", "up")]).className, "up");
assert.equal(periodDays("month"), 30);
assert.equal(periodDays("year"), 365);
assert.equal(periodDays("all", "2025-08-20", new Date("2026-08-23T12:00:00Z")), 369);
assert.equal(periodLabel("month"), "30-day history");
assert.equal(periodLabel("all"), "Available history");
assert.equal(periodLabel("all", "2025-08-20"), "All-time history");

console.log("uptime bar checks passed");
