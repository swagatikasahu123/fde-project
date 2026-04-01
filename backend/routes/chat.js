'use strict';

/**
 * routes/chat.js
 *
 * POST /api/chat
 *
 * Request body:
 *   {
 *     message:             string   — the user's natural language question (required)
 *     conversationHistory: Array    — optional prior turns for multi-turn context
 *                                     [ { role: "user"|"assistant", content: string }, ... ]
 *   }
 *
 * Response:
 *   {
 *     answer:     string   — grounded natural language answer
 *     sql:        string|null  — the SQL that was executed (null if off-topic)
 *     rowCount:   number   — number of rows returned by the query
 *     isOffTopic: boolean  — true if the guardrail rejected the question
 *   }
 *
 * Error responses:
 *   400 — missing / invalid request body
 *   500 — pipeline error with message
 */

const express  = require('express');
const router   = express.Router();

const { runChatPipeline } = require('../services/claudeService');
const { createExecutor  } = require('../services/sqlExecutor');

// Maximum question length accepted (prevent prompt-injection via huge inputs)
const MAX_QUESTION_LENGTH    = 2000;
const MAX_HISTORY_TURNS      = 20;
const MAX_HISTORY_CONTENT_LEN = 4000; // per-turn content length cap

// ─────────────────────────────────────────────────────────────────────────────
// Input validation helpers
// ─────────────────────────────────────────────────────────────────────────────

function validateBody(body) {
  if (!body || typeof body !== 'object') {
    return 'Request body must be a JSON object.';
  }
  if (!body.message || typeof body.message !== 'string') {
    return '"message" field is required and must be a string.';
  }
  if (body.message.trim().length === 0) {
    return '"message" must not be empty.';
  }
  if (body.message.length > MAX_QUESTION_LENGTH) {
    return `"message" must be ≤ ${MAX_QUESTION_LENGTH} characters.`;
  }
  if (body.conversationHistory !== undefined) {
    if (!Array.isArray(body.conversationHistory)) {
      return '"conversationHistory" must be an array if provided.';
    }
  }
  return null; // valid
}

/**
 * Sanitise the conversation history:
 *   - Keep only the last N turns
 *   - Only allow 'user' and 'assistant' roles
 *   - Truncate oversized turn content
 */
function sanitiseHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .slice(-MAX_HISTORY_TURNS)
    .map(t => ({
      role:    t.role,
      content: t.content.slice(0, MAX_HISTORY_CONTENT_LEN),
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat
// ─────────────────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  // 1. Validate input
  const validationError = validateBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const question           = req.body.message.trim();
  const conversationHistory = sanitiseHistory(req.body.conversationHistory);

  // 2. Build a bound SQL executor using this request's db handle
  const db          = req.app.locals.db;
  const executeSql  = createExecutor(db);

  // 3. Run the pipeline
  const pipelineStart = Date.now();
  let result;
  try {
    result = await runChatPipeline(question, conversationHistory, executeSql);
  } catch (err) {
    console.error('[chat] Pipeline error:', err.message);
    return res.status(500).json({
      error:   err.message || 'Internal pipeline error',
      answer:  'Sorry, something went wrong while processing your question. Please try again.',
      sql:     null,
      rowCount: 0,
      isOffTopic: false,
    });
  }

  const totalMs = Date.now() - pipelineStart;

  // 4. Log summary
  console.log(
    `[chat] "${question.slice(0, 60)}${question.length > 60 ? '…' : ''}" ` +
    `→ ${result.isOffTopic ? 'OFF_TOPIC' : `${result.rowCount} rows`} ` +
    `(${totalMs}ms)`
  );

  // 5. Respond
  res.json({
    answer:     result.answer,
    sql:        result.sql,
    rowCount:   result.rowCount,
    isOffTopic: result.isOffTopic,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/health — quick check that Anthropic API key is configured
// ─────────────────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  const keyConfigured = !!(process.env.GROQ_API_KEY &&
    process.env.GROQ_API_KEY !== 'placeholder' &&
    process.env.GROQ_API_KEY.length > 10);
  res.json({
    status:        keyConfigured ? 'ready' : 'missing_api_key',
    model:         'llama-3.3-70b-versatile',
    keyConfigured,
  });
});

module.exports = router;
