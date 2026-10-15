// ============================================================
// BACKEND: src/jobs/fixedPaymentScheduler.js — NEW FILE
// ------------------------------------------------------------
// Creates due fixed-payment invoices once a day at 00:20 IST, and once at
// startup so a server that was down on a template's day catches up the
// same month. Between runs it uses no CPU: node-cron only holds a timer. Safe to run any number of times: one invoice per template
// per month is enforced by a unique index.
// ============================================================
const cron = require("node-cron");
const { runDueFixedPayments } = require("../services/fixedPaymentService");

// Guard: if a run is still going (e.g. startup catch-up and the 00:20 run
// coincide), the second one is skipped instead of running in parallel.
let running = false;

const run = async (label) => {
  if (running) return;
  running = true;
  try {
    const s = await runDueFixedPayments(new Date());
    if (s.created || s.failed) {
      console.log(
        `[fixed-payments] ${label}: created ${s.created}, failed ${s.failed}, already done ${s.exists}`,
      );
    }
  } catch (err) {
    console.error(`[fixed-payments] ${label} error:`, err.message);
  } finally {
    running = false;
  }
};

const initFixedPaymentScheduler = () => {
  cron.schedule("20 0 * * *", () => run("daily run"), {
    timezone: "Asia/Kolkata",
  });
  // Startup catch-up, slightly delayed so the DB connection settles.
  setTimeout(() => run("startup catch-up"), 15000);
  console.log("Fixed payment scheduler initialized — runs daily 00:20 IST");
};

module.exports = { initFixedPaymentScheduler };
