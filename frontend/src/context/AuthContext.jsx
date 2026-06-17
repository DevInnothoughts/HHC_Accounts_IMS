import React from "react";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import api from "../api/axios";

const AuthContext = createContext();

// ✅ Auto-logout after 6 hours of inactivity
const IDLE_LIMIT_MS = 6 * 60 * 60 * 1000; // 6 hours
const ACTIVITY_KEY = "lastActivity";

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("user");
    if (!stored) return null;

    // If last activity is older than the idle limit (e.g. tab closed >6h),
    // the session has expired — start logged out.
    const last = parseInt(localStorage.getItem(ACTIVITY_KEY) || "0", 10);
    if (last && Date.now() - last > IDLE_LIMIT_MS) {
      localStorage.clear();
      return null;
    }

    const parsed = JSON.parse(stored);
    return {
      ...parsed,
      _id: parsed._id || parsed.id,
      id: parsed.id || parsed._id,
    };
  });

  const [loading, setLoading] = useState(false);

  const logout = useCallback(() => {
    localStorage.clear();
    setUser(null);
  }, []);

  const requestOTP = async (email) => {
    await api.post("/auth/request-otp", { email });
  };

  const verifyOTP = async (email, otp) => {
    const { data } = await api.post("/auth/verify-otp", { email, otp });
    localStorage.setItem("accessToken", data.accessToken);
    localStorage.setItem("refreshToken", data.refreshToken);
    localStorage.setItem(ACTIVITY_KEY, String(Date.now())); // ✅ seed activity

    const normalizedUser = {
      ...data.user,
      _id: data.user._id || data.user.id,
      id: data.user.id || data.user._id,
    };

    localStorage.setItem("user", JSON.stringify(normalizedUser));
    setUser(normalizedUser);
    return normalizedUser;
  };

  // ✅ Track activity and auto-logout after 6h idle
  useEffect(() => {
    if (!user) return;

    localStorage.setItem(ACTIVITY_KEY, String(Date.now())); // live session seed

    let throttleUntil = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now > throttleUntil) {
        throttleUntil = now + 5000; // write at most once per 5s
        localStorage.setItem(ACTIVITY_KEY, String(now));
      }
    };

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];
    events.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }),
    );

    const checkIdle = () => {
      const last = parseInt(localStorage.getItem(ACTIVITY_KEY) || "0", 10);
      if (last && Date.now() - last > IDLE_LIMIT_MS) {
        logout();
        window.location.href = "/login";
      }
    };
    const interval = setInterval(checkIdle, 30 * 1000); // check every 30s

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(interval);
    };
  }, [user, logout]);

  return (
    <AuthContext.Provider
      value={{ user, loading, requestOTP, verifyOTP, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
