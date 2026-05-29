import React from "react";
import { createContext, useContext, useState, useEffect } from "react";
import api from "../api/axios";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem("user");
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return {
      ...parsed,
      _id: parsed._id || parsed.id,
      id: parsed.id || parsed._id,
    };
  });

  const [loading, setLoading] = useState(false);

  const requestOTP = async (email) => {
    await api.post("/auth/request-otp", { email });
  };

  const verifyOTP = async (email, otp) => {
    const { data } = await api.post("/auth/verify-otp", { email, otp });
    localStorage.setItem("accessToken", data.accessToken);
    localStorage.setItem("refreshToken", data.refreshToken);

    // ✅ Normalize — always store both id and _id
    const normalizedUser = {
      ...data.user,
      _id: data.user._id || data.user.id,
      id: data.user.id || data.user._id,
    };

    localStorage.setItem("user", JSON.stringify(normalizedUser));
    setUser(normalizedUser);
    return normalizedUser;
  };

  const logout = () => {
    localStorage.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, requestOTP, verifyOTP, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
