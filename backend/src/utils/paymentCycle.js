// ============================================================
// BACKEND: src/utils/paymentCycle.js — REPLACE WHOLE FILE
// ------------------------------------------------------------
// The single source of truth for payment-cycle dates and the
// payment-processing lock. Used by the API, by the submit and approval
// popups, by every dashboard and by the Accounts payment queue, so
// none of them can drift apart.
//
// Pure functions. Nothing here reads or writes the database.
// ============================================================
const {
  CYCLES,
  RULES_EFFECTIVE_FROM,
  IST_OFFSET_MINUTES,
  MONTH_NAMES,
  PAYMENT_CYCLE_TERMS,
} = require("../config/paymentCycleConfig");

const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_LIST = [CYCLES.FIRST, CYCLES.SECOND];

// ── IST calendar helpers ───────────────────────────────────
// The server runs UTC on Linode. An invoice approved at 00:30 IST on
// the 8th is 19:00 UTC on the 7th; a plain getDate() would put it in
// the First cycle instead of the Second. Every day-of-month read below
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

// The UTC instant of 23:59:59.999 IST on a given IST calendar date.
const istEndOfDay = (year, monthIndex, day) =>
  new Date(istMidnight(year, monthIndex, day).getTime() + DAY_MS - 1);

const toDate = (v) => (v instanceof Date ? v : new Date(v));

const addMonth = (year, monthIndex) =>
  monthIndex === 11
    ? { year: year + 1, monthIndex: 0 }
    : { year, monthIndex: monthIndex + 1 };

const subMonth = (year, monthIndex) =>
  monthIndex === 0
    ? { year: year - 1, monthIndex: 11 }
    : { year, monthIndex: monthIndex - 1 };

const pad = (n) => String(n).padStart(2, "0");

const fmt = (year, monthIndex, day) =>
  `${pad(day)} ${MONTH_NAMES[monthIndex]} ${year}`;

const iso = (year, monthIndex, day) =>
  `${year}-${pad(monthIndex + 1)}-${pad(day)}`;

// "10–15 Oct 2026"
const fmtRange = (year, monthIndex, fromDay, toDay) =>
  `${pad(fromDay)}–${pad(toDay)} ${MONTH_NAMES[monthIndex]} ${year}`;

// ── Core rule ──────────────────────────────────────────────
// Maps an IST calendar date (the CH final-approval date) to its cycle.
const cycleForDay = (year, monthIndex, day) => {
  if (day <= CYCLES.FIRST.approvalCutoffDay) {
    return { cycle: CYCLES.FIRST, year, monthIndex };
  }
  if (day <= CYCLES.SECOND.approvalCutoffDay) {
    return { cycle: CYCLES.SECOND, year, monthIndex };
  }
  return { cycle: CYCLES.FIRST, ...addMonth(year, monthIndex) };
};

// The cycle that follows a given one.
const cycleAfter = ({ cycle, year, monthIndex }) =>
  cycle.key === CYCLES.FIRST.key
    ? { cycle: CYCLES.SECOND, year, monthIndex }
    : { cycle: CYCLES.FIRST, ...addMonth(year, monthIndex) };

// A monotonically increasing number per cycle instance, so two cycles
// can be compared with < and >. (Oct-First < Oct-Second < Nov-First.)
const cycleIndex = ({ cycle, year, monthIndex }) =>
  (year * 12 + monthIndex) * 2 + cycle.order;

// When the approval window for a cycle opened — the day after the
// previous cycle's cut-off.
//   SECOND window: 8th  -> 17th of the same month
//   FIRST  window: 18th of the previous month -> 7th of this month
const windowStartFor = ({ cycle, year, monthIndex }) => {
  if (cycle.key === CYCLES.SECOND.key) {
    return { year, monthIndex, day: CYCLES.FIRST.approvalCutoffDay + 1 };
  }
  const prev = subMonth(year, monthIndex);
  return { ...prev, day: CYCLES.SECOND.approvalCutoffDay + 1 };
};

