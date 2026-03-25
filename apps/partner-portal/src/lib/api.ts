import axios from 'axios';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export const api = axios.create({ baseURL: API_URL });

// ─── TTL Cache (reduces repeated calls for stable GET endpoints) ───────────────
const _cache = new Map<string, { data: unknown; expiresAt: number }>();

function cachedGet(url: string, ttlMs: number) {
  const hit = _cache.get(url);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve({ data: hit.data });
  return api.get(url).then((res) => {
    _cache.set(url, { data: res.data, expiresAt: Date.now() + ttlMs });
    return res;
  });
}

export function invalidateCache(...urls: string[]) {
  urls.forEach((url) => _cache.delete(url));
}

// ─── Rate-limit gate ──────────────────────────────────────────────────────────
let _rateLimitedUntil = 0;

export function isRateLimited() { return _rateLimitedUntil > Date.now(); }

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) config.headers['Authorization'] = `Bearer ${token}`;
  }
  // Block outgoing requests while rate-limited
  if (isRateLimited()) {
    return Promise.reject(Object.assign(new Error('Rate limited'), { isRateLimit: true }));
  }
  return config;
});

// Handle 401 and 429
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      // Don't redirect if already on login page or the failing URL is a known public endpoint
      const publicPaths = ['/api/auth/', '/api/partners/platform-branding'];
      const url: string = error.config?.url ?? '';
      const alreadyOnLogin = window.location.pathname === '/login';
      const isPublicPath = publicPaths.some((p) => url.includes(p));
      if (!alreadyOnLogin && !isPublicPath) {
        localStorage.removeItem('access_token');
        window.location.href = '/login';
      }
    }
    if (error.response?.status === 429 && typeof window !== 'undefined') {
      const retryAfter = parseInt(error.response.headers?.['retry-after'] ?? '60', 10);
      _rateLimitedUntil = Date.now() + retryAfter * 1000;
      window.dispatchEvent(new CustomEvent('bx:rate-limited', { detail: { retryAfter } }));
    }
    return Promise.reject(error);
  }
);

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ data: { accessToken: string; refreshToken: string } }>('/api/auth/login', { email, password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ success: boolean; message: string }>('/api/auth/change-password', { currentPassword, newPassword }),
};

// ─── Partners ─────────────────────────────────────────────────────────────────
export const partnersApi = {
  register: (data: object) => api.post('/api/partners', data),
  list: (page = 1, pageSize = 20) => api.get(`/api/partners?page=${page}&pageSize=${pageSize}`),
  get: (id: string) => cachedGet(`/api/partners/${id}`, 60_000),           // 60s — sidebar profile
  updateProfile: (id: string, data: {
    webhook_url?: string;
    supported_formats?: string[];
    supported_message_types?: string[];
    llm_use_platform?: boolean;
    llm_provider?: string;
    llm_endpoint?: string;
    llm_model?: string;
    llm_api_key?: string;
  }) => {
    invalidateCache(`/api/partners/${id}`);
    return api.put(`/api/partners/${id}`, data);
  },
  listPending: () => api.get('/api/partners/admin/pending'),
  approve: (id: string) => api.post(`/api/partners/admin/${id}/approve`),
  reject: (id: string) => api.post(`/api/partners/admin/${id}/reject`),
  suspend: (id: string) => api.post(`/api/partners/admin/${id}/suspend`),
};

// ─── Subscriptions ────────────────────────────────────────────────────────────
export const subscriptionsApi = {
  list: () => cachedGet('/api/subscriptions', 30_000),                     // 30s — sidebar badge
  getSendTargets: () => cachedGet('/api/subscriptions/send-targets', 30_000),
  create: (providerPartnerId: string) => {
    invalidateCache('/api/subscriptions', '/api/subscriptions/send-targets');
    return api.post('/api/subscriptions', { providerPartnerId });
  },
  approve: (id: string) => {
    invalidateCache('/api/subscriptions', '/api/subscriptions/send-targets');
    return api.post(`/api/subscriptions/${id}/approve`);
  },
  terminate: (id: string) => {
    invalidateCache('/api/subscriptions', '/api/subscriptions/send-targets');
    return api.post(`/api/subscriptions/${id}/terminate`);
  },
};

