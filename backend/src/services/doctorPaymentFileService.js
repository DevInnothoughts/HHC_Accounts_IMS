// ============================================================
// BACKEND: src/services/doctorPaymentFileService.js — NEW FILE
// ------------------------------------------------------------
// Bank upload files for doctor payments, in the SAME two formats Accounts
// already upload for vendor payments:
//   - FedOne (Federal Bank)            → .xlsx, 12 columns
//   - e-Net "Master Vendor Payment"    → .csv, 28 columns
//
// Both layouts are machine-parsed by the bank, so they are not rebuilt
// here. A doctor payment is presented in the shape the existing builders
// already understand, and fedOneExcelService / enetExcelService produce
// the file — one definition of each bank format for the whole system.
// ============================================================
const {
  buildFedOneWorkbook,
  validateForFedOne,
} = require("./fedOneExcelService");
const { buildEnetCsv, validateForEnet } = require("./enetExcelService");
const cfg = require("../config/doctorPayoutConfig");
const { compareBank, bankOf } = require("./doctorPayoutValidation");

// DoctorPayment (branch populated with bankAccounts) → the vendor-payment
// shape the bank builders read.
//   URN / reference   = DRP000012        (payment id, alphanumeric)
//   Credit/Debit remark = "Dr Ref / DRP-000012"
const toBankShape = (payment) => ({
  _id: payment._id,
  paymentId: payment.paymentId,
  paymentAmount: payment.amount,
  scheduledDate: payment.scheduledDate,
  branch: payment.branch,
  vendor: {
    vendorName: payment.doctorName || payment.doctor?.name,
    accountHolderName: payment.bank?.accountHolderName,
    accountNumber: payment.bank?.accountNumber,
    ifscCode: payment.bank?.ifscCode,
    email: payment.beneficiaryEmail || "",
  },
  invoiceRequest: {
    invoiceNumber: payment.paymentId,
    expenseCategory: { name: cfg.BANK_REMARK_PREFIX[payment.type] || "Dr" },
  },
  installments: [],
});

const reword = (message) =>
  String(message)
    .replace(/\bvendor has\b/g, "doctor has")
    .replace(/\bvendor IFSC\b/g, "doctor IFSC");

// Problems that stop a payment going into a bank file.
// payment.doctor must be populated (status + current bank details).
const validatePayment = (payment, format, debitAccountId) => {
  const errors = [];
  const label = payment.paymentId;
  const doctor = payment.doctor;

  if (!doctor) errors.push(`${label}: doctor record not found`);
  else {
    if (doctor.status !== "active")
      errors.push(
        `${label}: ${doctor.name} is ${doctor.status} in the Doctor Master`,
      );
    // Raised against one account, master now shows another.
    const drift = compareBank(bankOf(doctor), bankOf(payment.bank));
    if (drift?.severity === "critical")
      errors.push(
        `${label}: ${doctor.name}'s bank details were changed in the Doctor Master after this payment was raised — cancel the payment and raise it again`,
      );
  }

  const shape = toBankShape(payment);
  const formatErrors =
    format === "enet"
      ? validateForEnet(shape)
      : validateForFedOne(shape, debitAccountId);
  return errors.concat(formatErrors.map(reword));
};

const buildFedOne = (payments, debitAccountId) =>
  buildFedOneWorkbook(payments.map(toBankShape), debitAccountId);

const buildEnet = (payments) => buildEnetCsv(payments.map(toBankShape));

module.exports = { toBankShape, validatePayment, buildFedOne, buildEnet };
