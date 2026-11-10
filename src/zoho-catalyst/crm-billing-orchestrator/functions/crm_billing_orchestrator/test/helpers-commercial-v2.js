"use strict";

// Deliberately synthetic terms. These are not Sylvara prices or allowances.
function fixture() {
  return {
    currency: "USD", annualTermMonths: 12, annualBaseDiscountBasisPoints: 1000,
    allowancePeriodMonths: 1, allowanceRollover: false,
    voiceOverageMinorPerMinute: 37, smsOverageMinorPerSegment: 7,
    annualRefund: {
      unusedWholeMonthsRefundable: true, currentMonthRefundable: false,
      completedSetupRefundable: false,
    },
    policyVersions: {
      connectedTimeDefinition: null, rounding: null, exclusions: null, periodAttribution: null,
      lateEventsAndCorrections: null, usageLimits: null, disputes: null,
    },
    plans: Object.fromEntries(["Launch", "Growth", "Scale"].map((name, index) => [name, {
      monthlyBaseMinor: (index + 1) * 10_000,
      annualBaseMinor: (index + 1) * 108_000,
      setupMinor: (index + 1) * 12_300,
      includedVoiceMinutes: (index + 1) * 50,
      includedSmsSegments: (index + 1) * 70,
      scopeVersion: null,
    }])),
  };
}

module.exports = { fixture };
