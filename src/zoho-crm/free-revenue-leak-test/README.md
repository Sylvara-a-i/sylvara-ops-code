# Free Revenue Leak Test CRM Controls

This directory is the sanitized, version-controlled desired state for the Free Revenue Leak Test lifecycle in Zoho CRM. CRM remains the relationship, qualification, commercial-acceptance, and summary system. Catalyst owns call events, deployment ownership, notification processing, counters, and detailed reports.

[`config/automation-contract.json`](config/automation-contract.json) defines the 14 additive Deal fields, the exact three-rule workflow set, the single Revenue Desk Blueprint, the version-specific go-live invariant, paid-acceptance gates, and the disposable `ZZZ SYNTHETIC` acceptance path. The internal `Entry_Offer` value remains `7-Day Revenue Leak Test` for migration safety; every customer-facing label uses **Free Revenue Leak Test**.

The CRM organization is production-type, so acceptance work is restricted to clearly labeled synthetic records. The contract does not authorize Production traffic, real customer/prospect mutation, Zoho Sign, SMS, phone routing, Billing before paid acceptance, or automatic Closed Won.

Live configuration is authoritative only after independent readback. The immutable 2026-08-14 snapshot remains historical evidence and must not be edited to imply a later deployment.
