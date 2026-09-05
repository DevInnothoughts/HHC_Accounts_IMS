// ============================================================
// BACKEND: controllers/branchController.js
// ============================================================
const Branch = require("../models/Branch");
const { logAction } = require("../services/auditService");

const { ROLES } = require("../config/constants");

// Branch bank accounts are company money-out details. Only these two
// roles see them at all; everyone else gets the field removed.
const BANK_ACCOUNT_ROLES = [ROLES.ACCOUNTS, ROLES.SUPER_ADMIN];
const canSeeBankAccounts = (user) => BANK_ACCOUNT_ROLES.includes(user.role);

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^[0-9]{6,20}$/;

// Normalises and validates a submitted bank-account list.
// Returns { accounts, errors } — never throws.
const normaliseBankAccounts = (list, userId) => {
  const errors = [];
  if (!Array.isArray(list))
    return { accounts: [], errors: ["Invalid bank account list"] };

  const accounts = list.map((raw, i) => {
    const n = i + 1;
    const bankName = String(raw.bankName || "").trim();
    const accountNumber = String(raw.accountNumber || "").trim();
    const ifscCode = String(raw.ifscCode || "")
      .trim()
      .toUpperCase();
    const rtgsThreshold = Number(raw.rtgsThreshold);

    if (!bankName) errors.push(`Account ${n}: bank name is required`);
    if (!ACCOUNT_RE.test(accountNumber))
      errors.push(`Account ${n}: account number must be 6–20 digits`);
    if (!IFSC_RE.test(ifscCode))
      errors.push(`Account ${n}: invalid IFSC (e.g. FDRL0001234)`);
    if (
      raw.rtgsThreshold !== undefined &&
      (isNaN(rtgsThreshold) || rtgsThreshold < 0)
    )
      errors.push(`Account ${n}: RTGS threshold must be zero or more`);

    return {
      ...(raw._id ? { _id: raw._id } : {}), // keep ids so history survives edits
      label: String(raw.label || "").trim(),
      bankName,
      accountHolderName: String(raw.accountHolderName || "").trim(),
      accountNumber,
      ifscCode,
      rtgsThreshold: isNaN(rtgsThreshold) ? 200000 : rtgsThreshold,
      isDefault: Boolean(raw.isDefault),
      status: raw.status === "inactive" ? "inactive" : "active",
      addedBy: raw.addedBy || userId,
    };
  });

  // Same account twice in one branch is always a mistake.
  const keys = accounts.map((a) => `${a.accountNumber}|${a.ifscCode}`);
  if (keys.some((k, i) => keys.indexOf(k) !== i))
    errors.push("The same account number appears more than once");

  // Exactly one default among the active accounts.
  const active = accounts.filter((a) => a.status === "active");
  const defaults = active.filter((a) => a.isDefault);
  if (defaults.length > 1) {
    errors.push("Only one account can be marked default");
  } else if (defaults.length === 0 && active.length > 0) {
    active[0].isDefault = true; // first active account becomes default
  }
  // An inactive account can never be the default.
  accounts.forEach((a) => {
    if (a.status === "inactive") a.isDefault = false;
  });

  return { accounts, errors };
};

// AFTER
exports.getBranches = async (req, res) => {
  try {
    const query = {};

    // ✅ Only super_admin sees all branches; everyone else (incl. accounts)
    //    is scoped to their assigned branches
    if (req.user.role !== ROLES.SUPER_ADMIN) {
      query._id = { $in: req.user.branches };
    }

    // Bank accounts are stripped at the query level for everyone else, so
    // they never reach the wire — branch users load this list too.
    const projection = canSeeBankAccounts(req.user) ? {} : { bankAccounts: 0 };

    const branches = await Branch.find(query, projection).sort({ name: 1 });
    res.json(branches);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createBranch = async (req, res) => {
  try {
    const existing = await Branch.findOne({
      code: req.body.code?.toUpperCase(),
    });
    if (existing)
      return res.status(400).json({ message: "Branch code already exists" });

    const { bankAccounts, ...rest } = req.body;

    let accounts = [];
    if (bankAccounts?.length) {
      if (!canSeeBankAccounts(req.user)) {
        return res
          .status(403)
          .json({ message: "You cannot set branch bank accounts" });
      }
      const result = normaliseBankAccounts(bankAccounts, req.user._id);
      if (result.errors.length)
        return res.status(400).json({
          message: "Bank account details are invalid",
          errors: result.errors,
        });
      accounts = result.accounts;
    }

    const branch = await Branch.create({
      ...rest,
      code: req.body.code?.toUpperCase(),
      bankAccounts: accounts,
    });

    await logAction({
      userId: req.user._id,
      action: "CREATE_BRANCH",
      module: "Branch",
      targetId: branch._id,
      req,
    });
    res.status(201).json(branch);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    // Bank accounts only change through replaceBankAccounts. Without this,
    // a branch save that omitted the array would silently wipe it.
    const { bankAccounts, ...safe } = req.body;

    const branch = await Branch.findByIdAndUpdate(req.params.id, safe, {
      new: true,
      runValidators: true,
    })
      .populate("clusterHead", "name email")
      .populate("partner", "name email");
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    await logAction({
      userId: req.user._id,
      action: "UPDATE_BRANCH",
      module: "Branch",
      targetId: branch._id,
      req,
    });
    res.json(branch);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.toggleBranchStatus = async (req, res) => {
  try {
    const branch = await Branch.findById(req.params.id);
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    branch.status = branch.status === "active" ? "inactive" : "active";
    await branch.save();
    res.json(branch);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Branch bank accounts (accounts + super_admin only) ────
// PUT /api/branches/:id/bank-accounts
// Body: { bankAccounts: [ { ... } ] }  — replaces the whole list.
exports.replaceBankAccounts = async (req, res) => {
  try {
    const branch = await Branch.findById(req.params.id);
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    // Accounts users manage only the branches they're assigned to.
    if (req.user.role !== ROLES.SUPER_ADMIN) {
      const allowed = req.user.branches.map((b) => b._id.toString());
      if (!allowed.includes(branch._id.toString())) {
        return res
          .status(403)
          .json({ message: "You do not have access to this branch" });
      }
    }

    const { accounts, errors } = normaliseBankAccounts(
      req.body.bankAccounts || [],
      req.user._id,
    );
    if (errors.length)
      return res
        .status(400)
        .json({ message: "Bank account details are invalid", errors });

    const before = branch.bankAccounts.map(
      (a) => `${a.bankName} ****${a.accountNumber.slice(-4)}`,
    );

    branch.bankAccounts = accounts;
    await branch.save();

    // Money-out details — log what changed, not just that something did.
    await logAction({
      userId: req.user._id,
      action: "UPDATE_BRANCH_BANK_ACCOUNTS",
      module: "Branch",
      targetId: branch._id,
      details: {
        before,
        after: accounts.map(
          (a) => `${a.bankName} ****${a.accountNumber.slice(-4)}`,
        ),
      },
      req,
    });

    res.json(branch.bankAccounts);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
