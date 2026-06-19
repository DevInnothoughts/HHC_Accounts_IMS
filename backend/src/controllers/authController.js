const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const OtpSession = require("../models/OtpSession");
const { sendOTPEmail } = require("../services/emailService");
const { OTP_EXPIRY_MINUTES, OTP_MAX_ATTEMPTS } = require("../config/constants");

const generateOTP = () => crypto.randomInt(100000, 999999).toString();

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "6h", // was "8h"
  });
  const refreshToken = jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" },
  );
  return { accessToken, refreshToken };
};

exports.requestOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({
      email: email.toLowerCase(),
      status: "active",
    });
    if (!user)
      return res.status(404).json({ message: "User not found or inactive" });

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await OtpSession.deleteMany({ email: email.toLowerCase() });
    await OtpSession.create({
      email: email.toLowerCase(),
      otp,
      expiresAt,
      ipAddress: req.ip,
    });
    await sendOTPEmail(email, otp);

    res.json({ message: "OTP sent successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const session = await OtpSession.findOne({
      email: email.toLowerCase(),
      verified: false,
    });

    if (!session)
      return res.status(400).json({ message: "No active OTP session" });
    if (session.expiresAt < new Date())
      return res.status(400).json({ message: "OTP expired" });
    if (session.attempts >= OTP_MAX_ATTEMPTS)
      return res
        .status(429)
        .json({ message: "Max attempts reached. Request a new OTP." });

    if (session.otp !== otp) {
      session.attempts += 1;
      await session.save();
      return res.status(400).json({
        message: `Invalid OTP. ${OTP_MAX_ATTEMPTS - session.attempts} attempts left.`,
      });
    }

    session.verified = true;
    await session.save();

    const user = await User.findOne({ email: email.toLowerCase() }).populate(
      "branches",
    );
    user.lastLogin = new Date();
    await user.save();

    const { accessToken, refreshToken } = generateTokens(user._id);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        branches: user.branches,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(
      decoded.id,
    );
    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch {
    res.status(401).json({ message: "Invalid refresh token" });
  }
};
