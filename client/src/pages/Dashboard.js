import React, { useEffect, useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import { candidateApi, authApi } from '../utils/api';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

const STATUS_CONFIG = {
  pending:     { label: 'Pending',     color: 'var(--pending)' },
  in_progress: { label: 'In Progress', color: 'var(--in-progress)' },
  success:     { label: 'Success',     color: 'var(--success)' },
  failed:      { label: 'Failed',      color: 'var(--error)' },
};

// ── Candidate avatar ──────────────────────────────────────────────────────────
function Avatar({ src, name, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: src ? undefined : 'var(--bg-elevated)',
      border: '1.5px solid var(--border)', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, color: 'var(--text-muted)',
    }}>
      {src ? <img src={src} alt={name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
    </div>
  );
}

// ── Recruiter badge ───────────────────────────────────────────────────────────
function RecruiterBadge({ recruiter }) {
  if (!recruiter) return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: recruiter.photoUrl ? undefined : 'var(--accent-dim)',
        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--accent)', fontWeight: 700, fontSize: 10, border: '1px solid var(--border)',
      }}>
        {recruiter.photoUrl
          ? <img src={recruiter.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : (recruiter.name || '?').charAt(0).toUpperCase()}
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{recruiter.name}</span>
    </div>
  );
}

// ── Group header (for both recruiter and user groups) ─────────────────────────
function GroupHeader({ photoUrl, initial, name, subtitle, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
      <div style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
        background: photoUrl ? undefined : 'var(--accent-dim)',
        overflow: 'hidden', border: '1.5px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--accent)', fontWeight: 700, fontSize: 13,
      }}>
        {photoUrl
          ? <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initial}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{name}</div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</div>}
      </div>
      <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '2px 9px', borderRadius: 10 }}>
        {count} candidate{count !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { recruiters, roles } = useContext(AppContext);

  const [stats,          setStats]          = useState({ total: 0, pending: 0, in_progress: 0, success: 0, failed: 0 });
  const [allCandidates,  setAllCandidates]  = useState([]);
  const [recent,         setRecent]         = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [groupMode,      setGroupMode]      = useState('none'); // 'none' | 'recruiter' | 'user'
  const [allUsers,       setAllUsers]       = useState([]);

  useEffect(() => {
    if (user?.isAdmin) {
      authApi.listUsers().then(setAllUsers).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [recentData, allData] = await Promise.all([
          candidateApi.getAll({ limit: 8 }),
          candidateApi.getAll({ limit: 1000 }),
        ]);
        setRecent(recentData.candidates || []);
        const all = allData.candidates || [];
        setAllCandidates(all);
        const counts = { total: allData.total || 0, pending: 0, in_progress: 0, success: 0, failed: 0 };
        all.forEach(c => { if (counts[c.status] !== undefined) counts[c.status]++; });
        setStats(counts);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const getRoleLabel  = (val) => roles.find(r => r.value === val)?.label || val || '—';
  const getRecruiter  = (id)  => recruiters.find(r => r.id === id) || null;

  // Group candidates by recruiter
  const groupedByRecruiter = (() => {
    const groups = {};
    allCandidates.forEach(c => {
      const key = c.recruiterId || '__unassigned__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    return groups;
  })();

  // Group candidates by owner (hiring manager) — admin only
  const groupedByUser = (() => {
    const groups = {};
    allCandidates.forEach(c => {
      const key = c.ownerId || '__unassigned__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    return groups;
  })();

  // Common table headers
  const TableHead = ({ showUser = false }) => (
    <thead>
      <tr>
        <th style={{ width: 36 }}></th>
        <th>Candidate</th>
        <th>Email</th>
        <th>Role</th>
        <th>Location</th>
        <th>Recruiter</th>
        {showUser && <th>Added By</th>}
        <th>Status</th>
        <th>Added</th>
      </tr>
    </thead>
  );

  // Single row
  const CandidateRow = ({ c, showUser = false }) => {
    const recruiter = getRecruiter(c.recruiterId);
    return (
      <tr onClick={() => window.location.href = `/candidates/${c.id}`} style={{ cursor: 'pointer' }}>
        <td><Avatar src={c.photoUrl} name={c.fullName} size={30} /></td>
        <td>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 13 }}>{c.fullName || '—'}</div>
          {c.currentTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.currentTitle}</div>}
        </td>
        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--text-muted)' }}>{c.email || '—'}</td>
        <td style={{ fontSize: 12 }}>{getRoleLabel(c.role)}</td>
        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.location ? `📍 ${c.location}` : '—'}</td>
        <td><RecruiterBadge recruiter={recruiter} /></td>
        {showUser && (
          <td>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>
                {(c.ownerName || '?').charAt(0).toUpperCase()}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.ownerName || '—'}</span>
            </div>
          </td>
        )}
        <td><span className={`status-badge status-${c.status}`}>{STATUS_CONFIG[c.status]?.label || c.status}</span></td>
        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
      </tr>
    );
  };

  // Render a group table
  const GroupTable = ({ candidates, showUser = false }) => (
    <div className="table-wrap">
      <table className="data-table">
        <TableHead showUser={showUser} />
        <tbody>{candidates.map(c => <CandidateRow key={c.id} c={c} showUser={showUser} />)}</tbody>
      </table>
    </div>
  );

  // Group toggle button labels
  const groupButtons = [
    { mode: 'none',      label: 'Recent' },
    ...(recruiters.length > 0 ? [{ mode: 'recruiter', label: '◈ By Recruiter' }] : []),
    ...(user?.isAdmin   ? [{ mode: 'user',      label: '👤 By User' }]      : []),
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Overview of your recruiting pipeline</div>
        </div>
        <Link to="/candidates" className="btn btn-primary">+ Add Candidate</Link>
      </div>

      {/* Stats */}
      <div className="grid-4" style={{ marginBottom: 28 }}>
        {[
          { key: 'total',       label: 'Total Candidates', color: 'var(--accent)',      icon: '◈' },
          { key: 'pending',     label: 'Pending',          color: 'var(--pending)',     icon: '○' },
          { key: 'in_progress', label: 'In Progress',      color: 'var(--in-progress)', icon: '◑' },
          { key: 'success',     label: 'Successful',       color: 'var(--success)',     icon: '●' },
        ].map(s => (
          <div className="stat-card" key={s.key}>
            <div style={{ color: s.color, fontSize: 20, marginBottom: 8 }}>{s.icon}</div>
            <div className="stat-value" style={{ color: s.color }}>{loading ? '—' : stats[s.key]}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Candidates table */}
      <div className="card">
        <div className="flex items-center justify-between mb-16">
          <div className="card-title">
            {groupMode === 'none'      ? 'Recent Candidates'
            : groupMode === 'recruiter' ? 'Candidates by Recruiter'
            :                            'Candidates by User'}
          </div>
          <div className="flex gap-8">
            {groupButtons.length > 1 && groupButtons.map(b => (
              <button
                key={b.mode}
                className={`btn btn-sm ${groupMode === b.mode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setGroupMode(b.mode)}
              >
                {b.label}
              </button>
            ))}
            <Link to="/candidates" className="btn btn-secondary btn-sm">View All</Link>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" /></div>
        ) : allCandidates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">◈</div>
            <div className="empty-state-title">No candidates yet</div>
            <div className="empty-state-desc">Start by adding your first candidate</div>
            <Link to="/candidates" className="btn btn-primary">Add Candidate</Link>
          </div>
        ) : groupMode === 'none' ? (
          // ── Recent flat view ─────────────────────────────────────────────────
          <GroupTable candidates={recent} showUser={user?.isAdmin} />

        ) : groupMode === 'recruiter' ? (
          // ── Group by recruiter ───────────────────────────────────────────────
          <div>
            {recruiters.map(recruiter => {
              const group = groupedByRecruiter[recruiter.id] || [];
              if (!group.length) return null;
              return (
                <div key={recruiter.id} style={{ marginBottom: 28 }}>
                  <GroupHeader
                    photoUrl={recruiter.photoUrl}
                    initial={(recruiter.name || '?').charAt(0).toUpperCase()}
                    name={recruiter.name}
                    subtitle={recruiter.currentTitle}
                    count={group.length}
                  />
                  <GroupTable candidates={group} showUser={user?.isAdmin} />
                </div>
              );
            })}
            {/* Unassigned */}
            {(groupedByRecruiter['__unassigned__'] || []).length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <GroupHeader
                  photoUrl={null}
                  initial="—"
                  name="No Recruiter Assigned"
                  count={groupedByRecruiter['__unassigned__'].length}
                />
                <GroupTable candidates={groupedByRecruiter['__unassigned__']} showUser={user?.isAdmin} />
              </div>
            )}
          </div>

        ) : (
          // ── Group by user (admin only) ───────────────────────────────────────
          <div>
            {allUsers.map(u => {
              const group = groupedByUser[u.id] || [];
              if (!group.length) return null;
              return (
                <div key={u.id} style={{ marginBottom: 28 }}>
                  <GroupHeader
                    photoUrl={null}
                    initial={(u.displayName || u.username || '?').charAt(0).toUpperCase()}
                    name={u.displayName || u.username}
                    subtitle={u.isAdmin ? 'Administrator' : 'Hiring Manager'}
                    count={group.length}
                  />
                  <GroupTable candidates={group} showUser={false} />
                </div>
              );
            })}
            {/* Candidates with no owner (legacy) */}
            {(groupedByUser['__unassigned__'] || []).length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <GroupHeader photoUrl={null} initial="?" name="No Owner (Legacy)" count={groupedByUser['__unassigned__'].length} />
                <GroupTable candidates={groupedByUser['__unassigned__']} showUser={false} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom grid */}
      <div className="grid-2 mt-24">
        <div className="card">
          <div className="card-title">Quick Actions</div>
          <div className="flex flex-col gap-8">
            <Link to="/candidates" className="btn btn-secondary w-full" style={{ justifyContent: 'flex-start' }}>◈ Add New Candidate</Link>
            <Link to="/generate" className="btn btn-secondary w-full" style={{ justifyContent: 'flex-start' }}>◎ Generate Interview Scenario</Link>
            <Link to="/generate?tab=outreach" className="btn btn-secondary w-full" style={{ justifyContent: 'flex-start' }}>✉ Create Outreach Message</Link>
            <Link to="/settings" className="btn btn-secondary w-full" style={{ justifyContent: 'flex-start' }}>⚙ Configure Settings</Link>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Pipeline Status</div>
          {Object.entries(STATUS_CONFIG).map(([key, val]) => {
            const count = stats[key] || 0;
            const pct   = stats.total ? Math.round((count / stats.total) * 100) : 0;
            return (
              <div key={key} style={{ marginBottom: 14 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{val.label}</span>
                  <span style={{ fontSize: 12, color: val.color, fontWeight: 600 }}>{count}</span>
                </div>
                <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: val.color, borderRadius: 2, transition: 'width 0.5s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
