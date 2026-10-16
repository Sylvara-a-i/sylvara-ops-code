"""Offline Route B consistency contract; never an authentication or write gate.

``evaluate_booking_lineage(evidence, expected, now=<UTC ISO timestamp>)`` accepts
only bounded JSON data. ``expected`` must eventually come from a separately
qualified trusted adapter, never from the booking page or these readbacks.
Opaque evidence references identify retained evidence; their syntax, presence,
or equality does NOT authenticate anything. No adapter is supplied here.

Expected fields (all required): schema_version=1; scope={environment,
organization_id,workspace_id,service_id,staff_id}; original={forms_entry_id,
intake_id,lead_id,journey_id}; binding={booking_id,original,scope,carrier_digest,
requester_binding_ref,delivery_evidence_ref,provenance_ref,established_at};
calendar={destination_id}; event_join={metadata_evidence_ref,
booking_identity_field_ref,relationships}; readers={intake,booking,event_search,
event,original_lead,converted_records,calendar}; freshness_seconds (1..900);
previous_association (null or a previous candidate supplied independently).

Evidence fields: schema_version=1, intake, delivery, booking, event_search,
event, original_lead, converted_records (null when unconverted), calendar.
Every readback has read_status, observed_at, provenance_ref and scope. The
exact remaining fields are declared at each _read call below. Relationships
are normalized {role,module,record_id} tuples, NOT guessed provider API fields.
Read statuses: ok, not_found, not_yet_synced, inaccessible, deleted, timeout,
unknown. Lifecycle: scheduled, rescheduled, canceled. All timestamps are UTC;
scheduled start/end times may be in the future, but evidence times may not.
Equivalent UTC timestamp spellings compare as instants and output is canonical.
delivery.occurred_at means normalized lifecycle occurrence, not transport receipt.
converted_records includes the exact account_id, contact_id and deal_id readbacks
as well as the normalized relationship edges checked below.

Results are held or consistent_candidate, always with all authority and
persistence flags false. Candidate identities are private in-memory values;
never log or publish them. Comparing previous_association detects drift only:
it implements neither storage, durable idempotency, nor concurrent ownership.
The synthetic fixture in tests/test_booking_lineage.py is the complete example.
"""

from __future__ import annotations

import json
import re
from datetime import datetime


MAX_DEPTH = 16
MAX_NODES = 4096
MAX_BYTES = 131_072
MAX_STRING_BYTES = 4096
MAX_CONTAINER_ITEMS = 64
MAX_FRESHNESS_SECONDS = 900
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_DIGEST = re.compile(r"^[a-f0-9]{64}$")
_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")
_SCOPE = frozenset({"environment", "organization_id", "workspace_id", "service_id", "staff_id"})
_ORIGINAL = frozenset({"forms_entry_id", "intake_id", "lead_id", "journey_id"})
_READERS = frozenset({"intake", "booking", "event_search", "event", "original_lead", "converted_records", "calendar"})
_READ_HEADER = frozenset({"read_status", "observed_at", "provenance_ref", "scope"})
_READ_FAILURES = frozenset({"not_found", "not_yet_synced", "inaccessible", "deleted", "timeout", "unknown"})
_LIFECYCLE = frozenset({"scheduled", "rescheduled", "canceled"})
_UNRESOLVED = (
    "lifecycle_authentication_and_reader_qualification",
    "native_customer_create_and_update_containment",
    "tenant_booking_event_relationship_and_calendar_metadata",
    "independent_requester_to_booking_binding_qualification",
    "atomic_association_storage_and_concurrency_gate",
    "separate_setup_and_activation_eligibility",
)
_CANDIDATE_FIELDS = frozenset({
    "schema_version", "scope", "original", "booking_id", "carrier_digest",
    "requester_binding_ref", "binding_provenance_ref", "binding_established_at",
    "intake_submitted_at", "event_id", "relationships", "calendar_destination_id",
    "calendar_event_id", "metadata_evidence_ref", "booking_identity_field_ref",
    "conversion", "lifecycle", "revision", "updated_at", "starts_at", "ends_at",
    "observed_at", "readback_times", "provenance_refs",
})
_MUTABLE_CANDIDATE = frozenset({
    "lifecycle", "revision", "updated_at", "starts_at", "ends_at", "observed_at",
    "readback_times", "provenance_refs",
})


