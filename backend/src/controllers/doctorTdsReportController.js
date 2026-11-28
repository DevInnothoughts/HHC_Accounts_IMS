// ============================================================
// BACKEND: src/controllers/doctorTdsReportController.js — NEW FILE
// ------------------------------------------------------------
// TDS on doctor payments (Doctor Referral + Surgeon payouts) — kept apart
// from the invoice TDS report, as its own list.
//
//   GET /api/reports/doctor-tds                 preview (JSON)
//   GET /api/reports/doctor-tds/working-excel   "TDS WORKING" sheet
//
// WHERE THE TDS COMES FROM. It is the TDS column of the payout Excel,
// exactly as uploaded: PMS does not calculate it. A record counts once
// the Cluster / Department Head has approved it (approved, in payment or
// paid); pending, rejected and withdrawn records never appear.
//
// PERIOD (?dateBasis=)
//   sheetDate (default) — the Date typed in the payout sheet
//   approvalDate        — the day the record was approved
//   paymentDate         — the payment date recorded with the UTR
//
// Filters: from, to, branch (one or several, comma-separated), type
// (referral | surgeon), stage ("paid" = paid only), tds (with | nil),
// search (doctor name or PAN). Branch scoping as in the other reports.
// Read only.
// ============================================================
const DoctorPayout = require("../models/DoctorPayout");
const cfg = require("../config/doctorPayoutConfig");
const {
  _internal: { resolveBranchIds, dayStart, dayEnd },
} = require("./vendorReportController");
const {
  _internal: { guessNature, periodTitle, depositDue, NATURES, excelDate },
} = require("./tdsReportController");

const RS = cfg.PAYOUT_STATUS;
const APPROVED_ONWARDS = [RS.APPROVED, RS.RAISED, RS.FILE_GENERATED, RS.PAID];
const DATE_FIELD = {
  sheetDate: "date",
  approvalDate: "approvedAt",
  paymentDate: "paymentDate",
};
const MAX_SCAN = 50000; // records per request — beyond this, narrow the period
const MAX_REGISTER = 10000; // lines sent to the screen
const IST = 330 * 60 * 1000;

const str = (v) => (typeof v === "string" ? v.trim() : "");
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

class BadRequest extends Error {}

// Every query value goes through str() — never an object into a filter.
const parseFilters = (req) => {
  const q = req.query;
  const from = str(q.from);
  const to = str(q.to);
  if (from && !dayStart(from))
    throw new BadRequest("From date is not a valid date (YYYY-MM-DD)");
  if (to && !dayEnd(to))
    throw new BadRequest("To date is not a valid date (YYYY-MM-DD)");
  if (from && to && from > to)
    throw new BadRequest("The end date is before the start date");
  return {
    from: from ? dayStart(from) : null,
    to: to ? dayEnd(to) : null,
    dateBasis: DATE_FIELD[str(q.dateBasis)] ? str(q.dateBasis) : "sheetDate",
    branchIds: resolveBranchIds(req.user, str(q.branch)),
    type: Object.values(cfg.TYPES).includes(str(q.type)) ? str(q.type) : "",
    stage: str(q.stage) === "paid" ? "paid" : "",
    tds: ["with", "nil"].includes(str(q.tds)) ? str(q.tds) : "",
    search: str(q.search).slice(0, 60),
  };
};

