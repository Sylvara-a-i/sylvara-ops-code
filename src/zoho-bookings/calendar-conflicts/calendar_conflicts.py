"""Offline comparison of complete source calendars and Bookings availability.

This is a bounded consistency checker, not an authentication, booking, or launch
gate. The caller supplies independently obtained normalized snapshots. It does
not connect to providers, discover calendars, parse recurrence rules, or write.
No input values are included in the result or diagnostics.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timedelta


MAX_BYTES = 1_048_576
MAX_NODES = 50_000
MAX_CALENDARS = 256
MAX_INTERVALS = 4096
MAX_SLOTS = 4096
_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")
_SCOPE = {"environment", "organization_ref", "workspace_ref", "service_ref", "staff_ref"}
_WINDOW = {"start", "end"}
_BUFFERS = {"before_seconds", "after_seconds"}


class _Hold(Exception):
    """A fixed, non-sensitive diagnostic code."""


def _require(condition, code="invalid_input"):
    if not condition:
        raise _Hold(code)


def _exact(value, fields):
    _require(type(value) is dict and value.keys() == fields, "invalid_shape")


def _ref(value):
    _require(type(value) is str and _REF.fullmatch(value) is not None, "invalid_reference")
    return value


def _integer(value, minimum, maximum):
    _require(type(value) is int and minimum <= value <= maximum, "invalid_number")
    return value


def _list(value, maximum, minimum=0):
    _require(type(value) is list and minimum <= len(value) <= maximum, "invalid_list")
    return value


def _unique_refs(values, maximum, minimum=0):
    result = [_ref(value) for value in _list(values, maximum, minimum)]
    _require(len(result) == len(set(result)), "duplicate_reference")
    return set(result)


def _time(value):
    _require(type(value) is str and _TIME.fullmatch(value) is not None, "invalid_time")
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise _Hold("invalid_time") from None


def _window(value):
    _exact(value, _WINDOW)
    start, end = _time(value["start"]), _time(value["end"])
    _require(start < end, "invalid_interval")
    return start, end


def _fresh(value, now, budget):
    observed = _time(value)
    _require(timedelta(0) <= now - observed <= timedelta(seconds=budget), "stale_or_future_read")
    return observed


def _bounded(value):
    # Reject cycles, custom objects, excessive nesting, and oversized inputs
    # before the schema walker. Plain JSON scalars are the only accepted values.
    pending, containers, count, byte_count = [(value, 0)], set(), 0, 0
    while pending:
        item, depth = pending.pop()
        count += 1
        _require(count <= MAX_NODES and depth <= 16, "input_limit")
        if type(item) in (dict, list):
            _require(id(item) not in containers, "reused_container")
            containers.add(id(item))
            children = len(item) * (2 if type(item) is dict else 1)
            _require(count + len(pending) + children <= MAX_NODES, "input_limit")
            byte_count += 2 + max(0, len(item) - 1)
            if type(item) is dict:
                byte_count += len(item)
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
                byte_count += len(json.dumps(item, ensure_ascii=True).encode("utf-8"))
            except (ValueError, OverflowError):
                raise _Hold("input_limit") from None
        _require(byte_count <= MAX_BYTES, "input_limit")


def _result(status, reason, **counts):
    return {
        "status": status,
        "reason": reason,
        "provider_access_verified": False,
        "live_coverage_qualified": False,
        "booking_authorized": False,
        "provider_changes_made": False,
        **counts,
    }


def evaluate_calendar_conflicts(plan, evidence, *, now):
    """Return held, conflicts_observed, or consistent_snapshot; never authority.

    Exact input shapes and provider-normalization requirements are documented in
    README.md. `plan` is the independent expected scope, not provider payload.
    Freshness is explicitly supplied; no operational threshold is selected here.
    """
    try:
        _bounded(plan)
        _bounded(evidence)
        _exact(plan, {"schema_version", "scope", "account_refs", "freshness_seconds",
                      "window", "duration_seconds", "buffers"})
        _exact(evidence, {"schema_version", "scope", "inventory", "calendar_reads", "bookings"})
        _require(type(plan["schema_version"]) is int and plan["schema_version"] == 1)
        _require(type(evidence["schema_version"]) is int and evidence["schema_version"] == 1)
        _exact(plan["scope"], _SCOPE)
        _exact(evidence["scope"], _SCOPE)
        for value in plan["scope"].values():
            _ref(value)
        _require(plan["scope"] == evidence["scope"], "scope_mismatch")
        accounts = _unique_refs(plan["account_refs"], MAX_CALENDARS, 1)
        budget = _integer(plan["freshness_seconds"], 1, 86_400)
        duration = _integer(plan["duration_seconds"], 1, 86_400)
        _exact(plan["buffers"], _BUFFERS)
        before = _integer(plan["buffers"]["before_seconds"], 0, 86_400)
        after = _integer(plan["buffers"]["after_seconds"], 0, 86_400)
        start, end = _window(plan["window"])
        _require(end - start <= timedelta(days=31), "window_too_large")
        source_window = start - timedelta(seconds=before), end + timedelta(seconds=after)
        now_time = _time(now)

        inventory = evidence["inventory"]
        _exact(inventory, {"status", "observed_at", "complete", "accounts"})
        _require(inventory["status"] == "ok" and inventory["complete"] is True, "incomplete_inventory")
        inventory_time = _fresh(inventory["observed_at"], now_time, budget)
        inventory_accounts, source_keys = set(), set()
        for account in _list(inventory["accounts"], MAX_CALENDARS, 1):
            _exact(account, {"account_ref", "complete", "calendar_refs"})
            account_ref = _ref(account["account_ref"])
            _require(account_ref not in inventory_accounts, "duplicate_account")
            _require(account["complete"] is True, "incomplete_inventory")
            inventory_accounts.add(account_ref)
            calendars = _unique_refs(account["calendar_refs"], MAX_CALENDARS, 1)
            source_keys.update((account_ref, calendar) for calendar in calendars)
        _require(inventory_accounts == accounts, "account_inventory_mismatch")
        _require(len(source_keys) <= MAX_CALENDARS, "input_limit")

        bookings = evidence["bookings"]
        _exact(bookings, {"status", "observed_at", "complete", "window", "duration_seconds",
                          "buffers", "selected_calendar_refs", "slots"})
        _require(bookings["status"] == "ok" and bookings["complete"] is True, "incomplete_bookings")
        bookings_time = _fresh(bookings["observed_at"], now_time, budget)
        _require(_window(bookings["window"]) == (start, end), "window_mismatch")
        _integer(bookings["duration_seconds"], 1, 86_400)
        _exact(bookings["buffers"], _BUFFERS)
        for value in bookings["buffers"].values():
            _integer(value, 0, 86_400)
        _require(bookings["duration_seconds"] == duration and bookings["buffers"] == plan["buffers"],
                 "service_settings_mismatch")
        selected = _unique_refs(bookings["selected_calendar_refs"], MAX_CALENDARS, 1)

        observed_keys, all_busy, calendars_with_busy = set(), [], 0
        for read in _list(evidence["calendar_reads"], MAX_CALENDARS, 1):
            _exact(read, {"account_ref", "calendar_ref", "conflict_target_ref", "status",
                          "observed_at", "complete", "window", "busy"})
            source_key = _ref(read["account_ref"]), _ref(read["calendar_ref"])
            _require(source_key in source_keys, "unexpected_calendar")
            _require(source_key not in observed_keys, "duplicate_calendar")
            observed_keys.add(source_key)
            _require(read["status"] == "ok" and read["complete"] is True, "incomplete_calendar")
            observed = _fresh(read["observed_at"], now_time, budget)
            _require(inventory_time <= observed <= bookings_time, "observation_order")
            _require(_window(read["window"]) == source_window, "source_window_mismatch")
            _require(_ref(read["conflict_target_ref"]) in selected, "calendar_not_selected")
            busy = _list(read["busy"], MAX_INTERVALS)
            calendars_with_busy += bool(busy)
            for interval in busy:
                busy_start, busy_end = _window(interval)
                _require(busy_start < source_window[1] and source_window[0] < busy_end,
                         "busy_outside_window")
                all_busy.append((busy_start, busy_end))
                _require(len(all_busy) <= MAX_INTERVALS, "input_limit")
        _require(observed_keys == source_keys, "missing_calendar")

        # Merge overlaps so conflicts are counted per offered slot, not once per
        # source or overlapping event. Event boundaries are half-open [start,end).
        merged = []
        for busy_start, busy_end in sorted(all_busy):
            if merged and busy_start <= merged[-1][1]:
                merged[-1] = merged[-1][0], max(merged[-1][1], busy_end)
            else:
                merged.append((busy_start, busy_end))
        slot_times = [_time(slot) for slot in _list(bookings["slots"], MAX_SLOTS)]
        _require(len(slot_times) == len(set(slot_times)), "duplicate_slot")
        conflict_count, cursor = 0, 0
        for slot in sorted(slot_times):
            slot_end = slot + timedelta(seconds=duration)
            _require(start <= slot < slot_end <= end, "slot_outside_window")
            protected_start, protected_end = slot - timedelta(seconds=before), slot_end + timedelta(seconds=after)
            while cursor < len(merged) and merged[cursor][1] <= protected_start:
                cursor += 1
            if cursor < len(merged) and merged[cursor][0] < protected_end:
                conflict_count += 1
        counts = {"calendar_count": len(source_keys), "calendars_with_busy": calendars_with_busy,
                  "slot_count": len(slot_times), "conflicting_slot_count": conflict_count}
        if conflict_count:
            return _result("conflicts_observed", "offered_slot_overlaps_busy", **counts)
        if not slot_times or calendars_with_busy < len(source_keys):
            return _result("held", "insufficient_probe_coverage", **counts)
        return _result("consistent_snapshot", "no_conflicts_in_supplied_snapshot", **counts)
    except _Hold as error:
        return _result("held", str(error))
    except (OverflowError, RecursionError):
        return _result("held", "input_limit")


def _object(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


class _SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's normal diagnostic includes rejected argument values, which
        # may be private file paths. Keep argument failures on the JSON path.
        raise _Hold("invalid_arguments")


def main():
    parser = _SafeArgumentParser(prog="calendar-conflicts", description=__doc__, allow_abbrev=False)
    parser.add_argument("plan")
    parser.add_argument("evidence")
    parser.add_argument("--now", required=True, help="UTC timestamp, ending in Z")
    try:
        args = parser.parse_args()
        documents = []
        for path in (args.plan, args.evidence):
            with open(path, "rb") as file:
                raw = file.read(MAX_BYTES + 1)
            _require(len(raw) <= MAX_BYTES, "input_limit")
            documents.append(json.loads(raw, object_pairs_hook=_object))
        result = evaluate_calendar_conflicts(*documents, now=args.now)
    except _Hold as error:
        result = _result("held", str(error))
    except (OSError, ValueError, UnicodeError, RecursionError):
        result = _result("held", "unreadable_input")
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] == "consistent_snapshot" else 2


if __name__ == "__main__":
    raise SystemExit(main())
