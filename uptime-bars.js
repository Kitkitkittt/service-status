(function () {
  const DAY_MS = 86400000;
  const DAY_COUNT = 90;
  const SVG_WIDTH = 668;
  const SVG_HEIGHT = 16;
  const PILL_WIDTH = 5;
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const DATA_BASE_URL = "https://raw.githubusercontent.com/Kitkitkittt/service-status/master/";

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

  function stateLabel(state) {
    return {
      operational: "Operational",
      "partial-outage": "Partial outage",
      "full-outage": "Full-day outage",
      unknown: "No monitoring data",
    }[state];
  }

  function createBar(summary, startDay, today = new Date()) {
    const days = buildDays(today);
    const todayKey = days[days.length - 1];
    const states = days.map((day) => dayState(day, startDay, summary, todayKey));
    const counts = states.reduce((totals, state) => {
      totals[state] += 1;
      return totals;
    }, { operational: 0, "partial-outage": 0, "full-outage": 0, unknown: 0 });
    const bar = document.createElement("div");
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    const step = (SVG_WIDTH - PILL_WIDTH) / (days.length - 1);

    bar.className = "uptime-strip";
    bar.setAttribute("role", "img");
    bar.setAttribute(
      "aria-label",
      `90-day uptime history: ${counts.operational} operational, ${counts["partial-outage"]} partial outage, ${counts["full-outage"]} full-day outage, ${counts.unknown} without monitoring data.`,
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

    bar.appendChild(svg);
    return bar;
  }

  const exported = { buildDays, dayState, startDayFromHistory };
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
            const response = await fetch(`${DATA_BASE_URL}history/${slug}.yml`);
            return [slug, response.ok ? startDayFromHistory(await response.text()) : ""];
          }),
        );
        return { summaries: new Map(summaries.map((summary) => [summary.slug, summary])), starts: new Map(starts) };
      });
    return dataPromise;
  }

  async function render() {
    if (rendering) return;
    const articles = [...document.querySelectorAll(".live-status article")].filter(
      (article) => !article.querySelector(".uptime-strip"),
    );
    if (!articles.length) return;
    rendering = true;
    try {
      const { summaries, starts } = await loadData();
      articles.forEach((article) => {
        const slug = slugFromArticle(article);
        const summary = summaries.get(slug);
        if (summary && !article.querySelector(".uptime-strip")) {
          article.appendChild(createBar(summary, starts.get(slug) || ""));
        }
      });
    } catch (error) {
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
