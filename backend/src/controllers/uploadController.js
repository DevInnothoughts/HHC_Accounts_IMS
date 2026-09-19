// ============================================================
// BACKEND: src/controllers/uploadController.js  —  REPLACE WHOLE FILE
// ------------------------------------------------------------
// Vendor Master, Phase 2:
//  • uploadVendorDocument / deleteVendorDocument refuse master-owned
//    branch vendors, and now check the caller's branch access
//  • deleteVendorDocument now writes an audit entry (it never did)
//  • NEW uploadVendorMasterDocument / deleteVendorMasterDocument
// Invoice attachment and cheque-parsing handlers are unchanged.
// ============================================================
const path = require("path");
const fs = require("fs");
const vision = require("@google-cloud/vision");
const {
  uploadFile,
  deleteFile,
  validateFile,
} = require("../services/linodeStorageService");
const { logAction } = require("../services/auditService");
const InvoiceRequest = require("../models/InvoiceRequest");
const Vendor = require("../models/Vendor");
const VendorMaster = require("../models/VendorMaster");
const { VENDOR_MASTER } = require("../config/constants");
const access = require("../utils/vendorAccess");
const {
  ALLOWED_DOC_TYPES,
  requiredDocsFor,
} = require("../services/vendorMasterService");

// ✅ Load Google Vision credentials
let visionClient = null;
const CRED_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (CRED_PATH && fs.existsSync(CRED_PATH)) {
  try {
    const credentials = JSON.parse(fs.readFileSync(CRED_PATH, "utf8"));
    visionClient = new vision.ImageAnnotatorClient({ credentials });
  } catch (err) {
    visionClient = null;
  }
} else {
  console.error("[Vision] Credentials file not found — Vision API disabled");
}

