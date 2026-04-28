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
  getActiveWithResponseTime: () => api.get('/candidates/active-response'),
  checkDangerous: (params)   => api.get('/candidates/check-dangerous', { params }),
  getByIds:     (ids)      => api.get('/candidates', { params: { ids: ids.join(',') } }),
  getStats:     ()         => api.get('/candidates/stats'),
  getAnalytics: (params)   => api.get('/candidates/analytics', { params }),
  getRecent:    (limit)    => api.get('/candidates/recent', { params: { limit } }),
  getById:      (id)       => api.get(`/candidates/${id}`),
  getDuplicates:(id)       => api.get(`/candidates/${id}/duplicates`),
  create:       (formData) => api.post('/candidates', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  update:       (id, formData) => api.put(`/candidates/${id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  updateStatus: (id, status, notes) => api.patch(`/candidates/${id}/status`, { status, notes }),
  delete:       (id)       => api.delete(`/candidates/${id}`),
  extract:               (formData) => api.post('/candidates/extract', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  parseAttachment:       (formData) => api.post('/candidates/parse-attachment', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  reassignCandidateOwner: (fromUserId, toUserId, recruiterId) => api.post('/candidates/reassign-owner', { fromUserId, toUserId, recruiterId }),
  bulkReassignOwner:      (candidateIds, toUserId) => api.post('/candidates/bulk-reassign-owner', { candidateIds, toUserId }),
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
  callScript:    (data) => api.post('/generate/call-script', data),
};

export const settingsApi = {
  getAll:              (params)       => api.get('/settings', { params }),
  save:                (key, value)   => api.put(`/settings/${key}`, { value }),
  saveOpenAIKey:       (apiKey)       => api.put('/settings/openai-key', { apiKey }),
  deleteOpenAIKey:     ()             => api.delete('/settings/openai-key'),
  saveEnhancvKey:      (apiKey)       => api.put('/settings/enhancv-key', { apiKey }),
  deleteEnhancvKey:    ()             => api.delete('/settings/enhancv-key'),
  extractLinkedIn:     (linkedinUrl)  => api.post('/settings/extract-linkedin', { linkedinUrl }),
  saveRecruiters:      (recruiters, userId) => api.put('/settings/recruiters', { recruiters }, userId ? { params: { userId } } : {}),
  saveCompanyScenario:  (scenario)           => api.put('/settings/company-scenario', { scenario }),
  saveCompanyScenarios: (scenarios, userId)   => api.put('/settings/company-scenarios', { scenarios }, userId ? { params: { userId } } : {}),
  saveCompanies:       (companies, userId) => api.put('/settings/companies', { companies }, userId ? { params: { userId } } : {}),
  getPins:             ()             => api.get('/settings/pins'),
  addPin:              (candidateId)  => api.post(`/settings/pins/${candidateId}`),
  removePin:           (candidateId)  => api.delete(`/settings/pins/${candidateId}`),
  sharePin:            (candidateId, targetUserId, candidateName) => api.post(`/settings/pins/${candidateId}/share`, { targetUserId, candidateName }),
  getKnowledge:        (params)       => api.get('/settings/knowledge/list', { params }),
  uploadFile:          (formData)     => api.post('/settings/knowledge/file', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  addUrl:              (url, category, companyId, companyName) => api.post('/settings/knowledge/url', { url, category, companyId, companyName }),
  addInstructions:     (content, name, companyId, companyName) => api.post('/settings/knowledge/instructions', { content, name, companyId, companyName }),
  testInstructions:    (instructions, prompt) => api.post('/settings/knowledge/test-instructions', { instructions, prompt }),
  deleteKnowledge:     (id)           => api.delete(`/settings/knowledge/${id}`),
  reassignKnowledge:   (fromCompanyId, toCompanyId, toCompanyName, userId) => api.post('/settings/knowledge/reassign', { fromCompanyId, toCompanyId, toCompanyName }, userId ? { params: { userId } } : {}),
  reassignKnowledgeOwner: (fromUserId, toUserId, companyId) => api.post('/settings/knowledge/reassign-owner', { fromUserId, toUserId, companyId }),
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

export const notificationApi = {
  getAll:      (params)     => api.get('/notifications', { params }),
  getCount:    ()           => api.get('/notifications/count'),
  getUsers:    ()           => api.get('/notifications/users'),
  getSent:     ()           => api.get('/notifications/sent'),
  send:        (data)       => api.post('/notifications', data),
  markRead:    (id)         => api.patch(`/notifications/${id}/read`),
  markAllRead: ()           => api.patch('/notifications/read-all'),
  remove:      (id)         => api.delete(`/notifications/${id}`),
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
