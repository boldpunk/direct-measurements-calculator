// Thin fetch client for the MebelFlow backend (see /server).

// Falls back to the deployed Render API when VITE_API_URL isn't set at all (e.g.
// Netlify deploy previews). An explicitly empty string (same-origin deploys, where
// the frontend and API share one domain) is kept as-is, not treated as "unset" —
// that's why this is `??` and not `||`.
const API_BASE = import.meta.env.VITE_API_URL ?? 'https://mebelflow-api.onrender.com';
const TOKEN_KEY = 'mebelflow_token';
const EMPLOYEE_KEY = 'mebelflow_employee';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getCurrentEmployee() {
  try {
    const raw = localStorage.getItem(EMPLOYEE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setSession(token, employee) {
  localStorage.setItem(TOKEN_KEY, token);
  if (employee) localStorage.setItem(EMPLOYEE_KEY, JSON.stringify(employee));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMPLOYEE_KEY);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError('Нет связи с сервером', 0);
  }

  if (res.status === 401) {
    if (token) {
      // We had a session and the server no longer accepts it — it expired or was revoked.
      clearSession();
      if (!window.location.hash.startsWith('#/login')) {
        window.location.hash = '#/login';
      }
      throw new ApiError('Сессия истекла, войдите снова', 401);
    }
    // No session token means this was an anonymous request (e.g. a login attempt) —
    // fall through so the caller sees the server's actual error message.
  }
  if (res.status === 204) return null;

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError((data && data.error) || `Ошибка сервера (${res.status})`, res.status);
  return data;
}

export const api = {
  async login(email, password) {
    const data = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    setSession(data.token, data.employee);
    return data.employee;
  },
  logout() {
    clearSession();
  },
  async refresh() {
    const data = await request('/api/auth/refresh', { method: 'POST' });
    setSession(data.token);
    return data.token;
  },
  getState: () => request('/api/state'),

  createClient: (data) => request('/api/clients', { method: 'POST', body: data }),
  updateClient: (id, patch) => request(`/api/clients/${id}`, { method: 'PATCH', body: patch }),
  deleteClient: (id) => request(`/api/clients/${id}`, { method: 'DELETE' }),

  createOrder: (data) => request('/api/orders', { method: 'POST', body: data }),
  updateOrder: (id, patch) => request(`/api/orders/${id}`, { method: 'PATCH', body: patch }),
  updateOrderStatus: (id, status) => request(`/api/orders/${id}/status`, { method: 'PATCH', body: { status } }),
  deleteOrder: (id) => request(`/api/orders/${id}`, { method: 'DELETE' }),

  completeStage: (orderId, stageId) => request(`/api/orders/${orderId}/stages/${stageId}/complete`, { method: 'POST' }),
  setStageAssignment: (orderId, stageId, data) => request(`/api/orders/${orderId}/stages/${stageId}`, { method: 'PATCH', body: data }),

  addPayment: (orderId, data) => request(`/api/orders/${orderId}/payments`, { method: 'POST', body: data }),
  removePayment: (orderId, id) => request(`/api/orders/${orderId}/payments/${id}`, { method: 'DELETE' }),
  addMaterial: (orderId, data) => request(`/api/orders/${orderId}/materials`, { method: 'POST', body: data }),
  removeMaterial: (orderId, id) => request(`/api/orders/${orderId}/materials/${id}`, { method: 'DELETE' }),
  addOutsourceExpense: (orderId, data) => request(`/api/orders/${orderId}/outsourcing`, { method: 'POST', body: data }),
  removeOutsourceExpense: (orderId, id) => request(`/api/orders/${orderId}/outsourcing/${id}`, { method: 'DELETE' }),
  addSalaryExpense: (orderId, data) => request(`/api/orders/${orderId}/salaries`, { method: 'POST', body: data }),
  removeSalaryExpense: (orderId, id) => request(`/api/orders/${orderId}/salaries/${id}`, { method: 'DELETE' }),
  addOtherExpense: (orderId, data) => request(`/api/orders/${orderId}/other-expenses`, { method: 'POST', body: data }),
  removeOtherExpense: (orderId, id) => request(`/api/orders/${orderId}/other-expenses/${id}`, { method: 'DELETE' }),

  createTask: (data) => request('/api/tasks', { method: 'POST', body: data }),
  updateTask: (id, patch) => request(`/api/tasks/${id}`, { method: 'PATCH', body: patch }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),

  createRework: (data) => request('/api/rework', { method: 'POST', body: data }),
  updateReworkStatus: (id, status) => request(`/api/rework/${id}/status`, { method: 'PATCH', body: { status } }),

  createPartner: (data) => request('/api/partners', { method: 'POST', body: data }),
  deletePartner: (id) => request(`/api/partners/${id}`, { method: 'DELETE' }),

  createEmployee: (data) => request('/api/employees', { method: 'POST', body: data }),
  updateEmployee: (id, patch) => request(`/api/employees/${id}`, { method: 'PATCH', body: patch }),
  blockEmployee: (id, blocked) => request(`/api/employees/${id}/block`, { method: 'PATCH', body: { blocked } }),
  deleteEmployee: (id) => request(`/api/employees/${id}`, { method: 'DELETE' }),
  getRolePresets: () => request('/api/employees/roles'),

  updateSettings: (patch) => request('/api/settings', { method: 'PATCH', body: patch }),

  getAuditLog: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/api/audit-log${suffix}`);
  },
};
