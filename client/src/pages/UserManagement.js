import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { authApi } from '../utils/api';
import { useAuth } from '../context/AuthContext';

function ChangePasswordModal({ onClose, targetUser, isSelf }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();

  const submit = async () => {
    if (form.newPassword !== form.confirm) return toast.error('Passwords do not match');
    setSaving(true);
    try {
      if (isSelf) {
        await authApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
        toast.success('Password changed');
      } else {
        await authApi.resetPassword(targetUser.id, form.newPassword);
        toast.success(`Password reset for ${targetUser.displayName}`);
      }
      onClose();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-title">
          {isSelf ? 'Change Your Password' : `Reset Password — ${targetUser?.displayName}`}
        </div>
        {isSelf && (
          <div className="form-group">
            <label className="form-label">Current Password</label>
            <input className="form-input" type="password" placeholder="Current password"
              value={form.currentPassword} onChange={e => setForm(p => ({ ...p, currentPassword: e.target.value }))} />
          </div>
        )}
        <div className="form-group">
          <label className="form-label">New Password</label>
          <input className="form-input" type="password" placeholder="New password"
            value={form.newPassword} onChange={e => setForm(p => ({ ...p, newPassword: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Confirm New Password</label>
          <input className="form-input" type="password" placeholder="Repeat new password"
            value={form.confirm} onChange={e => setForm(p => ({ ...p, confirm: e.target.value }))} />
        </div>
        <div className="flex gap-8" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddUserModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ username: '', displayName: '', isAdmin: false });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await authApi.createUser(form);
      toast.success(`User "${form.displayName || form.username}" created — default password: 12345678`);
      onSaved();
      onClose();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-title">Add User</div>
        <div className="form-group">
          <label className="form-label">Username</label>
          <input className="form-input" placeholder="e.g. john.smith" autoFocus
            value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Display Name</label>
          <input className="form-input" placeholder="e.g. John Smith"
            value={form.displayName} onChange={e => setForm(p => ({ ...p, displayName: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isAdmin} onChange={e => setForm(p => ({ ...p, isAdmin: e.target.checked }))}
              style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
            <span>Grant admin access</span>
          </label>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Admin can see and manage all candidates, recruiters and users.
          </div>
        </div>
        <div style={{ background: 'rgba(0,212,170,0.06)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12, color: 'var(--success)', marginBottom: 16 }}>
          Default password: <strong>12345678</strong> — user should change it on first login.
        </div>
        <div className="flex gap-8" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Creating...</> : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd]         = useState(false);
  const [passwordModal, setPasswordModal] = useState(null); // { user, isSelf }

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authApi.listUsers();
      setUsers(data);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const deleteUser = async (u) => {
    if (!window.confirm(`Delete user "${u.displayName}"? This cannot be undone.`)) return;
    try {
      await authApi.deleteUser(u.id);
      toast.success('User deleted');
      fetchUsers();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-16">
        <div>
          <div className="card-title">User Management</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Each user is a hiring manager with access to their own candidates and recruiters.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add User</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" /></div>
      ) : (
        <div>
          {users.map(u => (
            <div key={u.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
              marginBottom: 8,
            }}>
              {/* Avatar */}
              <div style={{
                width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                background: u.isAdmin ? 'rgba(108,99,255,0.15)' : 'var(--bg-card)',
                border: `2px solid ${u.isAdmin ? 'var(--accent)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 15,
                color: u.isAdmin ? 'var(--accent)' : 'var(--text-muted)',
              }}>
                {(u.displayName || u.username || '?').charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                    {u.displayName || u.username}
                  </span>
                  {u.isAdmin && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: 'rgba(108,99,255,0.15)', color: 'var(--accent)', fontWeight: 600 }}>
                      ADMIN
                    </span>
                  )}
                  {u.id === currentUser?.id && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: 'rgba(0,212,170,0.1)', color: 'var(--success)', fontWeight: 600 }}>
                      YOU
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'DM Mono, monospace' }}>
                  @{u.username}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : ''}
              </div>
              <div className="flex gap-8">
                <button className="btn btn-secondary btn-sm"
                  onClick={() => setPasswordModal({ user: u, isSelf: u.id === currentUser?.id })}>
                  🔑 {u.id === currentUser?.id ? 'Change Password' : 'Reset Password'}
                </button>
                {u.id !== currentUser?.id && (
                  <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u)}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onSaved={fetchUsers} />}
      {passwordModal && (
        <ChangePasswordModal
          onClose={() => setPasswordModal(null)}
          targetUser={passwordModal.user}
          isSelf={passwordModal.isSelf}
        />
      )}
    </div>
  );
}
