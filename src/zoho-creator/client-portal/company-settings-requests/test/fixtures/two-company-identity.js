"use strict";

// Fully independent synthetic companies, each with its own principal and canonical links.
function evidence() {
  return {
    principal: { id: "synthetic-principal", auditActorId: "synthetic-human" },
    complete: true,
    grants: [
      { principalId: "synthetic-principal", creatorAccountId: "synthetic-company-a", creatorContactId: "synthetic-creator-contact-a", scope: "service-area-request", active: true, revision: "grant-v1-a" },
      { principalId: "synthetic-other-principal", creatorAccountId: "synthetic-company-b", creatorContactId: "synthetic-creator-contact-b", scope: "service-area-request", active: true, revision: "grant-v1-b" },
    ],
    accountLinks: [
      { creatorAccountId: "synthetic-company-a", crmAccountId: "synthetic-crm-company-a", revision: "account-link-v1-a" },
      { creatorAccountId: "synthetic-company-b", crmAccountId: "synthetic-crm-company-b", revision: "account-link-v1-b" },
    ],
    contactLinks: [
      { creatorContactId: "synthetic-creator-contact-a", creatorAccountId: "synthetic-company-a", crmContactId: "synthetic-crm-contact-a", revision: "contact-link-v1-a" },
      { creatorContactId: "synthetic-creator-contact-b", creatorAccountId: "synthetic-company-b", crmContactId: "synthetic-crm-contact-b", revision: "contact-link-v1-b" },
    ],
    crmContacts: [
      { id: "synthetic-crm-contact-a", accountId: "synthetic-crm-company-a" },
      { id: "synthetic-crm-contact-b", accountId: "synthetic-crm-company-b" },
    ],
    crmAccounts: [
      { id: "synthetic-crm-company-a", previousServiceArea: "  North\r\nCounty  " },
      { id: "synthetic-crm-company-b", previousServiceArea: "  South\r\nCounty  " },
    ],
  };
}

module.exports = { evidence };
