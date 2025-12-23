import axios, { AxiosHeaders } from 'axios';
import { resolveBackendUrl } from '@/lib/backendUrl';

export const api = axios.create();

// Add request interceptor to include auth token
api.interceptors.request.use(
  config => {
    const url = typeof config.url === 'string' ? config.url : '';
    const isAbsoluteUrl = /^https?:\/\//i.test(url);
    if (!isAbsoluteUrl) {
      const backendUrl = resolveBackendUrl();
      if (!backendUrl) {
        return Promise.reject(new Error('Backend URL not configured'));
      }
      config.baseURL = backendUrl;
    }

    const token = localStorage.getItem('auth_token');
    if (token) {
      const hdrs =
        config.headers instanceof AxiosHeaders
          ? config.headers
          : new AxiosHeaders((config.headers as any) || undefined);
      hdrs.set('Authorization', `Bearer ${token}`);
      config.headers = hdrs;
    }
    return config;
  },
  error => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  res => res,
  err => {
    try {
      const hasResponse = !!err?.response;
      if (!hasResponse) {
        const resolved = resolveBackendUrl();
        const baseURL = String(err?.config?.baseURL || resolved || '');
        const url = String(err?.config?.url || '');
        const code = String(err?.code || '');
        const method = String(err?.config?.method || '').toUpperCase();
        const details = [
          code ? `code=${code}` : null,
          baseURL ? `baseURL=${baseURL}` : null,
          url ? `url=${url}` : null,
          method ? `method=${method}` : null,
        ]
          .filter(Boolean)
          .join(' ');

        const msg = details
          ? `Network Error (${details})`
          : 'Network Error';

        if (typeof err?.message === 'string') {
          err.message = msg;
        }
      }
    } catch {
      // ignore
    }

    if (err.response?.status === 401) {
      // logout ONCE
      window.dispatchEvent(new Event('force-logout'));
    }
    return Promise.reject(err);
  }
);
