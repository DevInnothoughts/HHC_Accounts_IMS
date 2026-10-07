// ============================================================
// BACKEND: src/services/paymentDocumentService.js — NEW FILE
// ------------------------------------------------------------
// Collects the invoice attachments behind one or more payments and
// gives each a readable download name:
//
//     Branch_Name-Remark.ext   (Remark already holds the invoice no.)
//
// "Remark" is the exact string written to the Credit / Debit Remarks
// columns of the FedOne sheet (buildBankRemark), so a file can be
// matched to its bank line by eye. Characters Windows / macOS do not
// allow in file names are replaced; the " / " separator in the remark
// becomes "_".
//
// Read-only: nothing on the payment or invoice is modified.
// ============================================================
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { UPLOAD_BASE } = require("./linodeStorageService");
const { buildBankRemark } = require("./fedOneExcelService");

const MAX_BASE_NAME = 150; // keeps full paths well under Windows' 260-char limit
const UPLOAD_ROOT = path.resolve(UPLOAD_BASE);

// Optional. When this backend's uploads/ folder does not hold the files —
// e.g. running locally against the live database — set
//   FILES_SOURCE_URL=https://<production backend host>
// in backend/.env and files are fetched from <that>/files/<key>.
// Leave it unset on the production server itself.
const FILES_SOURCE_URL = (process.env.FILES_SOURCE_URL || "")
  .trim()
  .replace(/\/+$/, "");

