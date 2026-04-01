import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider,
  Background, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow,
  MarkerType, Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { expandNode } from '../api/client';

/* ── Node type colours ─────────────────────────────────────────── */
const TYPE_META = {
  Customer:        { color: '#3b82f6', bg: '#0f2240', label: 'Customer' },
  SalesOrder:      { color: '#22c55e', bg: '#0d2a14', label: 'Sales Order' },
  Product:         { color: '#f97316', bg: '#2a1500', label: 'Product' },
  Plant:           { color: '#ca8a04', bg: '#221900', label: 'Plant' },
  Delivery:        { color: '#a855f7', bg: '#200a30', label: 'Delivery' },
  BillingDocument: { color: '#ef4444', bg: '#250a0a', label: 'Billing' },
  Payment:         { color: '#14b8a6', bg: '#052820', label: 'Payment' },
};

const EDGE_LABEL_COLORS = {
  PLACES:      '#3b82f6',
  ORDERS:      '#22c55e',
  CONTAINS:    '#f97316',
  FULFILLED_BY:'#a855f7',
  SHIPS_FROM:  '#ca8a04',
  STORED_AT:   '#6b7280',
  INVOICED_AS: '#ef4444',
  CLEARED_BY:  '#14b8a6',
  PAYS:        '#3b82f6',
  CANCELLED:   '#ef4444',
};

/* ── Custom node ───────────────────────────────────────────────── */
function SapNode({ data, selected }) {
  const meta = TYPE_META[data.nodeType] || { color: '#6b7280', bg: '#1a1a1a', label: data.nodeType };
  return (
    <div style={{
      padding: '8px 12px',
      borderRadius: 8,
      background: meta.bg,
      border: `1.5px solid ${selected ? meta.color : meta.color + '60'}`,
      minWidth: 110, maxWidth: 170,
      boxShadow: selected
        ? `0 0 0 2px ${meta.color}55, 0 4px 20px rgba(0,0,0,0.5)`
        : '0 2px 10px rgba(0,0,0,0.4)',
      transition: 'box-shadow 0.15s, border-color 0.15s',
      cursor: 'pointer',
      position: 'relative',
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
        color: meta.color, textTransform: 'uppercase', marginBottom: 3,
        fontFamily: 'IBM Plex Mono, monospace',
      }}>
        {meta.label}
      </div>
      <div style={{
        fontSize: 11, color: '#e8eaf0', fontWeight: 500,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        lineHeight: 1.3,
      }}>
        {data.label}
      </div>
      {data.expanded && (
        <div style={{
          position: 'absolute', top: -4, right: -4,
          width: 8, height: 8, borderRadius: '50%',
          background: meta.color, border: '1px solid #0d0f14',
        }}/>
      )}
      {/* Handles */}
      <div style={{
        position:'absolute', left:'50%', top:-4,
        transform:'translateX(-50%)',
        width:8, height:8, borderRadius:'50%',
        background: meta.color + '80', border: `1px solid ${meta.color}`,
      }}/>
      <div style={{
        position:'absolute', left:'50%', bottom:-4,
        transform:'translateX(-50%)',
        width:8, height:8, borderRadius:'50%',
        background: meta.color + '80', border: `1px solid ${meta.color}`,
      }}/>
    </div>
  );
}

const nodeTypes = { sapNode: SapNode };

