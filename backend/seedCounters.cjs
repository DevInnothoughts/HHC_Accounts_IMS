require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("./src/config/db");
const InvoiceRequest = require("./src/models/InvoiceRequest");
const PaymentProcessing = require("./src/models/PaymentProcessing");
const Counter = require("./src/models/Counter");

// Find the highest numeric suffix among existing IDs (e.g. "INV-000010" -> 10)
const highest = (docs, field, prefix) =>
  docs.reduce((max, d) => {
    const n = parseInt(String(d[field]).replace(prefix, ""), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

const run = async () => {
  await connectDB();
  try {
    // Invoices
    const invDocs = await InvoiceRequest.find({ requestId: /^INV-\d+$/ })
      .select("requestId")
      .lean();
    const invMax = highest(invDocs, "requestId", "INV-");
    await Counter.findByIdAndUpdate(
      "invoiceRequest",
      { seq: invMax },
      { upsert: true },
    );
    console.log(
      `✅ invoiceRequest counter set to ${invMax} (${invDocs.length} invoices found)`,
    );

    // Payments
    const payDocs = await PaymentProcessing.find({ paymentId: /^PAY-\d+$/ })
      .select("paymentId")
      .lean();
    const payMax = highest(payDocs, "paymentId", "PAY-");
    await Counter.findByIdAndUpdate(
      "paymentProcessing",
      { seq: payMax },
      { upsert: true },
    );
    console.log(
      `✅ paymentProcessing counter set to ${payMax} (${payDocs.length} payments found)`,
    );

    console.log("Done.");
  } catch (err) {
    console.error("Seeding failed:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

run();
