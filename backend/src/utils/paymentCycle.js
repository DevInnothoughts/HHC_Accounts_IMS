// ============================================================
// BACKEND: src/utils/paymentCycle.js — NEW FILE
// ------------------------------------------------------------
// The single source of truth for payment-cycle dates. Used by the
// API, by the pre-submit popup and by every dashboard, so the three
// can never drift apart.
//
// Pure functions. Nothing here reads or writes the database.
// ============================================================
const {
  CYCLES,
  IST_OFFSET_MINUTES,
  MONTH_NAMES,
  PAYMENT_CYCLE_TERMS,
} = require("../config/paymentCycleConfig");

const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── IST calendar helpers ───────────────────────────────────
// The server runs UTC on Linode. An invoice approved at 00:30 IST on
// the 5th is 19:00 UTC on the 4th; a plain getDate() would put it in
// the 7th cycle instead of the 21st. Every day-of-month read below
// goes through this function.
const istParts = (instant) => {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
};

// The UTC instant of 00:00 IST on a given IST calendar date.
const istMidnight = (year, monthIndex, day) =>
  new Date(Date.UTC(year, monthIndex, day) - IST_OFFSET_MS);

const addMonth = (year, monthIndex) =>
  monthIndex === 11
    ? { year: year + 1, monthIndex: 0 }
    : { year, monthIndex: monthIndex + 1 };

const subMonth = (year, monthIndex) =>
  monthIndex === 0
    ? { year: year - 1, monthIndex: 11 }
    : { year, monthIndex: monthIndex - 1 };

// When the collection window for a cycle opened — the day after the
// previous cycle's cut-off.
//   CYCLE_21 window: 5th  -> 18th of the same month
//   CYCLE_7  window: 19th of the previous month -> 4th of this month
const windowStartFor = ({ cycle, year, monthIndex }) => {
  if (cycle.key === "CYCLE_21") {
    return { year, monthIndex, day: CYCLES.CYCLE_7.cutoffDay + 1 };
  }
  const prev = subMonth(year, monthIndex);
  return { ...prev, day: CYCLES.CYCLE_21.cutoffDay + 1 };
};

const fmt = (year, monthIndex, day) =>
  `${String(day).padStart(2, "0")} ${MONTH_NAMES[monthIndex]} ${year}`;

const iso = (year, monthIndex, day) =>
  `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

// ── Core rule ──────────────────────────────────────────────
// Maps an IST calendar date to the cycle it belongs to.
const cycleForDay = (year, monthIndex, day) => {
  if (day <= CYCLES.CYCLE_7.cutoffDay) {
    return { cycle: CYCLES.CYCLE_7, year, monthIndex };
  }
  if (day <= CYCLES.CYCLE_21.cutoffDay) {
    return { cycle: CYCLES.CYCLE_21, year, monthIndex };
  }
  return { cycle: CYCLES.CYCLE_7, ...addMonth(year, monthIndex) };
};

// The cycle that follows a given one.
const cycleAfter = ({ cycle, year, monthIndex }) =>
  cycle.key === "CYCLE_7"
    ? { cycle: CYCLES.CYCLE_21, year, monthIndex }
    : { cycle: CYCLES.CYCLE_7, ...addMonth(year, monthIndex) };

// Turns an internal cycle into the shape the client renders.
const describe = ({ cycle, year, monthIndex }) => ({
  cycleKey: cycle.key,
  cycleLabel: cycle.label,
  cutoffDate: istMidnight(year, monthIndex, cycle.cutoffDay),
  cutoffDateIso: iso(year, monthIndex, cycle.cutoffDay),
  cutoffDateLabel: fmt(year, monthIndex, cycle.cutoffDay),
  paymentDate: istMidnight(year, monthIndex, cycle.paymentDay),
  paymentDateIso: iso(year, monthIndex, cycle.paymentDay),
  paymentDateLabel: fmt(year, monthIndex, cycle.paymentDay),
});

/**
 * Resolve the payment cycle for a given date.
 *
 * @param {Date|string} [basisDate]
 *        The final-approval date when assigning a real cycle, or today
 *        when projecting one for the pre-submit popup.
 * @param {object}  [options]
 * @param {boolean} [options.projection]
 *        true when the invoice has NOT yet been finally approved, so
 *        the client knows to present the result as an estimate.
 */
const resolvePaymentCycle = (basisDate = new Date(), options = {}) => {
  const at = basisDate instanceof Date ? basisDate : new Date(basisDate);
  if (Number.isNaN(at.getTime())) {
    throw new Error("resolvePaymentCycle: invalid basis date");
  }

  const { year, monthIndex, day } = istParts(at);

  const current = cycleForDay(year, monthIndex, day);
  const next = cycleAfter(current);

  const described = describe(current);

  const daysToCutoff = Math.round(
    (described.cutoffDate.getTime() -
      istMidnight(year, monthIndex, day).getTime()) /
      DAY_MS,
  );

  // ── Window progress, for the dashboard ribbon ────────────
  const ws = windowStartFor(current);
  const windowStart = istMidnight(ws.year, ws.monthIndex, ws.day);
  const today = istMidnight(year, monthIndex, day);

  const windowTotalDays = Math.round(
    (described.cutoffDate.getTime() - windowStart.getTime()) / DAY_MS,
  );
  const windowElapsedDays = Math.round(
    (today.getTime() - windowStart.getTime()) / DAY_MS,
  );
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((windowElapsedDays / windowTotalDays) * 100)),
  );

  return {
    ...described,

    // How this result should be read by the UI.
    isProjection: Boolean(options.projection),
    anchor: "FINAL_APPROVAL",

    daysToCutoff, // 0 means the cut-off is today
    isCutoffToday: daysToCutoff === 0,
    isNextMonth: !(current.year === year && current.monthIndex === monthIndex),

    nextCycle: describe(next),
    windowStartIso: iso(ws.year, ws.monthIndex, ws.day),
    windowStartLabel: fmt(ws.year, ws.monthIndex, ws.day),
    windowTotalDays,
    progressPercent,

    basisDateIso: iso(year, monthIndex, day),
    resolvedAt: new Date(),
  };
};

/** Short form stored on the invoice document. */
const toStoredShape = (resolved, extra = {}) => ({
  cycleKey: resolved.cycleKey,
  cycleLabel: resolved.cycleLabel,
  cutoffDate: resolved.cutoffDate,
  paymentDate: resolved.paymentDate,
  basisDate: resolved.basisDateIso,
  ...extra,
});

module.exports = {
  resolvePaymentCycle,
  toStoredShape,
  cycleForDay,
  istParts,
  PAYMENT_CYCLE_TERMS,
};
