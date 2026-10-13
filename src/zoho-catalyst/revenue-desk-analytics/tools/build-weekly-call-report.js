'use strict';

const { buildDailyMetricFact, deduplicateCalls } = require('../functions/analytics_sync/lib/daily-rollup');
const { canonicalJson, minimizeFact } = require('../functions/analytics_sync/lib/facts');
const { invariant } = require('../functions/analytics_sync/lib/errors');

const SCOPE_FIELDS = ['ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY',
  'CONFIGURATION_VERSION', 'ENGAGEMENT_TYPE', 'METRIC_VERSION'];
const METRICS = ['TOTAL_CALLS_HANDLED', 'QUALIFIED_OPPORTUNITIES', 'URGENT_REQUESTS',
  'EXISTING_CUSTOMER_CALLS', 'WRONG_FIT_CALLS', 'SPAM_CALLS', 'UNRESOLVED_CALLS',
  'GENERAL_INQUIRY_CALLS', 'PRIVACY_STOP_CALLS', 'BOOKABLE_OPPORTUNITIES', 'OFFICE_FOLLOW_UP_CALLS'];
const DAY_MS = 86400000;

function check(condition, message) {
  invariant(condition, 'WEEKLY_REPORT_INVALID', message);
}

function object(value, fields) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((field) => fields.includes(field)),
  'Weekly report object has unsupported fields.');
}

function timestamp(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
  'Weekly report requires canonical UTC timestamps with milliseconds.');
  return value;
}

function localParts(formatter, instant) {
  return Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function dateAt(instant) {
  const value = new Date(instant).toISOString().slice(0, 10);
  check(value >= '2000-01-01' && value < '2100-01-01',
    'Weekly reporting supports calendar boundaries in 2000 through 2099.');
  return value;
}

function midnight(formatter, date) {
  const nominal = Date.parse(`${date}T00:00:00.000Z`);
  const matches = [];
  // Modern IANA offsets are minute-aligned and within 24 hours of UTC. Search
  // the entire bounded window rather than assuming a 24-hour local day or
  // silently choosing one side of a repeated/nonexistent local midnight.
  for (let instant = nominal - DAY_MS; instant <= nominal + DAY_MS; instant += 60000) {
    const part = localParts(formatter, instant);
    if (`${part.year}-${part.month}-${part.day}` === date
      && part.hour === '00' && part.minute === '00' && part.second === '00') matches.push(instant);
  }
  check(matches.length === 1, 'Weekly reporting boundary is ambiguous or nonexistent.');
  return new Date(matches[0]).toISOString();
}

function weekBounds(weekContaining, timeZone, weekStartsOn) {
  timestamp(weekContaining);
  check(Number.isInteger(weekStartsOn) && weekStartsOn >= 0 && weekStartsOn <= 6,
    'An explicit week-start day (0 Sunday through 6 Saturday) is required.');
  check(typeof timeZone === 'string' && /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(timeZone),
    'An explicit IANA reporting timezone is required.');
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone, calendar: 'iso8601', numberingSystem: 'latn', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    check(false, 'The reporting timezone is unsupported.');
  }
  const part = localParts(formatter, Date.parse(weekContaining));
  const localDate = Date.parse(`${part.year}-${part.month}-${part.day}T00:00:00.000Z`);
  check(Number.isFinite(localDate), 'The local reporting date is unsupported.');
  const start = localDate - ((new Date(localDate).getUTCDay() - weekStartsOn + 7) % 7) * DAY_MS;
  const startDate = dateAt(start);
  const endDate = dateAt(start + 7 * DAY_MS);
  return {
    timeZone, weekStartsOn, startDate, endDate,
    startAt: midnight(formatter, startDate), endAt: midnight(formatter, endDate),
  };
}

function sameScope(left, right) {
  return SCOPE_FIELDS.every((field) => left[field] === right[field]);
}

function coverageFrom(evidence, scope, period, sourceWatermark) {
  if (evidence === null) return {
    state: 'unknown', startAt: null, completeThroughAt: null,
    inventoryComplete: false, correctionsComplete: false,
  };
  object(evidence, ['scope', 'periodStartAt', 'periodEndAt', 'sourceWatermark',
    'coveredStartAt', 'completeThroughAt', 'inventoryComplete', 'correctionsComplete']);
  object(evidence.scope, SCOPE_FIELDS);
  check(sameScope(evidence.scope, scope), 'Completeness evidence crosses the report scope.');
  check(evidence.periodStartAt === period.startAt && evidence.periodEndAt === period.endAt
    && evidence.sourceWatermark === sourceWatermark,
  'Completeness evidence does not bind the exact period and source watermark.');
  const startAt = timestamp(evidence.coveredStartAt);
  const completeThroughAt = timestamp(evidence.completeThroughAt);
  check(startAt >= period.startAt && startAt <= completeThroughAt
    && completeThroughAt <= period.endAt && completeThroughAt <= sourceWatermark,
  'Completeness evidence has invalid coverage bounds.');
  check(typeof evidence.inventoryComplete === 'boolean'
    && typeof evidence.correctionsComplete === 'boolean', 'Completeness flags must be explicit booleans.');
  const verified = evidence.inventoryComplete && evidence.correctionsComplete;
  return {
    state: !verified || startAt === completeThroughAt ? 'unknown'
      : startAt === period.startAt && completeThroughAt === period.endAt ? 'complete' : 'partial',
    startAt, completeThroughAt,
    inventoryComplete: evidence.inventoryComplete, correctionsComplete: evidence.correctionsComplete,
  };
}

