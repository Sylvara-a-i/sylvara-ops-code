"use strict";

// Do not broaden these lists by suffix matching. Runtime-controlled hosts would
// turn configuration into an OAuth-token or prefill-token exfiltration path.
const APPROVED_CRM_API_HOSTS = Object.freeze(["www.zohoapis.com"]);
const APPROVED_FORMS_PUBLIC_HOSTS = Object.freeze(["forms.zohopublic.com"]);

function isApprovedCrmApiHostname(hostname) {
  return APPROVED_CRM_API_HOSTS.includes(hostname);
}

function isApprovedFormsPublicHostname(hostname) {
  return APPROVED_FORMS_PUBLIC_HOSTS.includes(hostname);
}

module.exports = {
  APPROVED_CRM_API_HOSTS,
  APPROVED_FORMS_PUBLIC_HOSTS,
  isApprovedCrmApiHostname,
  isApprovedFormsPublicHostname,
};
