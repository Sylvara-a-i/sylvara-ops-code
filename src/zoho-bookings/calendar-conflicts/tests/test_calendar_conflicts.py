import copy
import importlib.util
import io
import json
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone


MODULE = Path(__file__).resolve().parents[1] / "calendar_conflicts.py"
SPEC = importlib.util.spec_from_file_location("calendar_conflicts", MODULE)
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)
NOW = "2026-11-10T12:00:00Z"


def window(start, end):
    return {"start": start, "end": end}


def at(hour, minute=0):
    return f"2026-11-10T{hour:02d}:{minute:02d}:00Z"


def fixture():
    plan = {
        "schema_version": 1,
        "scope": {"environment": "synthetic", "organization_ref": "fixture-organization",
                  "workspace_ref": "fixture-workspace", "service_ref": "fixture-service", "staff_ref": "fixture-staff"},
        "account_refs": ["fixture-icloud", "fixture-google"],
        "freshness_seconds": 300,
        "window": window(at(13), at(17)),
        "duration_seconds": 1800,
        "buffers": {"before_seconds": 0, "after_seconds": 0},
    }
    evidence = {
        "schema_version": 1,
        "scope": copy.deepcopy(plan["scope"]),
        "inventory": {
            "status": "ok", "observed_at": at(11, 57), "complete": True,
            "accounts": [
                {"account_ref": "fixture-icloud", "complete": True, "calendar_refs": ["fixture-personal"]},
                {"account_ref": "fixture-google", "complete": True, "calendar_refs": ["fixture-work"]},
            ],
        },
        "calendar_reads": [
            {"account_ref": "fixture-icloud", "calendar_ref": "fixture-personal",
             "conflict_target_ref": "fixture-bridge", "status": "ok", "complete": True,
             "observed_at": at(11, 58), "window": copy.deepcopy(plan["window"]),
             "busy": [window(at(14), at(14, 30))]},
            {"account_ref": "fixture-google", "calendar_ref": "fixture-work",
             "conflict_target_ref": "fixture-work", "status": "ok", "complete": True,
             "observed_at": at(11, 59), "window": copy.deepcopy(plan["window"]),
             "busy": [window(at(15), at(15, 45))]},
        ],
        "bookings": {
            "status": "ok", "observed_at": NOW, "complete": True,
            "window": copy.deepcopy(plan["window"]), "duration_seconds": 1800,
            "buffers": copy.deepcopy(plan["buffers"]),
            "selected_calendar_refs": ["fixture-bridge", "fixture-work"],
            "slots": [at(13), at(13, 30), at(14, 30), at(16)],
        },
    }
    return plan, evidence


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.plan, self.evidence = fixture()

    def run_check(self):
        return checker.evaluate_calendar_conflicts(self.plan, self.evidence, now=NOW)

    def assert_held(self, reason):
        result = self.run_check()
        self.assertEqual(result["status"], "held")
        self.assertEqual(result["reason"], reason)
        return result

    def test_clean_snapshot_has_no_authority(self):
        result = self.run_check()
        self.assertEqual(result["status"], "consistent_snapshot")
        self.assertEqual(result["calendar_count"], 2)
        self.assertEqual(result["calendars_with_busy"], 2)
        for key in ("provider_access_verified", "live_coverage_qualified", "booking_authorized", "provider_changes_made"):
            self.assertIs(result[key], False)

    def test_complete_duration_is_checked_not_only_slot_start(self):
        self.evidence["bookings"]["slots"] = [at(13, 45)]
        result = self.run_check()
        self.assertEqual(result["status"], "conflicts_observed")
        self.assertEqual(result["conflicting_slot_count"], 1)

    def test_exact_event_end_is_available(self):
        self.evidence["bookings"]["slots"] = [at(14, 30)]
        self.assertEqual(self.run_check()["status"], "consistent_snapshot")

    def test_exact_event_start_after_slot_end_is_available(self):
        self.evidence["bookings"]["slots"] = [at(13, 30)]
        self.assertEqual(self.run_check()["status"], "consistent_snapshot")

    def test_pre_buffer_conflict(self):
        self.plan["buffers"]["before_seconds"] = 60
        self.evidence["bookings"]["buffers"]["before_seconds"] = 60
        for read in self.evidence["calendar_reads"]:
            read["window"]["start"] = at(12, 59)
        self.evidence["bookings"]["slots"] = [at(14, 30)]
        self.assertEqual(self.run_check()["status"], "conflicts_observed")

    def test_post_buffer_conflict(self):
        self.plan["buffers"]["after_seconds"] = 60
        self.evidence["bookings"]["buffers"]["after_seconds"] = 60
        for read in self.evidence["calendar_reads"]:
            read["window"]["end"] = at(17, 1)
        self.evidence["bookings"]["slots"] = [at(13, 30)]
        self.assertEqual(self.run_check()["status"], "conflicts_observed")

    def test_buffer_window_must_include_external_busy(self):
        self.plan["buffers"]["before_seconds"] = 60
        self.evidence["bookings"]["buffers"]["before_seconds"] = 60
        self.assert_held("source_window_mismatch")

    def test_overlapping_events_count_conflicting_slot_once(self):
        self.evidence["calendar_reads"][1]["busy"] = [window(at(14), at(16)), window(at(14, 15), at(16, 30))]
        self.evidence["bookings"]["slots"] = [at(14)]
        self.assertEqual(self.run_check()["conflicting_slot_count"], 1)

    def test_slots_and_intervals_need_not_be_sorted(self):
        self.evidence["bookings"]["slots"].reverse()
        self.evidence["calendar_reads"][0]["busy"].append(window(at(13, 5), at(13, 10)))
        self.assertEqual(self.run_check()["conflicting_slot_count"], 1)

    def test_duplicate_slot_equivalent_utc_format(self):
        self.evidence["bookings"]["slots"] = [at(13), "2026-11-10T13:00:00.000Z"]
        self.assert_held("duplicate_slot")

    def test_same_calendar_name_in_distinct_accounts_is_not_duplicate(self):
        self.evidence["inventory"]["accounts"][1]["calendar_refs"] = ["fixture-personal"]
        self.evidence["calendar_reads"][1]["calendar_ref"] = "fixture-personal"
        self.assertEqual(self.run_check()["status"], "consistent_snapshot")

    def test_two_sources_can_share_one_conflict_destination(self):
        self.evidence["calendar_reads"][1]["conflict_target_ref"] = "fixture-bridge"
        self.evidence["bookings"]["selected_calendar_refs"] = ["fixture-bridge"]
        self.assertEqual(self.run_check()["status"], "consistent_snapshot")

    def test_missing_icloud_calendar_detected(self):
        self.evidence["inventory"]["accounts"][0]["calendar_refs"].append("fixture-second")
        self.assert_held("missing_calendar")

    def test_unselected_bridge_detected(self):
        self.evidence["bookings"]["selected_calendar_refs"] = ["fixture-work"]
        self.assert_held("calendar_not_selected")

    def test_missing_account_detected(self):
        self.evidence["inventory"]["accounts"].pop()
        self.assert_held("account_inventory_mismatch")

    def test_incomplete_inventory_detected(self):
        self.evidence["inventory"]["complete"] = False
        self.assert_held("incomplete_inventory")

    def test_incomplete_account_detected(self):
        self.evidence["inventory"]["accounts"][0]["complete"] = False
        self.assert_held("incomplete_inventory")

    def test_incomplete_calendar_pagination_detected(self):
        self.evidence["calendar_reads"][0]["complete"] = False
        self.assert_held("incomplete_calendar")

    def test_incomplete_bookings_detected(self):
        self.evidence["bookings"]["complete"] = False
        self.assert_held("incomplete_bookings")

    def test_permission_failure_is_not_empty_availability(self):
        self.evidence["calendar_reads"][0]["status"] = "inaccessible"
        self.evidence["calendar_reads"][0]["busy"] = []
        self.assert_held("incomplete_calendar")

    def test_duplicate_calendar_detected(self):
        self.evidence["calendar_reads"].append(copy.deepcopy(self.evidence["calendar_reads"][0]))
        self.assert_held("duplicate_calendar")

    def test_duplicate_inventory_calendar_detected(self):
        self.evidence["inventory"]["accounts"][0]["calendar_refs"] *= 2
        self.assert_held("duplicate_reference")

    def test_duplicate_account_detected(self):
        self.evidence["inventory"]["accounts"].append(copy.deepcopy(self.evidence["inventory"]["accounts"][0]))
        self.assert_held("duplicate_account")

    def test_unexpected_calendar_detected(self):
        self.evidence["calendar_reads"][0]["calendar_ref"] = "fixture-other"
        self.assert_held("unexpected_calendar")

    def test_scope_mismatch_detected(self):
        self.evidence["scope"]["service_ref"] = "fixture-other"
        self.assert_held("scope_mismatch")

    def test_environment_and_organization_mismatch_detected(self):
        for field in ["environment", "organization_ref"]:
            self.plan, self.evidence = fixture()
            self.evidence["scope"][field] = "fixture-other"
            self.assert_held("scope_mismatch")

    def test_stale_source_is_not_hidden_by_fresh_bookings(self):
        self.evidence["calendar_reads"][0]["observed_at"] = at(10)
        self.assert_held("stale_or_future_read")

    def test_stale_inventory_detected(self):
        self.evidence["inventory"]["observed_at"] = at(10)
        self.assert_held("stale_or_future_read")

    def test_stale_bookings_detected(self):
        self.evidence["bookings"]["observed_at"] = at(10)
        self.assert_held("stale_or_future_read")

    def test_future_read_detected(self):
        self.evidence["bookings"]["observed_at"] = at(12, 1)
        self.assert_held("stale_or_future_read")

    def test_bookings_read_must_follow_source_snapshots(self):
        self.evidence["bookings"]["observed_at"] = at(11, 58)
        self.assert_held("observation_order")

    def test_inventory_read_must_precede_source_snapshots(self):
        self.evidence["inventory"]["observed_at"] = at(11, 59)
        self.assert_held("observation_order")

    def test_service_duration_drift_detected(self):
        self.evidence["bookings"]["duration_seconds"] = 3600
        self.assert_held("service_settings_mismatch")

    def test_service_buffer_drift_detected(self):
        self.evidence["bookings"]["buffers"]["after_seconds"] = 5
        self.assert_held("service_settings_mismatch")

    def test_window_drift_detected(self):
        self.evidence["bookings"]["window"]["end"] = at(18)
        self.assert_held("window_mismatch")

    def test_slot_must_fit_duration_in_requested_window(self):
        self.evidence["bookings"]["slots"] = [at(16, 45)]
        self.assert_held("slot_outside_window")

    def test_no_available_slots_is_inconclusive_not_pass(self):
        self.evidence["bookings"]["slots"] = []
        self.assert_held("insufficient_probe_coverage")

    def test_each_source_needs_busy_probe_coverage(self):
        self.evidence["calendar_reads"][1]["busy"] = []
        self.assert_held("insufficient_probe_coverage")

    def test_empty_source_can_still_report_a_detected_conflict(self):
        self.evidence["calendar_reads"][1]["busy"] = []
        self.evidence["bookings"]["slots"] = [at(14)]
        self.assertEqual(self.run_check()["status"], "conflicts_observed")

    def test_zero_length_busy_interval_rejected(self):
        self.evidence["calendar_reads"][0]["busy"] = [window(at(14), at(14))]
        self.assert_held("invalid_interval")

    def test_busy_outside_source_window_rejected(self):
        self.evidence["calendar_reads"][0]["busy"] = [window(at(18), at(19))]
        self.assert_held("busy_outside_window")

    def test_busy_crossing_window_boundary_is_not_dropped(self):
        self.evidence["calendar_reads"][0]["busy"] = [window(at(12), at(13, 15))]
        self.assertEqual(self.run_check()["conflicting_slot_count"], 1)

    def test_normalized_23_and_25_hour_all_day_busy_intervals(self):
        for start, end in [("2026-03-08T06:00:00Z", "2026-03-09T05:00:00Z"),
                           ("2026-11-01T05:00:00Z", "2026-11-02T06:00:00Z")]:
            self.plan, self.evidence = fixture()
            self.plan["window"] = window(start, end)
            self.evidence["bookings"]["window"] = window(start, end)
            self.evidence["bookings"]["slots"] = [start]
            for read in self.evidence["calendar_reads"]:
                read["window"] = window(start, end)
                read["busy"] = [window(start, end)]
            self.assertEqual(self.run_check()["status"], "conflicts_observed")

    def test_naive_or_non_utc_timestamps_rejected(self):
        for value in ["2026-11-10T14:00:00", "2026-11-10T08:00:00-06:00", "2026-02-30T14:00:00Z"]:
            self.evidence["bookings"]["slots"] = [value]
            self.assert_held("invalid_time")

    def test_boolean_not_integer(self):
        for section, field in [(self.plan, "duration_seconds"), (self.plan, "freshness_seconds"),
                               (self.evidence["bookings"], "duration_seconds")]:
            original = section[field]
            section[field] = True
            self.assert_held("invalid_number")
            section[field] = original

    def test_unknown_payload_keys_rejected_without_echo(self):
        self.evidence["calendar_reads"][0]["title"] = "private-title-fixture"
        result = self.assert_held("invalid_shape")
        self.assertNotIn("private-title-fixture", json.dumps(result))

    def test_output_does_not_echo_identifiers_or_times(self):
        result = json.dumps(self.run_check())
        self.assertNotIn("fixture", result)
        self.assertNotIn("2026", result)

    def test_oversized_list_rejected(self):
        self.evidence["bookings"]["slots"] = [at(13)] * (checker.MAX_SLOTS + 1)
        self.assert_held("invalid_list")

    def test_cycle_rejected(self):
        self.plan["cycle"] = self.plan
        self.assert_held("reused_container")

    def test_container_growth_and_total_string_bytes_are_bounded(self):
        self.plan["extra"] = [None] * (checker.MAX_NODES + 1)
        self.assert_held("input_limit")
        self.plan, self.evidence = fixture()
        self.plan["extra"] = ["x" * 4096] * 300
        self.assert_held("input_limit")

    def test_invalid_types_rejected_without_exception(self):
        for value in [None, True, 3, 4.5, [], "private-fixture", {"unknown": object()}]:
            result = checker.evaluate_calendar_conflicts(value, self.evidence, now=NOW)
            self.assertEqual(result["status"], "held")

    def test_schema_boolean_is_not_version_one(self):
        self.plan["schema_version"] = True
        self.assert_held("invalid_input")

    def test_empty_accounts_or_calendars_cannot_pass(self):
        self.plan["account_refs"] = []
        self.assert_held("invalid_list")
        self.plan, self.evidence = fixture()
        self.evidence["inventory"]["accounts"][0]["calendar_refs"] = []
        self.assert_held("invalid_list")

    def test_window_more_than_31_days_is_held(self):
        self.plan["window"]["end"] = "2026-12-12T00:00:00Z"
        self.assert_held("window_too_large")

    def test_calendar_limit_is_global_not_per_account(self):
        self.evidence["inventory"]["accounts"][0]["calendar_refs"] = [f"fixture-{i}" for i in range(256)]
        self.assert_held("input_limit")

    def test_invalid_now_is_held(self):
        result = checker.evaluate_calendar_conflicts(self.plan, self.evidence, now="invalid-private-fixture")
        self.assertEqual(result["reason"], "invalid_time")
        self.assertNotIn("invalid-private-fixture", json.dumps(result))

    def test_datetime_underflow_is_held(self):
        self.plan["window"] = window("0001-01-01T00:00:00Z", "0001-01-02T00:00:00Z")
        self.plan["buffers"]["before_seconds"] = 1
        self.assert_held("input_limit")

    def test_no_input_mutation(self):
        before = copy.deepcopy((self.plan, self.evidence))
        self.run_check()
        self.assertEqual((self.plan, self.evidence), before)

    def test_interval_sweep_matches_brute_force_250_seeded_cases(self):
        rng = random.Random(20261110)
        origin = datetime(2026, 11, 10, 13, tzinfo=timezone.utc)
        stamp = lambda value: value.isoformat().replace("+00:00", "Z")
        for _ in range(250):
            self.plan, self.evidence = fixture()
            before, after = rng.randrange(0, 301), rng.randrange(0, 301)
            buffers = {"before_seconds": before, "after_seconds": after}
            self.plan["buffers"] = buffers
            self.evidence["bookings"]["buffers"] = copy.deepcopy(buffers)
            all_busy = []
            for read in self.evidence["calendar_reads"]:
                read["window"] = window(stamp(origin - timedelta(seconds=before)), stamp(origin + timedelta(hours=4, seconds=after)))
                read["busy"] = []
                for _ in range(rng.randrange(1, 12)):
                    begin = origin + timedelta(seconds=rng.randrange(0, 13_000))
                    end = begin + timedelta(seconds=rng.randrange(1, 900))
                    read["busy"].append(window(stamp(begin), stamp(end)))
                    all_busy.append((begin, end))
            slots = [origin + timedelta(seconds=step) for step in rng.sample(range(0, 12_601, 300), 12)]
            self.evidence["bookings"]["slots"] = [stamp(slot) for slot in slots]
            expected = sum(any(slot - timedelta(seconds=before) < end and begin < slot + timedelta(seconds=1800 + after)
                               for begin, end in all_busy) for slot in slots)
            self.assertEqual(self.run_check()["conflicting_slot_count"], expected)


