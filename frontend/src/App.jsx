import { useState, useEffect, useCallback } from 'react';
import GraphPanel from './components/GraphPanel';
import ChatPanel  from './components/ChatPanel';
import NodeInspector from './components/NodeInspector';
import { fetchGraph } from './api/client';

export default function App() {
  const [graphData,      setGraphData]      = useState(null);
  const [graphLoading,   setGraphLoading]   = useState(true);
  const [graphError,     setGraphError]     = useState(null);
  const [selectedNode,   setSelectedNode]   = useState(null);
  const [inspectorOpen,  setInspectorOpen]  = useState(false);

  const loadGraph = useCallback(async () => {
    setGraphLoading(true);
    setGraphError(null);
    try {
      const data = await fetchGraph();
      setGraphData(data);
    } catch (err) {
      setGraphError(err.message || 'Failed to load graph');
    } finally {
      setGraphLoading(false);
    }
  }, []);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  const handleNodeClick = useCallback((node) => {
    setSelectedNode(node);
    setInspectorOpen(true);
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    setSelectedNode(null);
  }, []);

  return (
    <>
      {/* Global keyframe animations */}
      <style>{`
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes bounce { 0%,80%,100% { transform:scale(0); opacity:0.3 } 40% { transform:scale(1); opacity:1 } }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes slideIn {
          from { opacity:0; transform:translateX(20px); }
          to   { opacity:1; transform:translateX(0); }
        }
        .react-flow__controls button {
          background: #13161e !important;
          border-color: #252a38 !important;
          color: #8892aa !important;
          fill: #8892aa !important;
        }
        .react-flow__controls button:hover {
          background: #1a1e29 !important;
          color: #e8eaf0 !important;
          fill: #e8eaf0 !important;
        }
        .react-flow__edge-label { pointer-events: none; }
        textarea:focus { border-color: #2a4a7a !important; }
        button:hover { opacity: 0.85; }
      `}</style>

      {/* App shell */}
      <div style={styles.shell}>

        {/* Top bar */}
        <div style={styles.topbar}>
          <div style={styles.logo}>
            <div style={styles.logoMark}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <line x1="12" y1="2" x2="12" y2="6"/>
                <line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="2" y1="12" x2="6" y2="12"/>
                <line x1="18" y1="12" x2="22" y2="12"/>
                <line x1="4.22" y1="4.22" x2="7.05" y2="7.05"/>
                <line x1="16.95" y1="16.95" x2="19.78" y2="19.78"/>
                <line x1="4.22" y1="19.78" x2="7.05" y2="16.95"/>
                <line x1="16.95" y1="7.05" x2="19.78" y2="4.22"/>
              </svg>
            </div>
            <span style={styles.logoText}>SAP O2C</span>
            <span style={styles.logoSub}>Graph Intelligence</span>
          </div>

          <div style={styles.topbarMeta}>
            {graphData?.meta && (
              <>
                <span style={styles.metaChip}>
                  {graphData.meta.totalNodes} nodes
                </span>
                <span style={styles.metaChip}>
                  {graphData.meta.totalEdges} edges
                </span>
              </>
            )}
            <button style={styles.refreshBtn} onClick={loadGraph} title="Reload graph">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Main content */}
        <div style={styles.main}>

          {/* Graph panel — 60% */}
          <div style={styles.graphPane}>
            {graphError ? (
              <div style={styles.errorState}>
                <div style={styles.errorIcon}>⚠</div>
                <div style={styles.errorTitle}>Could not connect to backend</div>
                <div style={styles.errorMsg}>{graphError}</div>
                <div style={styles.errorHint}>Make sure the server is running on port 4000</div>
                <button style={styles.retryBtn} onClick={loadGraph}>Retry</button>
              </div>
            ) : graphLoading && !graphData ? (
              <div style={styles.loadingState}>
                <div style={styles.loadingSpinner}/>
                <div style={styles.loadingText}>Building graph…</div>
              </div>
            ) : (
              <GraphPanel
                graphData={graphData}
                loading={graphLoading}
                onNodeClick={handleNodeClick}
              />
            )}
          </div>

          {/* Chat panel — 40% */}
          <div style={styles.chatPane}>
            <ChatPanel />
          </div>
        </div>
      </div>

      {/* Node inspector overlay */}
      {inspectorOpen && selectedNode && (
        <NodeInspector node={selectedNode} onClose={closeInspector} />
      )}
    </>
  );
}

const styles = {
  shell: {
    display: 'flex', flexDirection: 'column',
    height: '100vh', width: '100vw', overflow: 'hidden',
    background: '#0d0f14',
  },
  topbar: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 18px',
    height: 48, flexShrink: 0,
    background: '#13161e',
    borderBottom: '1px solid #252a38',
  },
  logo: { display: 'flex', alignItems: 'center', gap: 10 },
  logoMark: {
    width: 30, height: 30, borderRadius: 8,
    background: '#0f2240', border: '1px solid #2a4a7a',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#4f8ef7',
  },
  logoText: { fontSize: 14, fontWeight: 700, color: '#e8eaf0', letterSpacing: '0.05em' },
  logoSub:  { fontSize: 11, color: '#4d5670', marginLeft: 2 },
  topbarMeta: { display: 'flex', alignItems: 'center', gap: 8 },
  metaChip: {
    fontSize: 11, color: '#8892aa',
    background: '#1a1e29', border: '1px solid #252a38',
    padding: '3px 10px', borderRadius: 20,
    fontFamily: 'IBM Plex Mono',
  },
  refreshBtn: {
    width: 28, height: 28, borderRadius: 6,
    background: '#1a1e29', border: '1px solid #252a38',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#8892aa', cursor: 'pointer',
  },
  main: {
    flex: 1, display: 'flex', overflow: 'hidden',
  },
  graphPane: {
    flex: '0 0 60%', position: 'relative',
    borderRight: '1px solid #252a38',
    overflow: 'hidden',
  },
  chatPane: {
    flex: '0 0 40%', overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
  },
  /* Loading & error states */
  loadingState: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    height: '100%', gap: 14, color: '#4d5670',
  },
  loadingSpinner: {
    width: 32, height: 32, borderRadius: '50%',
    border: '2px solid #1a1e29', borderTopColor: '#4f8ef7',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: { fontSize: 13, color: '#4d5670', fontFamily: 'IBM Plex Mono' },
  errorState: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    height: '100%', gap: 10, padding: 40,
  },
  errorIcon:  { fontSize: 32, color: '#ef4444', lineHeight: 1 },
  errorTitle: { fontSize: 15, fontWeight: 600, color: '#e8eaf0' },
  errorMsg:   { fontSize: 12, color: '#ef4444', fontFamily: 'IBM Plex Mono', textAlign: 'center' },
  errorHint:  { fontSize: 12, color: '#4d5670', textAlign: 'center' },
  retryBtn: {
    marginTop: 8, padding: '7px 20px',
    background: '#1e3a5f', border: '1px solid #2a4a7a',
    borderRadius: 7, color: '#4f8ef7', fontSize: 13,
    cursor: 'pointer', fontFamily: 'IBM Plex Sans',
  },
};
