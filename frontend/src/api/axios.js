import axios from "axios";

const api = axios.create({ baseURL: process.env.VITE_API_URL || "http://localhost:5000/api" });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      try {
        const refresh = localStorage.getItem("refreshToken");
        const { data } = await axios.post(
          `${process.env.VITE_API_URL || "http://localhost:5000/api"}/auth/refresh-token`,
          { refreshToken: refresh },
        );
        localStorage.setItem("accessToken", data.accessToken);
        localStorage.setItem("refreshToken", data.refreshToken);
        err.config.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(err.config);
      } catch {
        localStorage.clear();
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  },
);

export default api;
