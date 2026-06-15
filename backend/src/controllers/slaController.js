const SLAConfig = require("../models/SLAConfig");
const SLATracking = require("../models/SLATracking");
const InvoiceRequest = require("../models/InvoiceRequest");
const { getSLAStatus, runSLAChecks } = require("../services/slaService");
const { logAction } = require("../services/auditService");

exports.getSLAConfigs = async (req, res) => {
  try {
    const configs = await SLAConfig.find().sort({ stage: 1 });
    res.json(configs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.upsertSLAConfig = async (req, res) => {
  try {
    const { stage } = req.body;
    const config = await SLAConfig.findOneAndUpdate({ stage }, req.body, {
      upsert: true,
      new: true,
      runValidators: true,
    });
    await logAction({
      userId: req.user._id,
      action: "UPDATE_SLA_CONFIG",
      module: "SLA",
      targetId: config._id,
      req,
    });
    res.json(config);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getSLADashboard = async (req, res) => {
  try {
    const { status } = req.query;
    const role = req.user.role;

    const query = status
      ? { status }
      : { status: { $in: ["on_track", "at_risk", "breached"] } };

    // ✅ Accounts only sees their stage (Submitted invoices)
    if (role === "accounts") {
      query.stage = { $in: ["accounts"] };
    } else if (role === "branch_partner") {
      query.stage = "partner";
    } else if (role === "cluster_head") {
      query.stage = "cluster_head";
    }
    // super_admin sees all stages

    // ✅ NEW: branch scoping — accounts only sees SLA records for
    //    invoices belonging to their assigned branches.
    if (role === "accounts") {
      const branchIds = req.user.branches.map((b) => b._id);
      const invoiceIds = await InvoiceRequest.distinct("_id", {
        branch: { $in: branchIds },
      });
      query.paymentRequest = { $in: invoiceIds }; // SLATracking.paymentRequest → InvoiceRequest._id
    }

    const trackings = await SLATracking.find(query)
      .populate({
        path: "paymentRequest",
        model: "InvoiceRequest",
        populate: [
          { path: "branch", select: "name code" },
          { path: "createdBy", select: "name email" },
          { path: "vendor", select: "vendorName" },
        ],
        select:
          "requestId status priority netPayable invoiceNumber branch createdBy vendor",
      })
      .sort({ deadlineAt: 1 })
      .limit(200);

    // Filter out null paymentRequest (deleted invoices)
    const validTrackings = trackings.filter((t) => t.paymentRequest);

    const stats = {
      on_track: validTrackings.filter((t) => t.status === "on_track").length,
      at_risk: validTrackings.filter((t) => t.status === "at_risk").length,
      breached: validTrackings.filter((t) => t.status === "breached").length,
    };

    res.json({ trackings: validTrackings, stats });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getInvoiceSLAStatus = async (req, res) => {
  try {
    const invoice = await InvoiceRequest.findById(req.params.invoiceId).select(
      "branch",
    );
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    // ✅ Branch access guard — branch-scoped roles can only view SLA
    //    status for invoices in their assigned branches.
    const branchScopedRoles = ["branch_user", "branch_partner", "accounts"];
    if (branchScopedRoles.includes(req.user.role)) {
      const allowed = req.user.branches.map((b) => b._id.toString());
      const invoiceBranch = (invoice.branch?._id || invoice.branch)?.toString();
      if (!allowed.includes(invoiceBranch)) {
        return res
          .status(403)
          .json({ message: "You do not have access to this invoice" });
      }
    }

    const slaStatus = await getSLAStatus(req.params.invoiceId);
    res.json(slaStatus);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.triggerSLACheck = async (req, res) => {
  try {
    await runSLAChecks();
    res.json({ message: "SLA check completed successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
