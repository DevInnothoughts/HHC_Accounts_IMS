const roleGuard =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!allowedRoles.includes(req.user.role))
      return res
        .status(403)
        .json({ message: "Forbidden: Insufficient permissions" });
    next();
  };

module.exports = roleGuard;