/** Pure source-only reduction. See ../WEEKLY-CALL-REPORT-V1.md for producer obligations. */
function buildWeeklyCallReport(options) {
  object(options, ['calls', 'scope', 'weekContaining', 'timeZone', 'weekStartsOn',
    'sourceWatermark', 'sourceRevision', 'completeness']);
  const { calls, scope, sourceRevision } = options;
  object(scope, SCOPE_FIELDS);
  const sourceWatermark = timestamp(options.sourceWatermark);
  const period = weekBounds(options.weekContaining, options.timeZone, options.weekStartsOn);
  const dailyOptions = {
    clientKey: scope.CLIENT_KEY, deploymentKey: scope.DEPLOYMENT_KEY,
    configurationVersion: scope.CONFIGURATION_VERSION, engagementType: scope.ENGAGEMENT_TYPE,
    environment: scope.ENVIRONMENT, metricVersion: scope.METRIC_VERSION,
    sourceRevision, sourceModifiedAt: sourceWatermark,
  };
  // Reuse the canonical metric/fact validators, including for empty periods.
  const empty = buildDailyMetricFact({ ...dailyOptions, calls: [],
    reportingDateUtc: sourceWatermark.slice(0, 10) });
  check(scope.METRIC_VERSION === 'revenue_desk_metrics_v1', 'Unsupported weekly metric version.');
  check(Array.isArray(calls), 'Weekly report calls must be an array.');
  const versions = new Map();
  const normalized = calls.map((candidate) => {
    const call = minimizeFact('call', candidate);
    check(sameScope(call, scope), 'A call crosses the report scope.');
    check(call.SOURCE_MODIFIED_AT <= sourceWatermark, 'Source watermark precedes a call correction.');
    // Check every version, including stale versions hidden by a later correction.
    const version = `${call.CALL_KEY}:${call.SOURCE_MODIFIED_AT}`;
    const encoded = canonicalJson(call);
    check(!versions.has(version) || versions.get(version) === encoded,
      'Call facts conflict at the same source watermark.');
    versions.set(version, encoded);
    return call;
  });
  const unique = deduplicateCalls(normalized);
  // Deduplicate before filtering: a timestamp correction can move a call OUT of
  // this week. The producer must include that successor even outside the period.
  const selected = unique.filter((call) => call.STARTED_AT >= period.startAt && call.STARTED_AT < period.endAt);
  const coverage = coverageFrom(options.completeness ?? null, scope, period, sourceWatermark);
  const days = new Map();
  for (const call of selected) {
    const day = call.STARTED_AT.slice(0, 10);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(call);
  }
  // These are freshly filtered raw calls, never previously published UTC totals.
  const evaluated = [...days].map(([reportingDateUtc, dayCalls]) => buildDailyMetricFact({
    ...dailyOptions, reportingDateUtc, calls: dayCalls,
  }));
  const metrics = Object.fromEntries(METRICS.map((field) => {
    const observed = evaluated.every((fact) => Object.hasOwn(fact, field))
      ? evaluated.reduce((sum, fact) => sum + fact[field], empty[field]) : null;
    const known = coverage.state === 'complete' && observed !== null;
    return [field, { observed, total: known ? observed : null, state: known ? 'known' : 'unknown' }];
  }));
  return {
    contractVersion: 'weekly_call_report_v1', scope: { ...scope }, period,
    sourceRevision, sourceWatermark, coverage, metrics,
    corrections: {
      state: coverage.correctionsComplete ? 'reconciled_through_watermark' : 'unknown',
      observedSupersededVersions: versions.size - unique.length,
      latestCallWatermark: unique.reduce((latest, call) => latest === null
        || call.SOURCE_MODIFIED_AT > latest ? call.SOURCE_MODIFIED_AT : latest, null),
      modifiedAfterWeekEnd: selected.filter((call) => call.SOURCE_MODIFIED_AT >= period.endAt).length,
    },
  };
}

module.exports = { buildWeeklyCallReport, weekBounds };
