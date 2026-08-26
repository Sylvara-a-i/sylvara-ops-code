"use strict";

/* Canonical machine-readable server/client field-setup protocol. */
module.exports = {
  "schemaVersion": 1,
  "protocolId": "free_revenue_leak_test_field_setup_v1",
  "formNavigation": {
    "approvedPublicHosts": [
      "forms.zohopublic.com"
    ]
  },
  "initialState": "loading_session_validation",
  "blockedState": "recoverable_blocked",
  "states": [
    {
      "id": "loading_session_validation",
      "name": "Loading and session validation",
      "serverOutcomeRequired": false,
      "primaryAction": {
        "id": "validate_session",
        "label": "Validate session",
        "nextState": "company_progress_summary",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "company_progress_summary",
      "name": "Company and progress summary",
      "serverOutcomeRequired": false,
      "primaryAction": {
        "id": "acknowledge_company_summary",
        "label": "Continue to handoff",
        "nextState": "handoff_to_client_form1",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "handoff_to_client_form1",
      "name": "Hand-iPad-to-client instruction",
      "serverOutcomeRequired": false,
      "primaryAction": {
        "id": "handoff_to_client_form1",
        "label": "I handed over the iPad",
        "nextState": "form1_open_or_resume",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "form1_open_or_resume",
      "name": "Open or resume Form 1",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "open_form1",
        "label": "Open Form 1",
        "nextState": "form1_completion_confirmation",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "form1_completion_confirmation",
      "name": "Form 1 completion confirmation",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "confirm_form1_return",
        "label": "Form 1 showed success",
        "nextState": "return_to_operator_after_form1",
        "browserIntentAllowed": true
      },
      "secondaryActions": [
        {
          "id": "resume_form1",
          "label": "Reopen Form 1",
          "nextState": "form1_completion_confirmation",
          "browserIntentAllowed": true
        }
      ]
    },
    {
      "id": "return_to_operator_after_form1",
      "name": "Return-iPad-to-Gabriel instruction",
      "serverOutcomeRequired": false,
      "primaryAction": {
        "id": "handoff_to_operator_after_form1",
        "label": "Gabriel has the iPad",
        "nextState": "operator_qualification_review",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "operator_qualification_review",
      "name": "Operator qualification review",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "qualification_qualified",
        "label": "Qualified — Continue Setup",
        "nextState": "lead_conversion_preview",
        "browserIntentAllowed": true,
        "qualificationDecision": "qualified_continue_setup"
      },
      "secondaryActions": [
        {
          "id": "qualification_not_ready",
          "label": "Not Ready — Save And Follow Up",
          "nextState": "recoverable_blocked",
          "browserIntentAllowed": true,
          "qualificationDecision": "not_ready_save_and_follow_up"
        },
        {
          "id": "qualification_disqualified",
          "label": "Disqualified",
          "nextState": "recoverable_blocked",
          "browserIntentAllowed": true,
          "qualificationDecision": "disqualified"
        }
      ]
    },
    {
      "id": "lead_conversion_preview",
      "name": "Lead-conversion preview",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "accept_conversion_preview",
        "label": "Build current conversion preview",
        "nextState": "lead_conversion_confirmation",
        "browserIntentAllowed": true,
        "serverCoordinator": "conversion"
      },
      "secondaryActions": []
    },
    {
      "id": "lead_conversion_confirmation",
      "name": "Explicit conversion confirmation",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "confirm_conversion_intent",
        "label": "Confirm conversion",
        "nextState": "handoff_to_client_form2",
        "browserIntentAllowed": true,
        "serverCoordinator": "conversion"
      },
      "secondaryActions": []
    },
    {
      "id": "handoff_to_client_form2",
      "name": "Hand-iPad-to-client instruction",
      "serverOutcomeRequired": false,
      "primaryAction": {
        "id": "handoff_to_client_form2",
        "label": "I handed over the iPad",
        "nextState": "form2_email_verification",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "form2_email_verification",
      "name": "Email verification for Form 2",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "open_form2_email_verification",
        "label": "Continue verification",
        "nextState": "form2_open_or_resume",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "form2_open_or_resume",
      "name": "Open or resume Form 2",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "open_form2",
        "label": "Open Form 2",
        "nextState": "form2_completion_confirmation",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "form2_completion_confirmation",
      "name": "Form 2 completion confirmation",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "confirm_form2_return",
        "label": "Form 2 showed success",
        "nextState": "return_to_operator_after_form2",
        "browserIntentAllowed": true
      },
      "secondaryActions": [
        {
          "id": "resume_form2",
          "label": "Reopen Form 2",
          "nextState": "form2_completion_confirmation",
          "browserIntentAllowed": true
        }
      ]
    },
    {
      "id": "return_to_operator_after_form2",
      "name": "Return-iPad-to-Gabriel instruction",
      "serverOutcomeRequired": false,
      "primaryAction": {
        "id": "handoff_to_operator_after_form2",
        "label": "Gabriel has the iPad",
        "nextState": "number_reservation_status",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "number_reservation_status",
      "name": "Test-number reservation status",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "refresh_number_status",
        "label": "Check reservation status",
        "nextState": "forwarding_instructions",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "forwarding_instructions",
      "name": "Forwarding instructions",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "view_forwarding_instructions",
        "label": "Forwarding step complete",
        "nextState": "rollback_instructions",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "rollback_instructions",
      "name": "Rollback instructions",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "view_rollback_instructions",
        "label": "Rollback is prepared",
        "nextState": "route_verification_status",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "route_verification_status",
      "name": "Route-verification status",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "refresh_route_verification",
        "label": "Check verification status",
        "nextState": "ready_for_approval",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "ready_for_approval",
      "name": "Ready for approval",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "refresh_approval_readiness",
        "label": "Refresh readiness",
        "nextState": "ready_for_approval",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "live_status",
      "name": "Live status",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "refresh_live_status",
        "label": "Refresh status",
        "nextState": "live_status",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "stop_rollback_status",
      "name": "Stop/rollback status",
      "serverOutcomeRequired": true,
      "primaryAction": {
        "id": "refresh_stop_status",
        "label": "Refresh rollback status",
        "nextState": "stop_rollback_status",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    },
    {
      "id": "recoverable_blocked",
      "name": "Specific recoverable blocked/error state",
      "serverOutcomeRequired": false,
      "primaryAction": {
        "id": "retry_blocked_step",
        "label": "Retry validation",
        "nextState": "loading_session_validation",
        "browserIntentAllowed": true
      },
      "secondaryActions": []
    }
  ],
  "globalActions": [
    {
      "id": "stop_setup",
      "label": "Stop Setup",
      "nextState": "stop_rollback_status",
      "browserIntentAllowed": true,
      "authoritativeSideEffect": true
    }
  ],
  "globalServerPrerequisites": {
    "stop_setup": {
      "receiptType": "setup_stop_reconciled",
      "statusPatch": {
        "rollbackStatus": "requested"
      },
      "requiredFingerprintFields": []
    }
  },
  "qualification": {
    "factors": [
      {
        "id": "companyHasMeaningfulCallVolume",
        "label": "Company Has Meaningful Call Volume"
      },
      {
        "id": "canAcceptAdditionalProfitableWork",
        "label": "Can Accept Additional Profitable Work"
      },
      {
        "id": "hasRepeatableIntakeProcess",
        "label": "Has A Repeatable Intake Process"
      },
      {
        "id": "willAuthorizeControlledForwardingPath",
        "label": "Will Authorize A Controlled Forwarding Path"
      },
      {
        "id": "hasAccountableCallbackOrHandoffOwner",
        "label": "Has An Accountable Callback / Handoff Owner"
      },
      {
        "id": "decisionMakerIsPresent",
        "label": "Decision-Maker Is Present"
      }
    ],
    "decisions": [
      {
        "id": "qualified_continue_setup",
        "actionId": "qualification_qualified",
        "requiresAllFactors": true,
        "storedStatus": "qualified"
      },
      {
        "id": "not_ready_save_and_follow_up",
        "actionId": "qualification_not_ready",
        "requiresAllFactors": false,
        "storedStatus": "not_ready"
      },
      {
        "id": "disqualified",
        "actionId": "qualification_disqualified",
        "requiresAllFactors": false,
        "storedStatus": "disqualified"
      }
    ]
  },
  "serverPrerequisites": {
    "form1_open_or_resume": {
      "open_form1": {
        "receiptType": "form1_opened_or_resumed",
        "statusPatch": {
          "form1Status": "in_progress"
        },
        "requiredFingerprintFields": []
      }
    },
    "form1_completion_confirmation": {
      "confirm_form1_return": {
        "receiptType": "form1_reconciled",
        "statusPatch": {
          "form1Status": "reconciled"
        },
        "requiredFingerprintFields": []
      },
      "resume_form1": {
        "receiptType": "form1_opened_or_resumed",
        "statusPatch": {
          "form1Status": "in_progress"
        },
        "requiredFingerprintFields": []
      }
    },
    "operator_qualification_review": {
      "qualification_qualified": {
        "receiptType": "qualification_qualified",
        "statusPatch": {
          "qualificationStatus": "qualified"
        },
        "requiredFingerprintFields": []
      },
      "qualification_not_ready": {
        "receiptType": "qualification_not_ready",
        "statusPatch": {
          "qualificationStatus": "not_ready"
        },
        "requiredFingerprintFields": []
      },
      "qualification_disqualified": {
        "receiptType": "qualification_disqualified",
        "statusPatch": {
          "qualificationStatus": "disqualified"
        },
        "requiredFingerprintFields": []
      }
    },
    "lead_conversion_preview": {
      "accept_conversion_preview": {
        "receiptType": "conversion_preview_reconciled",
        "statusPatch": {
          "conversionStatus": "preview_ready"
        },
        "requiredFingerprintFields": [
          "conversionPreviewFingerprint"
        ]
      }
    },
    "lead_conversion_confirmation": {
      "confirm_conversion_intent": {
        "receiptType": "conversion_completion_reconciled",
        "statusPatch": {
          "conversionStatus": "completed"
        },
        "requiredFingerprintFields": [
          "conversionPreviewFingerprint",
          "conversionSideEffectFingerprint",
          "conversionOutcomeFingerprint",
          "dealResumeBindingDigest"
        ]
      }
    },
    "form2_email_verification": {
      "open_form2_email_verification": {
        "receiptType": "form2_email_verification_reconciled",
        "statusPatch": {
          "form2Status": "in_progress"
        },
        "requiredFingerprintFields": []
      }
    },
    "form2_open_or_resume": {
      "open_form2": {
        "receiptType": "form2_opened_or_resumed",
        "statusPatch": {
          "form2Status": "in_progress"
        },
        "requiredFingerprintFields": []
      }
    },
    "form2_completion_confirmation": {
      "confirm_form2_return": {
        "receiptType": "form2_reconciled",
        "statusPatch": {
          "form2Status": "reconciled"
        },
        "requiredFingerprintFields": []
      },
      "resume_form2": {
        "receiptType": "form2_opened_or_resumed",
        "statusPatch": {
          "form2Status": "in_progress"
        },
        "requiredFingerprintFields": []
      }
    },
    "number_reservation_status": {
      "refresh_number_status": {
        "receiptType": "number_assignment_reconciled",
        "statusPatch": {
          "numberStatus": "assigned"
        },
        "requiredFingerprintFields": [
          "configVersionFingerprint"
        ]
      }
    },
    "forwarding_instructions": {
      "view_forwarding_instructions": {
        "receiptType": "forwarding_enablement_reconciled",
        "statusPatch": {
          "forwardingStatus": "customer_reported_enabled"
        },
        "requiredFingerprintFields": []
      }
    },
    "rollback_instructions": {
      "view_rollback_instructions": {
        "receiptType": "rollback_readiness_reconciled",
        "statusPatch": {
          "rollbackStatus": "ready"
        },
        "requiredFingerprintFields": []
      }
    },
    "route_verification_status": {
      "refresh_route_verification": {
        "receiptType": "route_verification_reconciled",
        "statusPatch": {
          "forwardingStatus": "verified",
          "routeVerificationStatus": "verified"
        },
        "requiredFingerprintFields": []
      }
    },
    "ready_for_approval": {
      "refresh_approval_readiness": {
        "receiptType": "approval_readiness_reconciled",
        "statusPatch": {
          "form1Status": "reconciled",
          "qualificationStatus": "qualified",
          "conversionStatus": "completed",
          "form2Status": "reconciled",
          "numberStatus": "assigned",
          "forwardingStatus": "verified",
          "routeVerificationStatus": "verified",
          "rollbackStatus": "ready"
        },
        "requiredFingerprintFields": [
          "conversionPreviewFingerprint",
          "conversionSideEffectFingerprint",
          "conversionOutcomeFingerprint",
          "dealResumeBindingDigest",
          "configVersionFingerprint"
        ]
      }
    },
    "live_status": {
      "refresh_live_status": {
        "receiptType": "live_status_reconciled",
        "statusPatch": {
          "form1Status": "reconciled",
          "qualificationStatus": "qualified",
          "conversionStatus": "completed",
          "form2Status": "reconciled",
          "numberStatus": "live",
          "forwardingStatus": "verified",
          "routeVerificationStatus": "verified",
          "rollbackStatus": "ready"
        },
        "requiredFingerprintFields": [
          "conversionPreviewFingerprint",
          "conversionSideEffectFingerprint",
          "conversionOutcomeFingerprint",
          "dealResumeBindingDigest",
          "configVersionFingerprint"
        ]
      }
    },
    "stop_rollback_status": {
      "refresh_stop_status": {
        "receiptType": "stop_rollback_reconciled",
        "statusPatch": {
          "numberStatus": "cooldown",
          "forwardingStatus": "rollback_verified",
          "rollbackStatus": "verified"
        },
        "requiredFingerprintFields": [
          "configVersionFingerprint"
        ]
      }
    }
  },
  "browserAuthority": {
    "intentOnly": true,
    "prohibitedOperations": [
      "qualify",
      "convert_lead",
      "reserve_number",
      "open_verification_window",
      "approve",
      "activate",
      "start_test",
      "stop_live_route",
      "rollback_live_route"
    ]
  },
  "persistence": {
    "rowFields": [
      "journeyKey",
      "launchDigest",
      "sessionDigest",
      "moduleApiName",
      "recordId",
      "leadResumeBindingDigest",
      "dealResumeBindingDigest",
      "operatorUserId",
      "environment",
      "state",
      "form1Status",
      "qualificationStatus",
      "conversionStatus",
      "form2Status",
      "numberStatus",
      "forwardingStatus",
      "routeVerificationStatus",
      "rollbackStatus",
      "conversionPreviewFingerprint",
      "conversionSideEffectFingerprint",
      "conversionOutcomeFingerprint",
      "configVersionFingerprint",
      "issuedAt",
      "launchExpiresAt",
      "absoluteExpiresAt",
      "idleExpiresAt",
      "launchConsumedAt",
      "revision",
      "lastOutcome",
      "updatedAt"
    ],
    "mandatoryFields": [
      "journeyKey",
      "launchDigest",
      "moduleApiName",
      "recordId",
      "leadResumeBindingDigest",
      "operatorUserId",
      "environment",
      "state",
      "form1Status",
      "qualificationStatus",
      "conversionStatus",
      "form2Status",
      "numberStatus",
      "forwardingStatus",
      "routeVerificationStatus",
      "rollbackStatus",
      "issuedAt",
      "launchExpiresAt",
      "absoluteExpiresAt",
      "revision",
      "lastOutcome",
      "updatedAt"
    ],
    "initialValues": {
      "state": "loading_session_validation",
      "form1Status": "not_started",
      "qualificationStatus": "not_started",
      "conversionStatus": "not_started",
      "form2Status": "not_started",
      "numberStatus": "not_started",
      "forwardingStatus": "not_configured",
      "routeVerificationStatus": "not_verified",
      "rollbackStatus": "not_prepared",
      "revision": 1,
      "lastOutcome": "launch_issued"
    },
    "statusValues": {
      "form1Status": [
        "not_started",
        "in_progress",
        "submitted",
        "reconciled",
        "blocked"
      ],
      "qualificationStatus": [
        "not_started",
        "qualified",
        "not_ready",
        "disqualified"
      ],
      "conversionStatus": [
        "not_started",
        "preview_ready",
        "write_started",
        "reconciliation_required",
        "completed"
      ],
      "form2Status": [
        "not_started",
        "verification_pending",
        "in_progress",
        "submitted",
        "reconciled",
        "blocked"
      ],
      "numberStatus": [
        "not_started",
        "available",
        "reserved",
        "assigned",
        "live",
        "cooldown",
        "retired",
        "required"
      ],
      "forwardingStatus": [
        "not_configured",
        "instructions_issued",
        "customer_reported_enabled",
        "verification_in_progress",
        "verified",
        "verification_failed",
        "disabled",
        "rollback_verified"
      ],
      "routeVerificationStatus": [
        "not_verified",
        "window_open",
        "verified",
        "failed",
        "expired"
      ],
      "rollbackStatus": [
        "not_prepared",
        "ready",
        "requested",
        "in_progress",
        "verified",
        "failed"
      ]
    },
    "stateStatusRequirements": {
      "loading_session_validation": {},
      "company_progress_summary": {},
      "handoff_to_client_form1": {},
      "form1_open_or_resume": {},
      "form1_completion_confirmation": {
        "form1Status": [
          "in_progress",
          "submitted",
          "reconciled"
        ],
        "qualificationStatus": [
          "not_started"
        ],
        "conversionStatus": [
          "not_started"
        ],
        "form2Status": [
          "not_started"
        ],
        "numberStatus": [
          "not_started"
        ],
        "forwardingStatus": [
          "not_configured"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "return_to_operator_after_form1": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "not_started"
        ],
        "conversionStatus": [
          "not_started"
        ],
        "form2Status": [
          "not_started"
        ],
        "numberStatus": [
          "not_started"
        ],
        "forwardingStatus": [
          "not_configured"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "operator_qualification_review": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "not_started"
        ],
        "conversionStatus": [
          "not_started"
        ],
        "form2Status": [
          "not_started"
        ],
        "numberStatus": [
          "not_started"
        ],
        "forwardingStatus": [
          "not_configured"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "lead_conversion_preview": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "not_started"
        ],
        "form2Status": [
          "not_started"
        ],
        "numberStatus": [
          "not_started"
        ],
        "forwardingStatus": [
          "not_configured"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "lead_conversion_confirmation": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "preview_ready",
          "write_started",
          "reconciliation_required",
          "completed"
        ],
        "form2Status": [
          "not_started"
        ],
        "numberStatus": [
          "not_started"
        ],
        "forwardingStatus": [
          "not_configured"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "handoff_to_client_form2": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "completed"
        ],
        "form2Status": [
          "not_started"
        ],
        "numberStatus": [
          "not_started"
        ],
        "forwardingStatus": [
          "not_configured"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "form2_email_verification": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "completed"
        ],
        "form2Status": [
          "not_started"
        ],
        "numberStatus": [
          "not_started"
        ],
        "forwardingStatus": [
          "not_configured"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "form2_open_or_resume": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "completed"
        ],
        "form2Status": [
          "in_progress",
          "submitted",
          "reconciled"
        ],
        "numberStatus": [
          "not_started"
        ],
        "forwardingStatus": [
          "not_configured"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "form2_completion_confirmation": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "completed"
        ],
        "form2Status": [
          "in_progress",
          "submitted",
          "reconciled"
        ],
        "numberStatus": [
          "not_started"
        ],
        "forwardingStatus": [
          "not_configured"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "return_to_operator_after_form2": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "completed"
        ],
        "form2Status": [
          "reconciled"
        ],
        "numberStatus": [
          "not_started"
        ],
        "forwardingStatus": [
          "not_configured"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "number_reservation_status": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "completed"
        ],
        "form2Status": [
          "reconciled"
        ],
        "numberStatus": [
          "not_started",
          "available",
          "reserved",
          "required"
        ],
        "forwardingStatus": [
          "not_configured"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "forwarding_instructions": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "completed"
        ],
        "form2Status": [
          "reconciled"
        ],
        "numberStatus": [
          "assigned"
        ],
        "forwardingStatus": [
          "not_configured",
          "instructions_issued",
          "customer_reported_enabled"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "rollback_instructions": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "completed"
        ],
        "form2Status": [
          "reconciled"
        ],
        "numberStatus": [
          "assigned"
        ],
        "forwardingStatus": [
          "customer_reported_enabled",
          "verification_in_progress",
          "verified"
        ],
        "routeVerificationStatus": [
          "not_verified"
        ],
        "rollbackStatus": [
          "not_prepared"
        ]
      },
      "route_verification_status": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "completed"
        ],
        "form2Status": [
          "reconciled"
        ],
        "numberStatus": [
          "assigned"
        ],
        "forwardingStatus": [
          "customer_reported_enabled",
          "verification_in_progress",
          "verified"
        ],
        "routeVerificationStatus": [
          "not_verified",
          "window_open",
          "verified",
          "failed",
          "expired"
        ],
        "rollbackStatus": [
          "ready"
        ]
      },
      "ready_for_approval": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "completed"
        ],
        "form2Status": [
          "reconciled"
        ],
        "numberStatus": [
          "assigned"
        ],
        "forwardingStatus": [
          "verified"
        ],
        "routeVerificationStatus": [
          "verified"
        ],
        "rollbackStatus": [
          "ready"
        ]
      },
      "live_status": {
        "form1Status": [
          "reconciled"
        ],
        "qualificationStatus": [
          "qualified"
        ],
        "conversionStatus": [
          "completed"
        ],
        "form2Status": [
          "reconciled"
        ],
        "numberStatus": [
          "live"
        ],
        "forwardingStatus": [
          "verified"
        ],
        "routeVerificationStatus": [
          "verified"
        ],
        "rollbackStatus": [
          "ready"
        ]
      },
      "stop_rollback_status": {},
      "recoverable_blocked": {}
    },
    "launchExchange": {
      "expectedState": "loading_session_validation",
      "nextState": "company_progress_summary",
      "expectedRevision": 1,
      "nextRevision": 2
    }
  }
};