// ─── Integrations ─────────────────────────────────────────────────────────────
export const integrationsApi = {
  listMessages: (filters?: {
    direction?: 'sent' | 'received' | 'all';
    status?: string;
    format?: string;
    search?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.direction && filters.direction !== 'all') params.set('direction', filters.direction);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.format) params.set('format', filters.format);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    if (filters?.limit != null) params.set('limit', String(filters.limit));
    if (filters?.offset != null) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return api.get(`/api/integrations/messages${qs ? `?${qs}` : ''}`);
  },
  getMessage: (id: string) => api.get(`/api/integrations/messages/${id}`),
  getStats: () => api.get('/api/integrations/messages/stats'),
  sendMessage: (targetPartnerId: string, payload: unknown, format = 'json') =>
    api.post('/api/integrations/messages', payload, {
      headers: { 'x-target-partner-id': targetPartnerId, 'Content-Type': `application/${format}` },
    }),

  // ── Validation (Integration Handshake) ────────────────────────────────────
  initiateValidation: (receiverPartnerId: string, format: string, payload: string, notes?: string) =>
    api.post('/api/integrations/validate', { receiverPartnerId, format, payload, notes }),

  listValidations: (role?: 'initiator' | 'receiver' | 'all', status?: string) => {
    const params = new URLSearchParams();
    if (role && role !== 'all') params.set('role', role);
    if (status) params.set('status', status);
    const qs = params.toString();
    return api.get(`/api/integrations/validations${qs ? `?${qs}` : ''}`);
  },

  confirmValidation: (id: string, notes?: string) =>
    api.post(`/api/integrations/validations/${id}/confirm`, { notes }),

  rejectValidation: (id: string, notes?: string) =>
    api.post(`/api/integrations/validations/${id}/reject`, { notes }),

  getPartnerStats: (partnerId: string) =>
    api.get(`/api/integrations/partner-stats/${partnerId}`),
};

// ─── Mappings ─────────────────────────────────────────────────────────────────
export const mappingsApi = {
  registerSchema: (format: string, messageType: string, samplePayload: string, direction: 'outbound' | 'inbound' = 'outbound', sampleSchema?: string) =>
    api.post('/api/mappings/schemas', { format, messageType, samplePayload, direction, sampleSchema }),
  listSchemas: (partnerId: string) => api.get(`/api/mappings/schemas/${partnerId}`),
  getPartnerActiveSchemas: (partnerId: string) => api.get(`/api/mappings/schemas/${partnerId}/active`),
  getCdmFields: () => api.get('/api/mappings/schemas/cdm'),
  approveSchema: (id: string) => api.post(`/api/mappings/schemas/${id}/approve`),
  updateRules: (id: string, mappingRules: object[]) =>
    api.patch(`/api/mappings/schemas/${id}/rules`, { mappingRules }),
  activateSchema: (id: string) => api.post(`/api/mappings/schemas/${id}/activate`),
  deleteSchema: (id: string) => api.delete(`/api/mappings/schemas/${id}`),
  testTransform: (payload: string, format: string, sourcePartnerId: string, targetPartnerId: string, stage1Only = false) =>
    api.post('/api/mappings/transform', { payload, format, sourcePartnerId, targetPartnerId, stage1Only }),
  testLlm: (scope: 'platform' | 'partner') =>
    api.post('/api/mappings/test-llm', { scope }),
  getPartnerCapabilities: (partnerId: string) =>
    api.get(`/api/mappings/capabilities/${partnerId}`),
};

// ─── Agents ───────────────────────────────────────────────────────────────────
export const agentsApi = {
  listEvents: (limit = 50) => api.get(`/api/agents/events?limit=${limit}`),
  getOverview: () => api.get('/api/agents/overview'),
};

