"use strict";

const ISO_TIMESTAMP_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):?(\d{2}))$/;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  if (month >= 1 && month <= 12) return 31;
  return 0;
}

/**
 * Parse the deliberately narrow timestamp contract used at trust boundaries.
 * Date.parse alone normalizes impossible dates and 24:00 into different valid
 * instants, which would weaken freshness and signing-key rotation controls.
 */
function parseStrictIsoTimestamp(raw) {
  const match = typeof raw === "string" ? ISO_TIMESTAMP_WITH_OFFSET.exec(raw) : null;
  if (!match) return null;

  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw,
    , zone, , offsetHourRaw, offsetMinuteRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourRaw);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteRaw);

  if (
    day < 1 || day > daysInMonth(year, month) ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 14 || offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }

  const timestampMs = Date.parse(raw);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

module.exports = { parseStrictIsoTimestamp };
