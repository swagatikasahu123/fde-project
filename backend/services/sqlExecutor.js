'use strict';

/**
 * services/sqlExecutor.js
 *
 * Safely executes Claude-generated SQL against the SQLite database.
 *
 * Safety guarantees:
 *   1. Only SELECT statements are permitted (checked before execution).
 *   2. Hard cap of 100 rows — Claude is instructed to add LIMIT itself,
 *      but this enforces it regardless.
 *   3. SQL is executed on the shared read/write db handle but the
 *      pre-execution checks make mutation impossible.
 *   4. Dangerous keywords (DROP, DELETE, INSERT, UPDATE, ALTER, ATTACH,
 *      PRAGMA write ops) are rejected with a descriptive error.
 *   5. Execution errors are caught and re-thrown with context.
 *
 * Exports:
 *   createExecutor(db) → executeSql(sql)
 *   executeSql(db, sql) → { rows, rowCount, sql, executionTimeMs }
 */

const MAX_ROWS = 100;

// Keywords that must never appear in a safe SELECT query
const DANGEROUS_PATTERNS = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bDROP\b/i,
  /\bCREATE\b/i,
  /\bALTER\b/i,
  /\bATTACH\b/i,
  /\bDETACH\b/i,
  /\bREINDEX\b/i,
  /\bVACUUM\b/i,
  /\bPRAGMA\s+\w+\s*=/i,  // PRAGMA writes (PRAGMA journal_mode = WAL etc.)
];

/**
 * Validate that the SQL is a safe SELECT statement.
 * Throws a descriptive Error if it is not.
 */
function validateSQL(sql) {
  if (!sql || typeof sql !== 'string') {
    throw new Error('SQL must be a non-empty string.');
  }

  const trimmed = sql.trim();

  // Must start with SELECT (case-insensitive, allowing leading comments)
  const withoutLeadingComments = trimmed.replace(/^(--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)+/, '').trim();
  if (!/^SELECT\b/i.test(withoutLeadingComments)) {
    throw new Error(
      `Only SELECT statements are permitted. The generated SQL starts with: "${trimmed.slice(0, 80)}"`
    );
  }

  // Check for dangerous mutation keywords
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(
        `SQL contains a forbidden keyword matching pattern ${pattern}. ` +
        `Only read-only SELECT queries are allowed.`
      );
    }
  }
}

/**
 * Inject or enforce LIMIT on a SQL string.
 * If the SQL already has a LIMIT ≤ MAX_ROWS, leave it alone.
 * If it has no LIMIT, append LIMIT MAX_ROWS.
 * If it has LIMIT > MAX_ROWS, replace it.
 */
function enforceLimit(sql) {
  const limitMatch = sql.match(/\bLIMIT\s+(\d+)/i);
  if (limitMatch) {
    const existing = parseInt(limitMatch[1], 10);
    if (existing > MAX_ROWS) {
      return sql.replace(/\bLIMIT\s+\d+/i, `LIMIT ${MAX_ROWS}`);
    }
    return sql; // existing LIMIT is fine
  }
  // No LIMIT present — strip trailing semicolons and append
  return sql.replace(/;+\s*$/, '').trimEnd() + `\nLIMIT ${MAX_ROWS}`;
}

/**
 * Execute a SQL SELECT statement and return the results.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sql
 * @returns {{ rows: object[], rowCount: number, sql: string, executionTimeMs: number }}
 */
function executeSql(db, sql) {
  // 1. Validate
  validateSQL(sql);

  // 2. Enforce row limit
  const safeSql = enforceLimit(sql);

  // 3. Execute synchronously (better-sqlite3 is fully sync)
  const start = Date.now();
  let rows;
  try {
    rows = db.prepare(safeSql).all();
  } catch (err) {
    // Provide useful context in the error message
    throw new Error(
      `SQLite execution error: ${err.message}\n` +
      `SQL attempted:\n${safeSql}`
    );
  }
  const executionTimeMs = Date.now() - start;

  return {
    rows,
    rowCount:       rows.length,
    sql:            safeSql,
    executionTimeMs,
  };
}

/**
 * Factory — returns a bound executeSql function for a given db handle.
 * Use this when you want to pass executeSql as a callback without
 * carrying the db reference separately.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {(sql: string) => { rows, rowCount, sql, executionTimeMs }}
 */
function createExecutor(db) {
  return (sql) => executeSql(db, sql);
}

module.exports = { executeSql, createExecutor, validateSQL, enforceLimit };
