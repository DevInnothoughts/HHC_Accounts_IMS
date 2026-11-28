// ============================================================
// BACKEND: src/config/doctorPayoutConfig.js — NEW FILE
// ------------------------------------------------------------
// Doctor Referral + Surgeon / Anaesthetist payouts (Nov 2026).
// Everything that is a business rule rather than code lives here, so a
// change of rule is a one-line edit:
//   - who uploads / approves / pays
//   - the Excel layout (sheet names, column headings, required fields)
//   - tolerances and limits
// ============================================================
const { ROLES } = require("./constants");

const TYPES = { REFERRAL: "referral", SURGEON: "surgeon" };

const TYPE_LABELS = {
  [TYPES.REFERRAL]: "Doctor Referral",
  [TYPES.SURGEON]: "Surgeon Payment",
};

// Row (payout) lifecycle.
const PAYOUT_STATUS = {
  PENDING: "pending_approval", // uploaded, waiting for Cluster / Dept Head
  APPROVED: "approved", // approved — Accounts can raise the payment
  REJECTED: "rejected", // rejected by Cluster / Dept Head (final)
  WITHDRAWN: "withdrawn", // pulled back by Accounts before approval (final)
  RAISED: "raised", // on a payment (DRP-…) waiting for the bank file
  FILE_GENERATED: "file_generated", // bank file downloaded
  PAID: "paid", // UTR recorded
};

// One bank transfer.
const PAYMENT_STATUS = {
  RAISED: "raised",
  FILE_GENERATED: "file_generated",
  PAID: "paid",
  CANCELLED: "cancelled",
};