class _Hold(Exception):
    pass


def _require(condition, reason="invalid_shape"):
    if not condition:
        raise _Hold(reason)


def _exact(value, fields):
    _require(type(value) is dict and value.keys() == fields)


def _identifier(value):
    _require(type(value) is str and _ID.fullmatch(value) is not None, "invalid_identity")
    return value


def _reference(value):
    _identifier(value)
    _require(value.casefold() not in {"unknown", "unverified", "pending", "missing", "none", "null"},
             "qualification_reference_missing")
    return value


def _timestamp(value):
    _require(type(value) is str and _TIME.fullmatch(value) is not None, "invalid_timestamp")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise _Hold("invalid_timestamp") from None


def _canonical_time(value):
    return _timestamp(value).isoformat().replace("+00:00", "Z")


def _bounded_json(value):
    """Bound traversal before schema comparison, sorting, or candidate copying."""
    stack = [(value, 0, False)]
    active = set()
    nodes = size = 0
    while stack:
        current, depth, leaving = stack.pop()
        if leaving:
            active.remove(id(current))
            continue
        nodes += 1
        _require(depth <= MAX_DEPTH and nodes <= MAX_NODES, "input_limit")
        kind = type(current)
        if kind in (dict, list):
            _require(id(current) not in active, "invalid_json")
            _require(len(current) <= MAX_CONTAINER_ITEMS, "input_limit")
            active.add(id(current))
            stack.append((current, depth, True))
            size += 2 + max(0, len(current) - 1)
            if kind is dict:
                for key, child in current.items():
                    _require(type(key) is str and len(key) <= 64, "invalid_json")
                    size += len(json.dumps(key).encode("utf-8")) + 1
                    stack.append((child, depth + 1, False))
            else:
                stack.extend((child, depth + 1, False) for child in current)
        else:
            _require(current is None or kind in (str, int, bool), "invalid_json")
            if kind is str:
                _require(len(current) <= MAX_STRING_BYTES, "input_limit")
                _require(len(current.encode("utf-8")) <= MAX_STRING_BYTES, "input_limit")
            if kind is int:
                _require(abs(current) <= 9_007_199_254_740_991, "invalid_json")
            size += len(json.dumps(current, ensure_ascii=False).encode("utf-8"))
        _require(size <= MAX_BYTES, "input_limit")


def _scope(value):
    _exact(value, _SCOPE)
    _require(value["environment"] == "development", "scope_mismatch")
    for field in _SCOPE - {"environment"}:
        _identifier(value[field])


def _original(value):
    _exact(value, _ORIGINAL)
    for item in value.values():
        _identifier(item)


def _relationships(value):
    _require(type(value) is list and 1 <= len(value) <= 16, "relationships_invalid")
    tuples = []
    for item in value:
        _exact(item, {"role", "module", "record_id"})
        for field in item.values():
            _identifier(field)
        _require(item["module"] in {"Leads", "Accounts", "Contacts", "Deals"}, "relationships_invalid")
        tuples.append((item["role"], item["module"], item["record_id"]))
    _require(len(set(tuples)) == len(tuples), "relationships_invalid")
    return [dict(zip(("role", "module", "record_id"), row)) for row in sorted(tuples)]


