import { useState } from "react";
import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { requestOTP, verifyOTP } = useAuth();
  const navigate = useNavigate();

  const handleRequestOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await requestOTP(email);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const user = await verifyOTP(email, otp);
      navigate(user.role === "director" ? "/dashboard/director" : "/dashboard");
    } catch (err) {
      setError(err.response?.data?.message || "Invalid OTP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.logo}>HHC</div>
          <h1 style={styles.title}>Payment Management System</h1>
          <p style={styles.subtitle}>Healing Hands Clinic</p>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {step === 1 ? (
          <form onSubmit={handleRequestOTP} style={styles.form}>
            <label style={styles.label}>Email Address</label>
            <input
              style={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
            <button
              style={{ ...styles.btn, opacity: loading ? 0.7 : 1 }}
              disabled={loading}
            >
              {loading ? "Sending..." : "Send OTP"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOTP} style={styles.form}>
            <p style={styles.otpInfo}>
              OTP sent to <strong>{email}</strong>
            </p>
            <label style={styles.label}>Enter OTP</label>
            <input
              style={{
                ...styles.input,
                textAlign: "center",
                fontSize: 24,
                letterSpacing: 12,
              }}
              type="text"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="------"
              required
            />
            <button
              style={{ ...styles.btn, opacity: loading ? 0.7 : 1 }}
              disabled={loading}
            >
              {loading ? "Verifying..." : "Login"}
            </button>
            <button
              type="button"
              style={styles.linkBtn}
              onClick={() => {
                setStep(1);
                setOtp("");
              }}
            >
              ← Change Email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const C = {
  primary: "#1a3c6e",
  accent: "#2563eb",
  light: "#f0f4ff",
  border: "#dde3f0",
  danger: "#dc2626",
};
const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #1a3c6e 0%, #2563eb 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: "40px 36px",
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  header: { textAlign: "center", marginBottom: 32 },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    background: C.primary,
    color: "#fff",
    fontSize: 20,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 12px",
  },
  title: { fontSize: 20, fontWeight: 700, color: C.primary, margin: "0 0 4px" },
  subtitle: { fontSize: 13, color: "#666", margin: 0 },
  form: { display: "flex", flexDirection: "column", gap: 14 },
  label: { fontSize: 13, fontWeight: 600, color: "#444" },
  input: {
    padding: "12px 14px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 8,
    fontSize: 15,
    outline: "none",
    transition: "border .2s",
  },
  btn: {
    padding: "13px",
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: C.accent,
    fontSize: 13,
    cursor: "pointer",
    padding: 0,
  },
  error: {
    background: "#fef2f2",
    border: `1px solid ${C.danger}`,
    color: C.danger,
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    marginBottom: 16,
  },
  otpInfo: { fontSize: 13, color: "#555", textAlign: "center", margin: 0 },
};