module.exports = {
  TYPES,
  TYPE_LABELS,
  PAYOUT_STATUS,
  PAYMENT_STATUS,

  // ── Who does what ───────────────────────────────────────
  // Cluster Head and Department Head are the same role (designation is a
  // label only), so one entry covers both.
  UPLOAD_ROLES: [ROLES.ACCOUNTS],
  APPROVER_ROLES: [ROLES.CLUSTER_HEAD],
  PAYMENT_ROLES: [ROLES.ACCOUNTS],
  // Read-only access to batches, payments and the doctor master.
  VIEW_ROLES: [
    ROLES.ACCOUNTS,
    ROLES.SUPER_ADMIN,
    ROLES.CLUSTER_HEAD,
    ROLES.DIRECTOR,
  ],
  // May edit a doctor's details / bank account directly in the master.
  DOCTOR_ADMIN_ROLES: [ROLES.ACCOUNTS, ROLES.SUPER_ADMIN],
  // Only Super Admin corrects a UTR once it is on the record — same rule
  // as vendor payments.
  UTR_CORRECT_ROLES: [ROLES.SUPER_ADMIN],
  // Roles limited to their assigned branches (same list the payment
  // screens use). Super Admin and Director see every branch.
  BRANCH_SCOPED_ROLES: [
    ROLES.BRANCH_USER,
    ROLES.BRANCH_PARTNER,
    ROLES.ACCOUNTS,
    ROLES.CLUSTER_HEAD,
  ],

  // ── Excel layout ────────────────────────────────────────
  // Sheets are recognised by NAME first, then by their columns, so a
  // renamed tab still works. Headings are matched ignoring case, spaces
  // and punctuation ("Pan Number" = "PAN number" = "pan_number").
  SHEETS: {
    [TYPES.REFERRAL]: {
      name: "Dr Ref",
      nameHints: ["ref"],
      // field marking this type when the tab name gives no clue
      signature: "patientName",
    },
    [TYPES.SURGEON]: {
      name: "Dr Sur And Anesthetic",
      nameHints: ["sur", "anes", "anaes"],
      signature: "noOfSurgeries",
    },
  },

  // field → accepted headings (already normalised: lower-case a–z0–9).
  COLUMN_ALIASES: {
    branch: ["branch", "branchname", "unit"],
    date: ["date"],
    doctorName: ["nameofdoctor", "doctorname", "nameofthedoctor", "doctor"],
    patientName: ["patientname", "nameofpatient", "nameofthepatient"],
    settledAmount: ["settledamount", "settledamt"],
    noOfSurgeries: [
      "noofsurgeries",
      "noofsurgery",
      "numberofsurgeries",
      "surgeries",
    ],
    basicAmount: ["basicamount", "basicamt", "basic"],
    tdsAmount: ["tds", "tdsamount", "tdsamt"],
    payableAmount: ["payableamount", "payableamt", "netpayable", "payable"],
    panNumber: ["pannumber", "panno", "pan", "pancard", "pancardnumber"],
    accountNumber: [
      "bankaccountnumber",
      "bankaccountno",
      "accountnumber",
      "accountno",
      "bankacno",
    ],
    ifscCode: ["ifsc", "ifsccode"],
    bankName: ["bankname", "bank"],
    accountHolderName: [
      "nameasperbank",
      "accountholdername",
      "beneficiaryname",
    ],
    mobile: [
      "doctormobileno",
      "doctormobilenumber",
      "doctormobile",
      "mobileno",
      "mobilenumber",
      "mobile",
    ],
    email: ["doctoremailid", "doctoremail", "emailid", "email"],
  },

  // Column order of the downloadable template — identical to the client's
  // Template.xlsx (header on row 2, starting in column B).
  TEMPLATE_COLUMNS: {
    [TYPES.REFERRAL]: [
      ["branch", "Branch"],
      ["date", "Date"],
      ["doctorName", "Name of Doctor"],
      ["patientName", "Patient Name"],
      ["settledAmount", "Settled Amount"],
      ["basicAmount", "Basic Amount"],
      ["tdsAmount", "TDS"],
      ["payableAmount", "Payable Amount"],
      ["panNumber", "Pan Number"],
      ["accountNumber", "Bank Account Number"],
      ["ifscCode", "IFSC"],
      ["bankName", "Bank Name"],
      ["accountHolderName", "Name As Per Bank"],
      ["mobile", "Doctor Mobile No"],
      ["email", "Doctor Email Id"],
    ],
    [TYPES.SURGEON]: [
      ["branch", "Branch"],
      ["date", "Date"],
      ["doctorName", "Name of Doctor"],
      ["settledAmount", "Settled Amount"],
      ["noOfSurgeries", "No of Surgeries"],
      ["basicAmount", "Basic Amount"],
      ["tdsAmount", "TDS"],
      ["payableAmount", "Payable Amount"],
      ["panNumber", "Pan Number"],
      ["accountNumber", "Bank Account Number"],
      ["ifscCode", "IFSC"],
      ["bankName", "Bank Name"],
      ["accountHolderName", "Name As Per Bank"],
      ["mobile", "Doctor Mobile No"],
      ["email", "Doctor Email Id"],
    ],
  },

  // Everything is required except mobile and email (requirement 9).
  REQUIRED_FIELDS: {
    [TYPES.REFERRAL]: [
      "branch",
      "date",
      "doctorName",
      "patientName",
      "settledAmount",
      "basicAmount",
      "tdsAmount",
      "payableAmount",
      "panNumber",
      "accountNumber",
      "ifscCode",
      "bankName",
      "accountHolderName",
    ],
    [TYPES.SURGEON]: [
      "branch",
      "date",
      "doctorName",
      "settledAmount",
      "noOfSurgeries",
      "basicAmount",
      "tdsAmount",
      "payableAmount",
      "panNumber",
      "accountNumber",
      "ifscCode",
      "bankName",
      "accountHolderName",
    ],
  },
  OPTIONAL_FIELDS: ["mobile", "email"],

  FIELD_LABELS: {
    branch: "Branch",
    date: "Date",
    doctorName: "Name of Doctor",
    patientName: "Patient Name",
    settledAmount: "Settled Amount",
    noOfSurgeries: "No of Surgeries",
    basicAmount: "Basic Amount",
    tdsAmount: "TDS",
    payableAmount: "Payable Amount",
    panNumber: "Pan Number",
    accountNumber: "Bank Account Number",
    ifscCode: "IFSC",
    bankName: "Bank Name",
    accountHolderName: "Name As Per Bank",
    mobile: "Doctor Mobile No",
    email: "Doctor Email Id",
  },

  // ── Formats (same patterns the vendor master uses) ───────
  PAN_REGEX: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  IFSC_REGEX: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  ACCOUNT_REGEX: /^[0-9]{6,20}$/,
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  MOBILE_REGEX: /^[6-9][0-9]{9}$/,

  // ── Limits and tolerances ───────────────────────────────
  MAX_FILE_MB: 5,
  MAX_ROWS_PER_SHEET: 2000,
  HEADER_SCAN_ROWS: 15, // heading row is looked for in the first N rows
  // Payable must equal Basic − TDS within this many rupees (rounding).
  AMOUNT_TOLERANCE: 1,
  // A date this far ahead / behind is flagged (not blocked).
  DATE_WARN_FUTURE_DAYS: 1,
  DATE_WARN_PAST_DAYS: 400,

  // ── Payment processing ──────────────────────────────────
  // true  = one bank transfer per doctor per branch per type (many sheet
  //         rows → one DRP payment, one UTR). The raise screen can switch
  //         this off for a particular raise.
  // false = one transfer per sheet row.
  CONSOLIDATE_BY_DEFAULT: true,
  MAX_RAISE_ROWS: 1000,
  MAX_BANK_FILE_PAYMENTS: 500,
  MAX_BULK_UTR_ENTRIES: 200,

  // ── Doctor profile (Doctor Master) — Nov 2026 ───────────
  // Accounts complete each doctor's profile from the list they are given:
  // remaining details + documents. A profile is "complete" when it has
  // valid bank details and one document of every REQUIRED type.
  DOCTOR_TYPES: {
    referring: "Referring doctor",
    surgeon: "Surgeon",
    anaesthetist: "Anaesthetist",
    other: "Other",
  },
  DOCUMENT_TYPES: {
    pan: "PAN card",
    cheque: "Cancelled cheque / passbook",
    registration: "Medical registration certificate",
    other: "Other document",
  },
  REQUIRED_DOCUMENT_TYPES: ["pan", "cheque"],
  MAX_DOCUMENT_MB: 5,
  // false = an incomplete profile is only flagged (tag + filter in the
  //         Doctor Master); payments can still be raised.
  // true  = Accounts cannot raise a payment for a doctor whose profile
  //         is incomplete.
  BLOCK_PAYMENT_IF_PROFILE_INCOMPLETE: false,

  // "Import doctor list" Excel. PAN and name are compulsory; everything
  // else may be left blank and completed later in the Doctor Master.
  MAX_DOCTOR_LIST_ROWS: 2000,
  DOCTOR_LIST_COLUMNS: [
    ["name", "Name of Doctor"],
    ["panNumber", "Pan Number"],
    ["doctorType", "Doctor Type"],
    ["specialisation", "Specialisation"],
    ["registrationNumber", "Registration No"],
    ["hospitalName", "Hospital / Clinic"],
    ["city", "City"],
    ["address", "Address"],
    ["mobile", "Doctor Mobile No"],
    ["email", "Doctor Email Id"],
    ["accountNumber", "Bank Account Number"],
    ["ifscCode", "IFSC"],
    ["bankName", "Bank Name"],
    ["accountHolderName", "Name As Per Bank"],
  ],
  DOCTOR_LIST_ALIASES: {
    name: ["nameofdoctor", "doctorname", "nameofthedoctor", "doctor", "name"],
    panNumber: ["pannumber", "panno", "pan", "pancard", "pancardnumber"],
    doctorType: ["doctortype", "type", "category"],
    specialisation: [
      "specialisation",
      "specialization",
      "speciality",
      "specialty",
    ],
    registrationNumber: [
      "registrationno",
      "registrationnumber",
      "regno",
      "mmcno",
      "medicalregistrationno",
    ],
    hospitalName: [
      "hospitalclinic",
      "hospital",
      "clinic",
      "hospitalname",
      "clinicname",
    ],
    city: ["city"],
    address: ["address"],
    mobile: [
      "doctormobileno",
      "doctormobilenumber",
      "doctormobile",
      "mobileno",
      "mobilenumber",
      "mobile",
    ],
    email: ["doctoremailid", "doctoremail", "emailid", "email"],
    accountNumber: [
      "bankaccountnumber",
      "bankaccountno",
      "accountnumber",
      "accountno",
      "bankacno",
    ],
    ifscCode: ["ifsc", "ifsccode"],
    bankName: ["bankname", "bank"],
    accountHolderName: [
      "nameasperbank",
      "accountholdername",
      "beneficiaryname",
    ],
  },

  // ── Tally export of doctor payments — Nov 2026 ──────────
  // One Journal per approved record:
  //   Dr  <expense ledger>          Basic Amount
  //   Cr  <doctor name>             Payable Amount
  //   Cr  TDS <section> Payable     TDS
  // Ledger names must match the ledgers in each branch's Tally company —
  // change them here. The TDS ledger and section follow the same rules as
  // the invoice export (tallyExportService.resolveTdsSection); the hint
  // below is what that rule reads in place of an expense category.
  TALLY: {
    EXPENSE_LEDGER: {
      [TYPES.REFERRAL]: "Doctor Referral Fees",
      [TYPES.SURGEON]: "Surgeon Professional Fees",
    },
    TDS_SECTION_HINT: {
      [TYPES.REFERRAL]: "", // decided by the TDS rate, flagged if unsure
      [TYPES.SURGEON]: "surgeon professional fees",
    },
  },

  // Text put in the bank file's Credit / Debit remark, ahead of the
  // payment id — "Dr Ref / DRP-000012". It appears on the doctor's bank
  // statement, so change the wording here if Accounts want another.
  BANK_REMARK_PREFIX: {
    [TYPES.REFERRAL]: "Dr Ref",
    [TYPES.SURGEON]: "Dr Sur",
  },
};