// File-name-safe text: no path separators, no reserved characters.
const safePart = (value) =>
  String(value ?? "")
    .replace(/\s*[\\/]\s*/g, "_") // "Category / INV-12" -> "Category_INV-12"
    .replace(/[:*?"<>|\x00-\x1f]/g, "") // Windows-reserved + control chars
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, ""); // no leading/trailing dots or spaces

// "Branch_Name-Remark". The FedOne remark is "Category / Invoice No" and
// always keeps the invoice number whole, so it is not repeated separately.
// (Empty parts are dropped, not left as "--".)
const buildDocumentBaseName = (payment) => {
  const invoice = payment.invoiceRequest;
  const branch = payment.branch || invoice?.branch;
  const parts = [
    safePart(branch?.name || branch?.code),
    safePart(buildBankRemark(invoice, payment.paymentId)), // same args as the FedOne sheet
  ].filter(Boolean);
  const base = parts.join("-") || safePart(payment.paymentId) || "document";
  return base.slice(0, MAX_BASE_NAME).trim();
};

// Attachments store `key` (path under uploads/). Older records may only
// carry the public URL — recover the key from ".../files/<key>".
const keyOf = (att) => {
  if (att?.key) return String(att.key);
  const url = String(att?.url || "");
  const idx = url.indexOf("/files/");
  if (idx === -1) return null;
  try {
    return decodeURIComponent(
      url.slice(idx + "/files/".length).split(/[?#]/)[0],
    );
  } catch {
    return null;
  }
};

// Absolute path on disk, or null if the key would escape uploads/.
const resolveDiskPath = (key) => {
  if (!key) return null;
  const abs = path.resolve(UPLOAD_ROOT, key);
  return abs.startsWith(UPLOAD_ROOT + path.sep) ? abs : null;
};

const extensionOf = (att, key) =>
  (path.extname(att?.name || "") || path.extname(key || "") || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "");

/**
 * Build the download list for a set of populated payments.
 * Each payment needs: paymentId, branch{name,code},
 * invoiceRequest{_id, requestId, invoiceNumber, attachments, expenseCategory{name,code}}
 *
 * Returns { files: [{ name, absPath, url, paymentId, invoiceNumber, attachment }],
 *           missing: [...] }
 * Nothing is read here — loadDocument() reads each file when it is sent,
 * from local disk if present, else from its stored URL.
 * `missing` = attachments with neither a usable path nor a URL.
 */
const collectPaymentDocuments = (payments) => {
  const files = [];
  const missing = [];
  const usedNames = new Set(); // case-insensitive: Windows treats A.pdf == a.pdf
  const seenInvoices = new Set();

  const uniqueName = (base, ext) => {
    let name = `${base}${ext}`;
    let n = 2;
    while (usedNames.has(name.toLowerCase())) name = `${base} (${n++})${ext}`;
    usedNames.add(name.toLowerCase());
    return name;
  };

  for (const payment of payments) {
    const invoice = payment.invoiceRequest;
    if (!invoice) continue;

    // Two payment rows on the same invoice would otherwise duplicate files.
    const invoiceKey = String(invoice._id || invoice.requestId);
    if (seenInvoices.has(invoiceKey)) continue;
    seenInvoices.add(invoiceKey);

    const attachments = (invoice.attachments || []).filter(Boolean);
    const base = buildDocumentBaseName(payment);
    const numbered = attachments.length > 1;

    attachments.forEach((att, i) => {
      const key = keyOf(att);
      const absPath = resolveDiskPath(key);
      const url = /^https?:\/\//i.test(att.url || "") ? att.url : null;
      const remoteUrl =
        key && FILES_SOURCE_URL
          ? `${FILES_SOURCE_URL}/files/${key.split("/").map(encodeURIComponent).join("/")}`
          : null;
      const label = {
        paymentId: payment.paymentId,
        invoiceNumber: invoice.invoiceNumber,
        attachment: att.name || key || "(unnamed)",
      };
      if (!absPath && !url && !remoteUrl) {
        missing.push(label);
        return;
      }
      const stem = numbered ? `${base}_${i + 1}` : base;
      files.push({
        ...label,
        name: uniqueName(stem, extensionOf(att, key || url)),
        absPath,
        url,
        remoteUrl,
      });
    });
  }

  return { files, missing };
};

// ── Reading a document ─────────────────────────────────────
// 1) local uploads/ folder (same server that received the upload)
// 2) the attachment's stored URL — the same link the invoice page opens.
//    Needed when this server's uploads/ does not hold the file, e.g. a
//    local/staging backend pointed at the live database, or files that
//    live on another host.
const MAX_REMOTE_BYTES = 25 * 1024 * 1024;
const REMOTE_TIMEOUT_MS = 20000;

const fetchBuffer = (url, redirectsLeft = 3) =>
  new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, { timeout: REMOTE_TIMEOUT_MS }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error("Too many redirects"));
        const next = new URL(headers.location, url).toString();
        if (!/^https?:/i.test(next)) return reject(new Error("Bad redirect"));
        return resolve(fetchBuffer(next, redirectsLeft - 1));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode}`));
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_REMOTE_BYTES) {
          req.destroy(new Error("File too large"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
  });

/**
 * Returns a Buffer, or null if the file cannot be read.
 * Order: this server's disk → FILES_SOURCE_URL + key → stored URL.
 */
const loadDocument = async (file) => {
  if (file.absPath) {
    try {
      return await fs.promises.readFile(file.absPath);
    } catch {
      /* not on this server's disk — try the URLs */
    }
  }
  // Dedupe: the stored URL is often identical to the source-built one.
  const urls = [...new Set([file.remoteUrl, file.url].filter(Boolean))];
  for (const u of urls) {
    try {
      return await fetchBuffer(u);
    } catch {
      /* try the next one */
    }
  }
  return null;
};

// "YYYY-MM-DD" in IST — the server may run in UTC, the team does not.
const istDateStamp = (date = new Date()) =>
  new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);

// Plain-text note added to a ZIP when some attachments could not be found.
const missingFilesNote = (missing) =>
  [
    "The following attachments are recorded on the invoice but the file",
    "was not found on the server, so they are NOT in this download:",
    "",
    ...missing.map(
      (m) =>
        `- ${m.paymentId} | Invoice ${m.invoiceNumber || "—"} | ${m.attachment}`,
    ),
    "",
  ].join("\r\n");

// RFC 6266 Content-Disposition: ASCII fallback + UTF-8 filename*.
const contentDisposition = (fileName) => {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

module.exports = {
  collectPaymentDocuments,
  loadDocument,
  buildDocumentBaseName,
  istDateStamp,
  missingFilesNote,
  contentDisposition,
  MIME_BY_EXT,
};
