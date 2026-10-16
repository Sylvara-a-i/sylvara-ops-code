"""Synthetic, provider-free examples for the offline Route B contract."""

import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


CRM_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CRM_ROOT))
from validators.booking_lineage import (  # noqa: E402
    MAX_BYTES,
    MAX_CONTAINER_ITEMS,
    MAX_DEPTH,
    MAX_NODES,
    MAX_STRING_BYTES,
    evaluate_booking_lineage,
)


NOW = "2026-10-16T10:00:00Z"
LATER = "2026-10-16T10:01:00Z"


def booking_fixture(*, converted=False):
    """Normalized examples only: references do not simulate authentication."""
    scope = {"environment": "development", "organization_id": "synthetic-org",
             "workspace_id": "synthetic-workspace", "service_id": "synthetic-service",
             "staff_id": "synthetic-staff"}
    # Deliberately different: a Forms entry or callback ID is not the native
    # RandomId/Intake_Submission_ID, nor a CRM Lead ID, by assumption.
    original = {"forms_entry_id": "synthetic-entry-101", "intake_id": "Intake00001",
                "lead_id": "synthetic-lead-101", "journey_id": "synthetic-journey-101"}
    readers = {key: f"synthetic-{key}-evidence" for key in (
        "intake", "booking", "event_search", "event", "original_lead", "converted_records", "calendar")}
    relationships = [{"role": "participant", "module": "Leads", "record_id": original["lead_id"]}]
    if converted:
        relationships = [
            {"role": "participant", "module": "Contacts", "record_id": "synthetic-contact-101"},
            {"role": "related", "module": "Deals", "record_id": "synthetic-deal-101"},
        ]
    expected = {
        "schema_version": 1, "scope": scope, "original": original,
        "binding": {
            "booking_id": "synthetic-booking-101", "original": copy.deepcopy(original),
            "scope": copy.deepcopy(scope), "carrier_digest": "a" * 64,
            "requester_binding_ref": "synthetic-independent-requester-binding",
            "delivery_evidence_ref": "synthetic-delivery-evidence",
            "provenance_ref": "synthetic-binding-evidence",
            "established_at": "2026-10-16T09:01:00Z",
        },
        "calendar": {"destination_id": "synthetic-calendar"},
        "event_join": {"metadata_evidence_ref": "synthetic-metadata-evidence",
                       "booking_identity_field_ref": "synthetic-native-booking-field-evidence",
                       "relationships": relationships},
        "readers": readers, "freshness_seconds": 120, "previous_association": None,
    }

    def read(name, **values):
        return {"read_status": "ok", "observed_at": "2026-10-16T09:59:30Z",
                "provenance_ref": readers[name], "scope": copy.deepcopy(scope), **values}

    schedule = {"lifecycle": "scheduled", "starts_at": "2026-10-16T12:00:00Z", "ends_at": "2026-10-16T12:15:00Z"}
    evidence = {
        "schema_version": 1,
        "intake": read("intake", original=copy.deepcopy(original), submitted_at="2026-10-16T09:00:00Z"),
        "delivery": {"evidence_ref": expected["binding"]["delivery_evidence_ref"],
                     "booking_id": "synthetic-booking-101", "lifecycle": "scheduled",
                     "revision": 1, "occurred_at": "2026-10-16T09:02:00Z"},
        "booking": read("booking", booking_id="synthetic-booking-101", carrier_digest="a" * 64,
                        revision=1, updated_at="2026-10-16T09:02:00Z", **schedule),
        "event_search": read("event_search", booking_id="synthetic-booking-101",
                             metadata_evidence_ref=expected["event_join"]["metadata_evidence_ref"],
                             booking_identity_field_ref=expected["event_join"]["booking_identity_field_ref"],
                             complete=True, match_count=1, records=[{"event_id": "synthetic-crm-event-101"}]),
        "event": read("event", event_id="synthetic-crm-event-101", booking_id="synthetic-booking-101",
                      carrier_digest="a" * 64, relationships=copy.deepcopy(relationships),
                      calendar_event_id="synthetic-calendar-event-101", **schedule),
        "original_lead": read("original_lead", lead_id=original["lead_id"], intake_id=original["intake_id"],
                              journey_id=original["journey_id"], conversion={"state": "unconverted"}),
        "converted_records": None,
        "calendar": read("calendar", destination_id="synthetic-calendar", event_id="synthetic-calendar-event-101",
                         crm_event_id="synthetic-crm-event-101", booking_id="synthetic-booking-101", **schedule),
    }
    if converted:
        evidence["original_lead"]["conversion"] = {
            "state": "converted", "account_id": "synthetic-account-101", "contact_id": "synthetic-contact-101",
            "deal_id": "synthetic-deal-101", "converted_at": "2026-10-16T09:03:00Z",
        }
        evidence["converted_records"] = read(
            "converted_records", account_id="synthetic-account-101",
            contact_id="synthetic-contact-101", contact_account_id="synthetic-account-101",
            deal_id="synthetic-deal-101", deal_contact_id="synthetic-contact-101", deal_account_id="synthetic-account-101",
            deal_intake_id=original["intake_id"], deal_journey_id=original["journey_id"],
        )
    return evidence, expected