def _read(value, extra, name, context, now):
    _require(type(value) is dict, "read_unknown")
    status = value.get("read_status")
    if type(status) is str and status in _READ_FAILURES:
        raise _Hold(f"read_{status}")
    _require(status == "ok", "read_unknown")
    _exact(value, _READ_HEADER | set(extra))
    _require(value["scope"] == context["scope"], "scope_mismatch")
    _require(value["provenance_ref"] == context["readers"][name], "provenance_mismatch")
    observed = _timestamp(value["observed_at"])
    _require(observed <= now, "future_evidence")
    _require((now - observed).total_seconds() <= context["freshness_seconds"], "stale_evidence")
    return observed


def _revision(value):
    _require(type(value) is int and 1 <= value <= 9_007_199_254_740_991, "invalid_revision")


def _check_previous(previous, candidate):
    if previous is None:
        return
    _exact(previous, _CANDIDATE_FIELDS)
    _require(type(previous["schema_version"]) is int and previous["schema_version"] == 1,
             "invalid_previous_association")
    # Validate every prior field even when a newer revision supersedes its state.
    # Immutable fields must equal a fully validated current candidate; normalize
    # timestamps first so equivalent UTC encodings are not treated as rebinding.
    previous = dict(previous)
    for field in ("binding_established_at", "intake_submitted_at", "updated_at",
                  "starts_at", "ends_at", "observed_at"):
        previous[field] = _canonical_time(previous[field])
    previous["relationships"] = _relationships(previous["relationships"])
    _require(type(previous["conversion"]) is dict, "invalid_previous_association")
    previous["conversion"] = dict(previous["conversion"])
    if "converted_at" in previous["conversion"]:
        previous["conversion"]["converted_at"] = _canonical_time(previous["conversion"]["converted_at"])
    # Previous input is comparison evidence, never a grant to overwrite or store.
    for field in _CANDIDATE_FIELDS - _MUTABLE_CANDIDATE:
        _require(previous[field] == candidate[field], "association_conflict")
    _revision(previous["revision"])
    _require(previous["lifecycle"] in _LIFECYCLE, "invalid_previous_association")
    submitted = _timestamp(previous["intake_submitted_at"])
    updated = _timestamp(previous["updated_at"])
    prior_now = _timestamp(previous["observed_at"])
    _require(submitted <= updated <= prior_now
             and submitted <= _timestamp(previous["binding_established_at"]) <= prior_now
             and _timestamp(previous["starts_at"]) < _timestamp(previous["ends_at"]),
             "invalid_previous_association")
    _exact(previous["readback_times"], set(candidate["readback_times"]))
    _exact(previous["provenance_refs"], set(candidate["provenance_refs"]))
    prior_times = {}
    for name, timestamp in previous["readback_times"].items():
        prior_times[name] = _timestamp(timestamp)
        _require(submitted <= prior_times[name] <= prior_now, "invalid_previous_association")
        _reference(previous["provenance_refs"][name])
    _require(updated <= prior_times["booking"] and updated <= prior_times["event_search"]
             <= prior_times["event"] and updated <= prior_times["calendar"], "invalid_previous_association")
    if previous["conversion"]["state"] == "converted":
        converted = _timestamp(previous["conversion"]["converted_at"])
        _require(submitted <= converted <= prior_times["original_lead"]
                 and converted <= prior_times["converted_records"]
                 and converted <= prior_times["event"], "invalid_previous_association")
    _require(previous["lifecycle"] != "canceled" or candidate["lifecycle"] == "canceled", "canceled_resurrection")
    _require(candidate["revision"] >= previous["revision"], "lifecycle_regression")
    _require(_timestamp(candidate["updated_at"]) >= _timestamp(previous["updated_at"]), "lifecycle_regression")
    _require(_timestamp(candidate["observed_at"]) >= _timestamp(previous["observed_at"]), "readback_regression")
    for name, observed in candidate["readback_times"].items():
        _require(_timestamp(observed) >= prior_times[name], "readback_regression")
    if candidate["revision"] == previous["revision"]:
        for field in ("lifecycle", "updated_at", "starts_at", "ends_at"):
            _require(previous[field] == candidate[field], "same_revision_conflict")
    else:
        _require(_timestamp(candidate["updated_at"]) > _timestamp(previous["updated_at"]), "lifecycle_regression")
        _require(previous["lifecycle"] == "scheduled" or candidate["lifecycle"] != "scheduled", "lifecycle_regression")


