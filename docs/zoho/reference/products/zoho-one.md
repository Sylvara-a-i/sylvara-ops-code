# Zoho One Reference

- **Reference ID:** `SYLVARA-ZOHO-ONE-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective organization, edition, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes durable Zoho One administration, identity, assignment, and security behavior. It is not a user directory, application catalog, role matrix, policy export, or proof of active licensing.

Zoho One interfaces and features vary by edition, region, migration state, and administrator role. Live organization evidence outranks this reference.

## Product Role

Zoho One coordinates workforce identity, application assignment, administrative roles, domains, security policy, and supported provisioning. Each included application still owns its records, permissions, APIs, and business behavior.

Zoho One should govern who may reach an application. It must not be treated as a universal operational database or proof that an assigned user can perform every product action.

## Authentication And Discovery

- Begin with the organization owner, administrator roster, verified domains, and current security-interface version.
- Inventory users, groups, departments, application assignments, service administrators, and provisioning connections through authorized administration views.
- Separate organization owner, security administrator, service administrator, help-desk, and ordinary user privileges.
- Confirm whether identity originates in Zoho One or an external directory before changing a user.
- Treat inbound authentication, outbound SSO, and application provisioning as different flows.
- Verify current plan and regional availability before relying on conditional assignment or provisioning features.
- No general public raw administration API contract was established at the research cutoff; do not invent one.

## Core Model And Capabilities

- Users represent workforce identities with status, email identity, organizational placement, and application access.
- Groups and departments support assignment and policy targeting but can have different membership behavior.
- Applications may be Zoho services, directory-integrated applications, or launcher/bookmark entries.
- Administrative roles should be delegated by service and duty rather than broad ownership.
- Security policies can cover password, MFA, session, network, routing, and conditional-access controls.
- Directory stores and provisioning connectors synchronize identity through separate inbound and outbound contracts.
- Verified domains affect identity, password-reset, sender, and account-governance behavior.
- Audit logs provide evidence of administrative activity subject to plan, retention, and visibility limits.

## Automation And Events

- Conditional assignment may add or remove application access based on governed user attributes.
- Provisioning can create, update, suspend, or deprovision downstream application accounts when explicitly configured.
- Supported Deluge tasks can perform bounded user or group operations; their documented wrapper and scopes are the complete contract.
- Joiner, mover, and leaver workflows must be deterministic, approval-aware, and reversible where possible.
- Deactivation should revoke sessions and application access while preserving required audit and business evidence.
- Periodic access reviews are required even when assignment is automated.

## Reliability And Security

- Require phishing-resistant MFA where supported for privileged identities and protect recovery ownership.
- Apply least privilege and separation of duties; avoid shared administrator accounts.
- Test policy precedence before rollout so a lower-priority rule does not silently weaken protection.
- Fail closed when directory sync, provisioning, or offboarding returns an ambiguous result.
- Preserve an emergency recovery path that is documented outside the public repository.
- Monitor failed provisioning, stale assignments, dormant administrators, domain changes, and policy exceptions.
- Never place user lists, private email addresses, authentication details, or live policy exports in GitHub.

## Validation

Before adopting or changing Zoho One, verify:

1. organization ownership, edition, region, and current administration interface;
2. users, administrators, groups, departments, domains, and assignment sources;
3. security-policy order, MFA behavior, session controls, and recovery process;
4. joiner, mover, deactivation, reactivation, and failed-provisioning behavior;
5. application assignment and downstream deprovisioning readback;
6. audit visibility and retention; and
7. rollback for policy, SSO, directory, and provisioning changes.

Repository review is not authorization to change identities, domains, access, authentication, or Production policy.

## Official Sources

- [Zoho One Admin Guide](https://help.zoho.com/portal/en/kb/one/admin-guide)
- [Users administration](https://help.zoho.com/portal/en/kb/one/admin-guide/users)
- [Applications overview](https://help.zoho.com/portal/en/kb/one/admin-guide/applications/adding-applications/articles/zohoone-adding-apps-overview)
- [Provisioning overview](https://help.zoho.com/portal/en/kb/one/admin-guide/applications/configuring-provisioning/articles/provisioning-overview)
- [Security 2.0](https://help.zoho.com/portal/en/kb/one/admin-guide/security/security-2-0)
- [Audit logs](https://help.zoho.com/portal/en/kb/one/admin-guide/reports/audit-logs/articles/view-audit-logs-zo)

## Exclusions

This reference contains no user, administrator, group, department, domain, application assignment, security policy, identity-provider configuration, directory connection, audit event, or live organization identifier. Sylvara ownership, licensing, assignments, and effective access remain Unknown.
