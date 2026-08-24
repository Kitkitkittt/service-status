const assert = require("node:assert/strict");
const {
  aggregateState,
  buildDays,
  dayState,
  groupForSlug,
  incidentFreePercent,
  startDayFromHistory,
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

console.log("uptime bar checks passed");
