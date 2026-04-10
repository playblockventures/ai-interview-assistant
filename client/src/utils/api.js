import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api',
  timeout: 60000,
});

// Inject JWT token from localStorage on every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res.data,
  err => {
    const message = err.response?.data?.error || err.message || 'Something went wrong';
    // Auto-logout on 401 — but NOT for auth endpoints (prevents redirect loop)
    if (err.response?.status === 401 && !(err.config?.url || '').includes('/auth/')) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.replace('/login');
    }
    return Promise.reject(new Error(message));
  }
);

export const authApi = {
  login:          (data) => api.post('/auth/login', data),
  me:             ()     => api.get('/auth/me'),
  changePassword: (data) => api.post('/auth/change-password', data),
  // Admin user management
  listUsers:      ()     => api.get('/auth/users'),
  createUser:     (data) => api.post('/auth/users', data),
  deleteUser:     (id)   => api.delete(`/auth/users/${id}`),
  resetPassword:  (id, newPassword) => api.post(`/auth/users/${id}/reset-password`, { newPassword }),
};

export const candidateApi = {
  getAll:       (params)   => api.get('/candidates', { params }),
  getById:      (id)       => api.get(`/candidates/${id}`),
  create:       (formData) => api.post('/candidates', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  update:       (id, formData) => api.put(`/candidates/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  updateStatus: (id, status, notes) => api.patch(`/candidates/${id}/status`, { status, notes }),
  delete:       (id)       => api.delete(`/candidates/${id}`),
  extract:          (formData) => api.post('/candidates/extract', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  parseAttachment:  (formData) => api.post('/candidates/parse-attachment', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
};

export const generateApi = {
  scenario:      (data) => api.post('/generate/scenario', data),
  outreach:      (data) => api.post('/generate/outreach', data),
  conversation:  (data) => api.post('/generate/conversation', data),
  recommendRole: (data) => api.post('/generate/recommend-role', data),
  exportPdf:     (data) => axios.post('/api/generate/export-pdf', data, {
    responseType: 'blob', timeout: 30000,
    headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
  }),
};

export const settingsApi = {
  getAll:              (params)       => api.get('/settings', { params }),
  save:                (key, value)   => api.put(`/settings/${key}`, { value }),
  saveOpenAIKey:       (apiKey)       => api.put('/settings/openai-key', { apiKey }),
  deleteOpenAIKey:     ()             => api.delete('/settings/openai-key'),
  saveRecruiters:      (recruiters, userId) => api.put('/settings/recruiters', { recruiters }, userId ? { params: { userId } } : {}),
  saveCompanyScenario:  (scenario)           => api.put('/settings/company-scenario', { scenario }),
  saveCompanyScenarios: (scenarios)          => api.put('/settings/company-scenarios', { scenarios }),
  saveCompanies:       (companies)    => api.put('/settings/companies', { companies }),
  getKnowledge:        (params)       => api.get('/settings/knowledge/list', { params }),
  uploadFile:          (formData)     => api.post('/settings/knowledge/file', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  addUrl:              (url, category, companyId, companyName) => api.post('/settings/knowledge/url', { url, category, companyId, companyName }),
  addInstructions:     (content, name, companyId, companyName) => api.post('/settings/knowledge/instructions', { content, name, companyId, companyName }),
  testInstructions:    (instructions, prompt) => api.post('/settings/knowledge/test-instructions', { instructions, prompt }),
  deleteKnowledge:     (id)           => api.delete(`/settings/knowledge/${id}`),
};

export const exportApi = {
  exportData: (scope) => axios.get('/api/export', {
    params: { scope },
    responseType: 'blob',
    timeout: 120000,
    headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
  }),
  importData: (formData, mode) => api.post('/export', formData, {
    params: { mode },
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }),
};

export const interviewApi = {
  getHistory:            (id)            => api.get(`/interviews/${id}`),
  clearConversation:     (id)            => api.delete(`/interviews/${id}/conversation`),
  // Conversation
  addConversationMsg:    (id, role, content) => api.post(`/interviews/${id}/conversation`, { role, content }),
  editConversationMsg:   (id, idx, content) => api.patch(`/interviews/${id}/conversation/${idx}`, { content }),
  deleteConversationMsg: (id, idx)       => api.delete(`/interviews/${id}/conversation/${idx}`),
  // Outreach
  addOutreachMsg:        (id, content, type) => api.post(`/interviews/${id}/outreach`, { content, type }),
  editOutreachMsg:       (id, idx, content) => api.patch(`/interviews/${id}/outreach/${idx}`, { content }),
  deleteOutreachMsg:     (id, idx)       => api.delete(`/interviews/${id}/outreach/${idx}`),
  // Scenario
  editScenario:          (id, idx, content) => api.patch(`/interviews/${id}/scenario/${idx}`, { content }),
  deleteScenario:        (id, idx)       => api.delete(`/interviews/${id}/scenario/${idx}`),
};

export default api;
