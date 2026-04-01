'use strict';

/**
 * routes/graph.js
 *
 * GET /api/graph
 *   Returns the full graph: { meta, nodes, edges }
 *   Query params:
 *     ?types=Customer,SalesOrder    Filter nodes to these types only
 *                                   (edges pruned to those whose both endpoints survive)
 *
 * GET /api/graph/expand/:nodeType/:nodeId
 *   Returns the focal node + all direct (1-hop) neighbors: { meta, nodes, edges }
 *   :nodeType  — one of: Customer | SalesOrder | Product | Plant |
 *                        Delivery | BillingDocument | Payment
 *   :nodeId    — the natural key of the node (e.g. "310000108", "740506")
 *
 * GET /api/graph/node/:nodeType/:nodeId
 *   Returns a single node with all its metadata fields.
 *
 * All responses follow the envelope:
 *   {
 *     meta:  { totalNodes, totalEdges, nodeTypes, edgeTypes, generatedAt },
 *     nodes: [ { id, type, label, data } ... ],
 *     edges: [ { source, target, label } ... ]
 *   }
 */

const express = require('express');
const router  = express.Router();

const {
  buildFullGraph,
  buildNeighborGraph,
  graphStats,
} = require('../db/graphBuilder');

// Valid node type names — used for input validation
const VALID_NODE_TYPES = new Set([
  'Customer',
  'SalesOrder',
  'Product',
  'Plant',
  'Delivery',
  'BillingDocument',
  'Payment',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Simple in-process cache so repeated calls do not re-run all SQL.
// TTL: 60 seconds. In production, swap with Redis or a proper cache layer.
// ─────────────────────────────────────────────────────────────────────────────
let   _graphCache     = null;
let   _graphCachedAt  = 0;
const CACHE_TTL_MS    = 60_000;

function getCachedFullGraph(db) {
  const now = Date.now();
  if (_graphCache && (now - _graphCachedAt) < CACHE_TTL_MS) {
    return _graphCache;
  }
  _graphCache    = buildFullGraph(db);
  _graphCachedAt = now;
  return _graphCache;
}

function invalidateCache() {
  _graphCache    = null;
  _graphCachedAt = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build the standard response envelope
// ─────────────────────────────────────────────────────────────────────────────

function envelope(nodes, edges) {
  return {
    meta: {
      ...graphStats(nodes, edges),
      generatedAt: new Date().toISOString(),
    },
    nodes,
    edges,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/graph
// ─────────────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const db = req.app.locals.db;
    let { nodes, edges } = getCachedFullGraph(db);

    // Optional ?types= filter  e.g. ?types=Customer,SalesOrder
    const typesParam = req.query.types;
    if (typesParam) {
      const allowed = new Set(
        typesParam.split(',').map(t => t.trim()).filter(t => VALID_NODE_TYPES.has(t))
      );
      if (allowed.size > 0) {
        const allowedIds = new Set(
          nodes.filter(n => allowed.has(n.type)).map(n => n.id)
        );
        nodes = nodes.filter(n => allowedIds.has(n.id));
        edges = edges.filter(e => allowedIds.has(e.source) && allowedIds.has(e.target));
      }
    }

    res.json(envelope(nodes, edges));
  } catch (err) {
    console.error('[graph] GET / error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/graph/stats   (lightweight — no node/edge arrays)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  try {
    const db = req.app.locals.db;
    const { nodes, edges } = getCachedFullGraph(db);
    res.json({
      ...graphStats(nodes, edges),
      generatedAt: new Date().toISOString(),
      cacheAgeMs:  Date.now() - _graphCachedAt,
    });
  } catch (err) {
    console.error('[graph] GET /stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/graph/node/:nodeType/:nodeId   (single node metadata)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/node/:nodeType/:nodeId', (req, res) => {
  const { nodeType, nodeId } = req.params;

  if (!VALID_NODE_TYPES.has(nodeType)) {
    return res.status(400).json({
      error: `Invalid nodeType "${nodeType}". Valid types: ${[...VALID_NODE_TYPES].join(', ')}`,
    });
  }

  try {
    const db = req.app.locals.db;
    const { nodes } = getCachedFullGraph(db);
    const targetId  = `${nodeType}:${nodeId}`;
    const node      = nodes.find(n => n.id === targetId);

    if (!node) {
      return res.status(404).json({ error: `Node not found: ${targetId}` });
    }

    res.json({ node });
  } catch (err) {
    console.error('[graph] GET /node error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/graph/expand/:nodeType/:nodeId
// ─────────────────────────────────────────────────────────────────────────────

router.get('/expand/:nodeType/:nodeId', (req, res) => {
  const { nodeType, nodeId } = req.params;

  if (!VALID_NODE_TYPES.has(nodeType)) {
    return res.status(400).json({
      error: `Invalid nodeType "${nodeType}". Valid types: ${[...VALID_NODE_TYPES].join(', ')}`,
    });
  }

  if (!nodeId || nodeId.trim() === '') {
    return res.status(400).json({ error: 'nodeId is required' });
  }

  try {
    const db = req.app.locals.db;
    const { nodes, edges } = buildNeighborGraph(db, nodeType, nodeId.trim());

    if (nodes.length === 0) {
      return res.status(404).json({
        error: `No node found for ${nodeType}:${nodeId}`,
      });
    }

    res.json({
      focalNode: `${nodeType}:${nodeId}`,
      ...envelope(nodes, edges),
    });
  } catch (err) {
    console.error('[graph] GET /expand error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/graph/invalidate-cache   (dev/admin helper)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/invalidate-cache', (_req, res) => {
  invalidateCache();
  res.json({ ok: true, message: 'Graph cache cleared.' });
});

module.exports = router;