/* ── Layout: simple force-like positioning ─────────────────────── */
function layoutNodes(rawNodes, rawEdges) {
  const TYPE_ORDER = ['Customer','SalesOrder','Product','Plant','Delivery','BillingDocument','Payment'];
  const COLS = { Customer: 0, SalesOrder: 1, Product: 2, Plant: 3, Delivery: 4, BillingDocument: 5, Payment: 6 };
  const COL_X = [0, 220, 440, 660, 880, 1100, 1320];
  const Y_GAP = 90;

  const byType = {};
  for (const t of TYPE_ORDER) byType[t] = [];
  for (const n of rawNodes) {
    const t = n.type || 'Customer';
    if (!byType[t]) byType[t] = [];
    byType[t].push(n);
  }

  const positioned = [];
  for (const t of TYPE_ORDER) {
    const group = byType[t] || [];
    group.forEach((n, i) => {
      const x = COL_X[COLS[t]] || 0;
      const y = i * Y_GAP - ((group.length - 1) * Y_GAP) / 2;
      positioned.push({
        id:       n.id,
        type:     'sapNode',
        position: { x, y },
        data: {
          label:    n.label,
          nodeType: n.type,
          metadata: n.data,
          expanded: false,
        },
      });
    });
  }
  return positioned;
}

function buildEdges(rawEdges) {
  return rawEdges.map(e => ({
    id:           `${e.source}-${e.label}-${e.target}`,
    source:       e.source,
    target:       e.target,
    label:        e.label,
    type:         'smoothstep',
    animated:     ['CLEARED_BY','PAYS'].includes(e.label),
    style:        { stroke: EDGE_LABEL_COLORS[e.label] || '#4d5670', strokeWidth: 1.2, opacity: 0.6 },
    labelStyle:   { fill: EDGE_LABEL_COLORS[e.label] || '#8892aa', fontSize: 9, fontFamily: 'IBM Plex Mono', fontWeight: 600 },
    labelBgStyle: { fill: '#0d0f14', fillOpacity: 0.85 },
    markerEnd:    { type: MarkerType.ArrowClosed, color: EDGE_LABEL_COLORS[e.label] || '#4d5670', width: 12, height: 12 },
  }));
}

