// ============================================================
// BACKEND: routes/expenses.js
// ============================================================
const router = require("express").Router();
const ExpenseCategory = require("../models/ExpenseCategory");
const roleGuard = require("../middleware/roleGaurd");
const { ROLES } = require("../config/constants");

router.get("/", async (req, res) => {
  try {
    const { type } = req.query;
    const query = { status: "active" };
    if (type) query.type = type;
    const categories = await ExpenseCategory.find(query).sort({ name: 1 });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post(
  "/",
  roleGuard(ROLES.SUPER_ADMIN, ROLES.ACCOUNTS),
  async (req, res) => {
    try {
      const category = await ExpenseCategory.create(req.body);
      res.status(201).json(category);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  },
);

router.put(
  "/:id",
  roleGuard(ROLES.SUPER_ADMIN, ROLES.ACCOUNTS),
  async (req, res) => {
    try {
      const category = await ExpenseCategory.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true },
      );
      res.json(category);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  },
);

module.exports = router;