// The filtered records as plain report lines, oldest first.
const loadLines = async (f) => {
  const field = DATE_FIELD[f.dateBasis];
  const query = {
    status: f.stage === "paid" ? RS.PAID : { $in: APPROVED_ONWARDS },
  };
  if (f.branchIds) query.branch = { $in: f.branchIds };
  if (f.type) query.type = f.type;
  if (f.tds === "with") query.tdsAmount = { $gt: 0 };
  if (f.tds === "nil") query.tdsAmount = { $lte: 0 };
  if (f.from || f.to) {
    query[field] = {};
    if (f.from) query[field].$gte = f.from;
    if (f.to) query[field].$lte = f.to;
  } else if (field !== "date") {
    query[field] = { $ne: null }; // e.g. payment-date basis: paid ones only
  }
  if (f.search) {
    const rx = { $regex: escapeRx(f.search), $options: "i" };
    query.$or = [{ doctorName: rx }, { panNumber: rx }, { payoutId: rx }];
  }

  const rows = await DoctorPayout.find(query)
    .select(
      "payoutId type branch doctor panNumber doctorName date approvedAt paymentDate patientName noOfSurgeries basicAmount tdsAmount payableAmount status paymentRef utrNumber",
    )
    .populate("branch", "name code")
    .populate("doctor", "name doctorCode doctorType")
    .sort({ [field]: 1, _id: 1 })
    .limit(MAX_SCAN + 1)
    .lean();
  if (rows.length > MAX_SCAN)
    throw new BadRequest(
      `More than ${MAX_SCAN.toLocaleString("en-IN")} records match — narrow the period or pick a branch.`,
    );

  return rows.map((p) => {
    const gross = r2(p.basicAmount);
    const tds = r2(p.tdsAmount);
    return {
      _id: String(p._id),
      payoutId: p.payoutId,
      type: p.type,
      date: p[field] || null, // the date the period filter works on
      sheetDate: p.date,
      approvedAt: p.approvedAt || null,
      paymentDate: p.paymentDate || null,
      branchId: p.branch ? String(p.branch._id) : "",
      branchName: p.branch?.name || "",
      doctorId: p.doctor ? String(p.doctor._id) : "",
      doctorName: p.doctor?.name || p.doctorName || "",
      doctorCode: p.doctor?.doctorCode || "",
      panNumber: p.panNumber,
      reference:
        p.type === cfg.TYPES.REFERRAL
          ? p.patientName || ""
          : `${p.noOfSurgeries} surger${p.noOfSurgeries === 1 ? "y" : "ies"}`,
      gross,
      tds,
      net: r2(p.payableAmount),
      ratePct: gross > 0 ? r2((tds / gross) * 100) : null,
      status: p.status,
      paymentRef: p.paymentRef || "",
      utrNumber: p.utrNumber || "",
    };
  });
};

const istMonth = (d) => {
  const x = new Date(new Date(d).getTime() + IST);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1 };
};

const blank = () => ({ records: 0, gross: 0, tds: 0, net: 0 });
const add = (g, l) => {
  g.records += 1;
  g.gross += l.gross;
  g.tds += l.tds;
  g.net += l.net;
};
const tidy = (g) => ({
  ...g,
  gross: r2(g.gross),
  tds: r2(g.tds),
  net: r2(g.net),
});

// ── GET /api/reports/doctor-tds ────────────────────────────
exports.getReport = async (req, res) => {
  try {
    const f = parseFilters(req);
    const lines = await loadLines(f);

    const totals = blank();
    const byDoctor = new Map();
    const byBranch = new Map();
    const byMonth = new Map();
    const byType = {};
    let nilRecords = 0;

    lines.forEach((l) => {
      add(totals, l);
      if (l.tds <= 0) nilRecords += 1;

      const d =
        byDoctor.get(l.panNumber) ||
        byDoctor
          .set(l.panNumber, {
            key: l.panNumber,
            doctorId: l.doctorId,
            name: l.doctorName,
            doctorCode: l.doctorCode,
            pan: l.panNumber,
            ...blank(),
            referral: 0,
            surgeon: 0,
            _rates: new Set(),
            _branches: new Set(),
          })
          .get(l.panNumber);
      add(d, l);
      d[l.type] += l.gross;
      if (l.ratePct != null) d._rates.add(l.ratePct);
      if (l.branchName) d._branches.add(l.branchName);

      const b =
        byBranch.get(l.branchId) ||
        byBranch
          .set(l.branchId, {
            branchId: l.branchId,
            name: l.branchName,
            ...blank(),
            _doctors: new Set(),
          })
          .get(l.branchId);
      add(b, l);
      b._doctors.add(l.panNumber);

      if (l.date) {
        const { y, m } = istMonth(l.date);
        const ym = `${y}-${String(m).padStart(2, "0")}`;
        const mo =
          byMonth.get(ym) ||
          byMonth
            .set(ym, { ym, ...blank(), depositDue: depositDue({ y, m }) })
            .get(ym);
        add(mo, l);
      }

      const t = (byType[l.type] = byType[l.type] || blank());
      add(t, l);
    });

    const doctors = [...byDoctor.values()]
      .map(({ _rates, _branches, ...d }) => ({
        ...tidy(d),
        referral: r2(d.referral),
        surgeon: r2(d.surgeon),
        rates: [..._rates].sort((a, b) => a - b),
        branches: [..._branches].sort(),
      }))
      .sort((a, b) => b.tds - a.tds || b.gross - a.gross);

    res.json({
      filters: { dateBasis: f.dateBasis, stage: f.stage },
      totals: { ...tidy(totals), doctors: doctors.length, nilRecords },
      byType: Object.fromEntries(
        Object.entries(byType).map(([k, v]) => [k, tidy(v)]),
      ),
      byDoctor: doctors,
      byBranch: [...byBranch.values()]
        .map(({ _doctors, ...b }) => ({ ...tidy(b), doctors: _doctors.size }))
        .sort((a, b) => b.tds - a.tds),
      byMonth: [...byMonth.values()]
        .map(tidy)
        .sort((a, b) => (a.ym < b.ym ? -1 : 1)),
      // Doctors whose records carry more than one TDS % — worth a look.
      mixedRates: doctors
        .filter((d) => d.rates.length > 1)
        .map((d) => ({ name: d.name, pan: d.pan, rates: d.rates })),
      register: lines.slice(0, MAX_REGISTER),
      registerTruncated: lines.length > MAX_REGISTER,
    });
  } catch (err) {
    if (err instanceof BadRequest)
      return res.status(400).json({ message: err.message });
    console.error("Doctor TDS report error:", err);
    res.status(500).json({ message: "Could not build the doctor TDS report" });
  }
};