/* ── Legend ────────────────────────────────────────────────────── */
function Legend() {
  const [open, setOpen] = useState(true);
  return (
    <div style={{
      position: 'absolute', bottom: 50, left: 12, zIndex: 10,
      background: '#13161e', border: '1px solid #252a38',
      borderRadius: 8, overflow: 'hidden',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    }}>
      <button style={{
        display: 'flex', alignItems: 'center', gap: 6,
        width: '100%', background: 'none', border: 'none',
        borderBottom: open ? '1px solid #252a38' : 'none',
        padding: '6px 10px', cursor: 'pointer', color: '#8892aa',
        fontSize: 11, fontFamily: 'IBM Plex Sans, sans-serif',
      }} onClick={() => setOpen(v => !v)}>
        Node Types {open ? '▲' : '▼'}
      </button>
      {open && (
        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {Object.entries(TYPE_META).map(([type, meta]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: meta.color, flexShrink: 0 }}/>
              <span style={{ fontSize: 10, color: '#8892aa', fontFamily: 'IBM Plex Sans' }}>{meta.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Stats bar ─────────────────────────────────────────────────── */
function StatsBar({ meta, loading }) {
  if (!meta) return null;
  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10, display: 'flex', gap: 1, overflow: 'hidden', borderRadius: 8,
      border: '1px solid #252a38', background: '#13161e',
      boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
    }}>
      {[
        ['Nodes', meta.totalNodes],
        ['Edges', meta.totalEdges],
        ...Object.entries(meta.nodeTypes || {}).slice(0, 4),
      ].map(([k, v], i) => (
        <div key={k} style={{
          padding: '5px 12px', fontSize: 11,
          borderRight: '1px solid #252a38',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}>
          <span style={{ color: '#4d5670', fontSize: 9, letterSpacing: '0.06em' }}>{k.toUpperCase()}</span>
          <span style={{ color: '#e8eaf0', fontWeight: 600, fontFamily: 'IBM Plex Mono' }}>{v}</span>
        </div>
      ))}
      {loading && (
        <div style={{ padding: '5px 12px', display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#4f8ef7', animation: 'pulse 1s infinite' }}>loading…</span>
        </div>
      )}
    </div>
  );
}

/* ── Main inner component ───────────────────────────────────────── */
function GraphInner({ graphData, loading, onNodeClick }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [expandLoading, setExpandLoading] = useState(false);
  const { fitView } = useReactFlow();
  const initialFit = useRef(false);

  // Build nodes/edges when data arrives
  useEffect(() => {
    if (!graphData) return;
    const n = layoutNodes(graphData.nodes, graphData.edges);
    const e = buildEdges(graphData.edges);
    setNodes(n);
    setEdges(e);
    if (!initialFit.current) {
      setTimeout(() => { fitView({ padding: 0.15, duration: 600 }); }, 100);
      initialFit.current = true;
    }
  }, [graphData]);

  // Single click → inspect
  const onNodeClickHandler = useCallback((_, node) => {
    // Find original node data from graphData
    if (!graphData) return;
    const original = graphData.nodes.find(n => n.id === node.id);
    if (original) onNodeClick(original);
  }, [graphData, onNodeClick]);

  // Double click → expand
  const onNodeDoubleClick = useCallback(async (_, node) => {
    if (expandLoading) return;
    const [type, ...idParts] = node.id.split(':');
    const id = idParts.join(':');
    setExpandLoading(true);
    try {
      const result = await expandNode(type, id);
      if (!result.nodes) return;

      // Merge new nodes/edges into current state
      setNodes(prev => {
        const existing = new Set(prev.map(n => n.id));
        const newNodes = result.nodes
          .filter(n => !existing.has(n.id))
          .map((n, i) => {
            const meta  = TYPE_META[n.type] || {};
            const focal = prev.find(p => p.id === node.id);
            const angle = (i / result.nodes.length) * 2 * Math.PI;
            const r     = 220;
            return {
              id:   n.id,
              type: 'sapNode',
              position: {
                x: (focal?.position.x || 0) + r * Math.cos(angle),
                y: (focal?.position.y || 0) + r * Math.sin(angle),
              },
              data: { label: n.label, nodeType: n.type, metadata: n.data, expanded: false },
            };
          });

        // Mark focal node as expanded
        const updated = prev.map(p =>
          p.id === node.id ? { ...p, data: { ...p.data, expanded: true } } : p
        );
        return [...updated, ...newNodes];
      });

      setEdges(prev => {
        const existing = new Set(prev.map(e => e.id));
        const newEdges = buildEdges(result.edges).filter(e => !existing.has(e.id));
        return [...prev, ...newEdges];
      });
    } catch (err) {
      console.error('Expand error:', err);
    } finally {
      setExpandLoading(false);
    }
  }, [expandLoading]);

  return (
    <>
      <StatsBar meta={graphData?.meta} loading={loading || expandLoading} />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClickHandler}
        onNodeDoubleClick={onNodeDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.05}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 0.2 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: '#0d0f14' }}
      >
        <Background color="#1a1e29" gap={28} size={1} />
        <Controls
          style={{ background: '#13161e', border: '1px solid #252a38', borderRadius: 8 }}
          showInteractive={false}
        />
        <MiniMap
          nodeColor={n => {
            const meta = TYPE_META[n.data?.nodeType];
            return meta ? meta.color + '99' : '#4d5670';
          }}
          maskColor="rgba(13,15,20,0.85)"
          style={{ background: '#13161e', border: '1px solid #252a38', borderRadius: 8 }}
        />
      </ReactFlow>
      <Legend />
      {expandLoading && (
        <div style={{
          position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)',
          background: '#1a1e29', border: '1px solid #252a38', borderRadius: 6,
          padding: '6px 14px', fontSize: 11, color: '#4f8ef7',
          fontFamily: 'IBM Plex Mono', zIndex: 20,
        }}>
          Expanding node…
        </div>
      )}
    </>
  );
}

/* ── Exported wrapper ───────────────────────────────────────────── */
export default function GraphPanel({ graphData, loading, onNodeClick }) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlowProvider>
        <GraphInner
          graphData={graphData}
          loading={loading}
          onNodeClick={onNodeClick}
        />
      </ReactFlowProvider>
    </div>
  );
}
