import json
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]


class StatusDataTest(unittest.TestCase):
    def test_import_added_check_and_rename_preserve_history_and_run_coverage(self):
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
            run("python3", script, "snapshot", "--run", "run.json", "--output", "status.json")

            sites = yaml.safe_load((repo / ".upptimerc.yml").read_text())["sites"]
            by_slug = {site["slug"]: site for site in sites}
            records = {record["slug"]: record for record in json.loads((repo / "status.json").read_text())["checks"]}
            self.assertEqual(len(sites), 22)
            self.assertEqual(by_slug[original_check["slug"]]["name"], original_check["name"])
            self.assertEqual((repo / "history/tele-proxy-api-health.yml").read_bytes(), old_history)
            self.assertEqual(records[original_check["slug"]]["group"], "tele-proxy")
            self.assertIsNotNone(records[original_check["slug"]]["startDay"])
            self.assertIsNone(records[added_slug]["lastEvidenceAt"])
            self.assertEqual(records[added_slug]["status"], "unknown")
            self.assertIn(original_check["name"], (repo / "COVERAGE.md").read_text())
            self.assertIn("Tele-proxy Fixture", (repo / "COVERAGE.md").read_text())
            self.assertEqual(records["tele-proxy-web-ui"]["lastEvidenceAt"], receipt["run_started_at"])

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
