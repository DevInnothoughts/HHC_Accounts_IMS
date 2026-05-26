const path = require("path");
const {
  uploadFile,
  deleteFile,
  validateFile,
} = require("../services/linodeStorageService");
const { logAction } = require("../services/auditService");
const InvoiceRequest = require("../models/InvoiceRequest");
const Vendor = require("../models/Vendor");

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

// ── Vendor Document ────────────────────────────────────────
exports.uploadVendorDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const docType = req.body.docType || "other";

    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const errs = validateFile(req.file, { maxSizeMB: 5 });
    if (errs.length) return res.status(400).json({ message: errs.join(", ") });

    const vendor = await Vendor.findById(id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

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
      targetId: vendor._id,
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

    const doc = vendor.documents.find((d) => d.type === docType);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    if (doc.key) await deleteFile(doc.key).catch(console.warn);
    vendor.documents = vendor.documents.filter((d) => d.type !== docType);
    await vendor.save();

    res.json({ message: "Document deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
