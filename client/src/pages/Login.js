import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  useEffect(() => { document.title = 'Login — InterviewAI'; }, []);
  const { login }   = useAuth();
  const navigate    = useNavigate();
  const [form, setForm]       = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [errorDetail, setErrorDetail] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorDetail('');
    try {
      await login(form.username.trim(), form.password);
      navigate('/', { replace: true });
    } catch (err) {
      // Show the exact error from the server
      const msg = err.message || 'Login failed';
      setErrorDetail(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-deep)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 36, color: 'var(--accent)', marginBottom: 8 }}>◈</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
            InterviewAI
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '1px' }}>
            Recruiting Assistant
          </div>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: 32 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 24 }}>
            Sign in to your account
          </div>

          {/* Error detail box — shows exact server error */}
          {errorDetail && (
            <div style={{
              background: 'rgba(255,107,107,0.08)',
              border: '1px solid rgba(255,107,107,0.3)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: 12,
              color: 'var(--error)',
              lineHeight: 1.6,
              wordBreak: 'break-word',
            }}>
              <strong>Error:</strong> {errorDetail}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                className="form-input"
                type="text"
                placeholder="Enter your username"
                value={form.username}
                onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="Enter your password"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full btn-lg"
              style={{ marginTop: 8 }}
              disabled={loading}
            >
              {loading
                ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Signing in...</>
                : 'Sign In'}
            </button>
          </form>

          <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
            Don't have an account? Contact your admin.<br />
            New accounts are provisioned by administrators only.
          </div>

          {/* Help box */}
          <div style={{
            marginTop: 16,
            padding: '10px 14px',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.7,
          }}>
            <strong style={{ color: 'var(--text-secondary)' }}>First time?</strong><br />
            Visit <code style={{ color: 'var(--accent)' }}>/api/setup</code> to create the default admin account,
            then log in with <code style={{ color: 'var(--accent)' }}>admin</code> / <code style={{ color: 'var(--accent)' }}>12345678</code>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--text-muted)' }}>
          Powered by GPT-4o
        </div>
      </div>
    </div>
  );
}