// ── GET /api/reports/doctor-tds/working-excel ──────────────
// Same layout as the Accounts team's "TDS WORKING" sheet for invoices
// (columns A–M, SUBTOTAL row, Nature dropdown fed by the lookup table in
// N:R), so the two can be worked on — or pasted together — the same way.
//   GROSS = Basic Amount      Invoice = Basic Amount (no GST on these)
//   Net   = Invoice − TDS     L = patient / surgeries    M = PMS record id
exports.exportWorkingExcel = async (req, res) => {
  try {
    const ExcelJS = require("exceljs");
    const f = parseFilters(req);
    if (f.tds === "") f.tds = "with"; // a TDS working lists deductions
    f.search = "";
    const lines = await loadLines(f);

    let title = periodTitle(f.from, f.to);
    if (!title && lines.length) {
      const dated = lines.filter((l) => l.date);
      if (dated.length)
        title = periodTitle(dated[0].date, dated[dated.length - 1].date);
    }
    const kind = f.type
      ? ` — ${cfg.TYPE_LABELS[f.type].toUpperCase()}`
      : " — DOCTOR PAYMENTS";
    title = `${title ? `${title} ` : ""}TDS WORKING${kind}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = "HHC PMS";
    wb.created = new Date();
    const ws = wb.addWorksheet("TDS Working - Doctors", {
      views: [{ state: "frozen", ySplit: 3 }],
      pageSetup: {
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9,
      },
    });

    const ACC = '_ * #,##0.00_ ;_ * \\-#,##0.00_ ;_ * "-"??_ ;_ @_ ';
    const thin = { style: "thin", color: { argb: "FF000000" } };
    const box = { top: thin, left: thin, bottom: thin, right: thin };
    const HEAD_FILL = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF8497B0" },
    };
    const TOTAL_FILL = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF70AD47" },
    };

    [
      10.3, 22, 36, 12, 14.3, 9, 14.3, 8, 13.2, 14.3, 26, 26, 15, 26, 8.5, 7.5,
      7.5, 12,
    ].forEach((w, i) => (ws.getColumn(i + 1).width = w));

    const FIRST = 4;
    const LAST = Math.max(FIRST, FIRST + lines.length - 1);
    const N_FIRST = 4;
    const N_LAST = N_FIRST + NATURES.length - 1;
    const NATURE_RANGE = `$N$${N_FIRST}:$R$${N_LAST}`;

    // Row 1 — SUBTOTALs (respect Excel filters)
    const r1 = ws.getRow(1);
    r1.getCell("E").value = { formula: `SUBTOTAL(9,E${FIRST}:E${LAST})` };
    r1.getCell("H").value = "Total";
    r1.getCell("I").value = { formula: `SUBTOTAL(9,I${FIRST}:I${LAST})` };
    r1.getCell("J").value = { formula: `SUBTOTAL(9,J${FIRST}:J${LAST})` };
    ["E", "H", "I", "J"].forEach((c) => {
      const cell = r1.getCell(c);
      cell.font = { name: "Calibri", size: 12, bold: true };
      cell.fill = TOTAL_FILL;
      cell.border = box;
      if (c === "H") cell.alignment = { horizontal: "center" };
      else cell.numFmt = ACC;
    });

    // Row 2 — title
    ws.mergeCells("A2:M2");
    const t = ws.getCell("A2");
    t.value = title;
    t.font = { name: "Calibri", size: 12, bold: true };
    t.alignment = { horizontal: "center", vertical: "middle" };
    const med = { style: "medium", color: { argb: "FF000000" } };
    t.border = { top: med, left: med, bottom: med, right: med };
    ws.getRow(2).height = 18;

    // Row 3 — headers
    const HEAD = [
      "DATE",
      "BRANCH",
      "PAYEE",
      "PAN",
      "GROSS",
      "SECTION",
      "Invoice",
      "%",
      "TDS ",
      "Net",
      "Nature",
      "Patient / Surgeries",
      "PMS ID",
    ];
    const r3 = ws.getRow(3);
    r3.height = 31.5;
    HEAD.forEach((h, i) => {
      const cell = r3.getCell(i + 1);
      cell.value = h;
      cell.font = { name: "Times New Roman", size: 12, bold: true };
      cell.fill = HEAD_FILL;
      cell.border = box;
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    });

    // Lookup table N3:R — the same one the invoice working sheet carries
    ["Nature of Payment", "Section", "TDS %", "GST %", "TDS on GST?"].forEach(
      (h, i) => {
        const cell = r3.getCell(14 + i);
        cell.value = h;
        cell.font = { name: "Calibri", size: 11, bold: true };
        cell.border = box;
        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
      },
    );
    NATURES.forEach((n, k) => {
      const row = ws.getRow(N_FIRST + k);
      n.forEach((v, i) => {
        const cell = row.getCell(14 + i);
        if (v !== null) cell.value = v;
        cell.border = box;
        if (i === 2) cell.numFmt = "0.0##%";
        if (i === 3) cell.numFmt = "0%";
      });
    });

    lines.forEach((l, k) => {
      const r = FIRST + k;
      const row = ws.getRow(r);
      row.getCell("A").value = excelDate(l.date);
      row.getCell("A").numFmt = "dd-mm-yy";
      row.getCell("B").value = l.branchName;
      row.getCell("C").value = l.doctorName;
      row.getCell("D").value = l.panNumber;
      row.getCell("E").value = l.gross;
      row.getCell("F").value = {
        formula: `IFERROR(VLOOKUP(K${r},${NATURE_RANGE},2,FALSE),"")`,
      };
      row.getCell("G").value = l.gross;
      row.getCell("H").value = l.ratePct == null ? null : l.ratePct / 100;
      row.getCell("H").numFmt = "0.00%";
      row.getCell("I").value = l.tds;
      row.getCell("J").value = { formula: `G${r}-I${r}` };
      // Suggested only — Accounts confirm it from the dropdown. Surgeon /
      // anaesthetist fees read as professional fees when the % agrees;
      // referral payouts are suggested from the % alone.
      row.getCell("K").value = guessNature(
        cfg.TALLY.TDS_SECTION_HINT[l.type] || "",
        l.ratePct,
      );
      row.getCell("L").value = `${cfg.TYPE_LABELS[l.type]}: ${l.reference}`;
      row.getCell("M").value = l.payoutId;
      ["E", "G", "I", "J"].forEach((c) => (row.getCell(c).numFmt = ACC));
      for (let c = 1; c <= 13; c += 1) row.getCell(c).border = box;
      row.getCell("K").dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`$N$${N_FIRST}:$N$${N_LAST}`],
        showErrorMessage: true,
        errorTitle: "Nature of Payment",
        error: "Pick a nature from the list in column N.",
      };
    });

    if (lines.length) {
      ws.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: LAST, column: 13 },
      };
      const red = {
        type: "pattern",
        pattern: "solid",
        bgColor: { argb: "FFFFC7CE" },
      };
      ws.addConditionalFormatting({
        ref: `H${FIRST}:H${LAST}`,
        rules: [
          {
            // % in the payout sheet differs from the % of the Nature chosen
            type: "expression",
            formulae: [
              `AND($K${FIRST}<>"",ISNUMBER(VLOOKUP($K${FIRST},${NATURE_RANGE},3,FALSE)),ROUND(VLOOKUP($K${FIRST},${NATURE_RANGE},3,FALSE),6)<>ROUND($H${FIRST},6))`,
            ],
            style: { fill: red, font: { color: { argb: "FF9C0006" } } },
          },
        ],
      });
    } else {
      ws.getCell("A4").value =
        "No doctor payments with TDS match these filters.";
      ws.getCell("A4").font = { italic: true, color: { argb: "FF64748B" } };
    }

    const safe = title
      .replace(/TDS WORKING.*$/, "")
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    const filename = `TDS_Working_Doctors${safe ? `_${safe}` : ""}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.setHeader("Cache-Control", "no-cache");
    res.send(await wb.xlsx.writeBuffer());
  } catch (err) {
    if (err instanceof BadRequest)
      return res.status(400).json({ message: err.message });
    console.error("Doctor TDS working sheet error:", err);
    res.status(500).json({ message: "Could not build the TDS working sheet" });
  }
};
