import { useState, useRef, useEffect, useCallback } from 'react';
import { sendMessage } from '../api/client';

const SUGGESTIONS = [
  'Which products are in the most billing documents?',
  'Trace the full flow of billing document 90504248',
  'Find sales orders delivered but not billed',
  'Which customer has the highest total order value?',
  'Which plants ship the most deliveries?',
];

function SqlBlock({ sql }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(sql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={styles.sqlWrap}>
      <button style={styles.sqlToggle} onClick={() => setOpen(v => !v)}>
        <span style={styles.sqlIcon}>⟨/⟩</span>
        {open ? 'Hide SQL' : 'View SQL'}
        <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 10 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div style={styles.sqlBody}>
          <button style={styles.copyBtn} onClick={copy}>
            {copied ? '✓ copied' : 'copy'}
          </button>
          <pre style={styles.sqlCode}>{sql}</pre>
        </div>
      )}
    </div>
  );
}

function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ ...styles.msgRow, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      {!isUser && (
        <div style={styles.avatar}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
          </svg>
        </div>
      )}
      <div style={{ maxWidth: '85%' }}>
        <div style={{
          ...styles.bubble,
          ...(isUser ? styles.bubbleUser : styles.bubbleAi),
        }}>
          {msg.isOffTopic ? (
            <span style={{ color: '#f97316' }}>{msg.content}</span>
          ) : (
            <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
          )}
        </div>
        {!isUser && msg.sql && <SqlBlock sql={msg.sql} />}
        {!isUser && msg.rowCount !== undefined && !msg.isOffTopic && (
          <div style={styles.rowCount}>
            {msg.rowCount} row{msg.rowCount !== 1 ? 's' : ''} returned
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ ...styles.msgRow, justifyContent: 'flex-start' }}>
      <div style={styles.avatar}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
        </svg>
      </div>
      <div style={{ ...styles.bubble, ...styles.bubbleAi, display: 'flex', gap: 5, alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            ...styles.dot,
            animationDelay: `${i * 0.2}s`,
          }}/>
        ))}
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const [messages, setMessages]   = useState([
    {
      id: 0, role: 'assistant',
      content: "Hi! I can analyze the SAP Order-to-Cash dataset for you. Ask me about customers, orders, deliveries, billing, payments, or products.",
      sql: null, rowCount: undefined,
    }
  ]);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef             = useRef(null);
  const inputRef              = useRef(null);
  const idRef                 = useRef(1);

  // Build conversation history for multi-turn context
  const getHistory = useCallback(() =>
    messages
      .filter(m => m.id > 0)   // skip the welcome message
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
  , [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const submit = useCallback(async (text) => {
    const question = (text || input).trim();
    if (!question || loading) return;

    const userMsg = { id: idRef.current++, role: 'user', content: question };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = getHistory();
      const res = await sendMessage(question, history);
      setMessages(prev => [...prev, {
        id:         idRef.current++,
        role:       'assistant',
        content:    res.answer,
        sql:        res.sql,
        rowCount:   res.rowCount,
        isOffTopic: res.isOffTopic,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id:      idRef.current++,
        role:    'assistant',
        content: `Error: ${err.response?.data?.error || err.message}. Please check that your API key is configured and the backend is running.`,
        sql: null, rowCount: 0,
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, getHistory]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerDot} />
        <span style={styles.headerTitle}>Chat with Graph</span>
        <span style={styles.headerSub}>Order-to-Cash</span>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {messages.map(m => <Message key={m.id} msg={m} />)}
        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && !loading && (
        <div style={styles.suggestions}>
          {SUGGESTIONS.map(s => (
            <button key={s} style={styles.suggestion} onClick={() => submit(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={styles.inputArea}>
        <textarea
          ref={inputRef}
          style={styles.textarea}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about customers, orders, billing..."
          rows={1}
          disabled={loading}
        />
        <button
          style={{
            ...styles.sendBtn,
            opacity: (!input.trim() || loading) ? 0.4 : 1,
            cursor:  (!input.trim() || loading) ? 'default' : 'pointer',
          }}
          onClick={() => submit()}
          disabled={!input.trim() || loading}
        >
          {loading ? (
            <span style={styles.spinner}/>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: 'flex', flexDirection: 'column',
    height: '100%', background: '#13161e',
    borderLeft: '1px solid #252a38',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '14px 18px',
    borderBottom: '1px solid #252a38',
    flexShrink: 0,
  },
  headerDot: {
    width: 8, height: 8, borderRadius: '50%',
    background: '#14b8a6',
    boxShadow: '0 0 8px #14b8a680',
  },
  headerTitle: { fontSize: 13, fontWeight: 600, color: '#e8eaf0' },
  headerSub: {
    fontSize: 11, color: '#4d5670',
    marginLeft: 2, letterSpacing: '0.04em',
  },
  messages: {
    flex: 1, overflowY: 'auto',
    padding: '16px 14px',
    display: 'flex', flexDirection: 'column', gap: 14,
  },
  msgRow: { display: 'flex', gap: 8, alignItems: 'flex-end' },
  avatar: {
    width: 26, height: 26, borderRadius: '50%',
    background: '#1a1e29', border: '1px solid #252a38',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#14b8a6', flexShrink: 0,
  },
  bubble: {
    padding: '10px 13px', borderRadius: 10,
    fontSize: 13, lineHeight: 1.55,
  },
  bubbleUser: {
    background: '#1e3a5f',
    border: '1px solid #2a4a7a',
    color: '#c8daff',
    borderBottomRightRadius: 3,
  },
  bubbleAi: {
    background: '#1a1e29',
    border: '1px solid #252a38',
    color: '#c8cfe0',
    borderBottomLeftRadius: 3,
  },
  rowCount: {
    fontSize: 10, color: '#4d5670',
    marginTop: 4, marginLeft: 2,
    fontFamily: 'var(--font-mono)',
  },
  sqlWrap: { marginTop: 6 },
  sqlToggle: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: 'none', border: '1px solid #252a38',
    borderRadius: 6, padding: '4px 10px',
    color: '#4d5670', fontSize: 11, cursor: 'pointer',
    width: '100%', textAlign: 'left',
    transition: 'border-color 0.15s, color 0.15s',
    fontFamily: 'var(--font-sans)',
  },
  sqlIcon: { fontFamily: 'var(--font-mono)', fontSize: 12, color: '#4f8ef7' },
  sqlBody: {
    position: 'relative',
    background: '#0d0f14', border: '1px solid #252a38',
    borderRadius: '0 0 6px 6px', borderTop: 'none',
    padding: '10px 12px',
    maxHeight: 220, overflowY: 'auto',
  },
  copyBtn: {
    position: 'absolute', top: 8, right: 8,
    background: '#1a1e29', border: '1px solid #252a38',
    borderRadius: 4, padding: '2px 8px',
    fontSize: 10, color: '#8892aa', cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  },
  sqlCode: {
    fontFamily: 'var(--font-mono)', fontSize: 11,
    color: '#8892aa', whiteSpace: 'pre-wrap',
    lineHeight: 1.6, margin: 0,
  },
  suggestions: {
    padding: '0 14px 12px',
    display: 'flex', flexDirection: 'column', gap: 5,
    flexShrink: 0,
  },
  suggestion: {
    background: 'none', border: '1px solid #1a1e29',
    borderRadius: 6, padding: '7px 12px',
    fontSize: 11, color: '#8892aa', cursor: 'pointer',
    textAlign: 'left', transition: 'border-color 0.15s, color 0.15s',
    fontFamily: 'var(--font-sans)',
  },
  inputArea: {
    display: 'flex', gap: 8, padding: '12px 14px',
    borderTop: '1px solid #252a38', flexShrink: 0,
    background: '#13161e',
  },
  textarea: {
    flex: 1, background: '#0d0f14',
    border: '1px solid #252a38', borderRadius: 8,
    padding: '9px 12px', color: '#e8eaf0',
    fontSize: 13, resize: 'none',
    fontFamily: 'var(--font-sans)',
    outline: 'none', lineHeight: 1.5,
    minHeight: 38, maxHeight: 120,
    transition: 'border-color 0.15s',
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 8,
    background: '#1e3a5f', border: '1px solid #2a4a7a',
    color: '#4f8ef7', display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0,
    transition: 'background 0.15s',
  },
  dot: {
    width: 7, height: 7, borderRadius: '50%',
    background: '#4d5670', display: 'inline-block',
    animation: 'bounce 1s infinite ease-in-out',
  },
  spinner: {
    width: 14, height: 14, borderRadius: '50%',
    border: '2px solid #2a4a7a',
    borderTopColor: '#4f8ef7',
    display: 'inline-block',
    animation: 'spin 0.8s linear infinite',
  },
};
