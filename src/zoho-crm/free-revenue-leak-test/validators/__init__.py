"""Fail-closed validators for CRM Blueprint external evidence."""

from .external_evidence import (
    EvidenceValidationError,
    ValidationResult,
    activation_intent_signature,
    approval_intent_signature,
    billing_reconciliation_receipt,
    derive_binding_digest,
    derive_paid_commercial_terms_acceptance_version,
    derive_receipt_digest,
    validate_external_evidence,
)

__all__ = [
    "EvidenceValidationError",
    "ValidationResult",
    "activation_intent_signature",
    "approval_intent_signature",
    "billing_reconciliation_receipt",
    "derive_binding_digest",
    "derive_paid_commercial_terms_acceptance_version",
    "derive_receipt_digest",
    "validate_external_evidence",
]
