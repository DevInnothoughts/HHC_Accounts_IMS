const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const rateLimit = require("express-rate-limit");
require("dotenv").config(); // ✅ Must be FIRST before anything else
const connectDB = require("./config/db");

const startServer = async () => {
  await connectDB();
  const app = express();

  // ✅ Define UPLOAD_BASE directly here using __dirname — no imports needed
  // __dirname = backend/src/  so ../../uploads = backend/uploads/
  const UPLOAD_BASE = path.join(__dirname, "..", "..", "uploads");

  console.log("[App] Serving static files from:", UPLOAD_BASE);

  // ✅ Create uploads folder if it doesn't exist
  const fs = require("fs");
  if (!fs.existsSync(UPLOAD_BASE)) {
    fs.mkdirSync(UPLOAD_BASE, { recursive: true });
    console.log("[App] Created uploads directory:", UPLOAD_BASE);
  }

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
  app.use(express.json({ limit: "10mb" }));

  // ✅ Serve uploaded files BEFORE routes and rate limiters
  app.use(
    "/files",
    express.static(UPLOAD_BASE, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".pdf")) {
          res.setHeader("Content-Disposition", "inline");
          res.setHeader("Content-Type", "application/pdf");
        } else if (/\.(jpg|jpeg)$/i.test(filePath)) {
          res.setHeader("Content-Type", "image/jpeg");
        } else if (/\.png$/i.test(filePath)) {
          res.setHeader("Content-Type", "image/png");
        }
      },
    }),
  );

  const isDev = process.env.NODE_ENV === "development";

  const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 1000 : 300,
    message: { message: "Too many OTP requests." },
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 1000 : 300,
    message: { message: "Too many auth requests." },
  });
  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 1000 : 500,
    message: { message: "Too many upload requests." },
  });
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 1000 : 3000,
    skip: () => process.env.NODE_ENV === "development",
  });

  app.use("/api/auth/request-otp", otpLimiter);
  app.use("/api/auth", authLimiter);
  app.use("/api/uploads", uploadLimiter);
  app.use("/api/", apiLimiter);

  // Routes
  app.use("/api/auth", require("./routes/auth"));
  app.use(
    "/api/users",
    require("./middleware/auth").authenticate,
    require("./routes/users"),
  );
  app.use(
    "/api/branches",
    require("./middleware/auth").authenticate,
    require("./routes/branches"),
  );
  app.use(
    "/api/vendors",
    require("./middleware/auth").authenticate,
    require("./routes/vendors"),
  );

  app.use("/api/payments", require("./routes/payments"));
  app.use(
    "/api/reports",
    require("./middleware/auth").authenticate,
    require("./routes/reports"),
  );
  app.use("/api/budgets", require("./routes/budget"));
  app.use("/api/sla", require("./routes/sla"));
  app.use("/api/invoices", require("./routes/invoices"));
  app.use(
    "/api/uploads",
    require("./middleware/auth").authenticate, // ✅ add this
    require("./routes/uploads"),
  );
  app.use(
    "/api/expense-categories",
    require("./middleware/auth").authenticate,
    require("./routes/expenses"),
  );

  const { initSLAScheduler } = require("./jobs/slaScheduler");
  await initSLAScheduler();

  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: "Internal server error" });
  });

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`PMS Server running on port ${PORT}`);
    console.log(`Files served at: http://localhost:${PORT}/files/`);
  });
};

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
