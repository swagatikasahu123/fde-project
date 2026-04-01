import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: BASE,
  timeout: 60000, // 60s — LLM calls can be slow
  headers: { 'Content-Type': 'application/json' },
});

/* ── Graph endpoints ─────────────────────────────────────── */

/** Full graph: { meta, nodes, edges } */
export const fetchGraph = () =>
  api.get('/api/graph').then(r => r.data);

/** Graph filtered by node types */
export const fetchGraphByTypes = (types) =>
  api.get(`/api/graph?types=${types.join(',')}`).then(r => r.data);

/** 1-hop neighborhood of a node */
export const expandNode = (nodeType, nodeId) =>
  api.get(`/api/graph/expand/${nodeType}/${encodeURIComponent(nodeId)}`).then(r => r.data);

/** Single node metadata */
export const fetchNode = (nodeType, nodeId) =>
  api.get(`/api/graph/node/${nodeType}/${encodeURIComponent(nodeId)}`).then(r => r.data);

/** Graph stats (lightweight) */
export const fetchGraphStats = () =>
  api.get('/api/graph/stats').then(r => r.data);

/* ── Chat endpoint ───────────────────────────────────────── */

/**
 * Send a chat message.
 * @param {string} message
 * @param {Array}  conversationHistory  — [{role,content}, ...]
 * @returns {{ answer, sql, rowCount, isOffTopic }}
 */
export const sendMessage = (message, conversationHistory = []) =>
  api.post('/api/chat', { message, conversationHistory }).then(r => r.data);

/* ── Health ──────────────────────────────────────────────── */
export const fetchHealth = () =>
  api.get('/api/chat/health').then(r => r.data);

export default api;
