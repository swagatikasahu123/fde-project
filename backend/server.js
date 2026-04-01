'use strict';

/**
 * server.js — SAP O2C Graph API  —  Express entry point
 *
 * Boot sequence:
 *   1. Load .env
 *   2. Validate DATA_DIR exists
 *   3. Open SQLite with WAL + optimal pragmas
 *   4. Run initDatabase() — schema + full JSONL ingest
 *   5. Mount CORS, JSON body parser, request logger
 *   6. Register routes
 *   7. Listen
 *
 * The db handle lives at  app.locals.db  — accessible in every route
 * handler via  req.app.locals.db  (no global, no module singleton).
 *
 * Graceful shutdown on SIGINT / SIGTERM closes the DB before exit.
 */

require('dotenv').config();

const path     = require('path');
const fs       = require('fs');
const express  = require('express');
const cors     = require('cors');
const Database = require('better-sqlite3');

const { initDatabase } = require('./db/init');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (all overridable via .env)
// ─────────────────────────────────────────────────────────────────────────────

const PORT     = parseInt(process.env.PORT || '4000', 10);
const DB_PATH  = process.env.DB_PATH  || path.join(__dirname, 'sap_o2c.db');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// Comma-separated list of origins the browser is allowed to call from
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight checks
// ─────────────────────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) {
  console.error(
    `[server] FATAL: DATA_DIR not found: ${DATA_DIR}\n` +
    `         Unzip the dataset into backend/data/ so the structure is:\n` +
    `           data/business_partners/*.jsonl\n` +
    `           data/products/*.jsonl  etc.\n` +
    `         Or set DATA_DIR in .env`
  );
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Open SQLite
// ─────────────────────────────────────────────────────────────────────────────

let db;
try {
  db = new Database(DB_PATH);

  // Performance + safety pragmas (set before any user queries)
  db.pragma('journal_mode = WAL');   // concurrent reads during writes
  db.pragma('foreign_keys = ON');    // enforce FK constraints
  db.pragma('synchronous = NORMAL'); // safe + fast (not FULL)
  db.pragma('cache_size = -32000');  // ~32 MB page cache
  db.pragma('temp_store = MEMORY');  // temp tables in RAM
  db.pragma('mmap_size = 268435456');// 256 MB memory-mapped I/O

  console.log(`[server] SQLite opened: ${DB_PATH}`);
} catch (err) {
  console.error('[server] FATAL: Cannot open SQLite database:', err.message);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialise schema + ingest JSONL data
// ─────────────────────────────────────────────────────────────────────────────

try {
  initDatabase(db, DATA_DIR);
} catch (err) {
  console.error('[server] FATAL: Database initialisation failed:', err.message);
  console.error(err.stack);
  db.close();
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Express application
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// Attach db so every route can reach it via req.app.locals.db
app.locals.db = db;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({
  origin(origin, cb) {
    // Allow same-origin / non-browser requests (curl, Postman, SSR)
    if (!origin) return cb(null, true);
    if (CORS_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin "${origin}" is not allowed`));
  },
  methods:      ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:  true,
}));

app.use(express.json({ limit: '2mb' }));

// Lightweight request logger (avoids the morgan dependency)
app.use((req, _res, next) => {
  process.stdout.write(
    `[${new Date().toISOString()}] ${req.method.padEnd(6)} ${req.path}\n`
  );
  next();
});

// ── Built-in endpoints ────────────────────────────────────────────────────────

/**
 * GET /health
 * Pure liveness probe — does not touch the database.
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /api/status
 * Readiness probe — verifies the DB is open and returns row counts for
 * every core table. Useful for smoke-testing after startup.
 */
app.get('/api/status', (req, res) => {
  const dbHandle = req.app.locals.db;
  const tables = [
    'business_partners',
    'business_partner_addresses',
    'customer_company_assignments',
    'customer_sales_area_assignments',
    'plants',
    'products',
    'product_descriptions',
    'product_plants',
    'product_storage_locations',
    'sales_order_headers',
    'sales_order_items',
    'sales_order_schedule_lines',
    'outbound_delivery_headers',
    'outbound_delivery_items',
    'billing_document_headers',
    'billing_document_cancellations',
    'billing_document_items',
    'journal_entry_items_ar',
    'payments_ar',
  ];

  try {
    const rowCounts = {};
    for (const t of tables) {
      rowCounts[t] = dbHandle.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    }
    res.json({
      status:    'ready',
      dbPath:    DB_PATH,
      dataDir:   DATA_DIR,
      rowCounts,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── Feature routes (uncomment as each step is built) ─────────────────────────

// Step 2 — Graph endpoint
app.use('/api/graph', require('./routes/graph'));

// Step 3 — Chat / NL-to-SQL endpoint
app.use('/api/chat',  require('./routes/chat'));

// ── Error handlers ────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Four-argument signature is required by Express to recognise error middleware
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err.message);
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start listening
// ─────────────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[server] Listening on  http://localhost:${PORT}`);
  console.log(`[server] Health     →  http://localhost:${PORT}/health`);
  console.log(`[server] DB status  →  http://localhost:${PORT}/api/status`);
  console.log(`[server] CORS whitelist: ${CORS_ORIGINS.join(', ')}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[server] ${signal} — shutting down...`);
  server.close(() => {
    try {
      db.close();
      console.log('[server] SQLite closed cleanly.');
    } catch (e) {
      console.error('[server] Error closing DB:', e.message);
    }
    process.exit(0);
  });

  // Force-kill if still hanging after 10 s (e.g. long-running query)
  setTimeout(() => {
    console.error('[server] Forced exit after 10 s timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason);
  process.exit(1);
});

module.exports = app; // exported for integration tests
