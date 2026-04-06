import React, { useContext, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
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
