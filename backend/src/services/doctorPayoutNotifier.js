// ============================================================
// BACKEND: src/services/doctorPayoutNotifier.js — NEW FILE
// ------------------------------------------------------------
// E-mails for the doctor payout flow. Every function here is best-effort:
// it never throws, and callers do not wait for it, so a slow or dead SMTP
// server can never hold up or fail an upload / approval.
//
// Only ACTIVE users are mailed (deactivated users must not keep receiving
// payment mail), and nothing is ever sent to the doctors themselves.
// ============================================================
const User = require("../models/User");
const { ROLES } = require("../config/constants");
const { sendNotificationEmail } = require("./emailService");

const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );

const safely = (label, fn) =>
  Promise.resolve()
    .then(fn)
    .catch((err) =>
      console.error(`[DoctorPayout mail] ${label}:`, err.message),
    );

// New batch → the Cluster / Department Heads of the branches in it.
// perBranch: [{ branchId, name, rows, payable }]
const notifyApprovers = (batch, perBranch, uploader) =>
  safely("approvers", async () => {
    const branchIds = perBranch.map((b) => b.branchId);
    if (!branchIds.length) return;
    const heads = await User.find({
      role: ROLES.CLUSTER_HEAD,
      status: "active",
      branches: { $in: branchIds },
    })
      .select("name email branches")
      .lean();

    for (const head of heads) {
      const mine = perBranch.filter((b) =>
        (head.branches || []).some((id) => String(id) === String(b.branchId)),
      );
      if (!mine.length || !head.email) continue;
      const rows = mine.reduce((s, b) => s + b.rows, 0);
      const total = mine.reduce((s, b) => s + b.payable, 0);
      await sendNotificationEmail(
        head.email,
        `Doctor payouts awaiting your approval: ${batch.batchId}`,
        `<p>Dear ${esc(head.name || "Sir / Madam")},</p>
         <p>${esc(uploader?.name || "Accounts")} has uploaded doctor payouts
         (<strong>${esc(batch.batchId)}</strong>) for your approval.</p>
         <table style="border-collapse:collapse;font-size:14px;">
           <tr><th align="left" style="padding:4px 14px 4px 0;">Branch</th>
               <th align="right" style="padding:4px 14px;">Records</th>
               <th align="right" style="padding:4px 0;">Payable</th></tr>
           ${mine
             .map(
               (
                 b,
               ) => `<tr><td style="padding:4px 14px 4px 0;">${esc(b.name)}</td>
                 <td align="right" style="padding:4px 14px;">${b.rows}</td>
                 <td align="right" style="padding:4px 0;">${inr(b.payable)}</td></tr>`,
             )
             .join("")}
           <tr><td style="padding:6px 14px 4px 0;"><strong>Total</strong></td>
               <td align="right" style="padding:6px 14px;"><strong>${rows}</strong></td>
               <td align="right" style="padding:6px 0;"><strong>${inr(total)}</strong></td></tr>
         </table>
         <p>Please review them in PMS under <strong>Doctor Payouts</strong>.
         New doctors and changed bank details are highlighted there.</p>`,
      );
    }
  });

// Approval / rejection → the Accounts user who uploaded the batch.
const notifyUploader = (batch, { action, rows, amount, by, reason }) =>
  safely("uploader", async () => {
    const uploader = await User.findById(batch.uploadedBy)
      .select("name email status")
      .lean();
    if (!uploader?.email || uploader.status !== "active") return;
    const approved = action === "approved";
    await sendNotificationEmail(
      uploader.email,
      `${approved ? "✅ Approved" : "❌ Rejected"}: ${rows} doctor payout record${rows === 1 ? "" : "s"} in ${batch.batchId}`,
      `<p>${esc(by?.name || "The approver")} has <strong>${approved ? "approved" : "rejected"}</strong>
       ${rows} record${rows === 1 ? "" : "s"} (${inr(amount)}) of batch
       <strong>${esc(batch.batchId)}</strong>.</p>
       ${reason ? `<p><strong>Reason:</strong> ${esc(reason)}</p>` : ""}
       <p>${
         approved
           ? "The approved records are now under Doctor Payments, ready to be raised."
           : "Rejected records are closed. Correct them in the Excel and upload them again."
       }</p>`,
    );
  });

module.exports = { notifyApprovers, notifyUploader };
