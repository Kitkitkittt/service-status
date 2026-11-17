(function () {
  const DAY_MS = 86400000;
  const DAY_COUNT = 90;
  const SVG_WIDTH = 668;
  const SVG_HEIGHT = 16;
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const STALE_AFTER_MS = 20 * 60 * 1000;
  const DATA_BASE_URL = "https://raw.githubusercontent.com/Kitkitkittt/service-status/master/";
  const SERVICE_GROUPS = [
    {
      key: "vnibb",
      title: "VNIBB",
      slugs: ["vnibb-dashboard"],
    },
    {
      key: "gampo",
      title: "Gampo",
      slugs: ["gampo-simulator"],
    },
    {
      key: "research-wiki",
      title: "Research Wiki",
      slugs: [
        "research-wiki-liveness",
        "research-wiki-readiness",
        "research-wiki-application-auth-boundary",
        "research-wiki-mcp-auth-boundary",
      ],
    },
    {
      key: "9router",
      title: "9Router",
      slugs: ["9-router-web-ui", "9-router-api-health", "9-router-api-auth-boundary"],
    },
    {
      key: "tele-proxy",
      title: "Tele-proxy",
      slugs: ["tele-proxy-api-health", "tele-proxy-web-ui", "tele-proxy-api-auth-boundary"],
    },
    {
      key: "grafana",
      title: "Grafana",
      slugs: ["grafana-api-health", "grafana-api-auth-boundary"],
    },
    {
      key: "langfuse",
      title: "Langfuse",
      slugs: ["langfuse-liveness", "langfuse-readiness"],
    },
    {
      key: "other-projects",
      title: "Other projects",
      secondary: true,
      slugs: [
        "keith-digital-garden",
        "mechanical-watch-explainer",
        "auto-scientist-write-up",
        "f-1-racing-demo",
        "chords-lab",
      ],
    },
  ];

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
    const sampled = new Date(summary.lastEvidenceAt || summary.lastUpdated);
    if (!Number.isNaN(sampled.getTime()) && day > dateKey(sampled)) return "unknown";
    const minutesDown = Number(summary.dailyMinutesDown?.[day] || 0);
    if (minutesDown >= 1440) return "full-outage";
    if (minutesDown > 0 || (day === today && summary.status === "down")) return "partial-outage";
    return "operational";
  }

  function aggregateState(states) {
    if (!states.length || states.includes("unknown")) return "unknown";
    if (states.every((state) => state === "full-outage")) return "full-outage";
    if (states.some((state) => state === "partial-outage" || state === "full-outage")) return "partial-outage";
    return "operational";
  }

  function incidentFreePercent(states) {
    const monitored = states.filter((state) => state !== "unknown");
    if (!monitored.length) return null;
    return (monitored.filter((state) => state === "operational").length / monitored.length) * 100;
  }

  function startDayFromHistory(history) {
    const match = history.match(/^startTime:\s*(.+)$/m);
    if (!match) return "";
    const start = new Date(match[1].trim());
    return Number.isNaN(start.getTime()) ? "" : dateKey(start);
  }

  function lastUpdatedFromHistory(history) {
    return history.match(/^lastUpdated:\s*(.+)$/m)?.[1].trim() || "";
  }

  function sampleFreshness(timestamp, now = new Date()) {
    const sampled = new Date(timestamp).getTime();
    const age = now.getTime() - sampled;
    if (!Number.isFinite(sampled) || age < -60000) {
      return { state: "unknown", label: "Check time unavailable" };
    }
    const minutes = Math.max(0, Math.floor(age / 60000));
    return {
      state: age > STALE_AFTER_MS ? "stale" : "fresh",
      label: `Monitoring evidence ${minutes} min ago${age > STALE_AFTER_MS ? " · refresh to verify" : ""}`,
    };
  }

  function runCoversSite(config, name, url) {
    // Accept the repository's literal YAML layout; unfamiliar formats fail closed.
    return config.split(/^  - name: /m).slice(1).some((block) =>
      block.split("\n")[0].trim() === name &&
      block.match(/^    url: (.+)$/m)?.[1].trim() === url,
    );
  }

  function monitoringEvidence(historyTime, runTime, coveredByRun) {
    const historyMs = Date.parse(historyTime);
    const runMs = coveredByRun ? Date.parse(runTime) : NaN;
    if (Number.isFinite(runMs) && (!Number.isFinite(historyMs) || runMs > historyMs)) {
      return runTime;
    }
    return historyTime;
  }

  function slugFromArticle(article) {
    const href = article.querySelector("h4 a")?.getAttribute("href") || "";
    return href.match(/\/history\/([^/?#]+)/)?.[1] || "";
  }

  function groupForSlug(slug) {
    return SERVICE_GROUPS.find((group) => group.slugs.includes(slug)) || SERVICE_GROUPS[SERVICE_GROUPS.length - 1];
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

  function groupStatus(articles) {
    if (articles.some((article) => article.dataset.sampleState !== "fresh")) {
      return { className: "unknown", label: "Awaiting fresh checks" };
    }
    if (articles.some((article) => article.classList.contains("down"))) {
      return { className: "down", label: "Outage" };
    }
    if (articles.some((article) => article.classList.contains("degraded"))) {
      return { className: "degraded", label: "Degraded" };
    }
    return { className: "up", label: "Operational" };
  }

  function refreshFreshness(articles, summaries, now = new Date()) {
    let stale = 0;
    let unknown = 0;
    articles.forEach((article) => {
      const summary = summaries.get(slugFromArticle(article));
      const timestamp = summary?.lastEvidenceAt || "";
      const freshness = sampleFreshness(timestamp, now);
      article.dataset.sampleState = freshness.state;
      if (freshness.state === "stale") stale += 1;
      if (freshness.state === "unknown") unknown += 1;
      let label = article.querySelector(".sample-freshness");
      if (!label) {
        label = element("p", "sample-freshness");
        article.appendChild(label);
      }
      label.title = timestamp ? `Latest evidence: ${timestamp}; saved history record: ${summary?.lastUpdated || "unavailable"}. Healthy checks do not rewrite history on every run.` : "No verified monitoring timestamp";
      if (label.textContent !== freshness.label) label.textContent = freshness.label;
    });

    const section = document.querySelector(".live-status");
    if (!section) return;
    let notice = document.querySelector(".monitoring-notice");
    if (!notice) {
      notice = element("p", "monitoring-notice");
      notice.setAttribute("role", "status");
      section.before(notice);
    }
    const delayed = stale + unknown > 0;
    notice.classList.toggle("monitoring-notice--delayed", delayed);
    const message = delayed
      ? `Fresh monitoring evidence needed: ${stale} older than 20 minutes, ${unknown} unavailable. Reload to refresh. Saved history timestamps are not a workflow heartbeat. Private node and worker health are not measured here.`
      : `All ${articles.length} public checks have monitoring evidence within 20 minutes. Freshness uses saved checks and successful monitor runs covering each endpoint. Private node and worker health are not measured here.`;
    if (notice.textContent !== message) notice.textContent = message;

    section.querySelectorAll(":scope > .service-group").forEach((details) => {
      const status = groupStatus([...details.querySelectorAll("article")]);
      details.classList.remove("up", "down", "degraded", "unknown");
      details.classList.add(status.className);
      const label = details.querySelector(".service-group__status");
      if (label.textContent !== status.label) label.textContent = status.label;
    });
  }

  function createGroup(group, articles, summaries, starts, openGroups, period) {
    const today = new Date();
    const startDays = articles.map((article) => starts.get(slugFromArticle(article)) || "").filter(Boolean);
    const earliestStartDay = startDays.sort()[0] || "";
    const days = buildDays(today, periodDays(period, earliestStartDay, today));
    const details = element("details", `service-group ${group.secondary ? "service-group--secondary" : "service-group--primary"}`);
    const summary = element("summary", "service-group__summary");
    const identity = element("span", "service-group__identity");
    const status = groupStatus(articles);
    const groupSummaries = articles.map((article) => summaries.get(slugFromArticle(article)));
    const components = element("div", "service-group__components");

    details.dataset.group = group.key;
    details.classList.add(status.className);
    details.open = openGroups.has(group.key) || (!group.secondary && status.className !== "up");
    identity.append(
      element("strong", "service-group__title", group.title),
      element("span", "service-group__count", `${articles.length} component${articles.length === 1 ? "" : "s"}`),
    );
    summary.append(identity, element("span", "service-group__status", status.label));

    const componentStates = groupSummaries.map((serviceSummary) =>
      serviceSummary
        ? statesForSummary(serviceSummary, starts.get(serviceSummary.slug) || "", days)
        : days.map(() => "unknown"),
    );
    const aggregateStates = days.map((_, index) =>
      aggregateState(componentStates.map((states) => states[index])),
    );
    summary.append(createBarFromStates(days, aggregateStates, `Combined ${periodLabel(period, earliestStartDay).toLowerCase()}`));

    articles.forEach((article) => components.appendChild(article));
    details.append(summary, components);
    return details;
  }

  function groupArticles(articles, summaries = new Map(), starts = new Map(), period = "month") {
    const section = document.querySelector(".live-status");
    if (!section) return;
    const openGroups = new Set(
      [...section.querySelectorAll(":scope > .service-group[open]")].map((group) => group.dataset.group),
    );
    const articlesByGroup = new Map(SERVICE_GROUPS.map((group) => [group.key, []]));

    articles.forEach((article) => {
      articlesByGroup.get(groupForSlug(slugFromArticle(article)).key).push(article);
    });

    const fragment = document.createDocumentFragment();
    SERVICE_GROUPS.forEach((group) => {
      const groupedArticles = articlesByGroup.get(group.key);
      if (groupedArticles.length) {
        fragment.appendChild(createGroup(group, groupedArticles, summaries, starts, openGroups, period));
      }
    });
    section.replaceChildren(fragment);
    section.classList.add("live-status--grouped");
  }

  const exported = {
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
    runCoversSite,
    monitoringEvidence,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  if (typeof document === "undefined") return;

  let dataPromise;
  let rendering = false;
  let rerenderRequested = false;
  let currentSummaries = new Map();

  function loadData() {
    if (dataPromise) return dataPromise;
    dataPromise = fetch(`${DATA_BASE_URL}history/summary.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Summary request failed: ${response.status}`);
        return response.json();
      })
      .then(async (summaries) => {
        const monitor = (async () => {
          try {
            const response = await fetch("https://api.github.com/repos/Kitkitkittt/service-status/actions/workflows/uptime.yml/runs?branch=master&status=success&per_page=1");
            if (!response.ok) return null;
            const run = (await response.json()).workflow_runs?.[0];
            if (!run || run.status !== "completed" || run.conclusion !== "success" || !/^[a-f0-9]{40}$/.test(run.head_sha)) return null;
            const config = await fetch(`https://raw.githubusercontent.com/Kitkitkittt/service-status/${run.head_sha}/.upptimerc.yml`);
            return config.ok ? { startedAt: run.run_started_at, config: await config.text() } : null;
          } catch {
            return null;
          }
        })();
        const starts = await Promise.all(
          summaries.map(async ({ slug }) => {
            try {
              const response = await fetch(`${DATA_BASE_URL}history/${slug}.yml`);
              const history = response.ok ? await response.text() : "";
              return [slug, { startDay: startDayFromHistory(history), lastUpdated: lastUpdatedFromHistory(history) }];
            } catch {
              return [slug, { startDay: "", lastUpdated: "" }];
            }
          }),
        );
        const metadata = new Map(starts);
        const run = await monitor;
        return {
          summaries: new Map(summaries.map((summary) => {
            const lastUpdated = metadata.get(summary.slug)?.lastUpdated || "";
            return [summary.slug, {
              ...summary,
              lastUpdated,
              lastEvidenceAt: monitoringEvidence(lastUpdated, run?.startedAt || "", Boolean(run && runCoversSite(run.config, summary.name, summary.url))),
            }];
          })),
          starts: new Map(starts.map(([slug, data]) => [slug, data.startDay])),
        };
      });
    return dataPromise;
  }

  async function render() {
    if (rendering) {
      rerenderRequested = true;
      return;
    }
    const section = document.querySelector(".live-status");
    const articles = [...document.querySelectorAll(".live-status article")];
    if (!section || !articles.length) return;
    const selectedPeriod = document.querySelector('input[name="d"]:checked')?.value;
    const period = selectedPeriod === "year" || selectedPeriod === "all" ? selectedPeriod : "month";
    const periodChanged = section.dataset.period !== period;
    if (periodChanged) articles.forEach((article) => article.querySelector(".uptime-strip")?.remove());
    const needsBars = articles.some((article) => !article.querySelector(".uptime-strip"));
    const needsGrouping = articles.some((article) => !article.closest(".service-group"));
    if (!needsBars && !needsGrouping && !periodChanged) return;

    rendering = true;
    try {
      const { summaries, starts } = await loadData();
      currentSummaries = summaries;
      refreshFreshness(articles, summaries);
      articles.forEach((article) => {
        const slug = slugFromArticle(article);
        const serviceSummary = summaries.get(slug);
        if (!article.querySelector(".uptime-strip")) {
          const startDay = starts.get(slug) || "";
          const days = buildDays(new Date(), periodDays(period, startDay));
          article.appendChild(
            serviceSummary
              ? createBar(serviceSummary, startDay, period)
              : createBarFromStates(days, days.map(() => "unknown"), periodLabel(period, startDay)),
          );
        }
      });
      groupArticles(articles, summaries, starts, period);
    } catch (error) {
      refreshFreshness(articles, new Map());
      articles.forEach((article) => {
        if (!article.querySelector(".uptime-strip")) {
          const days = buildDays(new Date(), periodDays(period));
          article.appendChild(createBarFromStates(days, days.map(() => "unknown"), periodLabel(period)));
        }
      });
      groupArticles(articles, new Map(), new Map(), period);
      console.error("Unable to render uptime history", error);
    } finally {
      section.dataset.period = period;
      rendering = false;
      if (rerenderRequested) {
        rerenderRequested = false;
        render();
      }
    }
  }

  function start() {
    const observer = new MutationObserver(render);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", (event) => {
      if (event.target.matches('input[name="d"]')) render();
    });
    function selectDefaultPeriod() {
      const month = document.querySelector("#data_month");
      if (month && !document.querySelector('#data_year:checked, #data_all:checked')) {
        month.click();
      } else {
        render();
      }
    }
    selectDefaultPeriod();
    window.setTimeout(selectDefaultPeriod, 0);
    window.setInterval(() => {
      refreshFreshness([...document.querySelectorAll(".live-status article")], currentSummaries);
    }, 60000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
