(function () {
  const DAY_MS = 86400000;
  const DAY_COUNT = 90;
  const SVG_WIDTH = 668;
  const SVG_HEIGHT = 16;
  const PILL_WIDTH = 5;
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
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

  function dayState(day, startDay, summary, today) {
    if (!startDay || day < startDay) return "unknown";
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
    const step = (SVG_WIDTH - PILL_WIDTH) / (days.length - 1);

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
      rect.setAttribute("width", String(PILL_WIDTH));
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

  function createBar(summary, startDay, today = new Date()) {
    const days = buildDays(today);
    return createBarFromStates(days, statesForSummary(summary, startDay, days), "90-day history");
  }

  function groupStatus(articles) {
    if (articles.some((article) => article.classList.contains("down"))) {
      return { className: "down", label: "Outage" };
    }
    if (articles.some((article) => article.classList.contains("degraded"))) {
      return { className: "degraded", label: "Degraded" };
    }
    return { className: "up", label: "Operational" };
  }

  function createGroup(group, articles, summaries, starts, openGroups) {
    const days = buildDays(new Date());
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
    summary.append(createBarFromStates(days, aggregateStates, "Combined 90-day history"));

    articles.forEach((article) => components.appendChild(article));
    details.append(summary, components);
    return details;
  }

  function groupArticles(articles, summaries = new Map(), starts = new Map()) {
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
        fragment.appendChild(createGroup(group, groupedArticles, summaries, starts, openGroups));
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
    startDayFromHistory,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  if (typeof document === "undefined") return;

  let dataPromise;
  let rendering = false;

  function loadData() {
    if (dataPromise) return dataPromise;
    dataPromise = fetch(`${DATA_BASE_URL}history/summary.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Summary request failed: ${response.status}`);
        return response.json();
      })
      .then(async (summaries) => {
        const starts = await Promise.all(
          summaries.map(async ({ slug }) => {
            try {
              const response = await fetch(`${DATA_BASE_URL}history/${slug}.yml`);
              return [slug, response.ok ? startDayFromHistory(await response.text()) : ""];
            } catch {
              return [slug, ""];
            }
          }),
        );
        return { summaries: new Map(summaries.map((summary) => [summary.slug, summary])), starts: new Map(starts) };
      });
    return dataPromise;
  }

  async function render() {
    if (rendering) return;
    const articles = [...document.querySelectorAll(".live-status article")];
    if (!articles.length) return;
    const needsBars = articles.some((article) => !article.querySelector(".uptime-strip"));
    const needsGrouping = articles.some((article) => !article.closest(".service-group"));
    if (!needsBars && !needsGrouping) return;

    rendering = true;
    groupArticles(articles);
    try {
      const { summaries, starts } = await loadData();
      articles.forEach((article) => {
        const slug = slugFromArticle(article);
        const serviceSummary = summaries.get(slug);
        if (!article.querySelector(".uptime-strip")) {
          article.appendChild(
            serviceSummary
              ? createBar(serviceSummary, starts.get(slug) || "")
              : createBarFromStates(buildDays(new Date()), Array(DAY_COUNT).fill("unknown"), "90-day history"),
          );
        }
      });
      groupArticles(articles, summaries, starts);
    } catch (error) {
      articles.forEach((article) => {
        if (!article.querySelector(".uptime-strip")) {
          article.appendChild(
            createBarFromStates(buildDays(new Date()), Array(DAY_COUNT).fill("unknown"), "90-day history"),
          );
        }
      });
      groupArticles(articles);
      console.error("Unable to render uptime history", error);
    } finally {
      rendering = false;
    }
  }

  function start() {
    const observer = new MutationObserver(render);
    observer.observe(document.body, { childList: true, subtree: true });
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
