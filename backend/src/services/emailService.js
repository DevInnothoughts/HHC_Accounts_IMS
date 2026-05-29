const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

console.log("SMTP_HOST:", process.env.SMTP_HOST);
console.log("SMTP_PORT:", process.env.SMTP_PORT);
console.log("SMTP_USER:", process.env.SMTP_USER);

// Verify SMTP connection on server startup
transporter.verify((error, success) => {
  if (error) {
    console.log("❌ SMTP Connection Failed");
    console.log(error);
  } else {
    console.log("✅ SMTP Server Connected Successfully");
  }
});

const sendOTPEmail = async (email, otp) => {
  try {
    const info = await transporter.sendMail({
      from: `"PMS - HHC" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Your Login OTP - Payment Management System",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
          <div style="background:#1a3c6e;padding:24px;text-align:center;">
            <h2 style="color:#fff;margin:0;">Payment Management System</h2>
            <p style="color:#a8c4e0;margin:4px 0 0;">Healing Hands Clinic</p>
          </div>

          <div style="padding:32px;">
            <p style="font-size:16px;color:#333;">
              Your One-Time Password is:
            </p>

            <div style="background:#f0f4ff;border-radius:8px;padding:20px;text-align:center;margin:16px 0;">
              <span style="font-size:36px;font-weight:bold;color:#1a3c6e;letter-spacing:10px;">
                ${otp}
              </span>
            </div>

            <p style="color:#666;font-size:13px;">
              This OTP expires in <strong>5 minutes</strong>.
              Do not share it with anyone.
            </p>
          </div>
        </div>
      `,
    });

    console.log("✅ OTP Email Sent Successfully");
    console.log("📧 Sent To:", email);
    console.log("📨 Message ID:", info.messageId);

    return true;
  } catch (error) {
    console.log("❌ Failed To Send OTP Email");
    console.log("📧 Email:", email);
    console.log(error);

    return false;
  }
};

const sendNotificationEmail = async (to, subject, message) => {
  try {
    const info = await transporter.sendMail({
      from: `"PMS - HHC" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;">
          <div style="background:#1a3c6e;padding:20px;text-align:center;">
            <h3 style="color:#fff;margin:0;">
              Payment Management System
            </h3>
          </div>

          <div style="padding:24px;border:1px solid #e0e0e0;border-top:none;">
            <p style="color:#333;font-size:15px;">
              ${message}
            </p>
          </div>
        </div>
      `,
    });

    console.log("✅ Notification Email Sent Successfully");
    console.log("📧 Sent To:", to);
    console.log("📨 Message ID:", info.messageId);

    return true;
  } catch (error) {
    console.log("❌ Failed To Send Notification Email");
    console.log("📧 Email:", to);
    console.log(error);

    return false;
  }
};

module.exports = {
  sendOTPEmail,
  sendNotificationEmail,
};
