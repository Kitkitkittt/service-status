#!/usr/bin/env python3
"""Bounded repository_dispatch trigger for service-status #84.

One tick makes at most one HTTPS POST of type ``uptime`` to the pinned
repository. There are no retries, redirects or ambient proxies. A disputed POST
holds the circuit; only a custodian can rearm, and rearm never sends a POST or
invents a successful acceptance. systemd is the sole scheduler. No token value
is stored or logged here.
"""

import argparse
import datetime as dt
import fcntl
import http.client
import json
import os
from pathlib import Path
import pwd
import re
import stat
import sys
import urllib.error
import urllib.request

REPO = "Kitkitkittt/service-status"
EVENT_TYPE = "uptime"
API = f"https://api.github.com/repos/{REPO}/dispatches"
CREDENTIAL_ENV = "STATUS_TIMER_CREDENTIAL"
CREDENTIAL_NAME = "uptime-token"
CREDENTIAL_DIRECTORY = "/run/credentials/service-status-uptime-timer.service"
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
TOKEN_PREFIX = ("github_pat_", "gho_", "ghu_", "ghs_", "ghr_")
MAX_TOKEN_BYTES = 4096
SLOT = dt.timedelta(minutes=5)
JITTER_MINIMUM = dt.timedelta(seconds=270)
TIMEOUT_SECONDS = 10
STATE_NAME = "uptime-dispatch.json"
LOCK_NAME = "uptime-dispatch.lock"
STATE_SCHEMA = 4
CIRCUIT_CLOSED = "closed"
CIRCUIT_HELD = "held"
PHASES = ("initialized", "attempting", "accepted", "held", "rearmed")
FAILURE_CLASSES = ("ambiguous_response", "definite_credential_or_rate_failure", "definite_rejection")
EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)


class TimerError(Exception):
    """Bounded, non-secret failure; messages never include a credential."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse redirects so the bearer is never replayed to another URL."""

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise TimerError("redirect refused")


def credential_path():
    """Use the fixed systemd LoadCredential name and directory."""
    directory = os.environ.get("CREDENTIALS_DIRECTORY", CREDENTIAL_DIRECTORY)
    if not isinstance(directory, str) or not directory.startswith("/") or ".." in directory:
        raise TimerError("credential directory is invalid")
    return Path(directory) / CREDENTIAL_NAME


def read_token(path=None):
    """Read one native systemd credential copy; accept 0400/0440 only."""
    try:
        p = Path(path) if path else credential_path()
        st = p.stat()
        if not p.is_file() or st.st_size <= 0 or st.st_size > MAX_TOKEN_BYTES:
            raise TimerError("credential copy size rejected")
        if st.st_uid not in (0, os.geteuid()):
            raise TimerError("credential copy owner rejected")
        if stat.S_IMODE(st.st_mode) not in (0o400, 0o440):
            raise TimerError("credential copy mode rejected")
        if os.geteuid() == 0 or not os.access(p, os.R_OK) or os.access(p, os.W_OK):
            raise TimerError("credential copy must be non-root readable and read-only")
        raw = p.read_bytes()
    except (OSError, TypeError, ValueError) as error:
        raise TimerError("credential copy unavailable") from error
    try:
        token = raw.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise TimerError("credential copy is not ASCII") from error
    if not token.startswith(TOKEN_PREFIX) or any(ch.isspace() for ch in token):
        raise TimerError("credential shape rejected")
    return token


def private_settings(lookup=None):
    """Require an explicit, bounded non-root identity for the dispatch writer."""
    account = os.environ.get("STATUS_TIMER_ACCOUNT", "")
    nodename = os.environ.get("STATUS_TIMER_NODENAME", "")
    if not IDENTIFIER.fullmatch(account) or not IDENTIFIER.fullmatch(nodename):
        raise TimerError("dispatch identity is missing or invalid")
    if os.geteuid() == 0:
        raise TimerError("dispatch must run as a non-root service user")
    if os.uname().nodename != nodename:
        raise TimerError("dispatch identity does not match this host")
    lookup = lookup or (lambda uid: pwd.getpwuid(uid).pw_name)
    try:
        if lookup(os.geteuid()) != account:
            raise TimerError("dispatch identity does not match this account")
    except KeyError as error:
        raise TimerError("dispatch identity unavailable") from error
    return account, nodename