// Turns an internal cycle into the shape the client renders.
const describe = ({ cycle, year, monthIndex }) => ({
  cycleKey: cycle.key,
  cycleLabel: cycle.label,
  cycleShortLabel: cycle.shortLabel,
  cycleMonthLabel: `${MONTH_NAMES[monthIndex]} ${year}`,

  // Approval cut-off: CH must approve by 23:59 IST on this day.
  cutoffDate: istEndOfDay(year, monthIndex, cycle.approvalCutoffDay),
  cutoffDateIso: iso(year, monthIndex, cycle.approvalCutoffDay),
  cutoffDateLabel: fmt(year, monthIndex, cycle.approvalCutoffDay),
  cutoffDateTimeLabel: `${fmt(year, monthIndex, cycle.approvalCutoffDay)}, 11:59 PM`,

  // Accounts processing window.
  processingStartDate: istMidnight(year, monthIndex, cycle.processingStartDay),
  processingEndDate: istEndOfDay(year, monthIndex, cycle.processingEndDay),
  processingWindowLabel: fmtRange(
    year,
    monthIndex,
    cycle.processingStartDay,
    cycle.processingEndDay,
  ),

  // Bank payment window. paymentDate = first day (kept for older readers).
  paymentDate: istMidnight(year, monthIndex, cycle.paymentStartDay),
  paymentEndDate: istMidnight(year, monthIndex, cycle.paymentEndDay),
  paymentDateIso: iso(year, monthIndex, cycle.paymentStartDay),
  paymentEndDateIso: iso(year, monthIndex, cycle.paymentEndDay),
  paymentWindowLabel: fmtRange(
    year,
    monthIndex,
    cycle.paymentStartDay,
    cycle.paymentEndDay,
  ),
  // Older UI reads paymentDateLabel; it now shows the whole window.
  paymentDateLabel: fmtRange(
    year,
    monthIndex,
    cycle.paymentStartDay,
    cycle.paymentEndDay,
  ),
});

// ── Effective-date guard ───────────────────────────────────
// True when the instant falls before the date the new rules took effect.
const isBeforeNewRules = (instant) => {
  const { year, monthIndex, day } = istParts(toDate(instant));
  return iso(year, monthIndex, day) < RULES_EFFECTIVE_FROM;
};

// The previous 7th/21st rule, used ONLY to derive (never store) a cycle
// for old invoices that predate the stored-cycle field.
const legacyStoredShape = (instant) => {
  const at = toDate(instant);
  const { year, monthIndex, day } = istParts(at);
  let key = "CYCLE_7";
  let payDay = 7;
  let target = { year, monthIndex };
  if (day <= 4) {
    key = "CYCLE_7";
  } else if (day <= 18) {
    key = "CYCLE_21";
    payDay = 21;
  } else {
    target = addMonth(year, monthIndex);
  }
  return {
    cycleKey: key,
    cycleLabel: key === "CYCLE_7" ? "7th Cycle" : "21st Cycle",
    cutoffDate: istMidnight(
      target.year,
      target.monthIndex,
      key === "CYCLE_7" ? 4 : 18,
    ),
    paymentDate: istMidnight(target.year, target.monthIndex, payDay),
    basisDate: iso(year, monthIndex, day),
  };
};

/**
 * Resolve the payment cycle for a given date.
 *
 * @param {Date|string} [basisDate]
 *        The final-approval date when assigning a real cycle, or today
 *        when projecting one for a popup.
 * @param {object}  [options]
 * @param {boolean} [options.projection]
 *        true when the invoice has NOT yet been finally approved, so
 *        the client knows to present the result as an estimate.
 */
const resolvePaymentCycle = (basisDate = new Date(), options = {}) => {
  const at = toDate(basisDate);
  if (Number.isNaN(at.getTime())) {
    throw new Error("resolvePaymentCycle: invalid basis date");
  }

  const { year, monthIndex, day } = istParts(at);

  const current = cycleForDay(year, monthIndex, day);
  const next = cycleAfter(current);
  const described = describe(current);

  const today = istMidnight(year, monthIndex, day);
  const cutoffDayStart = istMidnight(
    current.year,
    current.monthIndex,
    current.cycle.approvalCutoffDay,
  );
  const daysToCutoff = Math.round(
    (cutoffDayStart.getTime() - today.getTime()) / DAY_MS,
  );

  // ── Window progress, for the dashboard ribbon ────────────
  const ws = windowStartFor(current);
  const windowStart = istMidnight(ws.year, ws.monthIndex, ws.day);
  const windowTotalDays = Math.max(
    1,
    Math.round((cutoffDayStart.getTime() - windowStart.getTime()) / DAY_MS),
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

    processingWindow: publicWindow(getProcessingWindow(at)),

    basisDateIso: iso(year, monthIndex, day),
    resolvedAt: new Date(),
  };
};

