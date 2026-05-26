const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).populate("branches");
    if (!req.user || req.user.status === "inactive")
      return res.status(401).json({ message: "Account inactive or not found" });
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = { authenticate };
