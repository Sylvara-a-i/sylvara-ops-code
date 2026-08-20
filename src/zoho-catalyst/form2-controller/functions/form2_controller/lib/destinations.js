"use strict";

// This controller is intentionally bound to Sylvara's reviewed US data-center
// destinations. Expanding either list requires a source review; accepting a
// hostname suffix or a runtime-provided custom domain would turn configuration
// into an authorization or bearer-token exfiltration primitive.
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
