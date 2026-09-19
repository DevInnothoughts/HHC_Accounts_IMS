// ============================================================
// BACKEND: src/scripts/lib/vendorMasterBackfillRunner.js  —  NEW FILE
// ------------------------------------------------------------
// The I/O half of the Phase 3 backfill: loads rows, applies the plan from
// vendorMasterBackfillPlan.js, copies documents, writes the report CSV and
// the rollback journal. All database access goes through an injected
// `dal` object (see scripts/buildVendorMaster.js), so this file has no
// Mongoose import and can be exercised against in-memory fakes.
// ============================================================
const path = require("path");
const crypto = require("crypto");
const {
  MASTER_OWNED_FIELDS,
  VENDOR_MASTER,
} = require("../../config/constants");
const plan = require("./vendorMasterBackfillPlan");

const PAYMENT_FIELDS = [
  "accountNumber",
  "ifscCode",
  "accountHolderName",
  "bankName",
];
const DOC_LABEL = {
  pan: "PAN Card",
  gst: "GST Certificate",
  cheque: "Cancelled Cheque",
};
const MB = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const idOf = plan.idOf;

const mask = (n) => (n ? `****${String(n).trim().slice(-4)}` : "");
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const pickOwned = (src, owned) => {
  const out = {};
  for (const f of owned)
    out[f] = src[f] === undefined || src[f] === "" ? null : src[f];
  return out;
};

// The master document that a golden row produces.
// A GSTIN belongs to a PAN when it is well-formed and characters 3–12 are
// that PAN.
const gstOfPan = (gst, pan) => {
  const g = plan.up(gst);
  return (
    Boolean(g) &&
    VENDOR_MASTER.GST_REGEX.test(g) &&
    g.slice(2, 12) === plan.up(pan)
  );
};

const buildMasterData = (golden, { owned, actorId, now }) => {
  const d = pickOwned(golden, owned);
  d.panNumber = plan.up(golden.panNumber);
  if (d.ifscCode) d.ifscCode = plan.up(d.ifscCode);
  // Primary GSTIN = the seed record's, if it genuinely belongs to this PAN.
  // Every branch keeps its own GSTIN; the master's full list (gstins) is
  // rebuilt from the linked branches after linking.
  d.gstNumber = gstOfPan(golden.gstNumber, golden.panNumber)
    ? plan.up(golden.gstNumber)
    : null;
  d.vendorType = golden.vendorType || "standard";
  d.vendorCategory = golden.vendorCategory || undefined;
  return {
    ...d,
    approvalStatus: "approved", // it was already approved as a branch vendor
    verifiedByAccounts: true,
    approvedBy: golden.approvedBy || null,
    approvedAt: golden.approvedAt || now,
    status: "active",
    createdBy: golden.createdBy || actorId || null,
    createdByScript: true,
    sourceVendorId: golden._id,
    linkedBranchCount: 0,
    documents: [],
  };
};

