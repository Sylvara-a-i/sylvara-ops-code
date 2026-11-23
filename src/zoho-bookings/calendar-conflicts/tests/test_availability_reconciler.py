"""Synthetic contract tests; these never contact calendar or booking providers."""

import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


MODULE = Path(__file__).resolve().parents[1] / "availability_reconciler.py"
SPEC = importlib.util.spec_from_file_location("availability_reconciler", MODULE)
reconciler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reconciler)
NOW = "2026-11-23T12:00:00Z"


def at(day, hour, minute=0):
    return f"2026-11-{day:02d}T{hour:02d}:{minute:02d}:00Z"


def shifted(value, seconds):
    return (datetime.fromisoformat(value.replace("Z", "+00:00"))
            + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")


def interval(start, end):
    return {"start": start, "end": end}


def event(ref, start, end, *, recurrence=None, availability="busy"):
    return {"event_ref": ref, "recurrence_id": recurrence, "status": "confirmed",
            "start": start, "end": end, "availability": availability,
            "metadata": {"summary": "Synthetic source title",
                         "description": "Synthetic confidential description",
                         "location": "Synthetic location",
                         "organizer": "fixture-owner@example.invalid",
                         "attendees": ["fixture-guest@example.invalid"]}}


def fixture():
    """Two authorized synthetic iCloud sources, including a Family calendar."""
    window = interval(at(23, 0), at(26, 0))
    identities = [{"account_ref": "fixture-icloud", "calendar_ref": "fixture-family"},
                  {"account_ref": "fixture-icloud", "calendar_ref": "fixture-personal"}]
    plan = {"schema_version": 1, "reconciler_ref": "fixture-reconciler",
            "destination_ref": "fixture-google-busy", "sources": identities,
            "window": window, "freshness_seconds": 300}
    source_events = [
        [event("fixture-free", at(23, 13), at(23, 14), availability="free"),
         event("fixture-series", at(24, 13), at(24, 14), recurrence=at(24, 13)),
         event("fixture-series", at(25, 13), at(25, 14), recurrence=at(25, 13))],
        [event("fixture-personal", at(23, 15), at(23, 16))],
    ]
    snapshot = {"schema_version": 1, "sources": [
        {**identity, "status": "ok", "complete": True, "recurrence_expanded": True,
         "upstream_observed_at": at(23, 11, 59), "observed_at": at(23, 11, 59),
         "window": copy.deepcopy(window), "events": events}
        for identity, events in zip(identities, source_events)
    ]}
    target = {"schema_version": 1, "destination_ref": plan["destination_ref"],
              "status": "ok", "complete": True, "observed_at": NOW, "events": []}
    return plan, snapshot, target


def apply_plan(target, result):
    """Independent synthetic target readback after successful plan execution."""
    updated = copy.deepcopy(target)
    by_id = {row["id"]: row for row in updated["events"]}
    for operation in result["operations"]:
        if operation["op"] == "upsert":
            row = copy.deepcopy(operation["event"])
            by_id[row["id"]] = row
        else:
            del by_id[operation["id"]]
    updated["events"] = list(by_id.values())
    return updated


class ReconcilerTests(unittest.TestCase):
    def setUp(self):
        self.plan, self.snapshot, self.target = fixture()
        self.state = None
        self.now = NOW

    def run_check(self):
        return reconciler.reconcile(self.plan, self.snapshot, self.target,
                                    self.state, now=self.now)

    def assert_ready(self, result):
        self.assertEqual(result["status"], "ready", result)
        self.assertIsNotNone(result["next_state"])
        self.assertFalse(result["provider_changes_made"])
        self.assertFalse(result["live_coverage_qualified"])
        self.assertFalse(result["booking_authorized"])

    def assert_held(self, result=None):
        result = self.run_check() if result is None else result
        self.assertEqual(result["status"], "held", result)
        self.assertEqual(result["operations"], [])
        self.assertIsNone(result["next_state"])
        self.assertFalse(result["provider_changes_made"])
        self.assertFalse(result["booking_authorized"])
        return result

    def establish(self):
        result = self.run_check()
        self.assert_ready(result)
        self.target = apply_plan(self.target, result)
        self.state = json.loads(json.dumps(result["next_state"]))
        return result

    def advance(self, seconds=60):
        self.now = shifted(self.now, seconds)
        self.target["observed_at"] = self.now
        for source in self.snapshot["sources"]:
            source["observed_at"] = shifted(source["observed_at"], seconds)
            source["upstream_observed_at"] = shifted(source["upstream_observed_at"], seconds)

    def test_authorized_free_and_busy_intervals_are_private_attendee_free(self):
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(len(result["operations"]), 4)
        projected_intervals = set()
        for operation in result["operations"]:
            self.assertEqual(operation["op"], "upsert")
            row = operation["event"]
            self.assertEqual(set(row), {"id", "projection", "body"})
            body = row["body"]
            self.assertEqual(set(body), {"summary", "visibility", "transparency",
                                         "attendees", "start", "end"})
            self.assertEqual(body["summary"], "Busy")
            self.assertEqual(body["visibility"], "private")
            self.assertEqual(body["transparency"], "opaque")
            self.assertEqual(body["attendees"], [])
            projected_intervals.add((body["start"]["dateTime"], body["end"]["dateTime"]))
        self.assertIn((at(23, 13), at(23, 14)), projected_intervals)
        serialized = json.dumps(result)
        for forbidden in ("Synthetic source title", "Synthetic confidential", "Synthetic location",
                          "fixture-guest@", "fixture-owner@", "fixture-series", "fixture-family"):
            self.assertNotIn(forbidden, serialized)

    def test_inputs_and_original_metadata_are_unchanged(self):
        inputs = copy.deepcopy((self.plan, self.snapshot, self.target))
        self.assert_ready(self.run_check())
        self.assertEqual((self.plan, self.snapshot, self.target), inputs)

    def test_replay_after_serialized_checkpoint_produces_no_mutations(self):
        self.establish()
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(result["operations"], [])

    def test_target_readback_adopts_completed_writes_without_checkpoint_or_duplicates(self):
        first = self.run_check()
        self.assert_ready(first)
        self.target = apply_plan(self.target, first)
        # Simulate completed target writes before a caller persisted next_state.
        self.assertIsNone(self.state)
        restarted = self.run_check()
        self.assert_ready(restarted)
        self.assertEqual(restarted["operations"], [])
        self.assertEqual(restarted["next_state"], first["next_state"])
        self.assertEqual(len(self.target["events"]), 4)

    def test_order_and_irrelevant_metadata_do_not_cause_churn(self):
        self.establish()
        self.plan["sources"].reverse()
        self.snapshot["sources"].reverse()
        self.target["events"].reverse()
        for source in self.snapshot["sources"]:
            source["events"].reverse()
            for item in source["events"]:
                item["metadata"] = {"summary": "Synthetic metadata update"}
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(result["operations"], [])

    def test_moved_recurrence_exception_keeps_original_instance_identity(self):
        self.establish()
        original = next(row for row in self.target["events"]
                        if row["body"]["start"]["dateTime"] == at(24, 13))
        self.advance()
        moved = self.snapshot["sources"][0]["events"][1]
        moved["start"], moved["end"] = at(24, 16), at(24, 17)
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(len(result["operations"]), 1)
        operation = result["operations"][0]
        self.assertEqual(operation["op"], "upsert")
        self.assertEqual(operation["event"]["id"], original["id"])
        self.assertEqual(operation["event"]["projection"], original["projection"])
        self.assertEqual(operation["event"]["body"]["start"]["dateTime"], at(24, 16))

    def test_cancelled_occurrence_removes_only_its_projection(self):
        self.establish()
        cancelled_id = next(row["id"] for row in self.target["events"]
                            if row["body"]["start"]["dateTime"] == at(24, 13))
        self.advance()
        self.snapshot["sources"][0]["events"][1].update(
            status="cancelled", start=None, end=None)
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(result["operations"], [{"op": "delete", "id": cancelled_id}])
        self.assertEqual(len(apply_plan(self.target, result)["events"]), 3)

    def test_complete_snapshot_omission_cancels_a_whole_series(self):
        self.establish()
        self.advance()
        self.snapshot["sources"][0]["events"] = self.snapshot["sources"][0]["events"][:1]
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual([op["op"] for op in result["operations"]], ["delete", "delete"])
        remaining = apply_plan(self.target, result)["events"]
        self.assertEqual(len(remaining), 2)
        self.assertTrue(all(row["body"]["start"]["dateTime"].startswith("2026-11-23")
                            for row in remaining))

    def test_complete_empty_sources_release_owned_projections(self):
        self.establish()
        self.advance()
        for source in self.snapshot["sources"]:
            source["events"] = []
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(len(result["operations"]), 4)
        self.assertEqual(apply_plan(self.target, result)["events"], [])

    def test_same_event_reference_on_distinct_sources_is_not_collapsed(self):
        self.snapshot["sources"][1]["events"] = [copy.deepcopy(self.snapshot["sources"][0]["events"][0])]
        result = self.run_check()
        self.assert_ready(result)
        rows = [op["event"] for op in result["operations"]]
        matching = [row for row in rows if row["body"]["start"]["dateTime"] == at(23, 13)]
        self.assertEqual(len(matching), 2)
        self.assertNotEqual(matching[0]["id"], matching[1]["id"])

    def test_equivalent_duplicate_instances_and_utc_spellings_collapse(self):
        self.establish()
        duplicate = copy.deepcopy(self.snapshot["sources"][0]["events"][1])
        for field in ("start", "end", "recurrence_id"):
            duplicate[field] = duplicate[field].replace("Z", ".000000Z")
        duplicate["metadata"] = {"summary": "Different synthetic metadata"}
        self.snapshot["sources"][0]["events"].append(duplicate)
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(result["operations"], [])

    def test_conflicting_duplicate_instance_is_held(self):
        duplicate = copy.deepcopy(self.snapshot["sources"][0]["events"][1])
        duplicate["start"] = at(24, 12)
        self.snapshot["sources"][0]["events"].append(duplicate)
        self.assert_held()

    def test_active_and_cancelled_duplicate_is_held(self):
        duplicate = copy.deepcopy(self.snapshot["sources"][0]["events"][0])
        duplicate.update(status="cancelled", start=None, end=None)
        self.snapshot["sources"][0]["events"].append(duplicate)
        self.assert_held()

    def test_identical_destination_page_overlap_is_harmless(self):
        self.establish()
        self.target["events"].append(copy.deepcopy(self.target["events"][0]))
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(result["operations"], [])

    def test_conflicting_destination_duplicate_is_held(self):
        self.establish()
        duplicate = copy.deepcopy(self.target["events"][0])
        duplicate["body"]["summary"] = "Synthetic drift"
        self.target["events"].append(duplicate)
        self.assert_held()

    def test_duplicate_owned_projection_is_removed_after_canonical_exists(self):
        self.establish()
        duplicate = copy.deepcopy(self.target["events"][0])
        duplicate["id"] = "fixture-duplicate"
        self.target["events"].append(duplicate)
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(result["operations"], [{"op": "delete", "id": "fixture-duplicate"}])

    def test_missing_canonical_is_created_before_duplicate_is_removed(self):
        self.establish()
        original_id = self.target["events"][0]["id"]
        self.target["events"][0]["id"] = "fixture-duplicate"
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual([op["op"] for op in result["operations"]], ["upsert", "delete"])
        self.assertEqual(result["operations"][0]["event"]["id"], original_id)

    def test_original_destination_and_other_owner_records_are_preserved(self):
        self.establish()
        foreign = copy.deepcopy(self.target["events"][0])
        foreign["id"] = "fixture-other-owner"
        foreign["projection"]["owner_ref"] = "fixture-other-reconciler"
        foreign["body"] = {"summary": "Synthetic original", "attendees": ["fixture@example.invalid"]}
        original = {"id": "fixture-original", "projection": None,
                    "body": {"summary": "Synthetic original appointment"}}
        self.target["events"].extend([foreign, original])
        self.advance()
        for source in self.snapshot["sources"]:
            source["events"] = []
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(apply_plan(self.target, result)["events"], [foreign, original])

    def test_unauthorized_managed_source_is_held_not_deleted(self):
        self.establish()
        self.target["events"][0]["projection"]["source_key"] = "0" * 64
        self.assert_held()

    def test_foreign_target_identity_collision_never_overwrites_original(self):
        first = self.run_check()
        collision = copy.deepcopy(first["operations"][0]["event"])
        collision["projection"] = None
        collision["body"] = {"summary": "Synthetic original"}
        self.target["events"] = [collision]
        self.assert_held()
        self.assertEqual(self.target["events"][0], collision)

    def test_target_content_drift_is_replaced_with_private_projection(self):
        self.establish()
        row = self.target["events"][0]
        row["body"].update(summary="Synthetic drift", visibility="public",
                           attendees=["fixture@example.invalid"], description="Synthetic detail")
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(len(result["operations"]), 1)
        repaired = result["operations"][0]["event"]["body"]
        self.assertEqual(repaired["summary"], "Busy")
        self.assertEqual(repaired["visibility"], "private")
        self.assertEqual(repaired["attendees"], [])
        self.assertNotIn("description", repaired)

    def test_missing_managed_target_is_recreated_after_restart(self):
        self.establish()
        missing = self.target["events"].pop()
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(result["operations"], [{"op": "upsert", "event": missing}])

    def test_missing_duplicate_and_unapproved_sources_are_held(self):
        for mutation in ("missing", "duplicate", "unapproved"):
            with self.subTest(mutation=mutation):
                self.setUp()
                if mutation == "missing":
                    self.snapshot["sources"].pop()
                elif mutation == "duplicate":
                    self.snapshot["sources"].append(copy.deepcopy(self.snapshot["sources"][0]))
                else:
                    self.snapshot["sources"][0]["calendar_ref"] = "fixture-unapproved"
                self.assert_held()

    def test_incomplete_failed_or_unexpanded_source_never_releases_busy(self):
        for field, value in (("complete", False), ("complete", 1), ("status", "error"),
                             ("recurrence_expanded", False)):
            with self.subTest(field=field, value=value):
                self.setUp()
                self.establish()
                self.advance()
                self.snapshot["sources"][0]["events"] = []
                self.snapshot["sources"][0][field] = value
                self.assert_held()

    def test_stale_upstream_is_held_even_when_transport_read_is_fresh(self):
        self.snapshot["sources"][0]["observed_at"] = NOW
        self.snapshot["sources"][0]["upstream_observed_at"] = shifted(NOW, -301)
        self.assert_held()

    def test_stale_future_and_misordered_reads_are_held(self):
        for field, value in (("observed_at", shifted(NOW, -301)),
                             ("observed_at", shifted(NOW, 1)),
                             ("upstream_observed_at", shifted(NOW, 1)),
                             ("upstream_observed_at", NOW)):
            with self.subTest(field=field, value=value):
                self.setUp()
                self.snapshot["sources"][0][field] = value
                self.assert_held()

    def test_missing_coverage_does_not_authorize_absence_deletion(self):
        self.establish()
        self.advance()
        self.snapshot["sources"][0]["events"] = []
        self.snapshot["sources"][0]["window"]["end"] = at(25, 0)
        self.assert_held()

    def test_incomplete_stale_wrong_or_older_destination_is_held(self):
        for field, value in (("complete", False), ("status", "error"),
                             ("observed_at", shifted(NOW, -301)),
                             ("observed_at", shifted(NOW, 1)),
                             ("observed_at", at(23, 11, 58)),
                             ("destination_ref", "fixture-wrong-destination")):
            with self.subTest(field=field, value=value):
                self.setUp()
                self.target[field] = value
                self.assert_held()

    def test_old_source_snapshot_cannot_resurrect_cancelled_projection(self):
        old_snapshot = copy.deepcopy(self.snapshot)
        self.establish()
        self.advance()
        self.snapshot["sources"][0]["events"][0].update(status="cancelled", start=None, end=None)
        self.establish()
        self.snapshot = old_snapshot
        self.assert_held()

    def test_changed_content_at_same_upstream_timestamp_is_held(self):
        self.establish()
        self.snapshot["sources"][0]["events"] = []
        self.assert_held()

    def test_fresher_transport_timestamp_cannot_hide_changed_upstream_content(self):
        self.establish()
        self.snapshot["sources"][0]["observed_at"] = NOW
        self.snapshot["sources"][0]["events"] = []
        self.assert_held()

    def test_destination_reconciler_and_authorization_changes_require_new_state(self):
        for field in ("destination_ref", "reconciler_ref", "sources", "freshness_seconds"):
            with self.subTest(field=field):
                self.setUp()
                self.establish()
                if field == "sources":
                    self.plan["sources"].pop()
                elif field == "freshness_seconds":
                    self.plan[field] += 1
                else:
                    self.plan[field] = "fixture-changed"
                self.assert_held()

    def test_clock_regression_cannot_reuse_later_checkpoint(self):
        self.establish()
        self.now = shifted(NOW, -1)
        self.assert_held()

    def test_projection_window_clips_intervals_and_uses_half_open_boundaries(self):
        self.plan["window"] = interval(at(23, 13), at(23, 15))
        self.snapshot["sources"][0]["events"] = [
            event("fixture-left", at(23, 12), at(23, 13)),
            event("fixture-crossing", at(23, 12), at(23, 16)),
            event("fixture-right", at(23, 15), at(23, 16)),
        ]
        self.snapshot["sources"][1]["events"] = []
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(len(result["operations"]), 1)
        body = result["operations"][0]["event"]["body"]
        self.assertEqual(body["start"]["dateTime"], at(23, 13))
        self.assertEqual(body["end"]["dateTime"], at(23, 15))

    def test_all_day_dst_interval_preserves_real_twenty_five_hour_duration(self):
        # Synthetic normalization of Nov 1 local midnight to Nov 2 in Chicago.
        window = interval("2026-11-01T00:00:00Z", "2026-11-03T00:00:00Z")
        self.plan["window"] = copy.deepcopy(window)
        for source in self.snapshot["sources"]:
            source["window"] = copy.deepcopy(window)
            source["events"] = []
        self.snapshot["sources"][0]["events"] = [
            event("fixture-all-day", "2026-11-01T05:00:00Z", "2026-11-02T06:00:00Z",
                  availability="free")]
        result = self.run_check()
        self.assert_ready(result)
        body = result["operations"][0]["event"]["body"]
        start = datetime.fromisoformat(body["start"]["dateTime"])
        end = datetime.fromisoformat(body["end"]["dateTime"])
        self.assertEqual(end - start, timedelta(hours=25))

    def test_all_day_dst_interval_preserves_real_twenty_three_hour_duration(self):
        # Synthetic normalization of Mar 8 local midnight to Mar 9 in Chicago.
        window = interval("2026-03-08T00:00:00Z", "2026-03-10T00:00:00Z")
        self.plan["window"] = copy.deepcopy(window)
        for source in self.snapshot["sources"]:
            source["window"] = copy.deepcopy(window)
            source["events"] = []
        self.snapshot["sources"][0]["events"] = [
            event("fixture-all-day", "2026-03-08T06:00:00Z", "2026-03-09T05:00:00Z",
                  availability="free")]
        result = self.run_check()
        self.assert_ready(result)
        body = result["operations"][0]["event"]["body"]
        start = datetime.fromisoformat(body["start"]["dateTime"])
        end = datetime.fromisoformat(body["end"]["dateTime"])
        self.assertEqual(end - start, timedelta(hours=23))

    def test_changed_horizon_cannot_release_previously_authorized_projections(self):
        self.establish()
        self.advance()
        self.plan["window"] = interval(at(24, 0), at(26, 0))
        self.assert_held()

    def test_stateless_restart_cannot_delete_owned_projection_outside_new_horizon(self):
        self.establish()
        self.advance()
        self.state = None
        self.plan["window"] = interval(at(24, 0), at(26, 0))
        self.assert_held()

    def test_moved_out_recurrence_exception_releases_only_old_instance(self):
        self.establish()
        original_id = next(row["id"] for row in self.target["events"]
                           if row["body"]["start"]["dateTime"] == at(24, 13))
        self.advance()
        self.snapshot["sources"][0]["events"][1].update(start=at(27, 13), end=at(27, 14))
        result = self.run_check()
        self.assert_ready(result)
        self.assertEqual(result["operations"], [{"op": "delete", "id": original_id}])

    def test_unexpanded_master_cannot_mix_with_expanded_recurring_instances(self):
        master = event("fixture-series", at(24, 13), at(24, 14))
        self.snapshot["sources"][0]["events"].append(master)
        self.assert_held()

    def test_invalid_events_hold_without_leaking_source_values(self):
        for changes in ({"start": "2026-11-23T13:00:00-06:00"},
                        {"end": at(23, 13)}, {"status": "unknown"},
                        {"status": "cancelled"}, {"rrule": "FREQ=DAILY"},
                        {"event_ref": "synthetic secret value"}):
            with self.subTest(changes=changes):
                self.setUp()
                self.snapshot["sources"][0]["events"][0].update(changes)
                result = self.assert_held()
                self.assertNotIn("synthetic secret value", json.dumps(result))

    def test_destination_cannot_be_an_authorized_source(self):
        self.plan["sources"][0]["calendar_ref"] = self.plan["destination_ref"]
        self.assert_held()

    def test_oversized_deep_and_cyclic_input_hold_without_tracebacks(self):
        for kind in ("long_string", "many_nodes", "deep", "cycle"):
            with self.subTest(kind=kind):
                self.setUp()
                metadata = self.snapshot["sources"][0]["events"][0]["metadata"]
                if kind == "long_string":
                    metadata["value"] = "x" * 4097
                elif kind == "many_nodes":
                    metadata["value"] = [0] * 50_001
                elif kind == "deep":
                    nested = metadata
                    for _ in range(20):
                        nested["nested"] = {}
                        nested = nested["nested"]
                else:
                    metadata["cycle"] = metadata
                self.assert_held()

    def test_non_json_metadata_types_are_rejected(self):
        for value in (1.5, float("nan"), b"synthetic", {"synthetic"}, object()):
            with self.subTest(kind=type(value).__name__):
                self.setUp()
                self.snapshot["sources"][0]["events"][0]["metadata"]["value"] = value
                self.assert_held()

    def test_boolean_schema_versions_and_numeric_policy_are_rejected(self):
        for container in ("plan", "snapshot", "target"):
            with self.subTest(container=container):
                self.setUp()
                getattr(self, container)["schema_version"] = True
                self.assert_held()
        self.setUp()
        self.plan["freshness_seconds"] = True
        self.assert_held()

    def test_unknown_or_missing_input_fields_are_rejected(self):
        for mutation in ("extra_plan", "missing_plan", "extra_target", "missing_event"):
            with self.subTest(mutation=mutation):
                self.setUp()
                if mutation == "extra_plan":
                    self.plan["allow_public"] = True
                elif mutation == "missing_plan":
                    del self.plan["sources"]
                elif mutation == "extra_target":
                    self.target["appointment_changes"] = []
                else:
                    del self.snapshot["sources"][0]["events"][0]["availability"]
                self.assert_held()

    def test_source_event_and_destination_count_limits_hold_without_truncation(self):
        with patch.object(reconciler, "MAX_SOURCES", 1):
            self.assert_held()
        # Three events on one source plus one on another exceeds the total of 3.
        with patch.object(reconciler, "MAX_EVENTS", 3):
            self.assert_held()
        self.snapshot["sources"][0]["events"] = self.snapshot["sources"][0]["events"][:1]
        self.snapshot["sources"][1]["events"] = []
        self.target["events"] = [
            {"id": f"fixture-original-{index}", "projection": None, "body": {}}
            for index in range(4)
        ]
        with patch.object(reconciler, "MAX_EVENTS", 3):
            self.assert_held()

    def test_generated_target_over_readable_byte_limit_is_held_atomically(self):
        # Small normalized records expand to larger privacy-controlled projections.
        self.snapshot["sources"][0]["events"] = [
            event(f"fixture-{index}", at(23, 13), at(23, 14)) for index in range(12)
        ]
        self.snapshot["sources"][1]["events"] = []
        for item in self.snapshot["sources"][0]["events"]:
            del item["metadata"]
        first = self.run_check()
        self.assert_ready(first)
        updated = apply_plan(self.target, first)
        encoded_size = lambda value: len(json.dumps(value, separators=(",", ":")).encode("utf-8"))
        limit = max(map(encoded_size, (self.plan, self.snapshot, self.target))) + 100
        self.assertGreater(encoded_size(updated), limit)
        before = copy.deepcopy((self.plan, self.snapshot, self.target))
        with patch.object(reconciler, "MAX_BYTES", limit):
            result = self.assert_held()
        self.assertEqual(result["reason"], "input_limit")
        self.assertEqual((self.plan, self.snapshot, self.target), before)

    def test_combined_foreign_and_projected_target_cannot_exceed_count_bound(self):
        # Each input fits independently, but preserving originals plus four new
        # Busy projections would make the next target readback unprocessable.
        self.target["events"] = [
            {"id": f"fixture-original-{index}", "projection": None, "body": {}}
            for index in range(4)
        ]
        before = copy.deepcopy(self.target)
        with patch.object(reconciler, "MAX_EVENTS", 4):
            self.assert_held()
        self.assertEqual(self.target, before)


class OfflineStoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db = Path(self.directory.name) / "synthetic.sqlite"
        self.plan, self.snapshot, _ = fixture()

    def run_store(self, now=NOW):
        return reconciler.run_offline(self.plan, self.snapshot, self.db, now=now)

    def read_store(self):
        with sqlite3.connect(self.db) as connection:
            row = connection.execute("SELECT state_json, events_json FROM offline_reconciliation").fetchone()
        return tuple(json.loads(item) for item in row)

    def test_restart_retains_identity_and_produces_no_duplicates(self):
        first = self.run_store()
        self.assertEqual(first["status"], "ready", first)
        before = self.read_store()
        second = self.run_store()
        self.assertEqual(second["status"], "ready", second)
        self.assertEqual(second["operations"], [])
        self.assertEqual(self.read_store(), before)
        self.assertEqual(len(before[1]), 4)

    def test_restart_after_cancellation_rejects_old_snapshot(self):
        old_snapshot = copy.deepcopy(self.snapshot)
        self.assertEqual(self.run_store()["status"], "ready")
        for source in self.snapshot["sources"]:
            source["observed_at"] = NOW
            source["upstream_observed_at"] = NOW
        self.snapshot["sources"][0]["events"][0].update(status="cancelled", start=None, end=None)
        self.assertEqual(self.run_store(now=shifted(NOW, 60))["status"], "ready")
        before = self.read_store()
        self.snapshot = old_snapshot
        held = self.run_store(now=shifted(NOW, 60))
        self.assertEqual(held["status"], "held", held)
        self.assertEqual(self.read_store(), before)
        self.assertEqual(len(before[1]), 3)

    def test_stale_and_incomplete_input_preserve_durable_state(self):
        self.assertEqual(self.run_store()["status"], "ready")
        before = self.read_store()
        self.snapshot["sources"][0]["events"] = []
        self.snapshot["sources"][0]["complete"] = False
        self.assertEqual(self.run_store()["status"], "held")
        self.assertEqual(self.read_store(), before)
        self.snapshot["sources"][0]["complete"] = True
        self.assertEqual(self.run_store(now=shifted(NOW, 600))["status"], "held")
        self.assertEqual(self.read_store(), before)

    def test_restart_reconciles_missing_and_tampered_simulated_target(self):
        self.assertEqual(self.run_store()["status"], "ready")
        original_state, original_events = self.read_store()
        drifted = copy.deepcopy(original_events)
        drifted.pop()
        drifted[0]["body"].update(visibility="public", attendees=["fixture@example.invalid"])
        with sqlite3.connect(self.db) as connection:
            connection.execute("UPDATE offline_reconciliation SET events_json = ?",
                               (json.dumps(drifted),))
        result = self.run_store()
        self.assertEqual(result["status"], "ready", result)
        self.assertEqual(len(result["operations"]), 2)
        self.assertEqual(self.read_store(), (original_state, original_events))

    def test_failed_commit_keeps_prior_target_and_checkpoint_together(self):
        self.assertEqual(self.run_store()["status"], "ready")
        before = self.read_store()
        for source in self.snapshot["sources"]:
            source["observed_at"] = NOW
            source["upstream_observed_at"] = NOW
            source["events"] = []
        with sqlite3.connect(self.db) as connection:
            connection.execute("CREATE TRIGGER fixture_abort BEFORE INSERT ON offline_reconciliation "
                               "BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
        result = self.run_store(now=shifted(NOW, 60))
        self.assertEqual(result["status"], "held", result)
        self.assertEqual(result["operations"], [])
        self.assertEqual(self.read_store(), before)

    def test_concurrent_restarts_serialize_without_duplicate_projections(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: self.run_store(), range(2)))
        self.assertTrue(all(result["status"] == "ready" for result in results), results)
        self.assertEqual(sorted(len(result["operations"]) for result in results), [0, 4])
        self.assertEqual(len(self.read_store()[1]), 4)

    def test_corrupt_checkpoint_is_held_without_resetting_destination(self):
        self.assertEqual(self.run_store()["status"], "ready")
        _, before_events = self.read_store()
        with sqlite3.connect(self.db) as connection:
            connection.execute("UPDATE offline_reconciliation SET state_json = ?", ('{"broken":true}',))
        result = self.run_store()
        self.assertEqual(result["status"], "held", result)
        self.assertEqual(self.read_store()[1], before_events)

    def test_null_checkpoint_cannot_reset_durable_source_watermarks(self):
        old_snapshot = copy.deepcopy(self.snapshot)
        self.assertEqual(self.run_store()["status"], "ready")
        for source in self.snapshot["sources"]:
            source["observed_at"] = NOW
            source["upstream_observed_at"] = NOW
            source["events"] = []
        self.assertEqual(self.run_store(now=shifted(NOW, 60))["status"], "ready")
        with sqlite3.connect(self.db) as connection:
            connection.execute("UPDATE offline_reconciliation SET state_json = 'null'")
        self.snapshot = old_snapshot
        result = self.run_store(now=shifted(NOW, 60))
        self.assertEqual(result["status"], "held", result)
        self.assertEqual(self.read_store(), (None, []))

    def test_blob_checkpoint_is_held_without_uncaught_traceback(self):
        self.assertEqual(self.run_store()["status"], "ready")
        with sqlite3.connect(self.db) as connection:
            connection.execute("UPDATE offline_reconciliation SET state_json = ?", (b"{}",))
        result = self.run_store()
        self.assertEqual(result["status"], "held", result)
        self.assertEqual(result["operations"], [])

    def test_missing_durable_singleton_cannot_be_silently_reinitialized(self):
        self.assertEqual(self.run_store()["status"], "ready")
        with sqlite3.connect(self.db) as connection:
            connection.execute("DELETE FROM offline_reconciliation")
        result = self.run_store()
        self.assertEqual(result["status"], "held", result)
        self.assertEqual(result["operations"], [])
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(connection.execute("SELECT * FROM offline_reconciliation").fetchall(), [])

    def test_dropped_checkpoint_table_cannot_reset_initialized_database(self):
        self.assertEqual(self.run_store()["status"], "ready")
        with sqlite3.connect(self.db) as connection:
            connection.execute("DROP TABLE offline_reconciliation")
        result = self.run_store()
        self.assertEqual(result["status"], "held", result)
        self.assertEqual(result["operations"], [])
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
                             .fetchall(), [])

    def test_unrelated_database_is_held_without_adding_simulator_state(self):
        with sqlite3.connect(self.db) as connection:
            connection.execute("CREATE TABLE fixture_original (value TEXT)")
            connection.execute("INSERT INTO fixture_original VALUES ('synthetic original')")
        result = self.run_store()
        self.assertEqual(result["status"], "held", result)
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
                             .fetchall(), [("fixture_original",)])
            self.assertEqual(connection.execute("SELECT value FROM fixture_original").fetchall(),
                             [("synthetic original",)])

    def test_cli_emits_only_fixed_status_and_counts_and_restarts_safely(self):
        plan_path = Path(self.directory.name) / "synthetic-plan.json"
        snapshot_path = Path(self.directory.name) / "synthetic-snapshot.json"
        plan_path.write_text(json.dumps(self.plan), encoding="utf-8")
        snapshot_path.write_text(json.dumps(self.snapshot), encoding="utf-8")
        command = [sys.executable, str(MODULE), str(plan_path), str(snapshot_path),
                   "--database", str(self.db), "--now", NOW]
        for expected in (4, 0):
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, "")
            output = json.loads(result.stdout)
            self.assertEqual(output["status"], "ready")
            self.assertEqual(output["operation_count"], expected)
            for forbidden in ("operations", "next_state", "Synthetic", "fixture-", "2026-11"):
                self.assertNotIn(forbidden, result.stdout)

    def test_cli_duplicate_keys_and_bad_arguments_are_sanitized(self):
        plan_path = Path(self.directory.name) / "synthetic-sensitive-name.json"
        plan_path.write_text('{"schema_version":1,"schema_version":1}', encoding="utf-8")
        commands = [
            [sys.executable, str(MODULE), str(plan_path), str(plan_path),
             "--database", str(self.db), "--now", NOW],
            [sys.executable, str(MODULE), "synthetic-sensitive-argument"],
        ]
        for command in commands:
            with self.subTest(command=command[-1]):
                result = subprocess.run(command, capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stderr, "")
                self.assertEqual(json.loads(result.stdout)["status"], "held")
                self.assertNotIn("synthetic-sensitive", result.stdout)
                self.assertFalse(self.db.exists())


if __name__ == "__main__":
    unittest.main()
