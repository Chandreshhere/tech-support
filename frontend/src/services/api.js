import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// ---------- Global endpoints ----------
export const getSystemInfo   = () => api.get('/config/system');
export const getChromaHealth = () => api.get('/config/chroma');
export const getRagInfo      = () => api.get('/config/rag');
export const getAppConfig    = () => api.get('/config');
export const patchConfig     = (path, value) => api.patch('/config', { path, value });

export const getKeys         = () => api.get('/keys');
export const createKey       = (body) => api.post('/keys', body);
export const updateKey       = (id, body) => api.put(`/keys/${id}`, body);
export const deleteKey       = (id) => api.delete(`/keys/${id}`);

// ---------- Context CRUD ----------
export const listContexts    = () => api.get('/contexts');
export const getContext      = (id) => api.get(`/contexts/${id}`);
export const createContext   = (body) => api.post('/contexts', body);
export const updateContext   = (id, body) => api.patch(`/contexts/${id}`, body);
export const deleteContext   = (id) => api.delete(`/contexts/${id}`);

// ---------- Context-scoped helpers ----------
export function ctxApi(contextId) {
  const base = `/contexts/${contextId}`;
  return {
    listScreens:  ()              => api.get(`${base}/screens`),
    getScreen:    (name)          => api.get(`${base}/screens/${name}`),
    saveScreen:   (name, content) => api.put(`${base}/screens/${name}`, { content }),
    createScreen: (name, content) => api.post(`${base}/screens`, { name, content }),
    deleteScreen: (name)          => api.delete(`${base}/screens/${name}`),
    getMeta:      (name)          => api.get(`${base}/screens/${name}/meta`),
    saveMeta:     (name, customNotes) => api.put(`${base}/screens/${name}/meta`, { customNotes }),
    ingest:       ()              => api.post(`${base}/ingest`),
    stats:        ()              => api.get(`${base}/stats`),
    // Agent run control — long-lived requests (can take minutes). Caller
    // should use a long timeout via the `opts` passed here.
    agentRun:     (task)          => api.post(`${base}/agent/run`, { task }, { timeout: 10 * 60 * 1000 }),
    agentResume:  (runId, note)   => api.post(`${base}/agent/runs/${runId}/resume`, { note }, { timeout: 10 * 60 * 1000 }),
    agentCancel:  (runId)         => api.post(`${base}/agent/runs/${runId}/cancel`),
    agentCancelCurrent: ()        => api.post(`${base}/agent/cancel-current`),
    agentCurrent: ()              => api.get(`${base}/agent/current`),
    agentStatus:  (runId)         => api.get(`${base}/agent/runs/${runId}`),
  };
}

export default api;
