const assert = require("node:assert/strict");
const {
  aggregateState,
  buildDays,
  dayState,
  incidentFreePercent,
  periodDays,
  periodLabel,
  enrolledDayState,
  headingHasHistoryLink,
  sampleFreshness,
  timingWindow,
  groupStatus,
} = require("../assets/uptime-bars.js");

assert.deepEqual(buildDays(new Date("2026-08-23T23:59:59Z"), 3), [
  "2026-08-21",
  "2026-08-22",
  "2026-08-23",
]);
const augustEvidence = { lastEvidenceAt: "2026-08-23T10:00:00Z" };
assert.equal(dayState("2026-08-20", "2026-08-21", { dailyMinutesDown: {}, status: "up" }, "2026-08-23"), "unknown");
assert.equal(dayState("2026-08-21", "", { dailyMinutesDown: {}, status: "up" }, "2026-08-23"), "unknown");
assert.equal(dayState("2026-08-21", "2026-08-21", { ...augustEvidence, dailyMinutesDown: {}, uptime: "100%", status: "up" }, "2026-08-23"), "operational");
assert.equal(dayState("2026-08-21", "2026-08-21", { dailyMinutesDown: {}, status: "up" }, "2026-08-23"), "unknown");
assert.equal(dayState("2026-08-22", "2026-08-21", { ...augustEvidence, dailyMinutesDown: { "2026-08-22": 12 }, uptime: "99%", status: "up" }, "2026-08-23"), "partial-outage");
assert.equal(dayState("2026-08-22", "2026-08-21", { ...augustEvidence, dailyMinutesDown: { "2026-08-22": 1440 }, uptime: "95%", status: "up" }, "2026-08-23"), "full-outage");
assert.equal(dayState("2026-08-23", "2026-08-21", { ...augustEvidence, dailyMinutesDown: {}, uptime: "99%", status: "down" }, "2026-08-23"), "partial-outage");
// Explicit incident minutes are retained even when current evidence is missing.
assert.equal(dayState("2026-08-22", "2026-08-21", { dailyMinutesDown: { "2026-08-22": 12 }, status: "up" }, "2026-08-23"), "partial-outage");
assert.equal(dayState("2026-08-22", "2026-08-21", { dailyMinutesDown: { "2026-08-22": 1440 }, status: "up" }, "2026-08-23"), "full-outage");
// Forward-of-evidence days must not invent incident-free history or current status.
assert.equal(dayState("2026-08-22", "2026-08-21", { lastEvidenceAt: "2026-08-21T10:00:00Z", dailyMinutesDown: {}, uptime: "100%", status: "up" }, "2026-08-23"), "unknown");
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
assert.equal(dayState("2026-11-17", "2026-11-10", { dailyMinutesDown: {}, uptime: "100%", status: "up" }, "2026-11-17"), "unknown");
assert.equal(dayState("2026-11-17", "2026-11-10", { lastUpdated: "2026-11-16T23:00:00Z", dailyMinutesDown: {}, uptime: "100%", status: "up" }, "2026-11-17"), "unknown");
assert.equal(aggregateState(["unknown", "full-outage"]), "partial-outage");
// A later startDay does not erase retained recorded history; an unenrolled
// member with no recorded evidence is ignored rather than counted as green.
const oldDay = "2026-11-15";
const newDay = "2026-11-16";
const today = "2026-11-17";
const oldOutage = { dailyMinutesDown: { [oldDay]: 1440 }, uptime: "95%", status: "down", lastEvidenceAt: "2026-11-17T10:58:00Z" };
const oldOperational = { dailyMinutesDown: {}, uptime: "100%", status: "up", lastEvidenceAt: "2026-11-17T10:58:00Z" };
const newCheck = { dailyMinutesDown: { [newDay]: 0 }, uptime: "100%", status: "up", lastEvidenceAt: "2026-11-17T10:58:00Z" };
assert.equal(enrolledDayState(oldDay, newDay, oldOutage, today), "full-outage");
assert.equal(enrolledDayState(oldDay, oldDay, oldOperational, today), "operational");
assert.equal(enrolledDayState(oldDay, newDay, newCheck, today), null);
assert.equal(enrolledDayState(newDay, newDay, newCheck, today), "operational");
assert.equal(enrolledDayState(newDay, newDay, { dailyMinutesDown: {}, status: "up", lastEvidenceAt: "2026-11-17T10:58:00Z" }, today), "unknown");
assert.equal(enrolledDayState(newDay, newDay, { dailyMinutesDown: {}, uptime: "100%", status: "up" }, today), "unknown");
assert.equal(enrolledDayState(oldDay, "", oldOperational, today), null);
assert.equal(enrolledDayState(oldDay, "", newCheck, today), null);
assert.equal(aggregateState([enrolledDayState(oldDay, oldDay, oldOutage, today), enrolledDayState(oldDay, newDay, newCheck, today)].filter((state) => state !== null)), "full-outage");
assert.equal(aggregateState([enrolledDayState(oldDay, oldDay, oldOperational, today), enrolledDayState(oldDay, newDay, newCheck, today)].filter((state) => state !== null)), "operational");
assert.equal(aggregateState([enrolledDayState(newDay, oldDay, oldOperational, today), enrolledDayState(newDay, newDay, newCheck, today)]), "operational");
assert.equal(aggregateState([enrolledDayState(newDay, oldDay, oldOperational, today), enrolledDayState(newDay, newDay, { status: "unknown" }, today)]), "unknown");
assert.equal(aggregateState([]), "unknown");
assert.equal(headingHasHistoryLink({ name: "Pending UI", slug: "pending-ui", startDay: null }), false);
assert.equal(headingHasHistoryLink({ name: "Enrolled UI", slug: "enrolled-ui", startDay: "2026-11-16" }), true);
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
