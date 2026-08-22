"use strict";

const { ARTIFACT_CREATOR_DESTINATION_SHA256 } = require("./creator-destination");
const {
  DestinationValidationError,
  assertCreatorDestination,
} = require("./destinations");
const { HttpBoundaryError, requestJson } = require("./http");

class CreatorDeliveryError extends Error {
  constructor(message, { ambiguous = true } = {}) {
    super(message);
    this.name = "CreatorDeliveryError";
    this.publicCode = "reconciliation_required";
    this.ambiguous = ambiguous;
  }
}

function createCreatorClient(
  config,
  {
    authorizationProvider,
    fetchImpl = globalThis.fetch,
    artifactCreatorDestinationSha256 = ARTIFACT_CREATOR_DESTINATION_SHA256,
  } = {},
) {
  if (typeof authorizationProvider !== "function") {
    throw new CreatorDeliveryError("Creator authorization provider is unavailable", {
      ambiguous: false,
    });
  }

  async function deliver(envelope) {
    let creatorUrl;
    try {
      creatorUrl = assertCreatorDestination(
        config.creatorUrl,
        artifactCreatorDestinationSha256,
      );
    } catch (error) {
      if (error instanceof DestinationValidationError) {
        throw new CreatorDeliveryError("Creator destination binding failed", {
          ambiguous: false,
        });
      }
      throw error;
    }

    let authorization;
    try {
      authorization = await authorizationProvider();
    } catch {
      throw new CreatorDeliveryError("Creator Connection authorization failed", {
        ambiguous: false,
      });
    }

    let response;
    try {
      response = await requestJson(
        creatorUrl,
        {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify(envelope),
        },
        {
          timeoutMs: config.outboundTimeoutMs,
          maximumBytes: config.maxOutboundBodyBytes,
          sideEffecting: true,
        },
        fetchImpl,
      );
    } catch (error) {
      if (error instanceof HttpBoundaryError) {
        throw new CreatorDeliveryError("Creator delivery outcome is not authoritative", {
          ambiguous: true,
        });
      }
      throw error;
    }

    if (
      response.status < 200 ||
      response.status >= 300 ||
      response.json?.accepted !== true ||
      response.json?.authoritative_readback !== true ||
      response.json?.event_key !== envelope.event_key
    ) {
      throw new CreatorDeliveryError("Creator did not return the required readback acknowledgment", {
        ambiguous: true,
      });
    }
    return { confirmed: true };
  }

  return Object.freeze({ deliver });
}

module.exports = { CreatorDeliveryError, createCreatorClient };
