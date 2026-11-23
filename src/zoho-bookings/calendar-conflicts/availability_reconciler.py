"""Offline v1.0 Busy projection reconciliation; no provider or booking adapter.

Inputs are normalized assertions, never authenticated provider evidence. The
SQLite runner is a synthetic destination simulator, not a calendar connection.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from datetime import datetime, timedelta


MAX_BYTES = 1_048_576
MAX_EVENTS = 4096
MAX_SOURCES = 256
_STORE_ID = 0x43414C31  # CAL1: distinguishes an initialized simulator from an empty DB.
_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")
_HASH = re.compile(r"^[0-9a-f]{64}$")


class _Hold(Exception):
    """Fixed diagnostics only; input values must not reach errors or logs."""


def _require(condition, reason="invalid_input"):
    if not condition:
        raise _Hold(reason)


def _shape(value, required, optional=frozenset()):
    _require(type(value) is dict and required <= value.keys()
             and value.keys() <= required | optional, "invalid_shape")


def _ref(value):
    _require(type(value) is str and _REF.fullmatch(value), "invalid_reference")
    return value


def _hash(value):
    _require(type(value) is str and _HASH.fullmatch(value), "invalid_state")
    return value


def _list(value, limit, minimum=0):
    _require(type(value) is list and minimum <= len(value) <= limit, "input_limit")
    return value


def _time(value):
    _require(type(value) is str and _TIME.fullmatch(value), "invalid_time")
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise _Hold("invalid_time") from None


def _stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def _window(value):
    _shape(value, {"start", "end"})
    start, end = _time(value["start"]), _time(value["end"])
    _require(start < end, "invalid_interval")
    return start, end


def _window_json(window):
    return dict(zip(("start", "end"), map(_stamp, window)))


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _digest(value):
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _bounded(value):
    pending, count, size = [(value, 0)], 0, 0
    while pending:
        item, depth = pending.pop()
        count += 1
        _require(count <= 50_000 and depth <= 16, "input_limit")
        if type(item) in (list, dict):
            children = len(item) * (2 if type(item) is dict else 1)
            _require(count + len(pending) + children <= 50_000, "input_limit")
            size += children + 2
            if type(item) is dict:
                _require(all(type(key) is str for key in item), "invalid_shape")
                pending.extend((key, depth + 1) for key in item)
                pending.extend((child, depth + 1) for child in item.values())
            else:
                pending.extend((child, depth + 1) for child in item)
        else:
            _require(type(item) in (str, int, bool, type(None)), "invalid_value_type")
            if type(item) is str:
                _require(len(item) <= 4096, "input_limit")
            try:
                size += len(_json(item))
            except (ValueError, OverflowError):
                raise _Hold("input_limit") from None
        _require(size <= MAX_BYTES, "input_limit")


def _fresh(value, now, budget):
    observed = _time(value)
    _require(timedelta(0) <= now - observed <= timedelta(seconds=budget),
             "stale_or_future_read")
    return observed


def _version(value):
    _require(type(value) is int and value == 1, "invalid_version")


def _result(status, reason, operations=None, next_state=None):
    return {"status": status, "reason": reason, "operations": operations or [],
            "next_state": next_state, "provider_changes_made": False,
            "live_coverage_qualified": False, "booking_authorized": False}


def _plan(plan):
    _shape(plan, {"schema_version", "reconciler_ref", "destination_ref", "sources",
                  "window", "freshness_seconds"})
    _version(plan["schema_version"])
    owner, destination = _ref(plan["reconciler_ref"]), _ref(plan["destination_ref"])
    budget = plan["freshness_seconds"]
    _require(type(budget) is int and 1 <= budget <= 86_400, "invalid_freshness")
    window = _window(plan["window"])
    _require(window[1] - window[0] <= timedelta(days=31), "window_limit")
    sources = {}
    for source in _list(plan["sources"], MAX_SOURCES, 1):
        _shape(source, {"account_ref", "calendar_ref"})
        identity = (_ref(source["account_ref"]), _ref(source["calendar_ref"]))
        _require(identity not in sources, "duplicate_source")
        # A destination cannot also be collected: that would project our own Busy
        # records back into themselves. Calendar aliases must be globally scoped.
        _require(identity[1] != destination, "source_destination_overlap")
        sources[identity] = _digest(identity)
    binding = _digest([owner, destination, sorted(sources), budget])
    return owner, destination, budget, window, sources, binding


def _checkpoint(state, binding, source_keys, window, now):
    if state is None:
        return {}, None
    _shape(state, {"schema_version", "binding", "window", "sources", "reconciled_at"})
    _version(state["schema_version"])
    _require(_hash(state["binding"]) == binding, "state_binding_mismatch")
    _require(_window(state["window"]) == window, "state_window_mismatch")
    reconciled = _time(state["reconciled_at"])
    _require(reconciled <= now, "clock_regression")
    checkpoints = {}
    for row in _list(state["sources"], MAX_SOURCES, 1):
        _shape(row, {"source_key", "observed_at", "upstream_observed_at", "digest"})
        key = _hash(row["source_key"])
        _hash(row["digest"])
        _require(key not in checkpoints, "invalid_state")
        _require(_time(row["upstream_observed_at"]) <= _time(row["observed_at"])
                 <= reconciled, "invalid_state")
        checkpoints[key] = row
    _require(set(checkpoints) == source_keys, "state_binding_mismatch")
    return checkpoints, reconciled


def _events(rows):
    events, series_kinds = {}, {}
    for event in _list(rows, MAX_EVENTS):
        _shape(event, {"event_ref", "recurrence_id", "status", "start", "end",
                       "availability"}, {"metadata"})
        event_ref = _ref(event["event_ref"])
        recurrence = event["recurrence_id"]
        if recurrence is not None:
            recurrence = _stamp(_time(recurrence))
        recurring = recurrence is not None
        _require(event_ref not in series_kinds or series_kinds[event_ref] == recurring,
                 "unexpanded_recurrence")
        series_kinds[event_ref] = recurring
        _require(event["status"] in ("confirmed", "cancelled"), "invalid_event_status")
        _require(event["availability"] in ("free", "busy"), "invalid_availability")
        if "metadata" in event:
            _require(type(event["metadata"]) is dict, "invalid_shape")
        if event["status"] == "cancelled":
            _require(event["start"] is None and event["end"] is None, "invalid_tombstone")
            start = end = None
        else:
            start, end = _window({"start": event["start"], "end": event["end"]})
            start, end = _stamp(start), _stamp(end)
        key = _digest([event_ref, recurrence])
        normalized = {"status": event["status"], "start": start, "end": end,
                      "availability": event["availability"], "recurrence_id": recurrence}
        _require(key not in events or events[key] == normalized, "conflicting_duplicate")
        events[key] = normalized
    return events


def _projection(owner, destination, source_key, event_key, start, end):
    return {"id": "b" + _digest([owner, destination, source_key, event_key]),
            "projection": {"owner_ref": owner, "source_key": source_key, "event_key": event_key},
            "body": {"summary": "Busy", "visibility": "private", "transparency": "opaque",
                     "attendees": [], "start": {"dateTime": _stamp(start)},
                     "end": {"dateTime": _stamp(end)}}}


def _sources(snapshot, sources, owner, destination, window, now, budget, prior):
    _shape(snapshot, {"schema_version", "sources"})
    _version(snapshot["schema_version"])
    seen, desired, checkpoints, reads, total = set(), {}, [], [], 0
    for source in _list(snapshot["sources"], MAX_SOURCES, 1):
        _shape(source, {"account_ref", "calendar_ref", "status", "complete", "observed_at",
                       "upstream_observed_at", "recurrence_expanded", "window", "events"})
        identity = (_ref(source["account_ref"]), _ref(source["calendar_ref"]))
        _require(identity in sources, "unauthorized_source")
        _require(identity not in seen, "duplicate_source")
        seen.add(identity)
        _require(source["status"] == "ok" and source["complete"] is True
                 and source["recurrence_expanded"] is True, "incomplete_source")
        observed = _fresh(source["observed_at"], now, budget)
        upstream = _fresh(source["upstream_observed_at"], now, budget)
        _require(upstream <= observed, "observation_order")
        coverage = _window(source["window"])
        _require(coverage[0] <= window[0] and window[1] <= coverage[1], "incomplete_window")
        events = _events(source["events"])
        total += len(source["events"])
        _require(total <= MAX_EVENTS, "input_limit")
        key = sources[identity]
        digest = _digest([_window_json(coverage), events])
        if key in prior:
            old = prior[key]
            _require(observed >= _time(old["observed_at"])
                     and upstream >= _time(old["upstream_observed_at"]), "source_regression")
            # An unchanged upstream observation cannot assert a different event
            # set (including a changed coverage window). Demand fresh evidence.
            if upstream == _time(old["upstream_observed_at"]):
                _require(digest == old["digest"], "inconsistent_snapshot")
        checkpoints.append({"source_key": key, "observed_at": _stamp(observed),
                            "upstream_observed_at": _stamp(upstream), "digest": digest})
        reads.append(observed)
        for event_key, event in events.items():
            if event["status"] == "cancelled":
                continue
            start, end = _time(event["start"]), _time(event["end"])
            # A moved-out exception may still be returned for an original
            # occurrence inside the covered window. It must release that instance.
            original = event["recurrence_id"]
            _require((start < coverage[1] and coverage[0] < end)
                     or (original is not None and coverage[0] <= _time(original) < coverage[1]),
                     "event_outside_coverage")
            start, end = max(start, window[0]), min(end, window[1])
            if start < end:
                row = _projection(owner, destination, key, event_key, start, end)
                desired[row["id"]] = row
    _require(seen == set(sources), "missing_source")
    return desired, sorted(checkpoints, key=lambda row: row["source_key"]), max(reads)


def _target(target, owner, destination, source_keys, window, now, budget, last_source_read, reconciled):
    _shape(target, {"schema_version", "destination_ref", "status", "complete", "observed_at", "events"})
    _version(target["schema_version"])
    _require(target["destination_ref"] == destination, "destination_mismatch")
    _require(target["status"] == "ok" and target["complete"] is True, "incomplete_target")
    observed = _fresh(target["observed_at"], now, budget)
    _require(observed >= last_source_read and (reconciled is None or observed >= reconciled),
             "observation_order")
    actual, owned = {}, {}
    for row in _list(target["events"], MAX_EVENTS):
        _shape(row, {"id", "projection", "body"})
        identity = _ref(row["id"])
        _require(type(row["body"]) is dict, "invalid_shape")
        _require(identity not in actual or actual[identity] == row, "conflicting_target_duplicate")
        actual[identity] = row
        marker = row["projection"]
        if marker is None:
            continue
        _shape(marker, {"owner_ref", "source_key", "event_key"})
        _ref(marker["owner_ref"])
        _hash(marker["source_key"])
        _hash(marker["event_key"])
        if marker["owner_ref"] == owner:
            _require(marker["source_key"] in source_keys, "unauthorized_target_source")
            # v1 retires only blockers inside its fixed authorized horizon. An
            # unknown/out-of-horizon interval cannot be released as an omission.
            body = row["body"]
            _require("start" in body and "end" in body, "invalid_target_interval")
            _shape(body["start"], {"dateTime"})
            _shape(body["end"], {"dateTime"})
            start, end = _window({"start": body["start"]["dateTime"],
                                  "end": body["end"]["dateTime"]})
            _require(window[0] <= start < end <= window[1], "target_outside_window")
            owned[identity] = row
    return actual, owned


def reconcile(plan, snapshot, target, state=None, *, now):
    """Plan only owned Busy writes; a held result contains no writes/checkpoint.

    Caller must persist next_state only with a successful simulated apply. A real
    provider adapter would need separately qualified readback and write fencing.
    """
    try:
        for value in (plan, snapshot, target, state):
            _bounded(value)
        now_dt = _time(now)
        owner, destination, budget, window, sources, binding = _plan(plan)
        prior, reconciled = _checkpoint(state, binding, set(sources.values()), window, now_dt)
        desired, checkpoints, read = _sources(snapshot, sources, owner, destination,
                                              window, now_dt, budget, prior)
        actual, owned = _target(target, owner, destination, set(sources.values()), window,
                                now_dt, budget, read, reconciled)
        operations = []
        for identity, row in sorted(desired.items()):
            _require(identity not in actual or identity in owned, "target_identity_collision")
            if identity in owned:
                _require(owned[identity]["projection"] == row["projection"], "target_identity_collision")
            if actual.get(identity) != row:
                operations.append({"op": "upsert", "event": row})
        # Create/repair blockers before removing obsolete managed projections.
        operations.extend({"op": "delete", "id": identity}
                          for identity in sorted(set(owned) - set(desired)))
        updated = {identity: row for identity, row in actual.items() if identity not in owned}
        updated.update(desired)
        # A successful plan must itself be readable on the next reconciliation.
        target_events = _list([row for _, row in sorted(updated.items())], MAX_EVENTS)
        _decode(_json(target | {"events": target_events}))
        next_state = {"schema_version": 1, "binding": binding, "window": _window_json(window),
                      "sources": checkpoints, "reconciled_at": _stamp(now_dt)}
        return _result("ready", "offline_plan", operations, next_state)
    except _Hold as error:
        return _result("held", str(error))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def _decode(value):
    _require(type(value) is str, "invalid_json")
    try:
        _require(len(value.encode("utf-8")) <= MAX_BYTES, "input_limit")
    except UnicodeError:
        raise _Hold("invalid_json") from None
    try:
        result = json.loads(value, object_pairs_hook=_unique_object)
    except (ValueError, RecursionError):
        raise _Hold("invalid_json") from None
    _bounded(result)
    return result


def run_offline(plan, snapshot, db_path, *, now):
    """Atomically reconcile a local SQLite simulation, including durable watermarks.

    BEGIN IMMEDIATE serializes runners. The simulated target and checkpoint share
    one transaction, so interruption commits both or neither. No network exists.
    """
    connection = None
    try:
        _bounded(plan)
        _, destination, _, _, _, _ = _plan(plan)
        _time(now)
        connection = sqlite3.connect(db_path, timeout=5)
        connection.execute("BEGIN IMMEDIATE")
        tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        _require(not tables or tables == [("offline_reconciliation",)], "invalid_state")
        store_id = connection.execute("PRAGMA application_id").fetchone()[0]
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        _require((tables and (store_id, version) == (_STORE_ID, 1))
                 or (not tables and (store_id, version) == (0, 0)), "invalid_state")
        connection.execute("CREATE TABLE IF NOT EXISTS offline_reconciliation "
                           "(singleton INTEGER PRIMARY KEY CHECK(singleton=1), "
                           "state_json TEXT NOT NULL, events_json TEXT NOT NULL)")
        columns = connection.execute("PRAGMA table_info(offline_reconciliation)").fetchall()
        _require(columns == [(0, "singleton", "INTEGER", 0, None, 1),
                             (1, "state_json", "TEXT", 1, None, 0),
                             (2, "events_json", "TEXT", 1, None, 0)], "invalid_state")
        rows = connection.execute("SELECT singleton, state_json, events_json "
                                  "FROM offline_reconciliation").fetchall()
        _require((not tables and not rows) or (len(rows) == 1 and rows[0][0] == 1), "invalid_state")
        state, events = (_decode(rows[0][1]), _decode(rows[0][2])) if rows else (None, [])
        _require(not rows or type(state) is dict, "invalid_state")
        target = {"schema_version": 1, "destination_ref": destination, "status": "ok",
                  "complete": True, "observed_at": now, "events": events}
        result = reconcile(plan, snapshot, target, state, now=now)
        if result["status"] == "held":
            connection.rollback()
            return result
        by_id = {row["id"]: row for row in events}
        for operation in result["operations"]:
            if operation["op"] == "upsert":
                by_id[operation["event"]["id"]] = operation["event"]
            else:
                del by_id[operation["id"]]
        updated = [row for _, row in sorted(by_id.items())]
        # Keep every committed checkpoint readable under the same input bounds.
        _decode(_json(updated))
        connection.execute("INSERT OR REPLACE INTO offline_reconciliation VALUES (1, ?, ?)",
                           (_json(result["next_state"]), _json(updated)))
        connection.execute(f"PRAGMA application_id = {_STORE_ID}")
        connection.execute("PRAGMA user_version = 1")
        connection.commit()
        return result
    except _Hold as error:
        return _result("held", str(error))
    except (sqlite3.Error, OSError):
        return _result("held", "offline_store_unavailable")
    finally:
        if connection is not None:
            connection.close()


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise _Hold("invalid_arguments")


def main(argv=None):
    parser = _Parser(prog="availability_reconciler", description=__doc__)
    parser.add_argument("plan")
    parser.add_argument("snapshot")
    parser.add_argument("--database", required=True, help="local synthetic SQLite destination")
    parser.add_argument("--now", required=True)
    try:
        args = parser.parse_args(argv)
        inputs = []
        for path in (args.plan, args.snapshot):
            with Path(path).open("rb") as stream:
                data = stream.read(MAX_BYTES + 1)
            _require(len(data) <= MAX_BYTES, "input_limit")
            inputs.append(_decode(data.decode("utf-8")))
        result = run_offline(*inputs, args.database, now=args.now)
    except _Hold as error:
        result = _result("held", str(error))
    except (OSError, UnicodeError):
        result = _result("held", "input_unreadable")
    # Projection times and durable state stay in the private local simulation.
    print(_json({key: value for key, value in result.items()
                 if key not in ("operations", "next_state")} | {"operation_count": len(result["operations"])}))
    return 0 if result["status"] == "ready" else 2


if __name__ == "__main__":
    raise SystemExit(main())
