// Single source of truth for talking to the backend.
//
// Base URL resolution:
//   1. VITE_API_URL (explicit override at build time), else
//   2. '' in a production build — the backend serves this frontend, so the API
//      lives on the SAME origin and relative paths like /api work, else
//   3. http://localhost:5000 in local dev (separate Vite dev server).
import axios from 'axios';

export const API_BASE =
    import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:5000');

const api = axios.create({ baseURL: `${API_BASE}/api` });

// Attach the JWT (if present) to every request.
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

// A 401 while holding a token means the session is stale (e.g. the account no
// longer matches the token) — clear it and return to the login screen instead
// of showing broken pages.
api.interceptors.response.use(
    (res) => res,
    (err) => {
        if (err.response?.status === 401 && localStorage.getItem('token')) {
            localStorage.removeItem('token');
            localStorage.removeItem('role');
            window.location.href = '/';
        }
        return Promise.reject(err);
    }
);

// Builds a servable URL for an uploaded file. Uses only the basename so it works
// for both new records (uploads/<file>) and legacy absolute disk paths — every
// uploaded file is served from the backend's /uploads static route.
export const fileUrl = (filepath) =>
    `${API_BASE}/uploads/${(filepath || '').split(/[\\/]/).pop()}`;

export default api;
