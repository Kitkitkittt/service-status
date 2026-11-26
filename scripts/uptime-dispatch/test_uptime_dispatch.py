#!/usr/bin/env python3
"""Deterministic offline fixtures for the #84 bounded dispatch candidate.

Parent executes these in a read-only no-egress sandbox. No network, no real
credential, no GitHub write, no monitoring/history data and no systemd action.
"""

import contextlib
import datetime as dt
import fcntl
import importlib.util
import http.client
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
import unittest.mock
import urllib.error
import urllib.request

SOURCE = Path(__file__).with_name("uptime_dispatch.py")
spec = importlib.util.spec_from_file_location("uptime_dispatch", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class FakeResponse:
    status = 204
    code = 204
    msg = "No Content"

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def close(self):
        pass

    def info(self):
        return {}

    def geturl(self):
        return mod.API


class FakeOpener:
    def __init__(self, outcome):
        self.outcome = outcome
        self.calls = []

    def open(self, request, timeout):
        self.calls.append((request.get_method(), request.full_url, json.loads(request.data), request.headers))
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def tick(store, opener, token="gho_offline_test_token", now=None):
    """Run the full durable decision + single fake POST path."""
    now = now or dt.datetime.now(dt.timezone.utc)
    with store:
        state = store.load()
        store.allow_tick(state, now)
        reserved = store.precommit(state, now)
        failure, accepted = mod.dispatch(token, opener=opener)
        if accepted:
            store.settle(reserved, "accepted", accepted=True)
            return "accepted", failure
        store.settle(reserved, "held", failure_class=failure)
        return "held", failure


def held_state(tmp, failure="ambiguous_response", at=None):
    store = mod.StateStore(tmp)
    at = at or dt.datetime(2026, 11, 26, 10, 0, tzinfo=dt.timezone.utc)
    with store:
        store.initialize(at)
        reserved = store.precommit(store.load(), at)
        store.settle(reserved, "held", failure_class=failure)
    return store


class DispatchTest(unittest.TestCase):
    def test_pinned_repo_event(self):
        self.assertEqual(mod.EVENT_TYPE, "uptime")
        self.assertEqual(mod.API, "https://api.github.com/repos/Kitkitkittt/service-status/dispatches")
        self.assertEqual(mod.SLOT, dt.timedelta(minutes=5))
        self.assertEqual(mod.JITTER_MINIMUM, dt.timedelta(seconds=270))
        self.assertEqual(mod.STATE_SCHEMA, 4)

    def test_accept_is_exactly_one_post(self):
        opener = FakeOpener(FakeResponse())
        failure, accepted = mod.dispatch("gho_offline_test_token", opener=opener)
        self.assertIsNone(failure)
        self.assertTrue(accepted)
        self.assertEqual(len(opener.calls), 1)
        method, url, payload, headers = opener.calls[0]
        self.assertEqual(method, "POST")
        self.assertEqual(url, mod.API)
        self.assertEqual(payload, {"event_type": "uptime"})
        self.assertTrue(str(headers.get("Authorization", "")).endswith("gho_offline_test_token"))

    def test_no_proxy_actual_https_handler_seam(self):
        saved = {key: os.environ.get(key) for key in ("http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "ALL_PROXY")}
        try:
            for key in saved:
                os.environ[key] = "http://127.0.0.1:9"
            calls = []

            def fake_open(self, request, timeout=None):
                calls.append((request.full_url, request.host))
                request.set_proxy("proxy.invalid", "https")
                return FakeResponse()

            with unittest.mock.patch.object(urllib.request.HTTPSHandler, "https_open", fake_open):
                failure, accepted = mod.dispatch("gho_offline_test_token")
            self.assertIsNone(failure)
            self.assertTrue(accepted)
            self.assertEqual(calls, [(mod.API, "api.github.com")])
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_ambiguous_5xx_sends_once_and_holds(self):
        error = urllib.error.HTTPError(mod.API, 503, "unavailable", {}, None)
        error.close()
        opener = FakeOpener(error)
        failure, accepted = mod.dispatch("gho_offline_token", opener=opener)
        self.assertEqual(failure, "ambiguous_response")
        self.assertFalse(accepted)
        self.assertEqual(len(opener.calls), 1)

    def test_redirect_is_ambiguous_and_not_replayed(self):
        error = urllib.error.HTTPError(mod.API, 302, "Found", {}, None)
        error.close()
        opener = FakeOpener(error)
        failure, accepted = mod.dispatch("gho_offline_token", opener=opener)
        self.assertEqual(failure, "ambiguous_response")
        self.assertFalse(accepted)
        self.assertEqual(len(opener.calls), 1)

    def test_malformed_status_is_ambiguous_and_leaves_held(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = mod.StateStore(tmp)
            with store:
                store.initialize(dt.datetime(2026, 11, 26, 10, 0, tzinfo=dt.timezone.utc))
            opener = FakeOpener(http.client.BadStatusLine("malformed status"))
            result = tick(store, opener, now=dt.datetime(2026, 11, 26, 10, 5, tzinfo=dt.timezone.utc))
            self.assertEqual(result, ("held", "ambiguous_response"))
            self.assertEqual(len(opener.calls), 1)
            with mod.StateStore(tmp) as restarted:
                held = restarted.load()
            self.assertEqual(held["phase"], "held")
            self.assertEqual(held["last_failure_class"], "ambiguous_response")

    def test_definite_credential_rate_failure_sends_once(self):
        error = urllib.error.HTTPError(mod.API, 429, "Too Many Requests", {}, None)
        error.close()
        opener = FakeOpener(error)
        failure, accepted = mod.dispatch("gho_offline_token", opener=opener)
        self.assertEqual(failure, "definite_credential_or_rate_failure")
        self.assertFalse(accepted)
        self.assertEqual(len(opener.calls), 1)

    def test_no_body_or_token_leaks(self):
        stderr = io.StringIO()
        opener = FakeOpener(urllib.error.HTTPError(mod.API, 403, "secret body", {}, io.BytesIO(b"sensitive")))
        with contextlib.redirect_stderr(stderr):
            failure, accepted = mod.dispatch("gho_secret_that_must_not_print", opener=opener)
        self.assertEqual(failure, "definite_credential_or_rate_failure")
        for leaked in ("secret body", "sensitive", "gho_secret_that_must_not_print"):
            self.assertNotIn(leaked, stderr.getvalue())

    def test_strict_cross_field_state(self):
        initialized_at = dt.datetime(2026, 11, 26, 10, 0, tzinfo=dt.timezone.utc)
        attempt_at = initialized_at + dt.timedelta(minutes=10)
        attempt = attempt_at.isoformat()
        with tempfile.TemporaryDirectory() as tmp:
            store = mod.StateStore(tmp)
            with store:
                store.initialize(initialized_at)
            original = json.loads((Path(tmp) / mod.STATE_NAME).read_text())
            initialized_held = dict(original, circuit=mod.CIRCUIT_HELD)
            valid = dict(original, phase="accepted", circuit=mod.CIRCUIT_CLOSED,
                         generation=1, last_attempt_at=attempt,
                         last_accepted_at=attempt, last_tick_at=attempt)
            future_rearm_state = dict(
                valid,
                rearm_at=(attempt_at + dt.timedelta(minutes=5)).isoformat(),
                rearm_evidence="ambiguous_response",
            )
            (Path(tmp) / mod.STATE_NAME).write_text(json.dumps(valid))
            self.assertEqual(store.load()["phase"], "accepted")
            cases = (
                dict(valid, phase="initialized"),
                dict(valid, circuit=mod.CIRCUIT_HELD),
                dict(valid, last_attempt_at=None),
                dict(valid, last_accepted_at=None),
                dict(valid, generation=0),
                dict(valid, last_failure_class="unknown_failure"),
                initialized_held,
                dict(valid, rearm_at=(attempt_at - dt.timedelta(minutes=1)).isoformat(),
                     rearm_evidence="ambiguous_response"),
                future_rearm_state,
                dict(valid, rearm_at=attempt, rearm_evidence=None),
            )
            for broken in cases:
                (Path(tmp) / mod.STATE_NAME).write_text(json.dumps(broken))
                with self.assertRaises(mod.TimerError):
                    store.load()

    def test_missing_state_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(mod.TimerError):
                mod.StateStore(tmp).load()

    def test_two_consecutive_eligible_dispatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = mod.StateStore(tmp)
            with store:
                store.initialize(dt.datetime.now(dt.timezone.utc))
            t0 = dt.datetime(2026, 11, 26, 10, 0, tzinfo=dt.timezone.utc)
            first = FakeOpener(FakeResponse())
            self.assertEqual(tick(store, first, now=t0)[0], "accepted")
            second = FakeOpener(FakeResponse())
            t1 = dt.datetime(2026, 11, 26, 10, 5, tzinfo=dt.timezone.utc)
            self.assertEqual(tick(store, second, now=t1)[0], "accepted")
            self.assertEqual(len(first.calls), 1)
            self.assertEqual(len(second.calls), 1)
            final = json.loads((Path(tmp) / mod.STATE_NAME).read_text())
            self.assertEqual(final["generation"], 2)
            self.assertEqual(final["phase"], "accepted")

    def test_true_successive_slot_jitter_and_no_second_post(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = mod.StateStore(tmp)
            with store:
                store.initialize(dt.datetime.now(dt.timezone.utc))
            t0 = dt.datetime(2026, 11, 26, 10, 4, 30, tzinfo=dt.timezone.utc)
            tick(store, FakeOpener(FakeResponse()), now=t0)
            same = FakeOpener(FakeResponse())
            with self.assertRaises(mod.TimerError):
                tick(store, same, now=t0 + dt.timedelta(seconds=10))
            next_slot_early = FakeOpener(FakeResponse())
            with self.assertRaises(mod.TimerError):
                tick(store, next_slot_early, now=dt.datetime(2026, 11, 26, 10, 5, 10, tzinfo=dt.timezone.utc))
            next_slot_ok = FakeOpener(FakeResponse())
            self.assertEqual(tick(store, next_slot_ok,
                                  now=dt.datetime(2026, 11, 26, 10, 10, tzinfo=dt.timezone.utc))[0], "accepted")
            self.assertEqual(len(same.calls), 0)
            self.assertEqual(len(next_slot_early.calls), 0)
            self.assertEqual(len(next_slot_ok.calls), 1)

    def test_attempting_and_held_survive_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = mod.StateStore(tmp)
            with store:
                store.initialize(dt.datetime.now(dt.timezone.utc))
            t0 = dt.datetime(2026, 11, 26, 10, 0, tzinfo=dt.timezone.utc)
            with store:
                reserved = store.precommit(store.load(), t0)
            with mod.StateStore(tmp) as restarted:
                loaded = restarted.load()
                self.assertEqual(loaded["phase"], "attempting")
                with self.assertRaises(mod.TimerError):
                    restarted.allow_tick(loaded, t0 + dt.timedelta(hours=1))
            with store:
                store.settle(reserved, "held", "ambiguous_response")
            with mod.StateStore(tmp) as restarted:
                loaded = restarted.load()
                self.assertEqual(loaded["circuit"], mod.CIRCUIT_HELD)
                with self.assertRaises(mod.TimerError):
                    restarted.allow_tick(loaded, t0 + dt.timedelta(hours=1))

    def test_rearm_does_not_invent_acceptance_or_allow_current_slot(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = held_state(tmp, "definite_credential_or_rate_failure")
            before = json.loads((Path(tmp) / mod.STATE_NAME).read_text())
            with store:
                with self.assertRaises(mod.TimerError):
                    store.rearm(dt.datetime(2026, 11, 26, 10, 4, 59, tzinfo=dt.timezone.utc))
                rearmed = store.rearm(dt.datetime(2026, 11, 26, 10, 10, tzinfo=dt.timezone.utc))
            after = json.loads((Path(tmp) / mod.STATE_NAME).read_text())
            self.assertEqual(rearmed["phase"], "rearmed")
            self.assertEqual(rearmed["circuit"], mod.CIRCUIT_CLOSED)
            self.assertIsNone(after["last_accepted_at"])
            self.assertEqual(after["last_attempt_at"], before["last_attempt_at"])
            self.assertEqual(after["generation"], before["generation"])
            self.assertEqual(after["rearm_evidence"], "definite_credential_or_rate_failure")
            store.load()

    def test_rearm_blocks_post_in_rearm_slot_and_next_early_slot(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = held_state(tmp)
            rearm_at = dt.datetime(2026, 11, 26, 10, 14, 45, tzinfo=dt.timezone.utc)
            with store:
                store.rearm(rearm_at)
            same = FakeOpener(FakeResponse())
            with self.assertRaises(mod.TimerError):
                tick(store, same, now=dt.datetime(2026, 11, 26, 10, 14, 50, tzinfo=dt.timezone.utc))
            early = FakeOpener(FakeResponse())
            with self.assertRaises(mod.TimerError):
                tick(store, early, now=dt.datetime(2026, 11, 26, 10, 15, 1, tzinfo=dt.timezone.utc))
            ok = FakeOpener(FakeResponse())
            self.assertEqual(tick(store, ok, now=dt.datetime(2026, 11, 26, 10, 20, tzinfo=dt.timezone.utc))[0], "accepted")
            self.assertEqual(len(same.calls), 0)
            self.assertEqual(len(early.calls), 0)
            self.assertEqual(len(ok.calls), 1)


    def test_post_rearm_attempt_reopens_after_restart_and_followed_by_one_tick(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = held_state(tmp, "definite_credential_or_rate_failure")
            with store:
                store.rearm(dt.datetime(2026, 11, 26, 10, 10, tzinfo=dt.timezone.utc))
            with mod.StateStore(tmp) as restarted:
                rearmed = restarted.load()
            self.assertEqual(rearmed["phase"], "rearmed")
            self.assertEqual(rearmed["rearm_evidence"], "definite_credential_or_rate_failure")
            with store:
                reserved = store.precommit(rearmed, dt.datetime(2026, 11, 26, 10, 15, tzinfo=dt.timezone.utc))
            with mod.StateStore(tmp) as restarted:
                loaded = restarted.load()
                self.assertEqual(loaded["phase"], "attempting")
                with self.assertRaises(mod.TimerError):
                    restarted.allow_tick(loaded, dt.datetime(2026, 11, 26, 11, 15, tzinfo=dt.timezone.utc))
            with store:
                store.settle(reserved, "accepted", accepted=True)
            with mod.StateStore(tmp) as restarted:
                accepted = restarted.load()
            self.assertEqual(accepted["phase"], "accepted")
            self.assertEqual(accepted["rearm_evidence"], "definite_credential_or_rate_failure")
            self.assertIsNone(accepted["last_failure_class"])
            follower = FakeOpener(FakeResponse())
            self.assertEqual(tick(store, follower,
                                  now=dt.datetime(2026, 11, 26, 10, 20, tzinfo=dt.timezone.utc))[0], "accepted")
            self.assertEqual(len(follower.calls), 1)

    def test_post_rearm_held_reopens_after_restart_with_preserved_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = held_state(tmp)
            with store:
                store.rearm(dt.datetime(2026, 11, 26, 10, 10, tzinfo=dt.timezone.utc))
            with mod.StateStore(tmp) as restarted:
                rearmed = restarted.load()
            with store:
                reserved = store.precommit(rearmed, dt.datetime(2026, 11, 26, 10, 15, tzinfo=dt.timezone.utc))
                store.settle(reserved, "held", failure_class="ambiguous_response")
            with mod.StateStore(tmp) as restarted:
                held = restarted.load()
            self.assertEqual(held["phase"], "held")
            self.assertEqual(held["circuit"], mod.CIRCUIT_HELD)
            self.assertEqual(held["last_failure_class"], "ambiguous_response")
            self.assertEqual(held["rearm_evidence"], "ambiguous_response")
            with self.assertRaises(mod.TimerError):
                tick(store, FakeOpener(FakeResponse()),
                     now=dt.datetime(2026, 11, 26, 11, 15, tzinfo=dt.timezone.utc))
            with store:
                rearmed_again = store.rearm(dt.datetime(2026, 11, 26, 10, 20, tzinfo=dt.timezone.utc))
            self.assertEqual(rearmed_again["phase"], "rearmed")
            self.assertEqual(rearmed_again["rearm_evidence"], "ambiguous_response")
            with mod.StateStore(tmp) as restarted:
                self.assertEqual(restarted.load()["phase"], "rearmed")

    def test_crash_left_attempting_can_be_rearmed_after_reconciliation(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = mod.StateStore(tmp)
            t0 = dt.datetime(2026, 11, 26, 10, 0, tzinfo=dt.timezone.utc)
            with store:
                store.initialize(t0)
                reserved = store.precommit(store.load(), t0)
            with store:
                rearmed = store.rearm(dt.datetime(2026, 11, 26, 10, 10, tzinfo=dt.timezone.utc))
            self.assertEqual(rearmed["phase"], "rearmed")
            self.assertEqual(rearmed["rearm_evidence"], "ambiguous_response")
            self.assertEqual(rearmed["generation"], reserved["generation"])

    def test_state_file_has_no_credential_and_is_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = mod.StateStore(tmp)
            with store:
                store.initialize(dt.datetime.now(dt.timezone.utc))
            path = Path(tmp) / mod.STATE_NAME
            self.assertNotIn(b"gho_", path.read_bytes())
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_concurrent_invocations_do_not_both_enter_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = mod.StateStore(tmp)
            with store:
                store.initialize(dt.datetime.now(dt.timezone.utc))
            blocker = (Path(tmp) / mod.LOCK_NAME).open("a+")
            fcntl.flock(blocker.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                with self.assertRaises(mod.TimerError):
                    with mod.StateStore(tmp):
                        pass
            finally:
                fcntl.flock(blocker.fileno(), fcntl.LOCK_UN)
                blocker.close()
            with mod.StateStore(tmp):
                pass

    def test_credential_copy_accepts_root_or_service_owner(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "credential"
            p.touch()
            original_stat, original_access = Path.stat, os.access

            class CopyStat:
                st_size = len("gho_offline_test_token\n")
                st_uid = 0
                st_mode = stat.S_IFREG | 0o440

            try:
                Path.stat = lambda self: CopyStat()
                os.access = lambda path, mode: mode == os.R_OK
                for mode in (0o400, 0o440):
                    p.chmod(0o600)
                    p.write_text("gho_offline_test_token\n")
                    p.chmod(mode)
                    CopyStat.st_mode = stat.S_IFREG | mode
                    self.assertEqual(mod.read_token(p), "gho_offline_test_token")
                    CopyStat.st_uid = os.geteuid()
                    self.assertEqual(mod.read_token(p), "gho_offline_test_token")
                    CopyStat.st_uid = 0
                for mode in (0o644, 0o444, 0o600):
                    p.chmod(0o600)
                    p.write_text("gho_offline_test_token\n")
                    p.chmod(mode)
                    CopyStat.st_mode = stat.S_IFREG | mode
                    with self.assertRaises(mod.TimerError):
                        mod.read_token(p)
                p.chmod(0o600)
                p.write_text("not-supported-prefix")
                p.chmod(0o400)
                CopyStat.st_mode = stat.S_IFREG | 0o400
                with self.assertRaises(mod.TimerError):
                    mod.read_token(p)
            finally:
                Path.stat, os.access = original_stat, original_access

    def test_private_settings_uses_injected_passwd_record(self):
        keys = ("STATUS_TIMER_ACCOUNT", "STATUS_TIMER_NODENAME")
        saved = {key: os.environ.get(key) for key in keys}
        try:
            os.environ["STATUS_TIMER_ACCOUNT"] = "svc-uptime"
            os.environ["STATUS_TIMER_NODENAME"] = os.uname().nodename
            if os.geteuid() == 0:
                with self.assertRaises(mod.TimerError):
                    mod.private_settings(lookup=lambda uid: "svc-uptime")
            else:
                self.assertEqual(mod.private_settings(lookup=lambda uid: "svc-uptime"),
                                 ("svc-uptime", os.uname().nodename))
                with self.assertRaises(mod.TimerError):
                    mod.private_settings(lookup=lambda uid: "someone-else")
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_no_monitoring_data_files_are_written(self):
        for forbidden in ("status.json", "history.yml", "uptime.json"):
            self.assertNotIn(forbidden, sorted(p.name for p in SOURCE.parent.iterdir()))


if __name__ == "__main__":
    unittest.main()