def initial_state(now):
    """One explicit initialized record; never infer a permissive default."""
    return {
        "schema": STATE_SCHEMA,
        "circuit": CIRCUIT_CLOSED,
        "phase": "initialized",
        "last_tick_at": None,
        "last_attempt_at": None,
        "last_accepted_at": None,
        "last_failure_class": None,
        "rearm_at": None,
        "rearm_evidence": None,
        "generation": 0,
        "initialized_at": now.isoformat(),
    }


def parse_time(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(dt.timezone.utc)


def slot_index(value):
    """Strict UTC five-minute slot containing the timestamp."""
    return int((value - EPOCH) // SLOT)


class StateStore:
    """Serialized, crash-durable authoritative state for one named timer."""

    def __init__(self, state_dir):
        self.dir = Path(state_dir)
        self.path = self.dir / STATE_NAME
        self.lock_path = self.dir / LOCK_NAME

    def __enter__(self):
        self.dir.mkdir(mode=0o700, parents=False, exist_ok=True)
        if self.dir.stat().st_mode & 0o077:
            raise TimerError("state directory must be private")
        self.lock = self.lock_path.open("a+")
        try:
            fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self.lock.close()
            raise TimerError("another dispatch invocation holds the state lock") from error
        return self

    def __exit__(self, *args):
        fcntl.flock(self.lock.fileno(), fcntl.LOCK_UN)
        self.lock.close()
        return False

    def load(self):
        """Validate schema, bounded values and cross-field invariants."""
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError as error:
            raise TimerError("timer state is not initialized") from error
        except (OSError, ValueError) as error:
            raise TimerError("timer state unreadable") from error
        required = {
            "schema", "circuit", "phase", "last_tick_at", "last_attempt_at",
            "last_accepted_at", "last_failure_class", "rearm_at",
            "rearm_evidence", "generation", "initialized_at",
        }
        if not isinstance(data, dict) or set(data) != required:
            raise TimerError("timer state schema invalid")
        if data["schema"] != STATE_SCHEMA:
            raise TimerError("timer state schema version invalid")
        if data["circuit"] not in (CIRCUIT_CLOSED, CIRCUIT_HELD) or data["phase"] not in PHASES:
            raise TimerError("timer state value invalid")
        if not isinstance(data["generation"], int) or isinstance(data["generation"], bool) or data["generation"] < 0:
            raise TimerError("timer state generation invalid")
        for key in ("last_failure_class", "rearm_evidence"):
            if data[key] is not None and data[key] not in FAILURE_CLASSES:
                raise TimerError(f"timer state {key} invalid")
        times = {key: parse_time(data[key]) for key in
                 ("last_tick_at", "last_attempt_at", "last_accepted_at", "rearm_at")}
        for key, parsed in times.items():
            if data[key] is not None and parsed is None:
                raise TimerError(f"timer state {key} invalid")
        if parse_time(data["initialized_at"]) is None:
            raise TimerError("timer state initialization timestamp invalid")

        phase, circuit, generation = data["phase"], data["circuit"], data["generation"]
        attempt, accepted, tick, rearm = (times["last_attempt_at"], times["last_accepted_at"],
                                          times["last_tick_at"], times["rearm_at"])
        if (rearm is None) != (data["rearm_evidence"] is None):
            raise TimerError("rearm time and evidence must appear together")
        if tick and (not attempt or tick > attempt):
            raise TimerError("tick time cannot exceed attempt time")
        if accepted and (not attempt or accepted > attempt):
            raise TimerError("accepted time cannot precede attempt time")
        if rearm and not attempt:
            raise TimerError("rearm time requires an attempt time")

        if phase == "initialized":
            if circuit != CIRCUIT_CLOSED or generation != 0 \
                    or any((attempt, accepted, tick, rearm, data["last_failure_class"])):
                raise TimerError("initialized phase cross-field state invalid")
        elif phase == "attempting":
            if circuit != CIRCUIT_CLOSED or generation < 1 or not attempt or tick != attempt \
                    or data["last_failure_class"] is not None:
                raise TimerError("attempting phase cross-field state invalid")
        elif phase == "accepted":
            if circuit != CIRCUIT_CLOSED or generation < 1 or not attempt or not accepted \
                    or accepted != attempt or data["last_failure_class"] is not None:
                raise TimerError("accepted phase cross-field state invalid")
        elif phase == "held":
            if circuit != CIRCUIT_HELD or generation < 1 or not attempt \
                    or data["last_failure_class"] not in FAILURE_CLASSES:
                raise TimerError("held phase cross-field state invalid")
        elif phase == "rearmed":
            if circuit != CIRCUIT_CLOSED or generation < 1 or not attempt or not rearm \
                    or data["last_failure_class"] not in FAILURE_CLASSES \
                    or data["rearm_evidence"] != data["last_failure_class"] \
                    or slot_index(rearm) <= slot_index(attempt) \
                    or rearm - attempt < JITTER_MINIMUM:
                raise TimerError("rearmed phase cross-field state invalid")
        if rearm and phase != "rearmed" and attempt:
            if slot_index(rearm) >= slot_index(attempt) \
                    or attempt - rearm < JITTER_MINIMUM:
                raise TimerError("retained rearm must precede a later attempt")
        return data

    def save(self, record):
        """Private temp file, file sync, atomic replace, then directory sync."""
        tmp = self.path.with_name(f".{STATE_NAME}.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(json.dumps(record, indent=2, sort_keys=True) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(tmp, self.path)
            dir_fd = os.open(self.dir, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except OSError as error:
            raise TimerError("timer state could not be made durable") from error

    def initialize(self, now):
        """Bootstrap only; never overwrite an existing record."""
        if self.path.exists():
            raise TimerError("state already exists; custodian rearm required")
        record = initial_state(now)
        self.save(record)
        return record

    def allow_tick(self, state, now):
        """Strictly later UTC slot, 270s minimum; no replay in a disputed slot."""
        if state["phase"] in ("attempting", "held"):
            raise TimerError(f"timer held in phase {state['phase']}; custodian rearm required")
        if state["phase"] not in ("initialized", "accepted", "rearmed"):
            raise TimerError(f"timer phase {state['phase']} is not eligible")
        attempt = parse_time(state["last_attempt_at"])
        if attempt is None:
            return state
        if slot_index(now) <= slot_index(attempt):
            raise TimerError("prior attempt slot is still current; skipped")
        reference = attempt
        if state["phase"] == "rearmed":
            rearm = parse_time(state["rearm_at"])
            if rearm is None:
                raise TimerError("rearmed state lacks reconciliation time")
            if slot_index(now) <= slot_index(rearm):
                raise TimerError("rearm slot is still current; skipped")
            reference = max(reference, rearm)
        if now - reference < JITTER_MINIMUM:
            raise TimerError("270-second jitter minimum not met; skipped")
        return state

    def precommit(self, state, now):
        """Durably reserve a new POST attempt before any network I/O."""
        reserved = dict(state)
        reserved["schema"] = STATE_SCHEMA
        reserved["circuit"] = CIRCUIT_CLOSED
        reserved["phase"] = "attempting"
        reserved["last_tick_at"] = now.isoformat()
        reserved["last_attempt_at"] = now.isoformat()
        reserved["last_failure_class"] = None
        reserved["generation"] = state["generation"] + 1
        # rearm_at / rearm_evidence are historical evidence and are retained.
        self.save(reserved)
        return reserved

    def settle(self, state, phase, failure_class=None, accepted=False):
        """Only a definite 204 records acceptance; all else holds."""
        final = dict(state)
        final["phase"] = phase
        final["last_failure_class"] = failure_class
        if phase == "held":
            final["circuit"] = CIRCUIT_HELD
        if accepted:
            final["circuit"] = CIRCUIT_CLOSED
            final["phase"] = "accepted"
            final["last_accepted_at"] = parse_time(state["last_attempt_at"]).isoformat()
            final["last_failure_class"] = None
        self.save(final)

    def rearm(self, now):
        """Custodian-only, no-network rearm of held or crash-left attempting."""
        state = self.load()
        if state["phase"] not in ("held", "attempting"):
            raise TimerError("only held or crash-left attempting state can be rearmed")
        attempt = parse_time(state["last_attempt_at"])
        if attempt is None:
            raise TimerError("no attempt to reconcile")
        if slot_index(now) <= slot_index(attempt):
            raise TimerError("prior attempt slot is still current; rearm refused")
        prior_rearm = parse_time(state["rearm_at"])
        if prior_rearm:
            if slot_index(now) <= slot_index(prior_rearm):
                raise TimerError("prior rearm slot is still current; rearm refused")
            reference = max(attempt, prior_rearm)
        else:
            reference = attempt
        if now - reference < JITTER_MINIMUM:
            raise TimerError("270-second jitter minimum not met; rearm refused")
        evidence = state["last_failure_class"] or "ambiguous_response"
        rearmed = dict(state)
        rearmed["phase"] = "rearmed"
        rearmed["circuit"] = CIRCUIT_CLOSED
        rearmed["last_failure_class"] = evidence
        rearmed["rearm_at"] = now.isoformat()
        rearmed["rearm_evidence"] = evidence
        # last_attempt_at, last_accepted_at and generation are unchanged.
        self.save(rearmed)
        return rearmed


def make_opener():
    """The only production opener: explicit empty proxy map, no redirects."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)


def dispatch(token, opener=None):
    """Send at most one POST. No redirects, proxies, retries or body logging."""
    body = json.dumps({"event_type": EVENT_TYPE}).encode("utf-8")
    request = urllib.request.Request(
        API,
        data=body,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    opener = opener or make_opener()
    try:
        with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            status = response.status
            response.close()
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        if code in (401, 403, 429):
            return "definite_credential_or_rate_failure", None
        if 400 <= code < 500:
            return "definite_rejection", None
        return "ambiguous_response", None
    except http.client.HTTPException:
        return "ambiguous_response", None
    except (TimerError, urllib.error.URLError, TimeoutError, OSError):
        return "ambiguous_response", None
    if status == 204:
        return None, True
    return "ambiguous_response", None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--initialize", action="store_true", help="explicit one-time bootstrap; no network")
    mode.add_argument("--dry-run", action="store_true", help="validate identity and credential only; no state or network")
    mode.add_argument("--rearm", action="store_true", help="custodian rearm; no network, no POST")
    args = parser.parse_args(argv)

    private_settings()
    if args.dry_run:
        read_token()
        print("identity and credential valid; no state accessed, no network")
        return 0
    now = dt.datetime.now(dt.timezone.utc)
    with StateStore(args.state_dir) as store:
        if args.initialize:
            store.initialize(now)
            print("initialized")
            return 0
        if args.rearm:
            store.rearm(now)
            print("rearmed for a future slot; no POST sent")
            return 0
        token = read_token()
        state = store.load()
        store.allow_tick(state, now)
        reserved = store.precommit(state, now)
        failure, accepted = dispatch(token)
        if accepted:
            store.settle(reserved, "accepted", accepted=True)
            print("dispatch accepted; no run ID is implied by HTTP 204")
            return 0
        store.settle(reserved, "held", failure_class=failure)
        print(f"dispatch held: {failure}; custodian rearm required", file=sys.stderr)
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except TimerError as error:
        print(f"timer refused: {error}", file=sys.stderr)
        sys.exit(2)