def advance_readbacks(evidence):
    for value in evidence.values():
        if type(value) is dict and "observed_at" in value:
            value["observed_at"] = "2026-10-16T10:00:30Z"


def lifecycle(evidence, state, revision=2):
    evidence["booking"].update(revision=revision, updated_at="2026-10-16T10:00:00Z")
    evidence["delivery"].update(lifecycle=state, revision=revision, occurred_at="2026-10-16T10:00:00Z")
    for key in ("booking", "event", "calendar"):
        evidence[key]["lifecycle"] = state


class BookingLineageTests(unittest.TestCase):
    def check_inert(self, result):
        for flag in ("downstream_authority", "live_authority", "storage_authority", "setup_authority", "activation_authority", "persisted"):
            self.assertIs(result[flag], False, flag)
        self.assertIn("native_customer_create_and_update_containment", result["unresolved_live_gates"])
        self.assertIn("atomic_association_storage_and_concurrency_gate", result["unresolved_live_gates"])
        self.assertIn("lifecycle_authentication_and_reader_qualification", result["unresolved_live_gates"])

    def held(self, evidence, expected, reason=None, *, now=NOW):
        result = evaluate_booking_lineage(evidence, expected, now=now)
        self.assertEqual(result["status"], "held")
        self.assertIsNone(result["candidate"])
        self.check_inert(result)
        if reason:
            self.assertEqual(result["reason"], reason)
        return result

    def consistent(self, evidence, expected, *, now=NOW):
        result = evaluate_booking_lineage(evidence, expected, now=now)
        self.assertEqual(result["status"], "consistent_candidate", result["reason"])
        self.check_inert(result)
        return result["candidate"]

    def test_unconverted_candidate_retains_separate_original_identities(self):
        evidence, expected = booking_fixture()
        candidate = self.consistent(evidence, expected)
        self.assertEqual(candidate["original"], expected["original"])
        self.assertEqual(len(set(candidate["original"].values())), 4)
        self.assertEqual(candidate["conversion"], {"state": "unconverted"})

    def test_converted_candidate_requires_original_native_conversion_and_current_edges(self):
        evidence, expected = booking_fixture(converted=True)
        candidate = self.consistent(evidence, expected)
        self.assertEqual(candidate["conversion"], evidence["original_lead"]["conversion"])
        self.assertEqual(candidate["original"]["lead_id"], "synthetic-lead-101")

    def test_candidate_and_hold_never_mutate_inputs(self):
        evidence, expected = booking_fixture(converted=True)
        before = copy.deepcopy((evidence, expected))
        candidate = self.consistent(evidence, expected)
        self.assertEqual((evidence, expected), before)
        candidate["scope"]["service_id"] = "changed-output"
        candidate["relationships"][0]["record_id"] = "changed-output"
        self.assertEqual((evidence, expected), before)
        evidence["booking"]["carrier_digest"] = "b" * 64
        before = copy.deepcopy((evidence, expected))
        self.held(evidence, expected)
        self.assertEqual((evidence, expected), before)

    def test_matching_editable_carrier_and_event_never_replace_requester_binding(self):
        for missing in (None, "", "unknown", "unverified", "a" * 64, "sha256:" + "a" * 64):
            with self.subTest(missing=missing):
                evidence, expected = booking_fixture()
                expected["binding"]["requester_binding_ref"] = missing
                self.held(evidence, expected)
        evidence, expected = booking_fixture()
        del expected["binding"]["requester_binding_ref"]
        self.held(evidence, expected)

    def test_valid_carrier_transplanted_to_another_booking_is_held(self):
        evidence, expected = booking_fixture()
        for value in evidence.values():
            if type(value) is dict and "booking_id" in value:
                value["booking_id"] = "synthetic-booking-202"
        self.held(evidence, expected, "booking_binding_mismatch")

    def test_requester_binding_must_pin_original_and_scope_independently(self):
        for field in ("original", "scope"):
            evidence, expected = booking_fixture()
            key = next(iter(expected["binding"][field]))
            expected["binding"][field][key] = "unrelated"
            self.held(evidence, expected, "requester_binding_mismatch")

    def test_unknown_and_caller_asserted_authentication_never_qualify_evidence(self):
        for location in ("root", "binding", "booking", "delivery"):
            evidence, expected = booking_fixture()
            value = expected["binding"] if location == "binding" else evidence if location == "root" else evidence[location]
            value["trusted"] = True
            self.held(evidence, expected)
        evidence, expected = booking_fixture()
        evidence["delivery"]["evidence_ref"] = "arbitrary-signature-looking-value"
        self.held(evidence, expected, "delivery_provenance_mismatch")

    def test_same_person_or_carrier_does_not_allow_other_intake_or_company(self):
        for field in ("forms_entry_id", "intake_id", "lead_id", "journey_id"):
            evidence, expected = booking_fixture()
            # Same booking/carrier/participant, but a different requester-owned
            # original chain cannot be inferred from customer similarity.
            expected["original"][field] = "different-intake-owner"
            expected["binding"]["original"][field] = "different-intake-owner"
            self.held(evidence, expected, "intake_owner_mismatch")
        evidence, expected = booking_fixture(converted=True)
        evidence["converted_records"]["contact_account_id"] = "other-company"
        self.held(evidence, expected, "converted_relationship_mismatch")

    def test_every_scope_dimension_and_reader_reference_must_match(self):
        for field in ("environment", "organization_id", "workspace_id", "service_id", "staff_id"):
            for readback in ("intake", "booking", "event_search", "event", "original_lead", "calendar"):
                with self.subTest(field=field, readback=readback):
                    evidence, expected = booking_fixture()
                    evidence[readback]["scope"][field] = "other"
                    self.held(evidence, expected, "scope_mismatch")
        for readback in ("intake", "booking", "event_search", "event", "original_lead", "calendar"):
            evidence, expected = booking_fixture()
            evidence[readback]["provenance_ref"] = "unqualified-reader"
            self.held(evidence, expected, "provenance_mismatch")

    def test_production_expected_scope_is_held(self):
        evidence, expected = booking_fixture()
        expected["scope"]["environment"] = "production"
        self.held(evidence, expected, "scope_mismatch")

    def test_missing_duplicate_and_incomplete_event_matches_hold(self):
        for count, records in ((0, []), (2, [{"event_id": "one"}, {"event_id": "two"}]),
                               (2, [{"event_id": "same"}, {"event_id": "same"}]),
                               (1, [{"event_id": "same"}, {"event_id": "same"}]), (True, [{"event_id": "one"}])):
            evidence, expected = booking_fixture()
            evidence["event_search"].update(match_count=count, records=records)
            self.held(evidence, expected, "event_match_ambiguous")
        for complete in (False, "true", 1, None):
            evidence, expected = booking_fixture()
            evidence["event_search"]["complete"] = complete
            self.held(evidence, expected, "event_search_incomplete")

    def test_event_join_metadata_and_by_id_readback_must_match(self):
        for field in ("metadata_evidence_ref", "booking_identity_field_ref"):
            evidence, expected = booking_fixture()
            evidence["event_search"][field] = "guessed-provider-field"
            self.held(evidence, expected, "event_join_unqualified")
        evidence, expected = booking_fixture()
        evidence["event"]["event_id"] = "another-event"
        self.held(evidence, expected, "event_identity_mismatch")

    def test_read_failures_are_not_inferred_as_absence_or_cancellation(self):
        for status in ("not_found", "not_yet_synced", "inaccessible", "deleted", "timeout", "unknown"):
            for readback in ("intake", "booking", "event_search", "event", "original_lead", "calendar"):
                evidence, expected = booking_fixture()
                evidence[readback] = {"read_status": status}
                self.held(evidence, expected, f"read_{status}")

    def test_abandoned_scheduling_leaves_original_intake_untouched(self):
        evidence, expected = booking_fixture()
        original_intake = copy.deepcopy(evidence["intake"])
        evidence["booking"] = {"read_status": "not_found"}
        self.held(evidence, expected, "read_not_found")
        self.assertEqual(evidence["intake"], original_intake)

    def test_freshness_includes_each_read_and_exact_boundary(self):
        evidence, expected = booking_fixture(converted=True)
        for row in evidence.values():
            if type(row) is dict and "observed_at" in row:
                row["observed_at"] = "2026-10-16T09:58:00Z"
        self.consistent(evidence, expected)
        for readback in expected["readers"]:
            evidence, expected = booking_fixture(converted=True)
            evidence[readback]["observed_at"] = "2026-10-16T09:57:59.999999Z"
            self.held(evidence, expected, "stale_evidence")
            evidence[readback]["observed_at"] = "2026-10-16T10:00:00.000001Z"
            self.held(evidence, expected, "future_evidence")

    def test_invalid_future_and_reversed_chronology_hold(self):
        for timestamp in ("2026-02-30T10:00:00Z", "2026-10-16T10:00:00", "today", 42):
            evidence, expected = booking_fixture()
            self.held(evidence, expected, now=timestamp)
        evidence, expected = booking_fixture()
        expected["binding"]["established_at"] = "2026-10-16T10:00:01Z"
        self.held(evidence, expected, "future_evidence")
        evidence, expected = booking_fixture()
        evidence["intake"]["submitted_at"] = "2026-10-16T09:01:01Z"
        self.held(evidence, expected, "intake_chronology_mismatch")
        evidence, expected = booking_fixture()
        evidence["booking"]["updated_at"] = "2026-10-16T10:00:01Z"
        self.held(evidence, expected, "booking_chronology_mismatch")

    def test_conversion_targets_and_current_relationships_are_all_required(self):
        for field in ("lead_id", "intake_id", "journey_id"):
            evidence, expected = booking_fixture(converted=True)
            evidence["original_lead"][field] = "different-original"
            self.held(evidence, expected, "original_lead_mismatch")
        for field in ("account_id", "contact_id", "contact_account_id", "deal_id", "deal_contact_id", "deal_account_id", "deal_intake_id", "deal_journey_id"):
            evidence, expected = booking_fixture(converted=True)
            evidence["converted_records"][field] = "different-owner"
            self.held(evidence, expected, "converted_relationship_mismatch")
        evidence, expected = booking_fixture(converted=True)
        evidence["original_lead"]["conversion"] = {"state": "unconverted"}
        self.held(evidence, expected, "native_conversion_mismatch")

    def test_account_relationship_edges_do_not_replace_exact_account_readback(self):
        evidence, expected = booking_fixture(converted=True)
        del evidence["converted_records"]["account_id"]
        self.held(evidence, expected, "invalid_shape")
        evidence, expected = booking_fixture(converted=True)
        evidence["converted_records"]["account_id"] = "different-account"
        self.held(evidence, expected, "converted_relationship_mismatch")

    def test_original_lead_readback_cannot_predate_the_original_intake(self):
        evidence, expected = booking_fixture()
        evidence["intake"]["submitted_at"] = "2026-10-16T09:59:00Z"
        expected["binding"]["established_at"] = "2026-10-16T09:59:10Z"
        evidence["booking"]["updated_at"] = evidence["delivery"]["occurred_at"] = "2026-10-16T09:59:20Z"
        evidence["original_lead"]["observed_at"] = "2026-10-16T09:58:59Z"
        self.held(evidence, expected, "original_lead_chronology_mismatch")

    def test_lifecycle_occurrence_cannot_be_after_current_booking_update(self):
        evidence, expected = booking_fixture()
        evidence["delivery"]["occurred_at"] = "2026-10-16T09:02:00.000001Z"
        self.held(evidence, expected, "delivery_chronology_mismatch")

    def test_event_relationship_readback_cannot_predate_native_conversion(self):
        evidence, expected = booking_fixture(converted=True)
        evidence["original_lead"]["conversion"]["converted_at"] = "2026-10-16T09:59:40Z"
        evidence["original_lead"]["observed_at"] = "2026-10-16T09:59:45Z"
        evidence["converted_records"]["observed_at"] = "2026-10-16T09:59:45Z"
        self.held(evidence, expected, "readback_regression")
        evidence["event"]["observed_at"] = "2026-10-16T09:59:40Z"
        previous = self.consistent(evidence, expected)
        # Search can predate conversion, but the exact Event relationships cannot.
        previous["readback_times"]["event"] = "2026-10-16T09:59:39Z"
        expected["previous_association"] = previous
        advance_readbacks(evidence)
        lifecycle(evidence, "rescheduled")
        self.held(evidence, expected, "invalid_previous_association", now=LATER)

    def test_equivalent_utc_timestamps_preserve_candidate_and_exact_replay(self):
        for converted in (False, True):
            evidence, expected = booking_fixture(converted=converted)
            first = self.consistent(evidence, expected)
            expected["previous_association"] = copy.deepcopy(first)

            def alternate_spelling(value):
                if type(value) is dict:
                    return {key: alternate_spelling(child) for key, child in value.items()}
                if type(value) is list:
                    return [alternate_spelling(child) for child in value]
                if type(value) is str and "T" in value and value.endswith("Z"):
                    return value[:-1] + ".000Z"
                return value

            # Booking, Event and Calendar may independently normalize precision.
            evidence["event"]["starts_at"] = "2026-10-16T12:00:00.000Z"
            self.assertEqual(self.consistent(evidence, expected), first)
            evidence, _ = booking_fixture(converted=converted)
            evidence = alternate_spelling(evidence)
            expected = alternate_spelling(expected)
            self.assertEqual(self.consistent(evidence, expected, now="2026-10-16T10:00:00.000000Z"), first)

    def test_expected_event_relation_cannot_substitute_for_original_native_lineage(self):
        evidence, expected = booking_fixture(converted=True)
        expected["event_join"]["relationships"][1]["record_id"] = "unrelated-deal"
        evidence["event"]["relationships"] = copy.deepcopy(expected["event_join"]["relationships"])
        self.held(evidence, expected, "native_event_lineage_mismatch")

    def test_relationship_order_is_irrelevant_but_duplicates_or_missing_links_hold(self):
        evidence, expected = booking_fixture(converted=True)
        evidence["event"]["relationships"].reverse()
        self.consistent(evidence, expected)
        evidence["event"]["relationships"].append(copy.deepcopy(evidence["event"]["relationships"][0]))
        self.held(evidence, expected, "relationships_invalid")
        evidence, expected = booking_fixture()
        evidence["event"]["relationships"] = []
        self.held(evidence, expected, "relationships_invalid")

    def test_exact_calendar_destination_and_event_identifiers_are_required(self):
        for field in ("destination_id", "event_id", "crm_event_id", "booking_id"):
            evidence, expected = booking_fixture()
            evidence["calendar"][field] = "other-calendar-identity"
            self.held(evidence, expected, "calendar_identity_mismatch")

    def test_exact_replay_only_returns_an_unpersisted_candidate(self):
        evidence, expected = booking_fixture()
        first = self.consistent(evidence, expected)
        expected["previous_association"] = first
        self.assertEqual(self.consistent(evidence, expected), first)
        # Parallel evaluation is deterministic, not a durable winning claim.
        self.assertEqual(self.consistent(evidence, expected), first)

    def test_fresh_reschedule_preserves_identity_and_uses_current_state_over_old_signal(self):
        evidence, expected = booking_fixture()
        first = self.consistent(evidence, expected)
        expected["previous_association"] = first
        advance_readbacks(evidence)
        old_delivery = copy.deepcopy(evidence["delivery"])
        lifecycle(evidence, "rescheduled")
        for key in ("booking", "event", "calendar"):
            evidence[key].update(starts_at="2026-10-16T13:00:00Z", ends_at="2026-10-16T13:15:00Z")
        evidence["delivery"] = old_delivery
        second = self.consistent(evidence, expected, now=LATER)
        for field in ("original", "booking_id", "event_id", "relationships", "calendar_event_id", "carrier_digest"):
            self.assertEqual(first[field], second[field])
        self.assertEqual(second["lifecycle"], "rescheduled")

    def test_cancellation_is_terminal_even_for_old_or_changed_signals(self):
        evidence, expected = booking_fixture()
        expected["previous_association"] = self.consistent(evidence, expected)
        advance_readbacks(evidence)
        old_delivery = copy.deepcopy(evidence["delivery"])
        lifecycle(evidence, "canceled")
        evidence["delivery"] = old_delivery
        canceled = self.consistent(evidence, expected, now=LATER)
        expected["previous_association"] = canceled
        for key in ("booking", "event", "calendar"):
            evidence[key]["lifecycle"] = "rescheduled"
        evidence["delivery"].update(lifecycle="rescheduled", revision=3)
        evidence["booking"].update(revision=3, updated_at="2026-10-16T10:00:01Z")
        self.held(evidence, expected, "canceled_resurrection", now=LATER)
        expected["previous_association"] = None
        evidence["delivery"].update(lifecycle="canceled", revision=2)
        self.held(evidence, expected, "canceled_resurrection", now=LATER)

    def test_same_revision_conflict_newer_signal_and_regressed_readback_hold(self):
        evidence, expected = booking_fixture()
        first = self.consistent(evidence, expected)
        expected["previous_association"] = first
        for key in ("booking", "event", "calendar"):
            evidence[key]["starts_at"] = "2026-10-16T11:59:00Z"
        self.held(evidence, expected, "same_revision_conflict")
        evidence, expected = booking_fixture()
        evidence["delivery"]["revision"] = 2
        self.held(evidence, expected, "readback_behind_delivery")
        evidence, expected = booking_fixture()
        expected["previous_association"] = first
        evidence["calendar"]["observed_at"] = "2026-10-16T09:59:29Z"
        self.held(evidence, expected, "readback_regression")

    def test_search_then_exact_event_read_and_lifecycle_readbacks_must_be_current(self):
        evidence, expected = booking_fixture()
        evidence["event"]["observed_at"] = "2026-10-16T09:59:29Z"
        self.held(evidence, expected, "readback_regression")
        for target in ("event", "calendar"):
            for field, value in (("lifecycle", "canceled"), ("starts_at", "2026-10-16T11:00:00Z"), ("ends_at", "2026-10-16T11:15:00Z")):
                evidence, expected = booking_fixture()
                evidence[target][field] = value
                self.held(evidence, expected, "lifecycle_readback_mismatch")

    def test_previous_association_blocks_coordinated_carrier_event_and_calendar_rebinding(self):
        for variant in ("carrier", "event", "calendar", "original", "binding"):
            evidence, expected = booking_fixture()
            expected["previous_association"] = self.consistent(evidence, expected)
            if variant == "carrier":
                expected["binding"]["carrier_digest"] = "b" * 64
                evidence["booking"]["carrier_digest"] = evidence["event"]["carrier_digest"] = "b" * 64
            elif variant == "event":
                evidence["event_search"]["records"][0]["event_id"] = "replacement-event"
                evidence["event"]["event_id"] = evidence["calendar"]["crm_event_id"] = "replacement-event"
            elif variant == "calendar":
                evidence["event"]["calendar_event_id"] = evidence["calendar"]["event_id"] = "replacement-calendar-event"
            elif variant == "original":
                expected["original"]["forms_entry_id"] = "replacement-original-entry"
                expected["binding"]["original"]["forms_entry_id"] = "replacement-original-entry"
                evidence["intake"]["original"]["forms_entry_id"] = "replacement-original-entry"
            else:
                expected["binding"]["requester_binding_ref"] = "replacement-binding"
            self.held(evidence, expected, "association_conflict")

    def test_changed_native_deal_cannot_reparent_an_existing_association(self):
        evidence, expected = booking_fixture(converted=True)
        expected["previous_association"] = self.consistent(evidence, expected)
        evidence["original_lead"]["conversion"]["deal_id"] = "replacement-deal"
        evidence["converted_records"]["deal_id"] = "replacement-deal"
        expected["event_join"]["relationships"][1]["record_id"] = "replacement-deal"
        evidence["event"]["relationships"][1]["record_id"] = "replacement-deal"
        self.held(evidence, expected, "association_conflict")

    def test_previous_unconverted_association_needs_explicit_transition_for_new_conversion(self):
        unconverted, original_expected = booking_fixture()
        previous = self.consistent(unconverted, original_expected)
        evidence, expected = booking_fixture(converted=True)
        expected["previous_association"] = previous
        self.held(evidence, expected, "association_conflict")

    def test_malformed_previous_record_fails_closed(self):
        evidence, expected = booking_fixture()
        previous = self.consistent(evidence, expected)
        for variant in (None, True, -1, "1"):
            expected["previous_association"] = copy.deepcopy(previous)
            expected["previous_association"]["revision"] = variant
            self.held(evidence, expected)
        expected["previous_association"] = {"accepted": True}
        self.held(evidence, expected)

    def test_new_revision_still_validates_all_prior_candidate_fields(self):
        evidence, expected = booking_fixture(converted=True)
        previous = self.consistent(evidence, expected)
        advance_readbacks(evidence)
        lifecycle(evidence, "rescheduled")
        malformed = (
            ("schema_version", True), ("schema_version", "1"),
            ("starts_at", None), ("ends_at", "not-a-timestamp"),
            ("starts_at", "2026-10-16T12:15:00Z"),
            ("updated_at", "2026-10-16T08:59:59Z"),
            ("observed_at", "2026-10-16T09:59:00Z"),
            ("provenance_refs", []), ("provenance_refs", {}),
            ("readback_times", []), ("readback_times", {}),
        )
        for field, value in malformed:
            with self.subTest(field=field, value=value):
                expected["previous_association"] = copy.deepcopy(previous)
                expected["previous_association"][field] = value
                self.held(evidence, expected, now=LATER)
        for name in previous["provenance_refs"]:
            for value in (None, True, "unknown", "private value", []):
                with self.subTest(reader=name, value=value):
                    expected["previous_association"] = copy.deepcopy(previous)
                    expected["previous_association"]["provenance_refs"][name] = value
                    self.held(evidence, expected, now=LATER)
            for value in (None, "2026-10-16T08:59:59Z", "2026-10-16T10:00:00.000001Z"):
                expected["previous_association"] = copy.deepcopy(previous)
                expected["previous_association"]["readback_times"][name] = value
                self.held(evidence, expected, now=LATER)

    def test_prior_chronology_is_validated_before_revision_progress(self):
        evidence, expected = booking_fixture(converted=True)
        previous = self.consistent(evidence, expected)
        advance_readbacks(evidence)
        lifecycle(evidence, "rescheduled")
        for name, value in (("booking", "2026-10-16T09:01:59Z"),
                            ("event_search", "2026-10-16T09:01:59Z"),
                            ("calendar", "2026-10-16T09:01:59Z"),
                            ("event", "2026-10-16T09:59:29Z"),
                            ("original_lead", "2026-10-16T09:02:59Z"),
                            ("converted_records", "2026-10-16T09:02:59Z")):
            expected["previous_association"] = copy.deepcopy(previous)
            expected["previous_association"]["readback_times"][name] = value
            self.held(evidence, expected, "invalid_previous_association", now=LATER)

    def test_later_scheduled_revision_can_preserve_a_scheduled_association(self):
        evidence, expected = booking_fixture()
        expected["previous_association"] = self.consistent(evidence, expected)
        advance_readbacks(evidence)
        lifecycle(evidence, "scheduled")
        self.consistent(evidence, expected, now=LATER)

    def test_deep_cyclic_oversized_and_non_json_input_return_sanitized_hold(self):
        deep = None
        for _ in range(MAX_DEPTH + 20):
            deep = {"child": deep}
        cyclic = {}
        cyclic["cycle"] = cyclic
        for value in (deep, cyclic, {"large": "x" * (MAX_STRING_BYTES + 1)},
                      list(range(MAX_CONTAINER_ITEMS + 1)), {"bad": float("nan")}, {1: "invalid-key"}):
            evidence, expected = booking_fixture()
            evidence["unknown"] = value
            self.held(evidence, expected)
        evidence, expected = booking_fixture()
        evidence["unknown"] = ["x" * MAX_STRING_BYTES] * (MAX_BYTES // MAX_STRING_BYTES + 1)
        self.held(evidence, expected, "input_limit")
        evidence, expected = booking_fixture()
        evidence["unknown"] = [[[None] * 64 for _ in range(64)] for _ in range(MAX_NODES // 4096 + 1)]
        self.held(evidence, expected, "input_limit")

    def test_custom_python_objects_are_not_executed_and_errors_never_echo_values(self):
        class Hostile(dict):
            def __iter__(self):
                raise AssertionError("custom-object-hook-ran")

        evidence, expected = booking_fixture()
        self.held(Hostile(evidence), expected, "invalid_json")
        evidence["booking"]["booking_id"] = "private-value-must-not-leak"
        result = self.held(evidence, expected)
        self.assertNotIn("private-value-must-not-leak", repr(result))

    def test_validator_performs_no_file_network_or_provider_operation(self):
        evidence, expected = booking_fixture()
        with patch("builtins.open", side_effect=AssertionError("file I/O forbidden")), \
             patch("socket.socket", side_effect=AssertionError("network forbidden")), \
             patch("subprocess.run", side_effect=AssertionError("process forbidden")):
            self.consistent(evidence, expected)


if __name__ == "__main__":
    unittest.main()