// ── Files ───────────────────────────────────────────────────
const makeFileOps = ({ fs, uploadBase, getFileUrl, folder }) => {
  const base = path.resolve(uploadBase);
  const safe = (key) => {
    if (!key) return null;
    const p = path.resolve(base, key);
    return p.startsWith(base + path.sep) ? p : null; // no ../ escapes
  };
  const size = (key) => {
    const p = safe(key);
    try {
      return p && fs.existsSync(p) ? fs.statSync(p).size : null;
    } catch {
      return null;
    }
  };
  const copy = (doc, masterId, now) => {
    const src = safe(doc.key);
    if (!src || !fs.existsSync(src)) return null;
    const ext = path.extname(doc.key).toLowerCase();
    const key = `${folder}/${masterId}/documents/${Date.now()}-${crypto
      .randomBytes(8)
      .toString("hex")}${ext}`;
    const dest = path.join(base, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    return {
      name: doc.name || path.basename(doc.key),
      url: getFileUrl(key),
      key,
      type: doc.type,
      uploadedAt: doc.uploadedAt || now,
    };
  };
  const remove = (key) => {
    const p = safe(key);
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  };
  return { size, copy, remove };
};

// ════════════════════════════════════════════════════════════
// BACKFILL
// ════════════════════════════════════════════════════════════
async function runBackfill(opts, deps) {
  const {
    apply = false,
    onlyPan = null,
    goldenOverrideId = null,
    actorId = null,
    outDir = process.cwd(),
    owned = MASTER_OWNED_FIELDS,
  } = opts;
  const { dal, fs, audit = async () => {}, log = console.log } = deps;
  const now = deps.now ? deps.now() : new Date();
  // Unique per run: two runs in the same second must never share a journal
  // (the journal is the only thing ROLLBACK can work from).
  const stamp = `${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${crypto
    .randomBytes(3)
    .toString("hex")}`;
  const files = makeFileOps({
    fs,
    uploadBase: deps.uploadBase,
    getFileUrl: deps.getFileUrl,
    folder: VENDOR_MASTER.documentFolder || "vendor-masters",
  });

  // ── Load ──────────────────────────────────────────────────
  const rows = await dal.loadCandidateRows({ onlyPan });
  const groups = plan.groupByPan(rows);
  const pans = [...groups.keys()];
  const masters = await dal.loadMastersByPans(pans); // Map pan -> master
  const linkedBranches = await dal.loadLinkedBranches(
    [...masters.values()].map((m) => m._id),
  ); // Map masterId -> Set(branchId)
  const counts = await dal.invoiceCounts(rows.map((r) => r._id));
  const branchNames = await dal.branchNames(); // Map branchId -> "Name (CODE)"

  // ── Plan ──────────────────────────────────────────────────
  const plans = [];
  for (const pan of pans) {
    const existing = masters.get(pan) || null;
    const p = plan.planPan(pan, groups.get(pan), {
      existingMaster: existing,
      existingLinkedBranches: existing
        ? linkedBranches.get(idOf(existing)) || new Set()
        : new Set(),
      invoiceCounts: counts,
      goldenOverrideId: onlyPan ? goldenOverrideId : null,
      owned,
    });
    let masterData = null;
    if (p.mode === "CREATE") {
      masterData = buildMasterData(p.golden, { owned, actorId, now });
      const errs = await dal.validateMaster(masterData);
      if (errs.length) {
        // Second safety net behind masterProblems(): the real schema said no.
        p.keep = [
          ...p.link.map((row) => ({
            row,
            reason: "INVALID_DATA",
            fields: errs,
          })),
          ...p.keep,
        ];
        p.link = [];
        p.mode = "SKIP";
        p.golden = null;
        masterData = null;
      }
    }
    plans.push({ p, masterData, existing });
  }

  // ── Report ────────────────────────────────────────────────
  const reasons = {};
  let createCount = 0;
  let existingCount = 0;
  let skipCount = 0;
  let linkRows = 0;
  let keepRows = 0;
  let copyFiles = 0;
  let copyBytes = 0;
  let missingFiles = 0;
  let reclaimBytes = 0;
  const csv = [
    [
      "PAN",
      "Plan",
      "Reason",
      "Differs in",
      "Linking overwrites",
      "Branch",
      "Vendor ID",
      "Vendor name",
      "Account",
      "IFSC",
      "GSTIN",
      "Invoices",
      "Master",
      "Notes",
    ].join(","),
  ];
  const line = (pan, planName, reason, row, extra = {}) =>
    csv.push(
      [
        pan,
        planName,
        reason,
        (extra.fields || []).join(" "),
        (extra.overwrites || []).join(" "),
        branchNames.get(idOf(row.branch)) || idOf(row.branch),
        idOf(row._id),
        row.vendorName,
        mask(row.accountNumber),
        row.ifscCode,
        row.gstNumber,
        counts.get(idOf(row._id)) || 0,
        extra.master || "",
        extra.notes || "",
      ]
        .map(csvCell)
        .join(","),
    );

  // GSTIN on a branch record that is not this PAN's — kept as-is (never
  // overwritten) but flagged for accounts to correct.
  const gstNote = (row, pan) =>
    plan.up(row.gstNumber) && !gstOfPan(row.gstNumber, pan)
      ? "GSTIN does not belong to this PAN — correct it on the branch vendor"
      : "";

  for (const { p, existing } of plans) {
    if (p.mode === "CREATE") createCount++;
    else if (p.mode === "USE_EXISTING") existingCount++;
    else skipCount++;
    linkRows += p.link.length;
    keepRows += p.keep.length;

    const masterLabel =
      p.mode === "USE_EXISTING"
        ? `existing ${idOf(existing)}`
        : p.mode === "CREATE"
          ? "new"
          : "";
    let goldenNote = "";
    if (p.mode === "CREATE") {
      const have = new Set(
        p.documents.filter((d) => files.size(d.key) != null).map((d) => d.type),
      );
      const missingReq = plan
        .requiredDocs(p.golden)
        .filter((t) => !have.has(t));
      if (missingReq.length)
        goldenNote = `master will lack: ${missingReq.map((t) => DOC_LABEL[t] || t).join(", ")}`;
      if (plan.up(p.golden.gstNumber) && !gstOfPan(p.golden.gstNumber, p.pan))
        goldenNote = [
          goldenNote,
          "primary GSTIN left blank (seed GSTIN invalid)",
        ]
          .filter(Boolean)
          .join("; ");
      for (const d of p.documents) {
        const s = files.size(d.key);
        if (s == null) missingFiles++;
        else {
          copyFiles++;
          copyBytes += s;
        }
      }
    }
    for (const r of p.link) {
      for (const d of r.documents || []) reclaimBytes += files.size(d.key) || 0;
      const isGolden = p.golden && idOf(r) === idOf(p.golden);
      line(p.pan, isGolden ? "MASTER_SOURCE" : "LINK", "", r, {
        overwrites: p.overwrites.get(idOf(r)) || [],
        master: masterLabel,
        notes: [isGolden ? goldenNote : "", gstNote(r, p.pan)]
          .filter(Boolean)
          .join("; "),
      });
    }
    for (const k of p.keep) {
      reasons[k.reason] = (reasons[k.reason] || 0) + 1;
      line(p.pan, "KEEP_BRANCH_LEVEL", k.reason, k.row, {
        fields: k.fields,
        master: masterLabel,
        notes: gstNote(k.row, p.pan),
      });
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, `vendor-master-report-${stamp}.csv`);
  fs.writeFileSync(reportPath, csv.join("\n") + "\n");

  const pad = (s, n) => String(s).padEnd(n);
  log("");
  log(
    `${apply ? "APPLY" : "DRY RUN"}${onlyPan ? `  (ONLY_PAN=${onlyPan})` : ""}`,
  );
  log(
    `Candidate vendors (approved, active, PAN, not yet linked): ${rows.length}`,
  );
  log(`PAN groups: ${pans.length}`);
  log(`  ${pad("New masters", 30)}: ${createCount}`);
  log(`  ${pad("Existing masters reused", 30)}: ${existingCount}`);
  log(`  ${pad("Groups skipped entirely", 30)}: ${skipCount}`);
  log(`Branch vendors to link        : ${linkRows}`);
  log(`Branch vendors kept as-is     : ${keepRows}`);
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1]))
    log(`  ${pad(r, 30)}: ${n}`);
  log(`Documents to copy to masters  : ${copyFiles} file(s), ${MB(copyBytes)}`);
  if (missingFiles) log(`  missing on disk (skipped)    : ${missingFiles}`);
  log(
    `Reclaimable after Phase 6     : ${MB(reclaimBytes)} (net ${MB(Math.max(0, reclaimBytes - copyBytes))})`,
  );
  log(`Report: ${reportPath}`);

  const summary = {
    candidates: rows.length,
    groups: pans.length,
    createCount,
    existingCount,
    skipCount,
    linkRows,
    keepRows,
    reasons,
    copyFiles,
    copyBytes,
    missingFiles,
    reclaimBytes,
    reportPath,
    applied: { mastersCreated: 0, rowsLinked: 0, failures: [] },
  };

  if (!apply) {
    log(
      "DRY RUN — nothing written. Review the report, then re-run with --apply.",
    );
    return summary;
  }

  // ── Apply ─────────────────────────────────────────────────
  const journalPath = path.join(outDir, `vendor-master-journal-${stamp}.json`);
  const journal = { startedAt: now.toISOString(), actorId, owned, entries: [] };
  const flush = () =>
    fs.writeFileSync(journalPath, JSON.stringify(journal, null, 1));
  if (fs.existsSync(journalPath))
    throw new Error(`Refusing to overwrite ${journalPath}`);
  flush();
  log(`Journal (keep this — it is what ROLLBACK uses): ${journalPath}`);

  for (const { p, masterData, existing } of plans) {
    if (p.mode !== "CREATE" && p.mode !== "USE_EXISTING") continue;
    let entry;
    let master;
    try {
      if (p.mode === "CREATE") {
        const masterId = String(dal.newId());
        const copied = [];
        for (const d of p.documents) {
          const c = files.copy(d, masterId, now);
          if (c) copied.push(c);
        }
        entry = {
          type: "CREATE",
          masterId,
          pan: p.pan,
          copiedKeys: copied.map((c) => c.key),
          rows: [],
          at: new Date().toISOString(),
        };
        journal.entries.push(entry);
        flush(); // written BEFORE the insert, so a crash still leaves a trace
        master = { ...masterData, _id: masterId, documents: copied };
        try {
          await dal.createMaster(master);
        } catch (e) {
          copied.forEach((c) => files.remove(c.key));
          entry.failed = e.message;
          flush();
          summary.applied.failures.push({ pan: p.pan, error: e.message });
          log(`  FAILED  ${p.pan}  create master: ${e.message}`);
          continue;
        }
        summary.applied.mastersCreated++;
        await audit({
          userId: actorId,
          action: "CREATE_VENDOR_MASTER",
          module: "VendorMaster",
          targetId: masterId,
          targetLabel: master.vendorName,
          statusTo: "approved",
          reason: `Backfill: built from branch vendor ${idOf(p.golden)} (${p.link.length} branch link(s))`,
        });
      } else {
        master = existing;
        entry = {
          type: "LINK_EXISTING",
          masterId: idOf(existing),
          pan: p.pan,
          rows: [],
          at: new Date().toISOString(),
        };
        journal.entries.push(entry);
        flush();
      }

      // What the master's payment details were when rows were linked — the
      // rollback refuses if they have been changed since.
      entry.paymentSnapshot = pickOwned(master, PAYMENT_FIELDS);
      const set = {
        ...pickOwned(master, owned),
        vendorMaster: entry.masterId,
        sourceOfTruth: "master",
      };

      for (const r of p.link) {
        const before = {
          ...pickOwned(r, owned),
          vendorMaster: null,
          sourceOfTruth: r.sourceOfTruth || "local",
        };
        let ok = false;
        try {
          ok = await dal.linkRow(r._id, set);
        } catch (e) {
          summary.applied.failures.push({
            pan: p.pan,
            vendorId: idOf(r),
            error: e.message,
          });
          log(`  FAILED  ${p.pan}  link ${idOf(r)}: ${e.message}`);
          continue;
        }
        if (!ok) {
          summary.applied.failures.push({
            pan: p.pan,
            vendorId: idOf(r),
            error: "row changed since planning (already linked?)",
          });
          continue;
        }
        entry.rows.push({ vendorId: idOf(r), before });
        flush();
        summary.applied.rowsLinked++;
        const over = p.overwrites.get(idOf(r)) || [];
        await audit({
          userId: actorId,
          action: "ATTACH_VENDOR_TO_MASTER",
          module: "Vendor",
          targetId: r._id,
          targetLabel: r.vendorName,
          branch: r.branch,
          reason: `Backfill: linked to vendor master ${master.vendorName} (PAN ${p.pan}). Payment details unchanged.`,
          oldValue: Object.fromEntries(over.map((f) => [f, before[f]])),
          newValue: Object.fromEntries(over.map((f) => [f, set[f]])),
        });
      }
      await dal.recount(entry.masterId);
      log(
        `  ${p.mode === "CREATE" ? "created" : "reused "}  ${p.pan}  ${String(master.vendorName).slice(0, 32).padEnd(32)} linked ${entry.rows.length}`,
      );
    } catch (e) {
      if (entry) entry.error = e.message;
      flush();
      summary.applied.failures.push({ pan: p.pan, error: e.message });
      log(`  FAILED  ${p.pan}: ${e.message}`);
    }
  }
  journal.finishedAt = new Date().toISOString();
  flush();

  log("");
  log(`Masters created : ${summary.applied.mastersCreated}`);
  log(`Rows linked     : ${summary.applied.rowsLinked}`);
  log(
    `Failures        : ${summary.applied.failures.length}${summary.applied.failures.length ? " — see above; re-running is safe" : ""}`,
  );
  log("Next: node src/scripts/createVendorMasterIndexes.js");
  summary.journalPath = journalPath;
  return summary;
}

