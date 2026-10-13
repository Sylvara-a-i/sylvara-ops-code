"use strict";

const { validateRequestedServiceArea } = require("./service-area-request-contract");

function deny() {
  throw new TypeError("Invalid CRM service-area response");
}

// Native record GETs can contain unrelated fields. Inspect their descriptors,
// then copy only the fixed projection; never spread or serialize the record.
function record(value, required, exact = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) deny();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) deny();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string") ||
      (exact && keys.length !== required.length)) deny();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") ||
        ["undefined", "function", "symbol", "bigint"].includes(typeof descriptor.value)) deny();
  }
  const selected = {};
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
    selected[key] = descriptor.value;
  }
  return selected;
}

function identifier(value) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      /[\u0000-\u0020\u007f]/.test(value)) deny();
}

// Pure native-body -> minimal-body boundary. This does not create a receipt,
// establish provenance, execute a GET, or authenticate the record's caller.
function projectCrmServiceAreaResponse(module, recordId, response) {
  try {
    if (module !== "Contacts" && module !== "Accounts") deny();
    identifier(recordId);
    const { data } = record(response, ["data"], true);
    if (!Array.isArray(data) || Object.getPrototypeOf(data) !== Array.prototype ||
        data.length !== 1 || Reflect.ownKeys(data).length !== 2) deny();
    const descriptor = Object.getOwnPropertyDescriptor(data, "0");
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
    const field = module === "Contacts" ? "Account_Name" : "Primary_Service_Area";
    const row = record(descriptor.value, ["id", field]);
    if (row.id !== recordId) deny();
    let projected;
    if (module === "Contacts") {
      const lookup = record(row.Account_Name, ["id"]);
      const keys = Reflect.ownKeys(row.Account_Name);
      if (keys.some((key) => key !== "id" && key !== "name")) deny();
      if (keys.includes("name") &&
          typeof Object.getOwnPropertyDescriptor(row.Account_Name, "name").value !== "string") deny();
      identifier(lookup.id);
      // Display names and all other Contact fields remain outside the receipt.
      projected = { id: row.id, Account_Name: Object.freeze({ id: lookup.id }) };
    } else {
      validateRequestedServiceArea(row.Primary_Service_Area);
      projected = { id: row.id, Primary_Service_Area: row.Primary_Service_Area };
    }
    return Object.freeze({ data: Object.freeze([Object.freeze(projected)]) });
  } catch {
    deny();
  }
}

module.exports = { projectCrmServiceAreaResponse };
