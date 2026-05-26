// ============================================================
// BACKEND: controllers/budgetController.js
// ============================================================
const Budget = require("../models/Budget");
const {
  checkBudget,
  updateBudgetUtilization,
  getBudgetSummary,
} = require("../services/budgetService");
const { logAction } = require("../services/auditService");
const InvoiceRequest = require("../models/InvoiceRequest");

exports.getBudgets = async (req, res) => {
  try {
    const { branch, year, month } = req.query;
    const now = new Date();
    const query = {
      year: Number(year) || now.getFullYear(),
      month: Number(month) || now.getMonth() + 1,
    };
    if (branch) query.branch = branch;

    const budgets = await Budget.find(query)
      .populate("branch", "name code")
      .populate("createdBy", "name email")
      .sort({ "branch.name": 1 });

    res.json(budgets);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createBudget = async (req, res) => {
  try {
    const budget = await Budget.create({
      ...req.body,
      createdBy: req.user._id,
    });
    await logAction({
      userId: req.user._id,
      action: "CREATE_BUDGET",
      module: "Budget",
      targetId: budget._id,
      req,
    });
    res.status(201).json(budget);
  } catch (err) {
    if (err.code === 11000)
      return res
        .status(400)
        .json({ message: "Budget already exists for this branch/month/type" });
    res.status(400).json({ message: err.message });
  }
};

exports.updateBudget = async (req, res) => {
  try {
    const budget = await Budget.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    }).populate("branch", "name code");
    if (!budget) return res.status(404).json({ message: "Budget not found" });
    await logAction({
      userId: req.user._id,
      action: "UPDATE_BUDGET",
      module: "Budget",
      targetId: budget._id,
      req,
    });
    res.json(budget);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.checkBudget = async (req, res) => {
  try {
    const { branchId, expenseType, amount } = req.body;
    const result = await checkBudget(branchId, expenseType, Number(amount));
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getBranchBudgetSummary = async (req, res) => {
  try {
    const { branchId } = req.params;
    const { year, month } = req.query;
    const now = new Date();
    const summary = await getBudgetSummary(
      branchId,
      Number(year) || now.getFullYear(),
      Number(month) || now.getMonth() + 1,
    );
    res.json(summary);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.recalculateBudgetUtilization = async (req, res) => {
  try {
    const { budgetId } = req.params;
    const budget = await Budget.findById(budgetId);
    if (!budget) return res.status(404).json({ message: "Budget not found" });

    const startOfMonth = new Date(budget.year, budget.month - 1, 1);
    const endOfMonth = new Date(budget.year, budget.month, 0, 23, 59, 59);

    const query = {
      branch: budget.branch,
      createdAt: { $gte: startOfMonth, $lte: endOfMonth },
      status: { $nin: ["Draft", "Rejected"] },
    };

    if (budget.expenseType !== "All") query.expenseType = budget.expenseType;

    const agg = await InvoiceRequest.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$netPayable" } } },
    ]);

    budget.utilized = agg[0]?.total || 0;
    await budget.save();

    res.json({ message: "Utilization recalculated", budget });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
