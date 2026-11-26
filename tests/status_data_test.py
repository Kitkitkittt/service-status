import json
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]
# Public cohort at e7cfcf2bb4330d8ace72df4df480ad862c62a669; works in shallow CI.
LEGACY_COHORT = """
vnibb-dashboard gampo-simulator research-wiki-liveness research-wiki-readiness
research-wiki-application-auth-boundary research-wiki-mcp-auth-boundary
9-router-web-ui 9-router-api-health 9-router-api-auth-boundary tele-proxy-api-health
tele-proxy-web-ui tele-proxy-api-auth-boundary grafana-api-health grafana-api-auth-boundary
langfuse-liveness langfuse-readiness keith-digital-garden mechanical-watch-explainer
auto-scientist-write-up f1-racing-demo chords-lab
""".split()


class StatusDataTest(unittest.TestCase):
    def test_import_added_check_and_rename_preserve_history_and_run_coverage(self):
        with TemporaryDirectory() as directory:
            repo = Path(directory)
            for name in (".upptimerc.yml", "catalog.yml", "COVERAGE.md"):
                shutil.copy(ROOT / name, repo)
            for name in ("history", "contracts"):
                shutil.copytree(ROOT / name, repo / name)

            existing_sites = {
                site["slug"]: site
                for site in yaml.safe_load((repo / ".upptimerc.yml").read_text())["sites"]
            }

            def run(*args):
                return subprocess.check_output(args, cwd=repo, text=True).strip()

            run("git", "init", "-q")
            run("git", "add", ".")
            run("git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "commit", "-qm", "Existing monitoring")
            original = run("git", "rev-parse", "HEAD")
            receipt = {"head_sha": original, "id": 1, "run_started_at": "2099-01-01T00:00:00Z"}
            (repo / "run.json").write_text(json.dumps(receipt))

            export = repo / "contracts/tele-proxy.json"
            contract = json.loads(export.read_text())
            original_check = contract["checks"][0]
            old_history = (repo / "history/tele-proxy-api-health.yml").read_bytes()
            original_check["name"] = "Tele-proxy Gateway Listener"
            added_slug = "tele-proxy-fixture-health"
            contract["checks"].append({**original_check, "slug": added_slug,
                                       "name": "Tele-proxy Fixture", "url": "https://tele-proxy.vnibb.xyz/status-fixture"})
            export.write_text(json.dumps(contract))
            script = str(ROOT / "scripts/status_data.py")
            run("python3", script, "sync")
            run("python3", script, "check")
            run("python3", script, "snapshot", "--run", "run.json", "--output", "status.json",
                "--output-v2", "status-v2.json")

            sites = yaml.safe_load((repo / ".upptimerc.yml").read_text())["sites"]
            by_slug = {site["slug"]: site for site in sites}
            records = {record["slug"]: record for record in json.loads((repo / "status.json").read_text())["checks"]}
            v2_records = {record["slug"]: record for record in json.loads((repo / "status-v2.json").read_text())["checks"]}
            renamed_slug = original_check["slug"]
            with self.subTest("sync preserves existing checks except the intended rename"):
                self.assertEqual(
                    [site for site in sites if site["slug"] != added_slug],
                    [dict(site, name=original_check["name"]) if slug == renamed_slug else site
                     for slug, site in existing_sites.items()],
                )
            self.assertEqual(by_slug[added_slug]["url"], "https://tele-proxy.vnibb.xyz/status-fixture")
            self.assertEqual((repo / "history/tele-proxy-api-health.yml").read_bytes(), old_history)
            self.assertEqual(records[original_check["slug"]]["group"], "tele-proxy")
            self.assertIsNotNone(records[original_check["slug"]]["startDay"])
            self.assertIn(original_check["name"], (repo / "COVERAGE.md").read_text())
            self.assertIn("Tele-proxy Fixture", (repo / "COVERAGE.md").read_text())
            self.assertEqual(records["tele-proxy-web-ui"]["lastEvidenceAt"], receipt["run_started_at"])
            self.assertIn(added_slug, v2_records)
            self.assertNotIn(added_slug, records)
            self.assertEqual(v2_records[added_slug]["status"], "unknown")
            self.assertIsNone(v2_records[added_slug]["lastEvidenceAt"])

    def test_snapshot_cli_keeps_legacy_cohort_and_explicit_v2_opt_in(self):
        with TemporaryDirectory() as directory:
            repo = Path(directory)
            for name in (".upptimerc.yml", "catalog.yml", "COVERAGE.md"):
                shutil.copy(ROOT / name, repo)
            for name in ("history", "contracts"):
                shutil.copytree(ROOT / name, repo / name)

            def run(*args):
                return subprocess.check_output(args, cwd=repo, text=True).strip()

            run("git", "init", "-q")
            run("git", "add", ".")
            run("git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "commit", "-qm", "Existing monitoring")
            script = str(ROOT / "scripts/status_data.py")

            # An old queued workflow that passes only --output keeps the legacy feed.
            run("python3", script, "snapshot", "--output", "old.json")
            legacy = json.loads((repo / "old.json").read_text())
            self.assertEqual(legacy["schemaVersion"], 1)
            self.assertEqual([row["slug"] for row in legacy["checks"]], LEGACY_COHORT)
            self.assertFalse((repo / "v1.json").exists())
            self.assertFalse((repo / "v2.json").exists())

            source_sha = run("git", "rev-parse", "HEAD")
            receipt = {"head_sha": source_sha, "id": 7, "run_started_at": "2099-01-01T00:00:00Z"}
            (repo / "run.json").write_text(json.dumps(receipt))
            run("python3", script, "snapshot", "--run", "run.json",
                "--output", "v1.json", "--output-v2", "v2.json")
            v1 = json.loads((repo / "v1.json").read_text())
            v2 = json.loads((repo / "v2.json").read_text())
            self.assertEqual(v1["schemaVersion"], 1)
            self.assertEqual(v2["schemaVersion"], 2)
            self.assertEqual(v1["sourceSha"], v2["sourceSha"], source_sha)
            self.assertEqual(v1["monitor"], v2["monitor"])
            self.assertEqual(v1["groups"], v2["groups"])
            self.assertEqual([row["slug"] for row in v1["checks"]], LEGACY_COHORT)
            self.assertGreater(len(v2["checks"]), len(v1["checks"]))
            v1_by_slug = {row["slug"]: row for row in v1["checks"]}
            v2_by_slug = {row["slug"]: row for row in v2["checks"]}
            self.assertEqual([row["slug"] for row in v1["checks"]],
                             [row["slug"] for row in v2["checks"] if row["slug"] in v1_by_slug])
            for slug, row in v1_by_slug.items():
                self.assertEqual(row, v2_by_slug[slug])
            for slug in ("grafana-web-ui", "langfuse-web-ui", "langfuse-api-auth-boundary"):
                self.assertIn(slug, v2_by_slug)
                self.assertNotIn(slug, v1_by_slug)


    def test_performance_excludes_failed_and_unrelated_commits(self):
        with TemporaryDirectory() as directory:
            repo = Path(directory)
            for name in (".upptimerc.yml", "catalog.yml", "COVERAGE.md"):
                shutil.copy(ROOT / name, repo)
            for name in ("history", "contracts"):
                shutil.copytree(ROOT / name, repo / name)

            def run(*args):
                return subprocess.check_output(args, cwd=repo, text=True)

            run("git", "init", "-q")
            run("git", "config", "user.name", "Monitor test")
            run("git", "config", "user.email", "test@example.invalid")
            run("git", "add", ".")
            run("git", "commit", "-qm", "Initial monitoring catalog")
            path = repo / "history/tele-proxy-api-auth-boundary.yml"
            cases = [
                ("2026-11-15T23:30:00-02:00", "is up (401 in 100 ms) [skip ci] [upptime]"),
                ("2026-11-16T05:00:00Z", "is degraded (401 in 300 ms) [skip ci] [upptime]"),
                ("2026-11-17T04:00:00Z", "is down (530 in 40 ms) [skip ci] [upptime]"),
                ("2026-11-17T05:00:00Z", "is up (200 in 9 ms) [skip ci] [upptime]"),
                ("2026-11-17T06:00:00Z", "Document service response (401 in 1 ms)"),
            ]
            for index, (date, message) in enumerate(cases):
                with path.open("a") as file:
                    file.write(f"\n# revision {index}\n")
                run("git", "commit", "-q", f"--date={date}", "-m", f"Tele-proxy {message}", "--", str(path))

            run("python3", str(ROOT / "scripts/status_data.py"), "snapshot", "--output", "status.json")
            records = json.loads((repo / "status.json").read_text())["checks"]
            auth = next(record for record in records if record["slug"] == "tele-proxy-api-auth-boundary")
            self.assertEqual(auth["performance"], {
                "days": [["2026-11-16", 2, 400]],
                "latestAt": "2026-11-16T05:00:00Z",
                "latestMs": 300,
            })

    def test_pages_and_snapshot_publication_require_master(self):
        workflows = ROOT / ".github/workflows"
        site = yaml.load((workflows / "site.yml").read_text(), Loader=yaml.BaseLoader)
        data = yaml.load((workflows / "status-data.yml").read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(site["on"]["push"]["branches"], ["master"])
        self.assertEqual(site["jobs"]["release"]["if"], "github.ref == 'refs/heads/master'")
        self.assertIn("github.ref == 'refs/heads/master'", data["jobs"]["publish"]["if"])
        self.assertIn("github.event_name != 'pull_request'", data["jobs"]["publish"]["if"])
        self.assertFalse((workflows / "update-template.yml").exists())
        self.assertFalse((workflows / "setup.yml").exists())


if __name__ == "__main__":
    unittest.main()
