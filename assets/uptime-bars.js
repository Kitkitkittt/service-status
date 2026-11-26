(function () {
  const DAY_MS = 86400000;
  const DAY_COUNT = 90;
  const SVG_WIDTH = 668;
  const SVG_HEIGHT = 16;
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const STALE_AFTER_MS = 20 * 60 * 1000;
  const SNAPSHOT_URL = "https://raw.githubusercontent.com/Kitkitkittt/service-status/status-data/status.json";
  const SNAPSHOT_V2_URL = "https://raw.githubusercontent.com/Kitkitkittt/service-status/status-data/status-v2.json";
  const REFRESH_MS = 60000;

  function dateKey(date) {
    return date.toISOString().slice(0, 10);
  }

  function buildDays(today, count = DAY_COUNT) {
    const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    return Array.from({ length: count }, (_, index) =>
      dateKey(new Date(end - (count - index - 1) * DAY_MS)),
    );
  }

  function periodDays(period, earliestStartDay = "", today = new Date()) {
    const fixedDays = { month: 30, year: 365 };
    if (fixedDays[period]) return fixedDays[period];
    if (period !== "all" || !earliestStartDay) return DAY_COUNT;
    const start = new Date(`${earliestStartDay}T00:00:00Z`);
    const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    return Math.max(1, Math.floor((end - start.getTime()) / DAY_MS) + 1);
  }

  function periodLabel(period, startDay = "") {
    if (period === "all") return startDay ? "All-time history" : "Available history";
    return {
      month: "30-day history",
      year: "1-year history",
    }[period] || "90-day history";
  }

  function observedDayState(day, summary, today) {
    const minutesDown = Number(summary.dailyMinutesDown?.[day] || 0);
    // Explicit recorded incident minutes are historical evidence: they win
    // even when current evidence is absent or older than the observed day.
    if (minutesDown >= 1440) return "full-outage";
    if (minutesDown > 0) return "partial-outage";
    // A stopped monitor cannot establish availability on subsequent days.
    const sampled = new Date(summary.lastEvidenceAt || summary.lastUpdated || NaN);
    if (Number.isNaN(sampled.getTime()) || day > dateKey(sampled)) return "unknown";
    if (day === today && summary.status === "down") return "partial-outage";
    // Upstream calculate-uptime.ts records only incident days: an absent key in
    // an observed window with an actual summary row is incident-free history.
    if (summary.uptime !== undefined && summary.uptime !== null) return "operational";
    return "unknown";
  }

  function enrolledDayState(day, startDay, summary, today) {
    // A member is ignored only before its enrollment date or while no startDay
    // is known, unless it has retained recorded incident history.
    if (!startDay || day < startDay) {
      const minutesDown = Number(summary.dailyMinutesDown?.[day] || 0);
      if (!minutesDown) return null;
    }
    return observedDayState(day, summary, today);
  }

  function dayState(day, startDay, summary, today) {
    if (!startDay || day < startDay) return "unknown";
    return observedDayState(day, summary, today);
  }

  function aggregateState(states) {
    if (!states.length) return "unknown";
    if (states.every((state) => state === "full-outage")) return "full-outage";
    if (states.some((state) => state === "partial-outage" || state === "full-outage")) return "partial-outage";
    return states.includes("unknown") ? "unknown" : "operational";
  }

  function incidentFreePercent(states) {
    const monitored = states.filter((state) => state !== "unknown");
    if (!monitored.length) return null;
    return (monitored.filter((state) => state === "operational").length / monitored.length) * 100;
  }

  function sampleFreshness(timestamp, now = new Date()) {
    const age = now.getTime() - Date.parse(timestamp);
    if (!Number.isFinite(age) || age < -60000) return "unknown";
    return age > STALE_AFTER_MS ? "stale" : "fresh";
  }

  const HEALTH_LABELS = { down: "Outage", degraded: "Degraded", up: "Operational", unknown: "No status yet" };

  function groupStatus(checks, now = new Date()) {
    const freshness = checks.map((check) => sampleFreshness(check.lastEvidenceAt, now));
    const incomplete = freshness.some((state) => state !== "fresh");
    const health = ["down", "degraded", "up"].find((state) => checks.some((check) => check.status === state)) || "unknown";
    if (health === "unknown") return { health, label: HEALTH_LABELS.unknown };
    if (!incomplete) return { health, label: HEALTH_LABELS[health] };
    const hasFreshFailure = health !== "up" && checks.some((check, index) =>
      check.status === health && freshness[index] === "fresh");
    const suffix = freshness.includes("stale") ? "checks stale" : "checks pending";
    const prefix = hasFreshFailure ? "" : "Last known: ";
    return { health, label: `${prefix}${HEALTH_LABELS[health]} · ${suffix}` };
  }

  function stateLabel(state) {
    return {
      operational: "Operational",
      "partial-outage": "Partial outage",
      "full-outage": "Full-day outage",
      unknown: "No monitoring data",
    }[state];
  }

  function element(name, className, text) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function createBarFromStates(days, states, label) {
    const counts = states.reduce((totals, state) => {
      totals[state] += 1;
      return totals;
    }, { operational: 0, "partial-outage": 0, "full-outage": 0, unknown: 0 });
    const percentage = incidentFreePercent(states);
    const bar = element("span", "uptime-strip");
    const meta = element("span", "uptime-strip__meta");
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    const axis = element("span", "uptime-strip__axis");
    const step = SVG_WIDTH / days.length;
    const pillWidth = Math.max(0.8, step - Math.min(2, step * 0.3));

    meta.append(
      element("span", "uptime-strip__label", label),
      element(
        "span",
        "uptime-strip__score",
        percentage === null ? "Awaiting data" : `${percentage.toFixed(1)}% incident-free days`,
      ),
    );
    bar.setAttribute("role", "img");
    bar.setAttribute(
      "aria-label",
      `${label}: ${counts.operational} operational days, ${counts["partial-outage"]} partial outage days, ${counts["full-outage"]} full-day outages, ${counts.unknown} without monitoring data.`,
    );
    svg.setAttribute("viewBox", `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    days.forEach((day, index) => {
      const state = states[index];
      const rect = document.createElementNS(SVG_NAMESPACE, "rect");
      const title = document.createElementNS(SVG_NAMESPACE, "title");
      rect.setAttribute("x", String(index * step));
      rect.setAttribute("y", "0");
      rect.setAttribute("width", String(pillWidth));
      rect.setAttribute("height", String(SVG_HEIGHT));
      rect.setAttribute("rx", "1");
      rect.setAttribute("ry", "1");
      rect.setAttribute("class", `uptime-strip__pill uptime-strip__pill--${state}`);
      title.textContent = `${day}: ${stateLabel(state)}`;
      rect.appendChild(title);
      svg.appendChild(rect);
    });

    axis.append(element("span", "", days[0]), element("span", "", "Today"));
    bar.append(meta, svg, axis);
    return bar;
  }

  function statesForSummary(summary, startDay, days) {
    const today = days[days.length - 1];
    return days.map((day) => dayState(day, startDay, summary, today));
  }

  function createBar(summary, startDay, period, today = new Date()) {
    const days = buildDays(today, periodDays(period, startDay, today));
    return createBarFromStates(days, statesForSummary(summary, startDay, days), periodLabel(period, startDay));
  }

  function timingWindow(performance, period, now) {
    const history = performance?.days || [];
    const days = buildDays(now, periodDays(period, history[0]?.[0], now));
    const byDay = new Map(history.map(([day, count, total]) => [day, { count, total }]));
    const points = days.flatMap((day, index) => {
      const sample = byDay.get(day);
      return sample ? [{ day, index, mean: sample.total / sample.count, ...sample }] : [];
    });
    const count = points.reduce((sum, point) => sum + point.count, 0);
    const total = points.reduce((sum, point) => sum + point.total, 0);
    return { days, points, count, mean: count ? total / count : null };
  }

  function durationLabel(ms) {
    return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
  }

  function svgNode(name, attributes) {
    const node = document.createElementNS(SVG_NAMESPACE, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  }

  function createTimingChart(window) {
    const { days, points, count, mean } = window;
    const chart = element("div", "timing-chart");
    if (!count) {
      chart.append(element("p", "timing-empty", "No successful timings recorded in this range."));
      return chart;
    }
    const height = 80;
    const max = Math.max(10, ...points.map((point) => point.mean));
    const step = 10 ** Math.floor(Math.log10(max));
    const ceiling = Math.ceil(max / step) * step;
    const svg = svgNode("svg", { viewBox: `0 0 ${SVG_WIDTH} ${height + 8}`, preserveAspectRatio: "none" });
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Daily average response time. ${count} samples over ${points.length} measured days. Average ${durationLabel(mean)}.`);
    const x = (point) => 4 + (SVG_WIDTH - 8) * point.index / Math.max(1, days.length - 1);
    const y = (point) => 4 + height * (1 - point.mean / ceiling);
    for (const row of [4, height / 2 + 4, height + 4]) {
      svg.append(svgNode("line", { x1: 0, x2: SVG_WIDTH, y1: row, y2: row, class: "timing-grid" }));
    }
    points.forEach((point, index) => {
      const prior = points[index - 1];
      if (prior?.index === point.index - 1) {
        svg.append(svgNode("line", { x1: x(prior), x2: x(point), y1: y(prior), y2: y(point), class: "timing-line" }));
      }
      const dot = svgNode("circle", { cx: x(point), cy: y(point), r: 2.5, class: "timing-dot" });
      const title = svgNode("title", {});
      title.textContent = `${point.day} · ${durationLabel(point.mean)} average · ${point.count} ${point.count === 1 ? "sample" : "samples"}`;
      dot.append(title);
      svg.append(dot);
    });
    const axis = element("div", "timing-axis");
    axis.append(element("span", "", durationLabel(ceiling)), element("span", "", "0 ms"));
    const plot = element("div", "timing-plot");
    plot.append(axis, svg);
    const dates = element("div", "timing-dates");
    dates.append(element("span", "", days[0]), element("span", "", days[days.length - 1]));
    chart.append(plot, dates);
    return chart;
  }

  function headingHasHistoryLink(check) {
    // A pending check without a real startDay has no history page to link to.
    return Boolean(check.startDay);
  }

  function createPerformanceCheck(check, window) {
    const article = element("article", "performance-check");
    const header = element("div", "performance-check__header");
    const heading = element("h4");
    if (headingHasHistoryLink(check)) {
      const link = element("a", "", check.name);
      link.href = `history/${check.slug}`;
      heading.append(link);
    } else {
      heading.textContent = check.name;
    }
    const stats = element("p", "timing-stats", window.count
      ? `${durationLabel(window.mean)} avg · ${window.count} ${window.count === 1 ? "sample" : "samples"}`
      : "No timings in range");
    header.append(heading, stats);
    article.append(header, createTimingChart(window));
    if (check.performance?.latestAt) {
      const latest = check.performance;
      const recorded = new Date(latest.latestAt);
      const time = element("time", "", `${dateKey(recorded)} ${recorded.toISOString().slice(11, 16)} UTC`);
      time.dateTime = latest.latestAt;
      const footer = element("p", "timing-latest", `Last successful timing ${durationLabel(latest.latestMs)} · `);
      footer.append(time);
      article.append(footer);
    }
    return article;
  }

  function createComponent(check, period, now) {
    const health = Object.hasOwn(HEALTH_LABELS, check.status) ? check.status : "unknown";
    const article = element("article", health);
    const heading = element("h4");
    if (headingHasHistoryLink(check)) {
      const link = element("a", "", check.name);
      link.href = `history/${check.slug}`;
      heading.append(link);
    } else {
      heading.textContent = check.name;
    }
    const freshness = sampleFreshness(check.lastEvidenceAt, now);
    article.dataset.sampleState = freshness;
    const details = element("div", "check-description", check.description);
    const evidenceTime = Date.parse(check.lastEvidenceAt);
    const age = Number.isFinite(evidenceTime) ? Math.max(0, Math.floor((now - evidenceTime) / 60000)) : null;
    const prefix = freshness === "fresh" ? "" : "Last known · ";
    const label = freshness === "unknown"
      ? "Check time unavailable"
      : `Monitoring evidence ${age} min ago${freshness === "stale" ? " · stale" : ""}`;
    const evidence = element("p", "sample-freshness", prefix + label);
    if (check.lastEvidenceAt) evidence.title = check.lastEvidenceAt;
    const metrics = element("div", "check-metrics", check.uptime
      ? `Overall uptime ${check.uptime}`
      : "Uptime pending");
    article.append(heading, metrics, details, evidence, createBar(check, check.startDay, period, now));
    return article;
  }

  function createGroup(group, checks, period, now, remembered) {
    const starts = checks.map((check) => check.startDay).filter(Boolean).sort();
    const earliest = starts[0] || "";
    const days = buildDays(now, periodDays(period, earliest, now));
    const status = groupStatus(checks, now);
    const secondary = group.id === "other-projects";
    const details = element("details", `service-group ${secondary ? "service-group--secondary" : "service-group--primary"} ${status.health}`);
    details.dataset.group = group.id;
    details.open = remembered ?? (!secondary && ["down", "degraded"].includes(status.health));
    const summary = element("summary", "service-group__summary");
    const identity = element("span", "service-group__identity");
    identity.append(
      element("strong", "service-group__title", group.title),
      element("span", "service-group__count", `${checks.length} check${checks.length === 1 ? "" : "s"}`),
    );
    const states = checks.map((check) => days.map((day) => enrolledDayState(day, check.startDay, check, days[days.length - 1])));
    const combined = days.map((_, index) => aggregateState(states.map((row) => row[index]).filter((state) => state !== null)));
    summary.append(identity, element("span", "service-group__status", status.label),
      createBarFromStates(days, combined, `Combined ${periodLabel(period, earliest).toLowerCase()}`));
    const components = element("div", "service-group__components");
    components.append(...checks.map((check) => createComponent(check, period, now)));
    details.append(summary, components);
    return details;
  }

  function createPerformanceGroup(group, checks, period, now, remembered) {
    const windows = checks.map((check) => timingWindow(check.performance, period, now));
    const measured = windows.filter((window) => window.count).length;
    const details = element("details", "service-group performance-group");
    details.dataset.group = group.id;
    details.open = remembered ?? (group.id === "tele-proxy" && measured > 0);
    const summary = element("summary", "service-group__summary");
    summary.append(element("strong", "service-group__title", group.title),
      element("span", "performance-group__coverage", `${measured} of ${checks.length} checks with timings`));
    const components = element("div", "service-group__components");
    components.append(...checks.map((check, index) => createPerformanceCheck(check, windows[index])));
    details.append(summary, components);
    return details;
  }

  const exported = { aggregateState, buildDays, dayState, enrolledDayState, groupStatus, headingHasHistoryLink, incidentFreePercent,
    periodDays, periodLabel, sampleFreshness, timingWindow };
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  if (typeof document === "undefined") return;

  let snapshot;
  let unavailable = false;
  let adoptedV2 = false;
  let legacyCoverage = false;
  let renderedSection;
  let renderedPeriod;
  let renderedSnapshot;
  let renderedMinute;
  let pending = false;
  let view = new URLSearchParams(window.location.search).get("view") === "performance" ? "performance" : "uptime";
  const groupPreferences = { uptime: new Map(), performance: new Map() };

  function configureMode(section) {
    const siblings = section.parentElement;
    let control = siblings.querySelector(":scope > .monitoring-mode");
    if (!control) {
      control = element("div", "monitoring-mode");
      control.setAttribute("role", "group");
      control.setAttribute("aria-label", "Monitoring view");
      for (const mode of ["uptime", "performance"]) {
        const button = element("button", "", mode === "uptime" ? "Uptime" : "Performance");
        button.type = "button";
        button.dataset.view = mode;
        button.addEventListener("click", () => {
          view = mode;
          const url = new URL(window.location.href);
          if (mode === "performance") url.searchParams.set("view", mode);
          else url.searchParams.delete("view");
          window.history.replaceState(window.history.state, "", url);
          render();
        });
        control.append(button);
      }
      section.before(control);
    }
    for (const button of control.children) button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }

  function render() {
    const section = document.querySelector(".live-status");
    const selected = document.querySelector('input[name="d"]:checked')?.value;
    const period = selected === "year" || selected === "all" ? selected : "month";
    const now = new Date();
    if (!section) return;

    configureMode(section);
    let notice = section.previousElementSibling;
    if (!notice?.classList.contains("monitoring-notice")) {
      notice = element("p", "monitoring-notice");
      notice.setAttribute("role", "status");
      section.before(notice);
    }
    const incomplete = snapshot?.checks.filter((check) => sampleFreshness(check.lastEvidenceAt, now) !== "fresh").length;
    const message = unavailable
      ? snapshot ? `Snapshot refresh failed. Showing the last available ${legacyCoverage ? "legacy-coverage " : ""}snapshot.` : "Current monitoring snapshot is unavailable. The status below is from the last page build."
      : !snapshot ? "Loading monitoring snapshot…"
      : legacyCoverage ? "Legacy snapshot coverage: showing the original checks until the full feed is available."
      : view === "performance" ? "Daily averages of recorded successful checks. Gaps indicate days without a timing sample."
      : incomplete ? `${incomplete} of ${snapshot.checks.length} checks have stale or missing evidence. Showing last-known status.`
      : `All ${snapshot.checks.length} checks have monitoring evidence within 20 minutes.`;
    notice.classList.toggle("monitoring-notice--delayed", Boolean(unavailable || legacyCoverage || (view === "uptime" && incomplete)));
    if (notice.textContent !== message) notice.textContent = message;
    if (!snapshot) return;

    const minute = Math.floor(now.getTime() / REFRESH_MS);
    if (renderedSection === section && renderedPeriod === period && renderedSnapshot === snapshot &&
        renderedMinute === minute && section.dataset.view === view &&
        section.firstElementChild?.classList.contains("service-group")) return;
    renderedSection = section;
    renderedPeriod = period;
    renderedSnapshot = snapshot;
    renderedMinute = minute;
    if (section.dataset.view) {
      for (const group of section.querySelectorAll(":scope > .service-group")) {
        groupPreferences[section.dataset.view].set(group.dataset.group, group.open);
      }
    }
    const focused = document.activeElement;
    const focusedGroup = focused?.closest(".service-group")?.dataset.group;
    const focusedHref = focused?.getAttribute("href");
    const create = view === "performance" ? createPerformanceGroup : createGroup;
    section.replaceChildren(...snapshot.groups.map((group) => create(
      group, snapshot.checks.filter((check) => check.group === group.id), period, now, groupPreferences[view].get(group.id),
    )));
    if (focusedGroup) {
      const group = [...section.children].find((child) => child.dataset.group === focusedGroup);
      const target = focusedHref
        ? [...(group?.querySelectorAll("a") || [])].find((link) => link.getAttribute("href") === focusedHref)
        : group?.querySelector("summary");
      target?.focus({ preventScroll: true });
    }
    section.classList.add("live-status--grouped");
    section.dataset.period = period;
    section.dataset.view = view;
  }

  function validTimestamp(value) {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }

  function validDay(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && dateKey(date) === value;
  }

  function validMonitor(monitor) {
    return monitor === null || (monitor && Number.isSafeInteger(monitor.runId) &&
      monitor.runId > 0 && typeof monitor.sourceSha === "string" && /^[a-f0-9]{40}$/.test(monitor.sourceSha) &&
      (monitor.startedAt === null || validTimestamp(monitor.startedAt)));
  }

  function validPerformance(performance) {
    if (!performance || !Array.isArray(performance.days)) return false;
    if (performance.latestAt !== null && (!validTimestamp(performance.latestAt) ||
        !Number.isFinite(performance.latestMs) || performance.latestMs <= 0)) return false;
    return performance.days.every((row) => Array.isArray(row) && row.length === 3 &&
      validDay(row[0]) && Number.isSafeInteger(row[1]) && row[1] > 0 &&
      Number.isFinite(row[2]) && row[2] > 0);
  }

  function validateFeed(next, version) {
    if (!next || next.schemaVersion !== version || typeof next.sourceSha !== "string" ||
        !/^[a-f0-9]{40}$/.test(next.sourceSha) || !validMonitor(next.monitor) ||
        !Array.isArray(next.groups) || !next.groups.length ||
        !Array.isArray(next.checks) || !next.checks.length) throw new Error("Unsupported status snapshot");
    const groupIds = new Set();
    for (const group of next.groups) {
      if (!group || typeof group.id !== "string" || !group.id || typeof group.title !== "string" || !group.title ||
          groupIds.has(group.id)) throw new Error("Invalid status group");
      groupIds.add(group.id);
    }
    const slugs = new Set();
    for (const check of next.checks) {
      if (!check || typeof check.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(check.slug) ||
          typeof check.name !== "string" || !check.name || !groupIds.has(check.group) || slugs.has(check.slug) ||
          !check.dailyMinutesDown || typeof check.dailyMinutesDown !== "object" ||
          Array.isArray(check.dailyMinutesDown) || !validPerformance(check.performance)) {
        throw new Error("Invalid status check");
      }
      if (check.lastUpdated !== null && check.lastUpdated !== undefined && !validTimestamp(check.lastUpdated)) {
        throw new Error("Invalid evidence timestamp");
      }
      if (check.lastEvidenceAt !== null && check.lastEvidenceAt !== undefined && !validTimestamp(check.lastEvidenceAt)) {
        throw new Error("Invalid evidence timestamp");
      }
      if (check.startDay != null && !validDay(check.startDay)) throw new Error("Invalid start day");
      slugs.add(check.slug);
    }
    return next;
  }

  async function fetchFeed(url, version) {
    const response = await fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
    return validateFeed(await response.json(), version);
  }

  function useSnapshot(next, full) {
    // validateFeed already rejected missing provenance and malformed rows.
    snapshot = next;
    adoptedV2 = Boolean(full);
    legacyCoverage = !full;
  }

  async function refresh() {
    if (pending) return;
    pending = true;
    try {
      if (!adoptedV2) {
        try {
          useSnapshot(await fetchFeed(SNAPSHOT_V2_URL, 2), true);
        } catch {
          useSnapshot(await fetchFeed(SNAPSHOT_URL, 1), false);
        }
      } else {
        useSnapshot(await fetchFeed(SNAPSHOT_V2_URL, 2), true);
      }
      unavailable = false;
    } catch {
      // Keep the last good feed; never downgrade after v2 adoption.
      unavailable = true;
    } finally {
      pending = false;
      render();
    }
  }

  function start() {
    if (document.documentElement.dataset.statusSnapshot === "enabled") return;
    document.documentElement.dataset.statusSnapshot = "enabled";
    new MutationObserver(render).observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", (event) => {
      if (event.target.matches('input[name="d"]')) render();
    });
    document.querySelector("#data_month")?.click();
    refresh();
    window.setInterval(refresh, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