// ── Processing window (Accounts) ───────────────────────────
// Is Accounts inside a processing window on this date, and for which
// cycle? Outside the windows `active` is false and nothing is locked.
const getProcessingWindow = (now = new Date()) => {
  const at = toDate(now);
  const { year, monthIndex, day } = istParts(at);

  const cycle = CYCLE_LIST.find(
    (c) => day >= c.processingStartDay && day <= c.processingEndDay,
  );

  if (!cycle) {
    // Next window to open, for display only.
    const upcoming =
      CYCLE_LIST.find((c) => day < c.processingStartDay) || null;
    const nextWin = upcoming
      ? { cycle: upcoming, year, monthIndex }
      : { cycle: CYCLES.FIRST, ...addMonth(year, monthIndex) };
    const d = describe(nextWin);
    return {
      active: false,
      nextWindow: {
        cycleKey: d.cycleKey,
        cycleLabel: d.cycleLabel,
        processingWindowLabel: d.processingWindowLabel,
      },
    };
  }

  const instance = { cycle, year, monthIndex };
  const d = describe(instance);
  return {
    active: true,
    cycleKey: d.cycleKey,
    cycleLabel: d.cycleLabel,
    cycleMonthLabel: d.cycleMonthLabel,
    processingWindowLabel: d.processingWindowLabel,
    paymentWindowLabel: d.paymentWindowLabel,
    cutoffDateTimeLabel: d.cutoffDateTimeLabel,
    // Invoices finally approved AFTER this instant belong to a later cycle.
    lockAfter: istEndOfDay(year, monthIndex, cycle.approvalCutoffDay),
    // Locked invoices become processable from 00:00 IST on this day.
    unlocksAt: istMidnight(year, monthIndex, cycle.processingEndDay + 1),
    unlocksLabel: fmt(year, monthIndex, cycle.processingEndDay + 1),
    _index: cycleIndex(instance),
  };
};

// Strips the internal comparison index before a window goes to a client.
// eslint-disable-next-line no-unused-vars
const publicWindow = ({ _index, ...rest }) => rest;

// The instant the Cluster Head finally approved this invoice.
// Accepts a mongoose document or a plain object.
const finalApprovalDateOf = (invoice) => {
  const obj = invoice?.toObject ? invoice.toObject() : invoice;
  if (!obj) return null;
  const assigned = obj.paymentCycle?.assigned;
  if (assigned?.cycleKey && !assigned.derived && assigned.recordedAt) {
    return new Date(assigned.recordedAt);
  }
  const finalApproval = [...(obj.approvalHistory || [])]
    .reverse()
    .find((h) => h.action === "approved" && /cluster/i.test(h.stage || ""));
  const basis = finalApproval?.actionAt || obj.updatedAt;
  return basis ? new Date(basis) : null;
};

/**
 * Is this invoice locked for payment processing right now?
 *
 * Locked only while a processing window is open (8–10 / 18–21) AND the
 * invoice's final approval came after that window's cut-off, i.e. it
 * belongs to a later cycle than the one being processed.
 */
const getProcessingLock = (invoice, now = new Date(), window = null) => {
  const win = window || getProcessingWindow(now);
  if (!win.active) return { locked: false };

  // Fixed monthly payments are never held by the processing windows.
  const src = invoice?.toObject ? invoice.toObject().source : invoice?.source;
  if (src === "fixed_payment") return { locked: false };

  const approvedAt = finalApprovalDateOf(invoice);
  if (!approvedAt || Number.isNaN(approvedAt.getTime())) {
    return { locked: false };
  }
  if (isBeforeNewRules(approvedAt)) return { locked: false };

  const { year, monthIndex, day } = istParts(approvedAt);
  const own = cycleForDay(year, monthIndex, day);
  if (cycleIndex(own) <= win._index) return { locked: false };

  const ownDesc = describe(own);
  return {
    locked: true,
    unlocksAt: win.unlocksAt,
    unlocksLabel: win.unlocksLabel,
    cycleKey: ownDesc.cycleKey,
    cycleLabel: ownDesc.cycleLabel,
    paymentWindowLabel: ownDesc.paymentWindowLabel,
    reason:
      `Locked during the ${win.cycleLabel} processing window (${win.processingWindowLabel}). ` +
      `This invoice was approved by the Cluster Head after the ${win.cutoffDateTimeLabel} cut-off ` +
      `and belongs to the ${ownDesc.cycleLabel} (${ownDesc.paymentWindowLabel}). ` +
      `It can be processed from ${win.unlocksLabel}.`,
  };
};

/** Short form stored on the invoice document. */
const toStoredShape = (resolved, extra = {}) => ({
  cycleKey: resolved.cycleKey,
  cycleLabel: resolved.cycleLabel,
  cutoffDate: resolved.cutoffDate,
  paymentDate: resolved.paymentDate,
  paymentEndDate: resolved.paymentEndDate,
  basisDate: resolved.basisDateIso,
  ...extra,
});

/**
 * Cycle to show for an invoice that has no stored cycle. Uses the rule
 * that was in force on its approval date. Nothing is written.
 */
const derivedStoredShape = (basis) =>
  isBeforeNewRules(basis)
    ? legacyStoredShape(basis)
    : toStoredShape(resolvePaymentCycle(basis));

module.exports = {
  resolvePaymentCycle,
  toStoredShape,
  derivedStoredShape,
  cycleForDay,
  istParts,
  getProcessingWindow,
  getProcessingLock,
  publicWindow,
  finalApprovalDateOf,
  PAYMENT_CYCLE_TERMS,
};
