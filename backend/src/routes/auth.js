const router = require("express").Router();
const {
  requestOTP,
  verifyOTP,
  refreshToken,
} = require("../controllers/authController");

router.post("/request-otp", requestOTP);
router.post("/verify-otp", verifyOTP);
router.post("/refresh-token", refreshToken);

module.exports = router;
