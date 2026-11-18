(function () {
  const DAY_MS = 86400000;
  const DAY_COUNT = 90;
  const SVG_WIDTH = 668;
  const SVG_HEIGHT = 16;
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const STALE_AFTER_MS = 20 * 60 * 1000;
  const SNAPSHOT_URL = "https://raw.githubusercontent.com/Kitkitkittt/service-status/status-data/status.json";
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

  function dayState(day, startDay, summary, today) {
    if (!startDay || day < startDay) return "unknown";
    // A stopped monitor cannot establish availability on subsequent days.
    const sampled = new Date(summary.lastEvidenceAt || summary.lastUpdated || NaN);
    if (!Number.isNaN(sampled.getTime()) && day > dateKey(sampled)) return "unknown";
    const minutesDown = Number(summary.dailyMinutesDown?.[day] || 0);
    if (minutesDown >= 1440) return "full-outage";
    if (minutesDown > 0 || (day === today && summary.status === "down")) return "partial-outage";
    return "operational";
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

  function createComponent(check, period, now) {
    const health = Object.hasOwn(HEALTH_LABELS, check.status) ? check.status : "unknown";
    const article = element("article", health);
    const heading = element("h4");
    const link = element("a", "", check.name);
    link.href = `history/${check.slug}`;
    heading.append(link);
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
      ? `Overall uptime ${check.uptime} · Avg response ${check.time} ms`
      : "Uptime and response time pending");
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
    const states = checks.map((check) => statesForSummary(check, check.startDay, days));
    const combined = days.map((_, index) => aggregateState(states.map((row) => row[index])));
    summary.append(identity, element("span", "service-group__status", status.label),
      createBarFromStates(days, combined, `Combined ${periodLabel(period, earliest).toLowerCase()}`));
    const components = element("div", "service-group__components");
    components.append(...checks.map((check) => createComponent(check, period, now)));
    details.append(summary, components);
    return details;
  }

  const exported = { aggregateState, buildDays, dayState, groupStatus, incidentFreePercent,
    periodDays, periodLabel, sampleFreshness };
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  if (typeof document === "undefined") return;

  let snapshot;
  let unavailable = false;
  let renderedSection;
  let renderedPeriod;
  let renderedSnapshot;
  let renderedMinute;
  let pending = false;

  function render() {
    const section = document.querySelector(".live-status");
    const selected = document.querySelector('input[name="d"]:checked')?.value;
    const period = selected === "year" || selected === "all" ? selected : "month";
    const now = new Date();
    if (!section) return;

    let notice = section.previousElementSibling;
    if (!notice?.classList.contains("monitoring-notice")) {
      notice = element("p", "monitoring-notice");
      notice.setAttribute("role", "status");
      section.before(notice);
    }
    const incomplete = snapshot?.checks.filter((check) => sampleFreshness(check.lastEvidenceAt, now) !== "fresh").length;
    const message = unavailable
      ? snapshot ? "Snapshot refresh failed. Showing the last available snapshot." : "Current monitoring snapshot is unavailable. The status below is from the last page build."
      : !snapshot ? "Loading monitoring snapshot…"
      : incomplete ? `${incomplete} of ${snapshot.checks.length} checks have stale or missing evidence. Showing last-known status.`
      : `All ${snapshot.checks.length} checks have monitoring evidence within 20 minutes.`;
    notice.classList.toggle("monitoring-notice--delayed", Boolean(unavailable || incomplete));
    if (notice.textContent !== message) notice.textContent = message;
    if (!snapshot) return;

    const minute = Math.floor(now.getTime() / REFRESH_MS);
    if (renderedSection === section && renderedPeriod === period && renderedSnapshot === snapshot &&
        renderedMinute === minute && section.firstElementChild?.classList.contains("service-group")) return;
    renderedSection = section;
    renderedPeriod = period;
    renderedSnapshot = snapshot;
    renderedMinute = minute;
    const open = new Map([...section.querySelectorAll(":scope > .service-group")].map((group) => [group.dataset.group, group.open]));
    const focused = document.activeElement;
    const focusedGroup = focused?.closest(".service-group")?.dataset.group;
    const focusedHref = focused?.getAttribute("href");
    section.replaceChildren(...snapshot.groups.map((group) => createGroup(
      group, snapshot.checks.filter((check) => check.group === group.id), period, now, open.get(group.id),
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
  }

  async function refresh() {
    if (pending) return;
    pending = true;
    try {
      const response = await fetch(SNAPSHOT_URL, { cache: "no-cache", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
      const next = await response.json();
      if (next.schemaVersion !== 1 || !Array.isArray(next.groups) || !Array.isArray(next.checks)) {
        throw new Error("Unsupported status snapshot");
      }
      if (snapshot?.sourceSha !== next.sourceSha || snapshot?.monitor?.runId !== next.monitor?.runId) {
        snapshot = next;
      }
      unavailable = false;
    } catch {
      unavailable = true;
    } finally {
      pending = false;
      render();
    }
  }

  function start() {
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