// ── Invoice / Payment Attachment ──────────────────────────
exports.uploadPaymentAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    const docType = req.body.docType || "other";

    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const errs = validateFile(req.file);
    if (errs.length) return res.status(400).json({ message: errs.join(", ") });

    // ✅ Support InvoiceRequest model
    const invoice = await InvoiceRequest.findById(id);
    if (!invoice)
      return res.status(404).json({ message: "Invoice request not found" });

    const { key, url, fileName } = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      `invoices/${id}/attachments`,
    );

    const attachment = {
      name: fileName,
      url,
      key,
      type: docType,
      uploadedAt: new Date(),
    };
    invoice.attachments.push(attachment);
    await invoice.save();

    await logAction({
      userId: req.user._id,
      action: "UPLOAD_INVOICE_ATTACHMENT",
      module: "Invoice",
      targetId: invoice._id,
      req,
    });
    res.json({
      message: "File uploaded successfully",
      attachment: invoice.attachments[invoice.attachments.length - 1],
    });
  } catch (err) {
    console.error("Invoice attachment upload error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.deletePaymentAttachment = async (req, res) => {
  try {
    const { id, attachmentId } = req.params;

    const invoice = await InvoiceRequest.findById(id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const attachment = invoice.attachments.id(attachmentId);
    if (!attachment)
      return res.status(404).json({ message: "Attachment not found" });

    if (attachment.key) await deleteFile(attachment.key).catch(console.warn);
    invoice.attachments.pull(attachmentId);
    await invoice.save();

    res.json({ message: "Attachment deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Vendor Document (branch-level records) ────────────────
// Master-owned branch vendors hold NO files: their KYC documents live once
// on the Vendor Master. Uploading or deleting here for such a row would
// either re-create the duplication the master exists to remove, or delete
// a file other branches depend on — so both are refused.
exports.uploadVendorDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const docType = req.body.docType || "other";

    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const errs = validateFile(req.file, { maxSizeMB: 5 });
    if (errs.length) return res.status(400).json({ message: errs.join(", ") });

    const vendor = await Vendor.findById(id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (!access.canAccessVendor(req, vendor))
      return res
        .status(403)
        .json({ message: "You do not have access to this vendor" });
    if (vendor.isMasterOwned()) {
      return res.status(409).json({
        code: "MASTER_OWNED",
        masterId: vendor.vendorMaster,
        message:
          "This vendor's documents are held in the Vendor Master. Upload them there.",
      });
    }

    const { key, url, fileName } = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      `vendors/${id}/documents`,
    );

    // Replace existing doc of same type or push new
    const existingIdx = vendor.documents.findIndex((d) => d.type === docType);
    const doc = {
      name: fileName,
      url,
      key,
      type: docType,
      uploadedAt: new Date(),
    };

    if (existingIdx > -1) {
      if (vendor.documents[existingIdx].key) {
        await deleteFile(vendor.documents[existingIdx].key).catch(console.warn);
      }
      vendor.documents[existingIdx] = doc;
    } else {
      vendor.documents.push(doc);
    }

    await vendor.save();

    // If vendor was rejected, reset to pending approval after document update
    if (vendor.approvalStatus === "rejected") {
      vendor.approvalStatus = "pending_approval";
      vendor.rejectionReason = null;
      vendor.rejectedBy = null;
      vendor.rejectedAt = null;
      await vendor.save();
    }

    await logAction({
      userId: req.user._id,
      action: "UPLOAD_VENDOR_DOCUMENT",
      module: "Vendor",
      targetDoc: vendor,
      newValue: { docType, name: fileName },
      req,
    });
    res.json({ message: "Document uploaded successfully", document: doc });
  } catch (err) {
    console.error("Vendor document upload error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.deleteVendorDocument = async (req, res) => {
  try {
    const { id, docType } = req.params;

    const vendor = await Vendor.findById(id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (!access.canAccessVendor(req, vendor))
      return res
        .status(403)
        .json({ message: "You do not have access to this vendor" });
    if (vendor.isMasterOwned()) {
      return res.status(409).json({
        code: "MASTER_OWNED",
        masterId: vendor.vendorMaster,
        message:
          "This vendor's documents are held in the Vendor Master and can only be changed there.",
      });
    }

    const doc = vendor.documents.find((d) => d.type === docType);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    if (doc.key) await deleteFile(doc.key).catch(console.warn);
    vendor.documents = vendor.documents.filter((d) => d.type !== docType);
    await vendor.save();

    // ✅ Was missing — document deletions left no audit trail.
    await logAction({
      userId: req.user._id,
      action: "DELETE_VENDOR_DOCUMENT",
      module: "Vendor",
      targetDoc: vendor,
      oldValue: { docType, name: doc.name },
      req,
    });

    res.json({ message: "Document deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Vendor Master Document ────────────────────────────────
// Stored once for the whole group under uploads/vendor-masters/<id>/.
// Who may change them:
//   • accounts / super_admin — always
//   • the user who registered the PAN — only while the master is draft
//     or rejected, so they can complete or correct their own submission
const canEditMasterDocs = (req, master) =>
  access.isMasterAdmin(req) ||
  (access.isSameUser(master.createdBy, req.user._id) &&
    ["draft", "rejected"].includes(master.approvalStatus));

exports.uploadVendorMasterDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const docType = req.body.docType || "other";

    if (!ALLOWED_DOC_TYPES.includes(docType))
      return res.status(400).json({ message: "Invalid document type" });
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const errs = validateFile(req.file, { maxSizeMB: 5 });
    if (errs.length) return res.status(400).json({ message: errs.join(", ") });

    const master = await VendorMaster.findById(id);
    if (!master)
      return res.status(404).json({ message: "Vendor master not found" });
    if (!canEditMasterDocs(req, master)) {
      return res.status(403).json({
        message:
          master.approvalStatus === "pending_approval" ||
          master.approvalStatus === "approved"
            ? "Documents of a submitted vendor master can only be changed by the accounts team."
            : "Not authorized to upload documents for this vendor master",
      });
    }

    const { key, url, fileName } = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      `${VENDOR_MASTER.documentFolder}/${id}/documents`,
    );

    const doc = {
      name: fileName,
      url,
      key,
      type: docType,
      uploadedAt: new Date(),
    };

    // One document per type (same rule as branch vendors). "other" may be
    // replaced like any type — upload an agreement as "agreement".
    const existingIdx = master.documents.findIndex((d) => d.type === docType);
    let replaced = null;
    if (existingIdx > -1) {
      replaced = master.documents[existingIdx];
      master.documents[existingIdx] = doc;
    } else {
      master.documents.push(doc);
    }
    await master.save();

    // Delete the old file only after the new reference is saved, so a
    // failed save never leaves the master pointing at a deleted file.
    if (replaced?.key) await deleteFile(replaced.key).catch(console.warn);

    await logAction({
      userId: req.user._id,
      action: "UPLOAD_VENDOR_MASTER_DOCUMENT",
      module: "VendorMaster",
      targetDoc: master,
      newValue: { docType, name: fileName, replaced: Boolean(replaced) },
      req,
    });

    res.json({
      message: "Document uploaded successfully",
      document: master.documents.find((d) => d.type === docType),
    });
  } catch (err) {
    console.error("Vendor master document upload error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.deleteVendorMasterDocument = async (req, res) => {
  try {
    const { id, docType } = req.params;

    const master = await VendorMaster.findById(id);
    if (!master)
      return res.status(404).json({ message: "Vendor master not found" });
    if (!canEditMasterDocs(req, master))
      return res.status(403).json({
        message:
          "Documents of a submitted vendor master can only be changed by the accounts team.",
      });

    const doc = master.documents.find((d) => d.type === docType);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    // An approved master must never lose a mandatory KYC document —
    // every branch that uses it depends on it. Replace, don't delete.
    if (
      master.approvalStatus === "approved" &&
      requiredDocsFor(master).includes(docType)
    ) {
      return res.status(400).json({
        message:
          "This is a required document for an approved vendor. Use Replace to upload a new copy instead of deleting it.",
      });
    }

    master.documents = master.documents.filter((d) => d.type !== docType);
    await master.save();
    if (doc.key) await deleteFile(doc.key).catch(console.warn);

    await logAction({
      userId: req.user._id,
      action: "DELETE_VENDOR_MASTER_DOCUMENT",
      module: "VendorMaster",
      targetDoc: master,
      oldValue: { docType, name: doc.name },
      req,
    });

    res.json({ message: "Document deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/ai/parse-cheque
// Body: multipart — file (cheque image)
exports.parseCheque = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    if (!visionClient) {
      return res.status(500).json({
        message: "Vision API not configured. Please check credentials.",
      });
    }

    const [result] = await visionClient.textDetection({
      image: { content: req.file.buffer.toString("base64") },
    });

    const text = result.textAnnotations?.[0]?.description || "";

    // Extract bank details from raw text using regex
    const ifscMatch = text.match(/[A-Z]{4}0[A-Z0-9]{6}/);
    const accountMatch = text.match(/\b\d{9,18}\b/);
    const micrMatch = text.match(/\b\d{9}\b/);

    if (!ifscMatch && !accountMatch) {
      return res.status(422).json({
        message: "Could not read cheque clearly. Please fill manually.",
      });
    }

    // Extract bank name from first few lines
    const lines = text.split("\n").filter((l) => l.trim());
    const bankName =
      lines.find((l) => /bank|finance|credit|cooperative/i.test(l)) || "";

    const accountHolderName = lines[0] || "";

    res.json({
      success: true,
      bankDetails: {
        accountHolderName: accountHolderName.trim(),
        bankName: bankName.trim(),
        accountNumber: accountMatch?.[0] || "",
        ifscCode: ifscMatch?.[0] || "",
        micrCode: micrMatch?.[0] || "",
      },
    });
  } catch (err) {
    console.error("Cheque parse error:", err);
    res.status(500).json({ message: err.message });
  }
};