// ════════════════════════════════════════════════════════════
// ROLLBACK — undo one --apply run, using its journal
// ════════════════════════════════════════════════════════════
async function runRollback(opts, deps) {
  const { journalPath, apply = false, actorId = null } = opts;
  const { dal, fs, audit = async () => {}, log = console.log } = deps;
  const files = makeFileOps({
    fs,
    uploadBase: deps.uploadBase,
    getFileUrl: deps.getFileUrl,
    folder: VENDOR_MASTER.documentFolder || "vendor-masters",
  });
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const result = { restoredRows: 0, deletedMasters: 0, refused: [] };

  log(`${apply ? "ROLLBACK" : "ROLLBACK DRY RUN"} — journal ${journalPath}`);

  for (const entry of [...journal.entries].reverse()) {
    if (entry.failed) continue; // already compensated at the time
    const refuse = (why) => {
      result.refused.push({ pan: entry.pan, masterId: entry.masterId, why });
      log(`  REFUSED ${entry.pan}: ${why}`);
    };
    const master = await dal.findMaster(entry.masterId);

    if (entry.type === "CREATE" && master && !master.createdByScript) {
      refuse("master is not marked createdByScript");
      continue;
    }
    // Bank details changed since the backfill? Restoring the rows' old
    // values would send payments back to an account accounts replaced.
    if (master && entry.paymentSnapshot) {
      const changed = PAYMENT_FIELDS.filter(
        (f) =>
          String(master[f] ?? "") !== String(entry.paymentSnapshot[f] ?? ""),
      );
      if (changed.length) {
        refuse(
          `master payment details changed since the backfill (${changed.join(", ")}) — undo by hand`,
        );
        continue;
      }
    }
    if (entry.type === "CREATE" && master) {
      const current = (await dal.rowsOfMaster(entry.masterId)).map(String);
      const mine = new Set(entry.rows.map((r) => r.vendorId));
      const extra = current.filter((id) => !mine.has(id));
      if (extra.length) {
        refuse(
          `${extra.length} branch vendor(s) were linked to this master after the backfill`,
        );
        continue;
      }
    }

    if (!apply) {
      log(
        `  would restore ${entry.rows.length} row(s)${entry.type === "CREATE" ? " and delete master" : ""}  ${entry.pan}`,
      );
      continue;
    }
    for (const r of entry.rows) {
      const ok = await dal.restoreRow(r.vendorId, entry.masterId, r.before);
      if (ok) {
        result.restoredRows++;
        await audit({
          userId: actorId,
          action: "ROLLBACK_VENDOR_MASTER_BACKFILL",
          module: "Vendor",
          targetId: r.vendorId,
          reason: `Backfill rolled back (PAN ${entry.pan})`,
        });
      }
    }
    if (entry.type === "CREATE" && master) {
      await dal.deleteMaster(entry.masterId);
      (entry.copiedKeys || []).forEach((k) => files.remove(k));
      result.deletedMasters++;
      await audit({
        userId: actorId,
        action: "ROLLBACK_VENDOR_MASTER_BACKFILL",
        module: "VendorMaster",
        targetId: entry.masterId,
        targetLabel: entry.pan,
        reason: "Backfill rolled back",
      });
    } else if (master) {
      await dal.recount(entry.masterId);
    }
    log(`  rolled back ${entry.pan}`);
  }
  log(
    `Restored rows: ${result.restoredRows}  Deleted masters: ${result.deletedMasters}  Refused: ${result.refused.length}`,
  );
  return result;
}

module.exports = { runBackfill, runRollback, buildMasterData };
