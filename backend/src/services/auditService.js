const AuditLog = require("../models/AuditLog");

const logAction = async ({
  userId,
  action,
  module,
  targetId,
  oldValue,
  newValue,
  req,
}) => {
  try {
    await AuditLog.create({
      user: userId,
      action,
      module,
      targetId,
      oldValue,
      newValue,
      ipAddress: req?.ip,
      deviceInfo: req?.headers["user-agent"],
    });
  } catch (err) {
    console.error("Audit log error:", err.message);
  }
};

module.exports = { logAction };
