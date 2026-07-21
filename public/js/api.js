'use strict';

// Single network boundary for the whole frontend. Attaches the JWT, sets the
// right content type, parses the response, and redirects to login on 401.
class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function api(method, path, options = {}) {
  const { body, form } = options;
  const headers = {};
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let payload;
  if (form) {
    payload = form; // FormData — let the browser set the multipart boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch('/api' + path, { method, headers, body: payload });

  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }

  if (res.status === 401) {
    Auth.clear();
    const onPublic = /(^|\/)(index\.html|login\.html|register\.html)$/.test(location.pathname) || location.pathname.endsWith('/');
    if (!onPublic) location.href = 'login.html';
    throw new ApiError('Your session has expired. Please log in again.', 401, data);
  }
  if (!res.ok) {
    const message = (data && data.error && data.error.message) || 'Something went wrong.';
    throw new ApiError(message, res.status, data);
  }
  return data;
}

const API = {
  get: (p) => api('GET', p),
  post: (p, body) => api('POST', p, { body }),
  postForm: (p, form) => api('POST', p, { form }),
  put: (p, body) => api('PUT', p, { body }),
  putForm: (p, form) => api('PUT', p, { form }),
  patch: (p, body) => api('PATCH', p, { body }),
  del: (p) => api('DELETE', p),
};

window.api = api;
window.API = API;
window.ApiError = ApiError;