class CliTests(unittest.TestCase):
    def arguments(self, *args):
        return subprocess.run([sys.executable, str(MODULE), *args], capture_output=True, text=True, check=False)

    def call(self, plan_text, evidence_text):
        with tempfile.TemporaryDirectory() as folder:
            first, second = Path(folder) / "plan.json", Path(folder) / "evidence.json"
            first.write_text(plan_text, encoding="utf-8")
            second.write_text(evidence_text, encoding="utf-8")
            return subprocess.run([sys.executable, str(MODULE), str(first), str(second), "--now", NOW], capture_output=True, text=True, check=False)

    def test_cli_success_and_conflict_exit_codes(self):
        plan, evidence = fixture()
        result = self.call(json.dumps(plan), json.dumps(evidence))
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        evidence["bookings"]["slots"] = [at(14)]
        result = self.call(json.dumps(plan), json.dumps(evidence))
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)["status"], "conflicts_observed")

    def test_duplicate_json_keys_rejected(self):
        result = self.call('{"schema_version":1,"schema_version":1}', '{}')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)["reason"], "duplicate_json_key")

    def test_malformed_json_is_sanitized(self):
        result = self.call('private-fixture-not-json', '{}')
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("private-fixture", result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")

    def test_non_finite_json_value_rejected(self):
        result = self.call('{"value": NaN}', '{}')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)["reason"], "invalid_value_type")

    def test_unexpected_private_argument_has_fixed_sanitized_error(self):
        result = self.arguments("/private-fixture/plan.json", "/private-fixture/evidence.json",
                                "--now", NOW, "/private-fixture/unexpected.json")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, "")
        self.assertEqual(json.loads(result.stdout), checker._result("held", "invalid_arguments"))
        self.assertNotIn("private-fixture", result.stdout)

    def test_missing_and_unknown_argument_forms_have_same_fixed_error(self):
        cases = [[], ["/private-fixture/plan.json"],
                 ["/private-fixture/plan.json", "/private-fixture/evidence.json", "--now"],
                 ["--private-fixture-option", "secret-fixture-value"],
                 ["/private-fixture/plan.json", "/private-fixture/evidence.json", "--no", NOW]]
        for arguments in cases:
            with self.subTest(arguments=arguments):
                result = self.arguments(*arguments)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stderr, "")
                self.assertEqual(json.loads(result.stdout), checker._result("held", "invalid_arguments"))

    def test_help_uses_fixed_program_name_without_local_module_path(self):
        result = self.arguments("--help")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        self.assertIn("usage: calendar-conflicts", result.stdout)
        self.assertNotIn(str(MODULE), result.stdout)
        self.assertNotIn(str(MODULE.parent), result.stdout)

    def test_argument_errors_never_read_input_files(self):
        arguments = ["/private-fixture/program.py", "/private-fixture/plan.json",
                     "/private-fixture/evidence.json", "--now", NOW, "private-extra-fixture"]
        output = io.StringIO()
        with patch.object(sys, "argv", arguments), patch("builtins.open") as reader, patch("sys.stdout", output):
            self.assertEqual(checker.main(), 2)
        reader.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()), checker._result("held", "invalid_arguments"))

    def test_invalid_now_value_is_sanitized_after_valid_argument_parse(self):
        plan, evidence = fixture()
        with tempfile.TemporaryDirectory() as folder:
            first, second = Path(folder) / "plan.json", Path(folder) / "evidence.json"
            first.write_text(json.dumps(plan), encoding="utf-8")
            second.write_text(json.dumps(evidence), encoding="utf-8")
            result = self.arguments(str(first), str(second), "--now=private-fixture-invalid-time")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, "")
        self.assertEqual(json.loads(result.stdout)["reason"], "invalid_time")
        self.assertNotIn("private-fixture", result.stdout)


if __name__ == "__main__":
    unittest.main()
