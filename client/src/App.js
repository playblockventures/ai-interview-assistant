import React, { useContext, useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { notificationApi } from './utils/api';
import Dashboard      from './pages/Dashboard';
import Candidates     from './pages/Candidates';
import CandidateDetail from './pages/CandidateDetail';
import Generate       from './pages/Generate';
import Settings       from './pages/Settings';
import Login          from './pages/Login';
import './App.css';

const NAV_ITEMS = [
  { path: '/',           label: 'Dashboard', icon: '▦' },
  { path: '/candidates', label: 'Candidates', icon: '◈' },
  { path: '/generate',   label: 'Generate',   icon: '◎' },
  { path: '/settings',   label: 'Settings',   icon: '⚙' },
];

// Redirect to /login if not authenticated
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-deep)' }}>
      <span className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// ── Notification Bell ─────────────────────────────────────────────────────────
function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen]           = useState(false);
  const [items, setItems]         = useState([]);
  const [unread, setUnread]       = useState(0);
  const [loading, setLoading]     = useState(false);
  const [showTip, setShowTip]     = useState(false);
  const [users, setUsers]         = useState([]);
  const [tip, setTip]             = useState({ userIds: [], title: '', message: '', candidateId: '', candidateName: '' });
  const [sending, setSending]     = useState(false);
  const dropRef = useRef(null);
  const pollRef = useRef(null);

  const fetchCount = useCallback(async () => {
    try {
      const data = await notificationApi.getCount();
      setUnread(data.count || 0);
    } catch (_) {}
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const data = await notificationApi.getAll();
      setItems(data);
      setUnread(data.filter(n => !n.read).length);
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  // Poll unread count every 30 s
  useEffect(() => {
    if (!user) return;
    fetchCount();
    pollRef.current = setInterval(fetchCount, 30000);
    return () => clearInterval(pollRef.current);
  }, [user, fetchCount]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openPanel = () => {
    setOpen(v => {
      if (!v) fetchAll();
      return !v;
    });
  };

  const markRead = async (id) => {
    try {
      await notificationApi.markRead(id);
      setItems(p => p.map(n => n.id === id ? { ...n, read: true } : n));
      setUnread(p => Math.max(0, p - 1));
    } catch (_) {}
  };

  const markAllRead = async () => {
    try {
      await notificationApi.markAllRead();
      setItems(p => p.map(n => ({ ...n, read: true })));
      setUnread(0);
    } catch (_) {}
  };

  const remove = async (id) => {
    try {
      await notificationApi.remove(id);
      setItems(p => p.filter(n => n.id !== id));
    } catch (_) {}
  };

  const clickNotification = (n) => {
    if (!n.read) markRead(n.id);
    if (n.candidateId) {
      navigate(`/candidates/${n.candidateId}`);
      setOpen(false);
    }
  };

  // Admin: send tip
  const openTip = async () => {
    if (!users.length) {
      try { setUsers(await notificationApi.getUsers()); } catch (_) {}
    }
    setShowTip(true);
  };

  const sendTip = async () => {
    if (!tip.userIds.length || !tip.message.trim()) return toast.error('Select at least one user and enter a message');
    setSending(true);
    try {
      await notificationApi.send(tip);
      toast.success('Tip sent');
      setShowTip(false);
      setTip({ userIds: [], title: '', message: '', candidateId: '', candidateName: '' });
    } catch (e) { toast.error(e.message); }
    finally { setSending(false); }
  };

  const toggleUser = (id) => setTip(p => ({
    ...p,
    userIds: p.userIds.includes(id) ? p.userIds.filter(x => x !== id) : [...p.userIds, id],
  }));

  const timeAgo = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  return (
    <div ref={dropRef} style={{ position: 'relative', marginBottom: 8 }}>
      {/* Bell button */}
      <button
        onClick={openPanel}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 9,
          padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
          border: '1px solid var(--border)', background: open ? 'var(--bg-elevated)' : 'transparent',
          color: 'var(--text-secondary)', fontSize: 13, transition: 'background 0.15s',
        }}
      >
        <div style={{ position: 'relative', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>🔔</span>
          {unread > 0 && (
            <span style={{
              position: 'absolute', top: -2, right: -2,
              background: 'var(--error)', color: '#fff',
              borderRadius: '50%', fontSize: 9, fontWeight: 700,
              minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 3px', lineHeight: 1,
            }}>{unread > 99 ? '99+' : unread}</span>
          )}
        </div>
        <span style={{ flex: 1, textAlign: 'left' }}>Notifications</span>
        {unread > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{unread}</span>}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', zIndex: 200,
          maxHeight: 420, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Notifications</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {user?.isAdmin && (
                <button
                  onClick={openTip}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--accent)', padding: '2px 6px', borderRadius: 4 }}
                >
                  💡 Send Tip
                </button>
              )}
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 4 }}
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading && (
              <div style={{ padding: '20px', textAlign: 'center' }}>
                <span className="spinner" style={{ width: 20, height: 20 }} />
              </div>
            )}
            {!loading && items.length === 0 && (
              <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No notifications yet
              </div>
            )}
            {!loading && items.map(n => (
              <div
                key={n.id}
                style={{
                  padding: '10px 14px', borderBottom: '1px solid var(--border)',
                  background: n.read ? 'transparent' : 'rgba(108,99,255,0.06)',
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  cursor: n.candidateId ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                }}
                onClick={() => clickNotification(n)}
              >
                <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>
                  {n.type === 'tip' ? '💡' : '💬'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: n.read ? 400 : 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4, wordBreak: 'break-word' }}>
                    {n.message}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>{timeAgo(n.createdAt)}</span>
                    {n.candidateName && <span>· {n.candidateName}</span>}
                    {!n.read && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>● New</span>}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); remove(n.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: '0 2px', flexShrink: 0 }}
                  title="Dismiss"
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin: Send Tip modal */}
      {showTip && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowTip(false)}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: 24, width: 440, maxWidth: '90vw',
            maxHeight: '80vh', overflowY: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>💡 Send Guide Tip</div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Recipients
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button
                  onClick={() => setTip(p => ({ ...p, userIds: p.userIds.length === users.length ? [] : users.map(u => u.id) }))}
                  style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: tip.userIds.length === users.length ? 'var(--accent)' : 'var(--bg-elevated)',
                    color: tip.userIds.length === users.length ? '#fff' : 'var(--text-secondary)',
                  }}
                >All users</button>
                {users.filter(u => u.id !== user.id).map(u => (
                  <button
                    key={u.id}
                    onClick={() => toggleUser(u.id)}
                    style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: tip.userIds.includes(u.id) ? 'var(--accent)' : 'var(--bg-elevated)',
                      color: tip.userIds.includes(u.id) ? '#fff' : 'var(--text-secondary)',
                    }}
                  >{u.displayName || u.username}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Title <span style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                className="form-input"
                placeholder="Guide Tip from Admin"
                value={tip.title}
                onChange={e => setTip(p => ({ ...p, title: e.target.value }))}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Message
              </label>
              <textarea
                className="form-textarea"
                placeholder="e.g. Remember to ask about React experience in this round..."
                value={tip.message}
                onChange={e => setTip(p => ({ ...p, message: e.target.value }))}
                style={{ minHeight: 90 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={sendTip} disabled={sending || !tip.userIds.length || !tip.message.trim()}>
                {sending ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Sending...</> : '▶ Send to Selected Users'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowTip(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// User menu in sidebar footer
function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer',
          border: '1px solid var(--border)',
          background: open ? 'var(--bg-elevated)' : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: user.isAdmin ? 'rgba(108,99,255,0.2)' : 'var(--bg-elevated)',
          border: `2px solid ${user.isAdmin ? 'var(--accent)' : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 12, color: user.isAdmin ? 'var(--accent)' : 'var(--text-muted)',
          flexShrink: 0,
        }}>
          {(user.displayName || user.username || '?').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.displayName || user.username}
          </div>
          <div style={{ fontSize: 10, color: user.isAdmin ? 'var(--accent)' : 'var(--text-muted)' }}>
            {user.isAdmin ? 'Admin' : 'Hiring Manager'}
          </div>
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow)', overflow: 'hidden',
          zIndex: 100,
        }}>
          <NavLink to="/settings?tab=account" style={{ display: 'block', padding: '9px 14px', fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none' }}
            onClick={() => setOpen(false)}>
            🔑 Change Password
          </NavLink>
          {user.isAdmin && (
            <NavLink to="/settings?tab=users" style={{ display: 'block', padding: '9px 14px', fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none' }}
              onClick={() => setOpen(false)}>
              👥 User Management
            </NavLink>
          )}
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <button onClick={() => { setOpen(false); logout(); }}
              style={{ width: '100%', background: 'none', border: 'none', padding: '9px 14px', fontSize: 12, color: 'var(--error)', cursor: 'pointer', textAlign: 'left' }}>
              ⎋ Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AppShell() {
  return (
    <AppProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <span className="brand-icon">◈</span>
            <div>
              <div className="brand-name">InterviewAI</div>
              <div className="brand-sub">Recruiting Assistant</div>
            </div>
          </div>
          <nav className="sidebar-nav">
            {NAV_ITEMS.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-footer">
            <NotificationBell />
            <UserMenu />
          </div>
        </aside>
        <main className="main-content">
          <Routes>
            <Route path="/"              element={<Dashboard />} />
            <Route path="/candidates"    element={<Candidates />} />
            <Route path="/candidates/:id" element={<CandidateDetail />} />
            <Route path="/generate"      element={<Generate />} />
            <Route path="/settings"      element={<Settings />} />
            <Route path="*"             element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AppProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          } />
        </Routes>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#1a1a2e', color: '#e8e8f0',
              border: '1px solid #2d2d4e', borderRadius: '8px',
              fontFamily: "'DM Sans', sans-serif",
            },
          }}
        />
      </Router>
    </AuthProvider>
  );
}
