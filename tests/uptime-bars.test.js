const assert = require("node:assert/strict");
const {
  aggregateState,
  buildDays,
  dayState,
  incidentFreePercent,
  periodDays,
  periodLabel,
  sampleFreshness,
  timingWindow,
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
assert.equal(aggregateState(["unknown", "operational"]), "unknown");
assert.equal(aggregateState(["operational", "partial-outage"]), "partial-outage");
assert.equal(aggregateState(["operational", "full-outage"]), "partial-outage");
assert.equal(aggregateState(["full-outage", "full-outage"]), "full-outage");
assert.equal(incidentFreePercent(["unknown", "operational", "operational", "partial-outage"]).toFixed(1), "66.7");
assert.equal(incidentFreePercent(["unknown"]), null);
const now = new Date("2026-11-17T11:00:00Z");
assert.equal(sampleFreshness("2026-11-17T10:40:00Z", now), "fresh");
assert.equal(sampleFreshness("2026-11-17T10:39:59Z", now), "stale");
assert.equal(sampleFreshness(null, now), "unknown");
assert.equal(sampleFreshness("2026-11-17T11:02:00Z", now), "unknown");
const stale = { status: "down", lastEvidenceAt: "2026-11-17T10:30:00Z" };
const fresh = { status: "up", lastEvidenceAt: "2026-11-17T10:58:00Z" };
const pending = { status: "unknown", lastEvidenceAt: null };
assert.deepEqual(groupStatus([stale, fresh], now), {
  health: "down", label: "Last known: Outage · checks stale",
});
assert.deepEqual(groupStatus([pending, fresh], now), {
  health: "up", label: "Last known: Operational · checks pending",
});
assert.deepEqual(groupStatus([pending, { ...fresh, status: "down" }], now), {
  health: "down", label: "Outage · checks pending",
});
assert.equal(dayState("2026-11-17", "2026-11-10", { lastUpdated: "2026-11-16T23:00:00Z", status: "up" }, "2026-11-17"), "unknown");
assert.equal(aggregateState(["unknown", "full-outage"]), "partial-outage");
assert.equal(periodDays("month"), 30);
assert.equal(periodDays("year"), 365);
assert.equal(periodDays("all", "2025-08-20", new Date("2026-08-23T12:00:00Z")), 369);
assert.equal(periodLabel("month"), "30-day history");
assert.equal(periodLabel("all"), "Available history");
assert.equal(periodLabel("all", "2025-08-20"), "All-time history");

const timings = { days: [["2026-10-01", 1, 500], ["2026-11-14", 1, 600], ["2026-11-17", 3, 600]] };
const month = timingWindow(timings, "month", now);
assert.equal(month.count, 4);
assert.equal(month.mean, 300);
assert.deepEqual(month.points.map(({ day, index }) => [day, index]), [["2026-11-14", 26], ["2026-11-17", 29]]);
assert.equal(timingWindow(timings, "all", now).count, 5);
assert.equal(timingWindow(undefined, "month", now).mean, null);

console.log("uptime bar checks passed");