// ─── Billing ──────────────────────────────────────────────────────────────────
export const billingApi = {
  // Partner views
  getMy: () => api.get('/api/billing/my'),
  getUsage: (period?: string) => api.get(`/api/billing/usage${period ? `?period=${period}` : ''}`),
  getLLMUsage: (period?: string) => api.get(`/api/billing/llm-usage${period ? `?period=${period}` : ''}`),
  getInvoices: () => api.get('/api/billing/invoices'),
  getPlans: () => api.get('/api/billing/plans'),
  selectPlan: (planId: string) => api.put('/api/billing/my/plan', { plan_id: planId }),
  // Admin
  adminGetPlans: () => api.get('/api/billing/admin/plans'),
  adminCreatePlan: (data: object) => api.post('/api/billing/admin/plans', data),
  adminUpdatePlan: (id: string, data: object) => api.put(`/api/billing/admin/plans/${id}`, data),
  adminUpdateRates: (id: string, rates: object[]) => api.put(`/api/billing/admin/plans/${id}/rates`, { rates }),
  adminGetPartners: () => api.get('/api/billing/admin/partners'),
  adminAssignPlan: (partnerId: string, data: object) => api.put(`/api/billing/admin/partners/${partnerId}`, data),
  adminGetUsage: (period?: string) => api.get(`/api/billing/admin/usage${period ? `?period=${period}` : ''}`),
  adminGetInvoices: (period?: string) => api.get(`/api/billing/admin/invoices${period ? `?period=${period}` : ''}`),
  adminGenerateInvoices: (period: string, partner_ids?: string[]) => api.post('/api/billing/admin/invoices/generate', { period, partner_ids }),
  adminMarkPaid: (id: string) => api.put(`/api/billing/admin/invoices/${id}/paid`, {}),
};
export const adminApi = {
  getSettings: () => api.get('/api/partners/admin/settings'),
  updateSettings: (data: Record<string, string>) => api.put('/api/partners/admin/settings', data),
  enableDemo: () => api.post('/api/partners/admin/demo/enable'),
  disableDemo: () => api.post('/api/partners/admin/demo/disable'),
  listAll: () => api.get('/api/partners/admin/all'),
  listPending: () => api.get('/api/partners/admin/pending'),
  approve: (id: string) => api.post(`/api/partners/admin/${id}/approve`),
  reject: (id: string) => api.post(`/api/partners/admin/${id}/reject`),
  suspend: (id: string) => api.post(`/api/partners/admin/${id}/suspend`),
  archive: (id: string) => api.post(`/api/partners/admin/${id}/archive`),
  deletePartner: (id: string) => api.delete(`/api/partners/admin/${id}`),
};

export const brandingApi = {
  getPlatform: () => cachedGet('/api/partners/platform-branding', 120_000), // 2min — global, rarely changes
  updatePlatform: (data: BrandingConfig) => {
    invalidateCache('/api/partners/platform-branding');
    return api.put('/api/partners/platform-branding', data);
  },
  getPartner: (id: string) => cachedGet(`/api/partners/${id}/branding`, 60_000), // 60s
  updatePartner: (id: string, data: BrandingConfig) => {
    invalidateCache(`/api/partners/${id}/branding`);
    return api.put(`/api/partners/${id}/branding`, data);
  },
};

export interface BrandingConfig {
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
  platformName?: string;
  tagline?: string;
}

// ─── A2A / Exchange Agent ─────────────────────────────────────────────────────
export const a2aApi = {
  listSessions: (page = 1, pageSize = 20) =>
    api.get(`/a2a/sessions?page=${page}&pageSize=${pageSize}`),
};

// ─── API Keys ─────────────────────────────────────────────────────────────────
export const apiKeysApi = {
  list:     ()          => api.get('/api/auth/keys'),
  generate: ()          => api.post('/api/auth/keys'),
  revoke:   (id: string) => api.delete(`/api/auth/keys/${id}`),
};
