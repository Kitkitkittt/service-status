"""Validate the catalog, import a reviewed Tele-proxy export, and build public status data."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

import yaml

CONFIG = Path(".upptimerc.yml")
EXPORT = Path("contracts/tele-proxy.json")
COVERAGE = Path("COVERAGE.md")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
FENCE = "<!-- generated public checks -->"
PROBE_KEYS = ("name", "slug", "url", "expectedStatusCodes", "timeout")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_yaml(path):
    return yaml.safe_load(path.read_text())


def probes(checks):
    return [{key: check[key] for key in PROBE_KEYS} for check in checks]


def tele_contract():
    contract = json.loads(EXPORT.read_text())
    require(set(contract) == {"schemaVersion", "group", "checks"}, "Unexpected export fields")
    require(contract["schemaVersion"] == 1, "Unsupported Tele-proxy export version")
    require(contract["group"] == {"id": "tele-proxy", "title": "Tele-proxy"}, "Wrong service group")
    checks = contract["checks"]
    require(checks, "The Tele-proxy export is empty")
    for check in checks:
        require(set(check) == {*PROBE_KEYS, "description"}, "Unexpected probe fields")
        require(check["slug"].startswith("tele-proxy-"), "Wrong Tele-proxy slug namespace")
        require(urlsplit(check["url"]).hostname == "tele-proxy.vnibb.xyz", "Wrong Tele-proxy public host")
        require(0 < len(check["description"]) < 160 and "\n" not in check["description"], "Invalid description")
    return checks


def validate(sites, contract):
    slugs = [site["slug"] for site in sites]
    require(len(set(slugs)) == len(slugs), "Duplicate check slug")
    require(len({site["name"] for site in sites}) == len(sites), "Duplicate check name")
    for site in sites:
        url = urlsplit(site["url"])
        require(SLUG.fullmatch(site["slug"]), "Invalid check slug")
        require(url.scheme == "https" and url.hostname and not url.username and
                not url.password and not url.query and not url.fragment, f"Invalid URL for {site['slug']}")
        codes = site["expectedStatusCodes"]
        require(codes and all(type(code) is int and 100 <= code <= 599 for code in codes),
                f"Invalid HTTP codes for {site['slug']}")
        require(type(site["timeout"]) is int and 0 < site["timeout"] <= 15000,
                f"Invalid timeout for {site['slug']}")
    managed = [site for site in sites if site["slug"].startswith("tele-proxy-")]
    require(managed == probes(contract), "Tele-proxy checks drifted. Run scripts/status_data.py sync.")


def catalog(sites, contract):
    source = load_yaml(Path("catalog.yml"))
    groups = source["groups"]
    checks = source["checks"]
    for check in contract:
        require(check["slug"] not in checks, "Tele-proxy metadata belongs in its export")
        checks[check["slug"]] = ["tele-proxy", check["description"]]
    require(set(checks) == {site["slug"] for site in sites}, "Catalog checks differ from Upptime")
    group_ids = list(groups)
    group_ids.insert(group_ids.index("grafana"), "tele-proxy")
    groups["tele-proxy"] = "Tele-proxy"
    require(set(group_ids) == {group for group, _ in checks.values()}, "Missing or empty groups")
    return {
        "groups": [{"id": group, "title": groups[group]} for group in group_ids],
        "checks": {slug: {"group": group, "description": description}
                   for slug, (group, description) in checks.items()},
    }


def coverage_text(sites, metadata):
    source = COVERAGE.read_text()
    before, _, after = source.split(FENCE)
    groups = {group["id"]: group["title"] for group in metadata["groups"]}
    rows = [f"The public status page tracks **{len(sites)} HTTPS checks across {len(groups)} groups**.",
            "", "| Group | Check | Expected HTTP | What it checks |",
            "| --- | --- | --- | --- |"]
    for site in sites:
        meta = metadata["checks"][site["slug"]]
        fields = (groups[meta["group"]], site["name"],
                  ", ".join(map(str, site["expectedStatusCodes"])), meta["description"])
        rows.append("| " + " | ".join(field.replace("|", "\\|") for field in fields) + " |")
    return before + FENCE + "\n\n" + "\n".join(rows) + "\n\n" + FENCE + after


def sync_config(sites, contract):
    existing = {site["slug"] for site in sites if site["slug"].startswith("tele-proxy-")}
    require(existing <= {check["slug"] for check in contract},
            "Removing or renaming a Tele-proxy slug requires an explicit migration")
    first = next(index for index, site in enumerate(sites) if site["slug"] in existing)
    result = [site for site in sites if site["slug"] not in existing]
    result[first:first] = probes(contract)
    text = CONFIG.read_text()
    site_nodes = next(value.value for key, value in yaml.compose(text).value if key.value == "sites")
    last = first + len(existing)
    require(all(site["slug"] in existing for site in sites[first:last]),
            "Keep Tele-proxy checks adjacent in Upptime")
    start = text.rfind("\n", 0, site_nodes[first].start_mark.index) + 1
    end = text.rfind("\n", 0, site_nodes[last].start_mark.index) + 1 if last < len(sites) else text.index("\nstatus-website:") + 1
    updated = yaml.safe_dump(probes(contract), sort_keys=False, allow_unicode=True)
    updated = "".join("  " + line for line in updated.splitlines(keepends=True))
    return result, text[:start] + updated + text[end:]


def timestamp(value):
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if not isinstance(value, str):
        return None
    try:
        return timestamp(datetime.fromisoformat(value))
    except ValueError:
        return None


def contract_key(site):
    # Explicit slugs were added without changing existing check contracts.
    return {key: value for key, value in site.items() if key not in ("slug", "name")}


def snapshot(sites, metadata, source_sha, run):
    old_sites = []
    run_time = None
    if run:
        sha = run["head_sha"]
        require(re.fullmatch(r"[a-f0-9]{40}", sha), "Invalid monitor commit")
        old_config = subprocess.check_output(["git", "show", f"{sha}:{CONFIG}"], text=True)
        old_sites = yaml.safe_load(old_config)["sites"]
        run_time = timestamp(run["run_started_at"])
    summary = {row["slug"]: row for row in json.loads(Path("history/summary.json").read_text())}
    records = []
    for site in sites:
        slug = site["slug"]
        path = Path("history") / f"{slug}.yml"
        record = load_yaml(path) if path.is_file() else {}
        matches_url = record.get("url") == site["url"]
        saved_time = timestamp(record.get("lastUpdated")) if matches_url else None
        # Keep earlier history by slug. An old URL or changed probe contract cannot
        # inherit the successful run timestamp for the current check.
        covered = any(old.get("slug", slug) == slug and old["name"] == site["name"]
                      and contract_key(old) == contract_key(site) for old in old_sites)
        evidence = max(filter(None, [saved_time, run_time if covered and saved_time else None]),
                       key=datetime.fromisoformat, default=None)
        row = summary.get(slug, {})
        start = timestamp(record.get("startTime"))
        records.append({
            "slug": slug, "name": site["name"], **metadata["checks"][slug],
            "status": record.get("status", "unknown") if matches_url else "unknown",
            "lastUpdated": saved_time, "lastEvidenceAt": evidence, "startDay": start[:10] if start else None,
            "dailyMinutesDown": row.get("dailyMinutesDown", {}),
            "uptime": row.get("uptime"), "time": row.get("time"),
        })
    return {"schemaVersion": 1, "sourceSha": source_sha,
            "monitor": {"runId": run["id"], "sourceSha": run["head_sha"], "startedAt": run_time} if run else None,
            "groups": metadata["groups"], "checks": records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "sync", "snapshot"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--run", type=Path)
    args = parser.parse_args()
    sites = load_yaml(CONFIG)["sites"]
    contract = tele_contract()
    if args.command == "sync":
        sites, config = sync_config(sites, contract)
    validate(sites, contract)
    metadata = catalog(sites, contract)
    coverage = coverage_text(sites, metadata)
    if args.command == "sync":
        CONFIG.write_text(config)
        COVERAGE.write_text(coverage)
    else:
        require(COVERAGE.read_text() == coverage, "Coverage drifted. Run scripts/status_data.py sync.")
    if args.command == "snapshot":
        require(args.output, "--output is required")
        source_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        run = json.loads(args.run.read_text()) if args.run else None
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(snapshot(sites, metadata, source_sha, run), indent=2) + "\n")
    print(f"Validated {len(sites)} checks across {len(metadata['groups'])} groups")


if __name__ == "__main__":
    main()
