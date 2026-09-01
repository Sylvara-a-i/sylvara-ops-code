/**
 * Owning workflow: CRM record-bound Form 2 setup-access issuance.
 * Trigger: Administrator-restricted Deals `Open Free-Test Setup` Client Script button.
 * Security: The server-side CRM function performs the authoritative Deal reads,
 * guarded initialization, Catalyst request, and response checks. This browser
 * boundary independently validates its result before external navigation.
 * Failure: No navigation, retry, response logging, or sensitive error output.
 */

const expectedModule = "Deals";
const functionApiName = "issue_revenue_leak_test_setup_zdk";
const accessUrlPrefix = "{{FORM2_ACCESS_PUBLIC_URL}}#setupToken=";
const recordIdPattern = /^[1-9][0-9]{9,29}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
let loaderVisible = false;
let acceptedAccessUrl = "";

try {
  const moduleApiName = typeof $Page.module === "string" ? $Page.module.trim() : "";
  const recordId = typeof $Page.record_id === "string" ? $Page.record_id.trim() : "";
  if (moduleApiName !== expectedModule || !recordIdPattern.test(recordId)) {
    throw new Error("invalid_page_context");
  }

  // ZDK requires a JSON object here. An ES Map serializes as an empty object
  // at the provider boundary, so the CRM function never receives its inputs.
  const parameters = {
    deal_id: recordId,
  };
  ZDK.Client.showLoader({
    type: "page",
    template: "spinner",
    message: "Preparing secure Free-Test Setup access...",
  });
  loaderVisible = true;

  const response = ZDK.Apps.CRM.Functions.execute(functionApiName, parameters);
  if (
    response === null ||
    typeof response !== "object" ||
    response.code !== "success" ||
    response.details === null ||
    typeof response.details !== "object" ||
    (Object.prototype.hasOwnProperty.call(response.details, "output_type") &&
      response.details.output_type !== "string") ||
    typeof response.details.output !== "string" ||
    response.details.output.length === 0 ||
    response.details.output.length > 4096
  ) {
    throw new Error("invalid_function_response");
  }

  const envelope = JSON.parse(response.details.output);
  const envelopeKeys = Object.keys(envelope).sort();
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    Array.isArray(envelope) ||
    JSON.stringify(envelopeKeys) !==
      JSON.stringify(["accessUrl", "ok", "schemaVersion"]) ||
    envelope.schemaVersion !== "crm-launch-v1" ||
    envelope.ok !== true ||
    typeof envelope.accessUrl !== "string"
  ) {
    throw new Error("invalid_navigation_envelope");
  }

  const accessUrl = envelope.accessUrl;
  const token = accessUrl.slice(accessUrlPrefix.length);
  if (
    accessUrl.length !== accessUrlPrefix.length + 43 ||
    !accessUrl.startsWith(accessUrlPrefix) ||
    accessUrl.includes("?") ||
    accessUrl.includes("&") ||
    /\s/.test(accessUrl) ||
    accessUrl.includes(recordId) ||
    !tokenPattern.test(token)
  ) {
    throw new Error("invalid_access_url");
  }

  acceptedAccessUrl = accessUrl;
} catch (error) {
  acceptedAccessUrl = "";
} finally {
  if (loaderVisible) {
    try {
      ZDK.Client.hideLoader();
    } catch (error) {
      acceptedAccessUrl = "";
    }
  }
}

if (acceptedAccessUrl !== "") {
  try {
    $Client.openURL(acceptedAccessUrl);
  } catch (error) {
    ZDK.Client.showMessage(
      "Free-Test Setup could not be opened. No automatic retry was attempted.",
      { type: "error" },
    );
  }
} else {
  ZDK.Client.showMessage(
    "Free-Test Setup could not be opened. No automatic retry was attempted.",
    { type: "error" },
  );
}
