// ============================================================
// FRONTEND: src/utils/exportExcel.js — NEW FILE
// ------------------------------------------------------------
// Builds a workbook from whatever is currently on screen, so the file
// and the table can never disagree.
//
// Requires:  npm i xlsx
//
// SheetJS community edition writes values, number formats, column
// widths and autofilter, but cannot style cells. Headers come out
// plain. If you need styled headers, that sheet has to be built
// server-side with exceljs, the way the subtype report is.
// ============================================================
import * as XLSX from "xlsx";

// Indian digit grouping: 1,23,45,678.00 rather than 12,345,678.00.
const INR = "[>=10000000]#,##,##,##0.00;[>=100000]#,##,##0.00;#,##0.00";

const FORMATS = {
  money: INR,
  int: "#,##0",
  hours: "#,##0.0",
  pct: '0.0"%"',
  date: "dd/mm/yyyy",
};

// Excel can't hold a JS Date reliably across timezones here, so dates
// go in as display strings.
const asDate = (v) => (v ? new Date(v).toLocaleDateString("en-GB") : "");

const cellValue = (row, col) => {
  const raw = typeof col.value === "function" ? col.value(row) : row[col.key];
  if (raw === null || raw === undefined || raw === "")
    return col.fmt === "date" ? "" : (raw ?? "");
  if (col.fmt === "date") return asDate(raw);
  if (["money", "int", "hours", "pct"].includes(col.fmt)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : "";
  }
  return raw;
};

/**
 * sheets: [{
 *   name:    "Delay by stage",              // tab name, trimmed to 31 chars
 *   title:   "Invoice approval delay",      // optional, row 1
 *   meta:    [["Period", "01/04/26 - 30/06/26"], ...],   // optional
 *   columns: [{ header, key, width, fmt, value? }],
 *   rows:    [ ... ],
 *   totals:  { key: value } | null          // optional bold-less total row
 * }]
 */
export function downloadExcel({ filename, sheets }) {
  const wb = XLSX.utils.book_new();
  const used = new Set();

  sheets
    .filter((s) => s && s.columns?.length)
    .forEach((s) => {
      const aoa = [];

      if (s.title) aoa.push([s.title]);
      (s.meta || []).forEach(([k, v]) => aoa.push([k, v]));
      if (s.title || s.meta?.length) aoa.push([]);

      const headerRow = aoa.length; // zero-based index of the header
      aoa.push(s.columns.map((c) => c.header));

      (s.rows || []).forEach((r) =>
        aoa.push(s.columns.map((c) => cellValue(r, c))),
      );

      if (s.totals) {
        aoa.push(
          s.columns.map((c, i) =>
            i === 0
              ? s.totals.__label || "Total"
              : s.totals[c.key] === undefined
                ? ""
                : cellValue(s.totals, c),
          ),
        );
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = s.columns.map((c) => ({ wch: c.width || 14 }));

      // Number formats, applied per column from the first data row down.
      const lastRow = aoa.length - 1;
      s.columns.forEach((c, ci) => {
        const z = FORMATS[c.fmt];
        if (!z) return;
        for (let r = headerRow + 1; r <= lastRow; r++) {
          const ref = XLSX.utils.encode_cell({ r, c: ci });
          if (ws[ref] && ws[ref].t === "n") ws[ref].z = z;
        }
      });

      if ((s.rows || []).length > 1) {
        ws["!autofilter"] = {
          ref: XLSX.utils.encode_range(
            { r: headerRow, c: 0 },
            { r: lastRow, c: s.columns.length - 1 },
          ),
        };
      }

      // Tab names: 31 chars max, no []:*?/\ , and must be unique.
      let name = String(s.name || "Sheet")
        .replace(/[[\]:*?/\\]/g, " ")
        .slice(0, 31);
      let n = 2;
      while (used.has(name)) name = `${name.slice(0, 28)} ${n++}`;
      used.add(name);

      XLSX.utils.book_append_sheet(wb, ws, name);
    });

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filename}_${stamp}.xlsx`);
}

// Filter summary shown at the top of every sheet, so a file sitting in
// someone's Downloads folder still says what it covers.
export function filterMeta(filters = {}, extra = []) {
  const d = (v) => (v ? new Date(v).toLocaleDateString("en-GB") : null);
  const period =
    filters.from || filters.to
      ? `${d(filters.from) || "start"} to ${d(filters.to) || "today"}`
      : "All dates";

  return [
    ["Period", period],
    filters.expenseType ? ["Expense type", filters.expenseType] : null,
    filters.branchName
      ? ["Branch", filters.branchName]
      : ["Branch", "All branches"],
    ...extra,
    ["Generated", new Date().toLocaleString("en-GB")],
  ].filter(Boolean);
}
