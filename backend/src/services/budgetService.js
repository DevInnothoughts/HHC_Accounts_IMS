// ============================================================
// BACKEND: services/budgetService.js
// ============================================================
const Budget = require("../models/Budget");
const InvoiceRequest = require("../models/InvoiceRequest");
const { sendNotificationEmail } = require("./emailService");
const User = require("../models/User");
const { ROLES } = require("../config/constants");

/**
 * Check if a payment request fits within budget
 * Returns: { allowed, budget, remainingAfter, utilizationAfterPercent, warning }
 */
const checkBudget = async (branchId, expenseType, amount) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Check specific expense type budget first, then 'All' budget
  const budgets = await Budget.find({
    branch: branchId,
    year,
    month,
    status: "active",
    expenseType: { $in: [expenseType, "All"] },
  });

  if (budgets.length === 0) {
    return {
      allowed: true,
      budget: null,
      warning: null,
      message: "No budget configured for this branch/month",
    };
  }

  // Use most specific budget (expenseType match over 'All')
  const budget =
    budgets.find((b) => b.expenseType === expenseType) || budgets[0];

  const remainingAfter = budget.remaining - amount;
  const utilizationAfterPercent = Math.round(
    ((budget.utilized + amount) / budget.totalBudget) * 100,
  );

  if (budget.hardLimit && remainingAfter < 0) {
    return {
      allowed: false,
      budget,
      remainingAfter,
      utilizationAfterPercent,
      warning: "hard_limit",
      message: `Budget exceeded. Available: ₹${budget.remaining.toLocaleString("en-IN")}. Requested: ₹${amount.toLocaleString("en-IN")}`,
    };
  }

  let warning = null;
  let message = null;

  if (utilizationAfterPercent >= 100) {
    warning = "over_budget";
    message = `This request will exceed the monthly budget by ₹${Math.abs(remainingAfter).toLocaleString("en-IN")}`;
  } else if (utilizationAfterPercent >= budget.alertThreshold) {
    warning = "threshold_exceeded";
    message = `Budget utilization will reach ${utilizationAfterPercent}% after this request`;
  }

  return {
    allowed: true,
    budget,
    remainingAfter,
    utilizationAfterPercent,
    warning,
    message,
  };
};

/**
 * Update budget utilization after a payment request is approved/rejected
 */
const updateBudgetUtilization = async (
  branchId,
  expenseType,
  amount,
  operation = "add",
) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const budget = await Budget.findOne({
    branch: branchId,
    year,
    month,
    status: "active",
    expenseType: { $in: [expenseType, "All"] },
  });

  if (!budget) return null;

  const change = operation === "add" ? amount : -amount;
  budget.utilized = Math.max(0, budget.utilized + change);
  await budget.save();

  // Send alert if threshold crossed
  if (
    operation === "add" &&
    budget.utilizationPercent >= budget.alertThreshold
  ) {
    await sendBudgetAlert(budget);
  }

  return budget;
};

/**
 * Send budget threshold alert to accounts team
 */
const sendBudgetAlert = async (budget) => {
  try {
    await budget.populate("branch");
    const accountsUsers = await User.find({
      role: ROLES.ACCOUNTS,
      status: "active",
    });

    for (const user of accountsUsers) {
      await sendNotificationEmail(
        user.email,
        `⚠️ Budget Alert: ${budget.branch.name} — ${budget.utilizationPercent}% utilized`,
        `
          <p>The monthly budget for <strong>${budget.branch.name}</strong> has reached <strong>${budget.utilizationPercent}%</strong> utilization.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:12px;">
            <tr><td style="padding:6px;color:#666;">Month</td><td style="padding:6px;font-weight:600;">${budget.month}/${budget.year}</td></tr>
            <tr><td style="padding:6px;color:#666;">Total Budget</td><td style="padding:6px;font-weight:600;">₹${budget.totalBudget.toLocaleString("en-IN")}</td></tr>
            <tr><td style="padding:6px;color:#666;">Utilized</td><td style="padding:6px;font-weight:600;color:#dc2626;">₹${budget.utilized.toLocaleString("en-IN")}</td></tr>
            <tr><td style="padding:6px;color:#666;">Remaining</td><td style="padding:6px;font-weight:600;color:#16a34a;">₹${budget.remaining.toLocaleString("en-IN")}</td></tr>
          </table>
        `,
      );
    }
  } catch (err) {
    console.error("Budget alert email error:", err.message);
  }
};

/**
 * Get budget summary for a branch
 */
const getBudgetSummary = async (branchId, year, month) => {
  const budgets = await Budget.find({
    branch: branchId,
    year,
    month,
    status: "active",
  });

  return budgets.map((b) => ({
    _id: b._id,
    expenseType: b.expenseType,
    totalBudget: b.totalBudget,
    utilized: b.utilized,
    remaining: b.remaining,
    utilizationPercent: b.utilizationPercent,
    alertThreshold: b.alertThreshold,
    hardLimit: b.hardLimit,
    status: b.status,
  }));
};

module.exports = {
  checkBudget,
  updateBudgetUtilization,
  getBudgetSummary,
  sendBudgetAlert,
};