def _evaluate(evidence, context, now):
    _exact(context, {"schema_version", "scope", "original", "binding", "calendar", "event_join",
                     "readers", "freshness_seconds", "previous_association"})
    _exact(evidence, {"schema_version", "intake", "delivery", "booking", "event_search", "event",
                      "original_lead", "converted_records", "calendar"})
    _require(type(context["schema_version"]) is int and context["schema_version"] == 1
             and type(evidence["schema_version"]) is int and evidence["schema_version"] == 1)
    _scope(context["scope"])
    _original(context["original"])
    original = context["original"]
    binding = context["binding"]
    _exact(binding, {"booking_id", "original", "scope", "carrier_digest", "requester_binding_ref",
                     "delivery_evidence_ref", "provenance_ref", "established_at"})
    _require(binding["original"] == original and binding["scope"] == context["scope"], "requester_binding_mismatch")
    _identifier(binding["booking_id"])
    _require(type(binding["carrier_digest"]) is str and _DIGEST.fullmatch(binding["carrier_digest"]) is not None,
             "invalid_carrier_digest")
    for field in ("requester_binding_ref", "delivery_evidence_ref", "provenance_ref"):
        _reference(binding[field])
        _require(binding[field] not in {binding["carrier_digest"], f"sha256:{binding['carrier_digest']}"},
                 "requester_binding_missing")
    established = _timestamp(binding["established_at"])
    _require(established <= now, "future_evidence")
    _exact(context["calendar"], {"destination_id"})
    _identifier(context["calendar"]["destination_id"])
    join = context["event_join"]
    _exact(join, {"metadata_evidence_ref", "booking_identity_field_ref", "relationships"})
    for field in ("metadata_evidence_ref", "booking_identity_field_ref"):
        _reference(join[field])
    expected_relationships = _relationships(join["relationships"])
    _exact(context["readers"], _READERS)
    for reader in context["readers"].values():
        _reference(reader)
    _require(type(context["freshness_seconds"]) is int
             and 1 <= context["freshness_seconds"] <= MAX_FRESHNESS_SECONDS, "invalid_freshness")

    observed = {}
    intake = evidence["intake"]
    observed["intake"] = _read(intake, {"original", "submitted_at"}, "intake", context, now)
    _require(intake["original"] == original, "intake_owner_mismatch")
    submitted = _timestamp(intake["submitted_at"])
    _require(submitted <= established and submitted <= observed["intake"], "intake_chronology_mismatch")

    booking = evidence["booking"]
    observed["booking"] = _read(booking, {"booking_id", "carrier_digest", "lifecycle", "revision",
                                         "updated_at", "starts_at", "ends_at"}, "booking", context, now)
    _require(booking["booking_id"] == binding["booking_id"], "booking_binding_mismatch")
    _require(booking["carrier_digest"] == binding["carrier_digest"], "carrier_conflict")
    _require(booking["lifecycle"] in _LIFECYCLE, "invalid_lifecycle")
    _revision(booking["revision"])
    updated = _timestamp(booking["updated_at"])
    _require(submitted <= updated <= observed["booking"], "booking_chronology_mismatch")
    _require(_timestamp(booking["starts_at"]) < _timestamp(booking["ends_at"]), "invalid_schedule")

    delivery = evidence["delivery"]
    _exact(delivery, {"evidence_ref", "booking_id", "lifecycle", "revision", "occurred_at"})
    _require(delivery["evidence_ref"] == binding["delivery_evidence_ref"], "delivery_provenance_mismatch")
    _require(delivery["booking_id"] == binding["booking_id"], "booking_binding_mismatch")
    _require(delivery["lifecycle"] in _LIFECYCLE, "invalid_lifecycle")
    _revision(delivery["revision"])
    _require(submitted <= _timestamp(delivery["occurred_at"]) <= updated, "delivery_chronology_mismatch")
    _require(delivery["revision"] <= booking["revision"], "readback_behind_delivery")
    if delivery["revision"] == booking["revision"]:
        _require(delivery["lifecycle"] == booking["lifecycle"], "same_revision_conflict")
    _require(delivery["lifecycle"] != "canceled" or booking["lifecycle"] == "canceled", "canceled_resurrection")

    search = evidence["event_search"]
    observed["event_search"] = _read(search, {"booking_id", "metadata_evidence_ref", "booking_identity_field_ref",
                                              "complete", "match_count", "records"}, "event_search", context, now)
    _require(search["booking_id"] == binding["booking_id"], "booking_binding_mismatch")
    _require(search["metadata_evidence_ref"] == join["metadata_evidence_ref"]
             and search["booking_identity_field_ref"] == join["booking_identity_field_ref"], "event_join_unqualified")
    _require(search["complete"] is True, "event_search_incomplete")
    _require(type(search["match_count"]) is int and search["match_count"] == 1
             and type(search["records"]) is list and len(search["records"]) == 1, "event_match_ambiguous")
    _exact(search["records"][0], {"event_id"})
    event_id = _identifier(search["records"][0]["event_id"])
    event = evidence["event"]
    observed["event"] = _read(event, {"event_id", "booking_id", "carrier_digest", "relationships",
                                     "calendar_event_id", "lifecycle", "starts_at", "ends_at"}, "event", context, now)
    _require(event["event_id"] == event_id and event["booking_id"] == binding["booking_id"], "event_identity_mismatch")
    _require(event["carrier_digest"] == binding["carrier_digest"], "carrier_conflict")
    relationships = _relationships(event["relationships"])
    _require(relationships == expected_relationships, "event_relationship_mismatch")
    _identifier(event["calendar_event_id"])
    _require(observed["event_search"] >= updated and observed["event"] >= observed["event_search"], "readback_regression")

    lead = evidence["original_lead"]
    observed["original_lead"] = _read(lead, {"lead_id", "intake_id", "journey_id", "conversion"}, "original_lead", context, now)
    _require(submitted <= observed["original_lead"], "original_lead_chronology_mismatch")
    _require(all(lead[key] == original[key] for key in ("lead_id", "intake_id", "journey_id")), "original_lead_mismatch")
    conversion = lead["conversion"]
    _require(type(conversion) is dict, "native_conversion_missing")
    allowed = {"Leads": original["lead_id"]}
    if conversion.get("state") == "unconverted":
        _exact(conversion, {"state"})
        _require(evidence["converted_records"] is None, "native_conversion_mismatch")
    else:
        _exact(conversion, {"state", "account_id", "contact_id", "deal_id", "converted_at"})
        _require(conversion["state"] == "converted", "native_conversion_missing")
        ids = [original["lead_id"]] + [_identifier(conversion[key]) for key in ("account_id", "contact_id", "deal_id")]
        _require(len(set(ids)) == 4, "native_conversion_mismatch")
        _require(submitted <= _timestamp(conversion["converted_at"]) <= observed["original_lead"], "native_conversion_mismatch")
        current = evidence["converted_records"]
        observed["converted_records"] = _read(current, {"account_id", "contact_id", "contact_account_id", "deal_id", "deal_contact_id",
                                                        "deal_account_id", "deal_intake_id", "deal_journey_id"}, "converted_records", context, now)
        _require(current["account_id"] == conversion["account_id"]
                 and current["contact_id"] == conversion["contact_id"]
                 and current["contact_account_id"] == conversion["account_id"]
                 and current["deal_id"] == conversion["deal_id"]
                 and current["deal_contact_id"] == conversion["contact_id"]
                 and current["deal_account_id"] == conversion["account_id"]
                 and current["deal_intake_id"] == original["intake_id"]
                 and current["deal_journey_id"] == original["journey_id"], "converted_relationship_mismatch")
        _require(observed["converted_records"] >= _timestamp(conversion["converted_at"])
                 and observed["event"] >= _timestamp(conversion["converted_at"]), "readback_regression")
        allowed.update({"Accounts": conversion["account_id"], "Contacts": conversion["contact_id"], "Deals": conversion["deal_id"]})
    _require(all(allowed.get(row["module"]) == row["record_id"] for row in relationships)
             and any(row["module"] in {"Leads", "Contacts", "Deals"} for row in relationships), "native_event_lineage_mismatch")

    calendar = evidence["calendar"]
    observed["calendar"] = _read(calendar, {"destination_id", "event_id", "crm_event_id", "booking_id", "lifecycle",
                                           "starts_at", "ends_at"}, "calendar", context, now)
    _require(calendar["destination_id"] == context["calendar"]["destination_id"]
             and calendar["event_id"] == event["calendar_event_id"]
             and calendar["crm_event_id"] == event_id and calendar["booking_id"] == binding["booking_id"], "calendar_identity_mismatch")
    _require(observed["calendar"] >= updated, "readback_regression")
    for readback in (event, calendar):
        _require(readback["lifecycle"] == booking["lifecycle"]
                 and all(_timestamp(readback[field]) == _timestamp(booking[field]) for field in ("starts_at", "ends_at")),
                 "lifecycle_readback_mismatch")

    candidate = {
        "schema_version": 1, "scope": dict(context["scope"]), "original": dict(original),
        "booking_id": binding["booking_id"], "carrier_digest": binding["carrier_digest"],
        "requester_binding_ref": binding["requester_binding_ref"], "binding_provenance_ref": binding["provenance_ref"],
        "binding_established_at": _canonical_time(binding["established_at"]), "intake_submitted_at": _canonical_time(intake["submitted_at"]),
        "event_id": event_id, "relationships": relationships, "calendar_destination_id": calendar["destination_id"],
        "calendar_event_id": calendar["event_id"], "metadata_evidence_ref": join["metadata_evidence_ref"],
        "booking_identity_field_ref": join["booking_identity_field_ref"], "conversion": dict(conversion),
        "lifecycle": booking["lifecycle"], "revision": booking["revision"],
        **{field: _canonical_time(booking[field]) for field in ("updated_at", "starts_at", "ends_at")},
        "observed_at": now.isoformat().replace("+00:00", "Z"),
        "readback_times": {key: _canonical_time(evidence[key]["observed_at"]) for key in observed},
        "provenance_refs": {key: evidence[key]["provenance_ref"] for key in observed},
    }
    if "converted_at" in candidate["conversion"]:
        candidate["conversion"]["converted_at"] = _canonical_time(candidate["conversion"]["converted_at"])
    _check_previous(context["previous_association"], candidate)
    return candidate


def evaluate_booking_lineage(evidence, expected, *, now):
    """Return a private consistency candidate or sanitized hold; perform no I/O.

    The expected context, references and readbacks are not authenticated here.
    Even a consistent candidate cannot release any live or durable effect.
    """
    result = {
        "status": "held", "reason": "invalid_input", "candidate": None,
        "downstream_authority": False, "live_authority": False,
        "storage_authority": False, "setup_authority": False,
        "activation_authority": False, "persisted": False,
        "unresolved_live_gates": list(_UNRESOLVED),
    }
    try:
        _bounded_json([evidence, expected, now])
        selected_now = _timestamp(now)
        result["candidate"] = _evaluate(evidence, expected, selected_now)
        result.update(status="consistent_candidate", reason="consistent_offline_evidence")
    except _Hold as error:
        result["reason"] = str(error)
    except (TypeError, ValueError, KeyError, OverflowError):
        # Never include supplied values or provider exception text in a hold.
        result["reason"] = "invalid_input"
    return result
