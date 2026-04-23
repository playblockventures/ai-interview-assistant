import React, { useEffect, useState, useContext, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { candidateApi, authApi, settingsApi } from '../utils/api';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

const FAILED_STATUSES = ['failed', 'no_response', 'not_interested', 'other_job', 'have_a_doubt'];

const STATUS_CONFIG = {
  pending:        { label: 'Pending',          color: 'var(--pending)',     hex: '#f5a623' },
  in_progress:    { label: 'In Progress',      color: 'var(--in-progress)', hex: '#4a9eff' },
  success:        { label: 'Success',          color: 'var(--success)',     hex: '#00d4aa' },
  failed:         { label: 'Failed',           color: 'var(--error)',       hex: '#ff6b6b' },
  no_response:    { label: 'No Response',      color: 'var(--error)',       hex: '#ff6b6b' },
  not_interested: { label: 'Not Interested',   color: 'var(--error)',       hex: '#ff6b6b' },
  other_job:      { label: 'Already Occupied', color: 'var(--error)',       hex: '#ff6b6b' },
  have_a_doubt:   { label: 'Have a Doubt',     color: 'var(--error)',       hex: '#ff6b6b' },
};

// ── Date range picker ─────────────────────────────────────────────────────────
const PRESETS = [
  { label: '1W', days: 7 },
  { label: '2W', days: 14 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: 'All', days: null },
];
const isoToday = () => new Date().toISOString().split('T')[0];
const isoDaysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; };

function DateRangePicker({ fromDate, toDate, onChange }) {
  const today = isoToday();
  const active = PRESETS.find(p =>
    p.days === null ? (!fromDate && !toDate) : (fromDate === isoDaysAgo(p.days) && toDate === today)
  );
  const apply = (days) => {
    if (days === null) onChange('', '');
    else onChange(isoDaysAgo(days), today);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Period:</span>
      {PRESETS.map(p => (
        <button key={p.label} onClick={() => apply(p.days)}
          className={`btn btn-sm ${active?.label === p.label ? 'btn-primary' : 'btn-secondary'}`}
          style={{ minWidth: 38, padding: '3px 8px', fontSize: 11 }}>
          {p.label}
        </button>
      ))}
      <span style={{ color: 'var(--border)', margin: '0 2px' }}>|</span>
      <input type="date" className="form-input" style={{ width: 132, height: 30, fontSize: 11 }}
        value={fromDate} onChange={e => onChange(e.target.value, toDate)} />
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→</span>
      <input type="date" className="form-input" style={{ width: 132, height: 30, fontSize: 11 }}
        value={toDate} onChange={e => onChange(fromDate, e.target.value)} />
    </div>
  );
}

// ── Reusable mini components ──────────────────────────────────────────────────
function Avatar({ src, name, size = 32 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: 'var(--bg-elevated)', border: '1.5px solid var(--border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.42, color: 'var(--text-muted)' }}>
      {src ? <img src={src} alt={name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
    </div>
  );
}

function StatCard({ icon, label, value, color, sub, onClick }) {
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${color}`, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div style={{ color, fontSize: 22, marginBottom: 8 }}>{icon}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
      {onClick && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>Click to filter →</div>}
    </div>
  );
}

// ── Horizontal bar chart ──────────────────────────────────────────────────────
function BarChart({ data, colorFn, maxLabel = 'count', onClickItem }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div>
      {data.map((d, i) => (
        <div key={i} style={{ marginBottom: 10, cursor: onClickItem ? 'pointer' : 'default' }}
          onClick={() => onClickItem && onClickItem(d)}>
          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{d.label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginLeft: 8 }}>{d.value}</span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(d.value / max) * 100}%`, background: colorFn ? colorFn(d, i) : 'var(--accent)', borderRadius: 3, transition: 'width 0.6s ease' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Donut chart (pure CSS/SVG) ────────────────────────────────────────────────
function DonutChart({ segments, size = 120 }) {
  const total = segments.reduce((s, d) => s + d.value, 0);
  if (!total) return <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--bg-elevated)' }} />;

  let offset = 0;
  const cx = size / 2, cy = size / 2, r = size * 0.38, stroke = size * 0.18;
  const circ = 2 * Math.PI * r;

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      {segments.map((seg, i) => {
        const pct  = seg.value / total;
        const dash = pct * circ;
        const gap  = circ - dash;
        const el = (
          <circle key={i} cx={cx} cy={cy} r={r}
            fill="none" stroke={seg.color} strokeWidth={stroke}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset * circ}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        );
        offset += pct;
        return el;
      })}
    </svg>
  );
}

// ── Funnel chart ──────────────────────────────────────────────────────────────
function FunnelChart({ stages }) {
  const maxVal = Math.max(...stages.map(s => s.value), 1);
  return (
    <div>
      {stages.map((s, i) => {
        const pct     = Math.round((s.value / maxVal) * 100);
        const convPct = i > 0 && stages[i - 1].value > 0
          ? Math.round((s.value / stages[i - 1].value) * 100)
          : null;
        return (
          <div key={i} style={{ marginBottom: 8 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>{s.icon}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.label}</span>
                {convPct !== null && (
                  <span style={{ fontSize: 10, color: convPct >= 50 ? 'var(--success)' : 'var(--warning)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 8 }}>
                    {convPct}% conv.
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.value}</span>
            </div>
            <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: s.color, borderRadius: 4, transition: 'width 0.6s ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Activity timeline ─────────────────────────────────────────────────────────
function ActivityTimeline({ weeks }) {
  const max = Math.max(...(weeks || []).map(w => w.count), 1);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
        {weeks.map((w, i) => (
          <div key={i} title={`${w.label}: ${w.count} candidates`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: w.count > 0 ? 600 : 400, color: w.count > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
              {w.count > 0 ? w.count : ''}
            </div>
            <div style={{ width: '100%', background: w.count > 0 ? 'var(--accent)' : 'var(--bg-elevated)', borderRadius: '3px 3px 0 0', height: `${Math.max((w.count / max) * 60, w.count > 0 ? 8 : 4)}px`, opacity: i === 7 ? 1 : 0.5 + (i / 7) * 0.5, transition: 'height 0.6s ease' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {weeks.map((w, i) => (
          <div key={i} style={{ flex: 1, fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {i === 7 ? 'Now' : i === 6 ? '-1w' : i === 0 ? '-7w' : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Group header ──────────────────────────────────────────────────────────────
function GroupHeader({ photoUrl, initial, name, subtitle, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: photoUrl ? undefined : 'var(--accent-dim)', overflow: 'hidden', border: '1.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}>
        {photoUrl ? <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initial}
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

// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const openTab = (path) => {
    const a = document.createElement('a');
    a.href = path; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };
  const navTo = (e, path) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); openTab(path); }
    else window.location.href = path;
  };
  const { user }                 = useAuth();
  const { recruiters, roles }    = useContext(AppContext);
  const [serverAnalytics,  setServerAnalytics]  = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [allCandidates,    setAllCandidates]    = useState([]);
  const [allCandidatesLoaded, setAllCandidatesLoaded] = useState(false);
  const [recent,           setRecent]           = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [groupMode,        setGroupMode]        = useState('none');
  const [allUsers,         setAllUsers]         = useState([]);
  const [activeView,       setActiveView]       = useState('overview');
  const [pinnedCandidates, setPinnedCandidates] = useState([]);
  const [activeCandidates, setActiveCandidates] = useState([]);
  const [fromDate,         setFromDate]         = useState(() => isoDaysAgo(7));
  const [toDate,           setToDate]           = useState(() => isoToday());

  useEffect(() => {
    if (user?.isAdmin) authApi.listUsers().then(setAllUsers).catch(() => {});
  }, [user]);

  // Initial load — analytics + recent + active + pins in parallel
  useEffect(() => {
    (async () => {
      try {
        const [analyticsData, recentData, pinsData, activeData] = await Promise.all([
          candidateApi.getAnalytics({ fromDate, toDate }),
          candidateApi.getRecent(20),
          settingsApi.getPins().catch(() => ({ pins: [] })),
          candidateApi.getActiveWithResponseTime(),
        ]);
        setServerAnalytics(analyticsData);
        setRecent(recentData.candidates || []);
        setActiveCandidates(activeData.candidates || []);
        // Seed pinned candidates from stale/duplicate lists already in analytics
        const allKnown = [
          ...(analyticsData.staleCandidates || []),
          ...(analyticsData.duplicateGroups || []).flatMap(g => g.candidates),
        ];
        const pinIds = new Set(pinsData.pins || []);
        const pinned = [...pinIds].map(id => allKnown.find(c => c.id === id)).filter(Boolean);
        setPinnedCandidates(pinned);
      } catch (e) { console.error(e); }
      finally { setLoading(false); setAnalyticsLoading(false); }
    })();
  }, []); // eslint-disable-line

  // Re-fetch analytics when date range changes (after initial load)
  useEffect(() => {
    if (loading) return; // skip — initial load handles first fetch
    setAnalyticsLoading(true);
    candidateApi.getAnalytics({ fromDate, toDate })
      .then(setServerAnalytics)
      .catch(console.error)
      .finally(() => setAnalyticsLoading(false));
  }, [fromDate, toDate]); // eslint-disable-line

  // Lazy-load all candidates for Candidates tab group view + Deep Analysis role breakdown
  useEffect(() => {
    if (!['candidates', 'pipeline'].includes(activeView) || allCandidatesLoaded) return;
    candidateApi.getStats()
      .then(d => { setAllCandidates(d.candidates || []); setAllCandidatesLoaded(true); })
      .catch(console.error);
  }, [activeView, allCandidatesLoaded]);

  const analytics = serverAnalytics;
  const total = analytics?.total ?? 0;

  // Resolve role labels client-side (server returns raw roleValue)
  const roleBreakdown = useMemo(() =>
    (analytics?.roleBreakdown || []).map(rb => ({
      ...rb,
      label: roles.find(r => r.value === rb.roleValue)?.label || rb.roleValue,
    })),
  [analytics?.roleBreakdown, roles]);
  const getRoleLabel = (val) => roles.find(r => r.value === val)?.label || val || '—';
  const getRecruiter = (id)  => recruiters.find(r => r.id === id) || null;
  // Always resolve owner name from live users list — never trust stale ownerName field
  const getOwnerName  = (c)  => {
    // Non-admin: all visible candidates belong to the current user — use live profile name
    if (!user?.isAdmin && c.ownerId === user?.id)
      return user?.displayName || user?.username || c.ownerName || '—';
    const u = allUsers.find(u => u.id === c.ownerId);
    return u?.displayName || u?.username || c.ownerName || '—';
  };

  const formatAvgResponse = (ms) => {
    if (ms === null || ms === undefined) return '—';
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.round(ms / 3600000);
    if (h < 24) return `${h}h`;
    const d = (ms / 86400000).toFixed(1);
    return `${d}d`;
  };

  // Navigate to /candidates with pre-set filters via sessionStorage
  const navigateFiltered = (filters) => {
    try {
      sessionStorage.setItem('candidates_filters', JSON.stringify({
        search: '', statusFilter: '', recruiterFilter: '', ownerFilter: '', page: 1,
        fromDate, toDate,
        ...filters,
      }));
    } catch {}
    window.location.href = '/candidates';
  };

  // Stale candidates + duplicate groups — computed server-side, no client useMemo needed
  const staleCandidates = analytics?.staleCandidates || [];
  const duplicateGroups = analytics?.duplicateGroups || [];

  // Group helpers
  const groupedByRecruiter = useMemo(() => {
    const g = {};
    allCandidates.forEach(c => { const k = c.recruiterId || '__none__'; if (!g[k]) g[k] = []; g[k].push(c); });
    return g;
  }, [allCandidates]);

  const groupedByUser = useMemo(() => {
    const g = {};
    allCandidates.forEach(c => { const k = c.ownerId || '__none__'; if (!g[k]) g[k] = []; g[k].push(c); });
    return g;
  }, [allCandidates]);

  const groupButtons = [
    { mode: 'none',      label: 'Recent' },
    ...(recruiters.length > 0 ? [{ mode: 'recruiter', label: '◈ By Recruiter' }] : []),
    ...(user?.isAdmin ? [{ mode: 'user', label: '👤 By User' }] : []),
  ];

  // Candidate table rows
  const CandidateRow = ({ c, index }) => {
    const recruiter = getRecruiter(c.recruiterId);
    return (
      <tr onClick={e => navTo(e, `/candidates/${c.id}`)} onMouseDown={e => { if (e.button === 1) { e.preventDefault(); openTab(`/candidates/${c.id}`); } }} style={{ cursor: 'pointer' }}>
        <td style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{index + 1}</td>
        <td><Avatar src={c.photoUrl} name={c.fullName} size={28} /></td>
        <td>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{c.fullName || '—'}</div>
          {c.currentTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.currentTitle}</div>}
        </td>
        <td style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{c.email || '—'}</td>
        <td style={{ fontSize: 12 }}>{getRoleLabel(c.role)}</td>
        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.location ? `📍 ${c.location}` : '—'}</td>
        <td>
          {recruiter ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: recruiter.photoUrl ? undefined : 'var(--accent-dim)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 9, flexShrink: 0 }}>
                {recruiter.photoUrl ? <img src={recruiter.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : recruiter.name.charAt(0).toUpperCase()}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{recruiter.name}</span>
            </div>
          ) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>}
        </td>
        {user?.isAdmin && (
          <td>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 600, color: 'var(--text-muted)' }}>
                {(getOwnerName(c) || '?').charAt(0).toUpperCase()}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{getOwnerName(c)}</span>
            </div>
          </td>
        )}
        <td><span className={`status-badge status-${c.status}`}>{STATUS_CONFIG[c.status]?.label || c.status}</span></td>
        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
      </tr>
    );
  };

  const TableHead = () => (
    <thead>
      <tr>
        <th style={{ width: 32, color: 'var(--text-muted)', fontSize: 11 }}>No</th>
        <th style={{ width: 34 }}></th>
        <th>Candidate</th><th>Email</th><th>Role</th><th>Location</th>
        <th>Recruiter</th>
        {user?.isAdmin && <th>Added By</th>}
        <th>Status</th><th>Added</th>
      </tr>
    </thead>
  );

  const GroupTable = ({ candidates }) => (
    <div className="table-wrap">
      <table className="data-table">
        <TableHead />
        <tbody>{candidates.map((c, i) => <CandidateRow key={c.id} c={c} index={i} />)}</tbody>
      </table>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Recruiting pipeline analytics and overview</div>
        </div>
        <Link to="/candidates" className="btn btn-primary">+ Add Candidate</Link>
      </div>

      {/* View toggle */}
      <div className="tabs" style={{ marginBottom: 24 }}>
        {[['overview', '📊 Overview'], ['pipeline', '🔬 Deep Analysis'], ['candidates', '◈ Candidates']].map(([key, label]) => (
          <button key={key} className={`tab ${activeView === key ? 'active' : ''}`} onClick={() => setActiveView(key)}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><span className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} /></div>
      ) : (

        <>
          {/* ══════════════ OVERVIEW TAB ══════════════ */}
          {activeView === 'overview' && (
            <>
              {/* Date range filter */}
              <div className="card" style={{ marginBottom: 20, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <DateRangePicker
                  fromDate={fromDate} toDate={toDate}
                  onChange={(f, t) => { setFromDate(f); setToDate(t); }}
                />
                {analyticsLoading && <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, flexShrink: 0 }} />}
              </div>

              {/* KPI stat cards */}
              <div className="grid-4" style={{ marginBottom: 24 }}>
                <StatCard icon="◈" label="Total Candidates" value={total} color="var(--accent)"
                  onClick={() => navigateFiltered({})} />
                <StatCard icon="◑" label="In Progress" value={analytics?.statusCounts.in_progress || 0} color="var(--in-progress)"
                  sub={total > 0 ? `${Math.round(((analytics?.statusCounts.in_progress || 0) / total) * 100)}% of pipeline` : ''}
                  onClick={() => navigateFiltered({ statusFilter: 'in_progress' })} />
                <StatCard icon="●" label="Success Rate" value={`${analytics?.successRate || 0}%`} color="var(--success)"
                  sub={`${analytics?.statusCounts.success || 0} hired of ${(analytics?.statusCounts.success || 0) + (analytics?.totalFailed || 0)} decided`}
                  onClick={() => navigateFiltered({ statusFilter: 'success' })} />
                <StatCard icon="⏱" label="Avg. Time to Decision" value={analytics?.avgDays != null ? `${analytics.avgDays}d` : '—'} color="var(--warning)"
                  sub="days from add to outcome" />
              </div>

              {/* Row 1: Pipeline status + Activity */}
              <div className="grid-2" style={{ marginBottom: 20 }}>
                <div className="card">
                  <div className="card-title">Pipeline Status</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                    <div style={{ flexShrink: 0 }}>
                      <DonutChart size={110} segments={
                        Object.entries(STATUS_CONFIG).map(([key, val]) => ({
                          value: analytics?.statusCounts[key] || 0,
                          color: val.hex,
                        })).filter(s => s.value > 0)
                      } />
                    </div>
                    <div style={{ flex: 1 }}>
                      {Object.entries(STATUS_CONFIG).map(([key, val]) => {
                        const count = analytics?.statusCounts[key] || 0;
                        const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
                        return (
                          <div key={key} onClick={() => navigateFiltered({ statusFilter: key })}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', borderRadius: 6, padding: '2px 4px', transition: 'background 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: val.hex, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, flex: 1, color: 'var(--text-secondary)' }}>{val.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: val.color }}>{count}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 32, textAlign: 'right' }}>{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">Weekly Activity</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Candidates added per week (last 8 weeks)</div>
                  <ActivityTimeline weeks={analytics?.weeklyActivity || []} />
                </div>
              </div>

              {/* Row 2: Role breakdown + Locations */}
              <div className="grid-2" style={{ marginBottom: 20 }}>
                <div className="card">
                  <div className="card-title">Candidates by Role</div>
                  {roleBreakdown.length ? (
                    <BarChart
                      data={roleBreakdown}
                      colorFn={(_, i) => `hsl(${160 + i * 30}, 70%, 55%)`}
                      onClickItem={(d) => navigateFiltered({ search: d.roleValue })}
                    />
                  ) : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No role data yet</div>}
                </div>

                <div className="card">
                  <div className="card-title">Top Locations</div>
                  {analytics?.locationBreakdown.length ? (
                    <BarChart
                      data={analytics.locationBreakdown}
                      colorFn={(_, i) => `hsl(${200 + i * 20}, 65%, 55%)`}
                      onClickItem={(d) => navigateFiltered({ search: d.label })}
                    />
                  ) : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No location data yet</div>}
                </div>
              </div>

              {/* Row 3: Recruiter performance */}
              {analytics?.recruiterPerf.length > 0 && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <div className="card-title">Recruiter Performance</div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: 32, color: 'var(--text-muted)', fontSize: 11 }}>No</th>
                          <th>Recruiter</th>
                          <th style={{ textAlign: 'center' }}>Total</th>
                          <th style={{ textAlign: 'center' }}>In Progress</th>
                          <th style={{ textAlign: 'center' }}>Success</th>
                          <th style={{ textAlign: 'center' }}>Failed</th>
                          <th style={{ textAlign: 'center' }}>Success Rate</th>
                          <th>Pipeline</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.recruiterPerf.map((r, i) => (
                          <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigateFiltered({ recruiterFilter: r.id })}>
                            <td style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{i + 1}</td>
                            <td style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</td>
                            <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent)' }}>{r.total}</td>
                            <td style={{ textAlign: 'center', color: 'var(--in-progress)' }}>{r.in_progress}</td>
                            <td style={{ textAlign: 'center', color: 'var(--success)' }}>{r.success}</td>
                            <td style={{ textAlign: 'center', color: 'var(--error)' }}>{r.failed}</td>
                            <td style={{ textAlign: 'center' }}>
                              <span style={{ fontWeight: 700, color: r.successRate >= 50 ? 'var(--success)' : r.successRate > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                                {r.successRate}%
                              </span>
                            </td>
                            <td style={{ width: 120 }}>
                              <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                                {[['success', '#00d4aa'], ['in_progress', '#4a9eff'], ['pending', '#f5a623'], ['failed', '#ff6b6b']].map(([key, color]) => (
                                  r[key] > 0 && <div key={key} style={{ height: '100%', width: `${(r[key] / r.total) * 100}%`, background: color }} />
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Admin: User breakdown */}
              {user?.isAdmin && analytics?.userBreakdown.length > 0 && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <div className="card-title">Hiring Manager Performance</div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: 32, color: 'var(--text-muted)', fontSize: 11 }}>No</th>
                          <th>Recruiter</th>
                          <th style={{ textAlign: 'center' }}>Candidates</th>
                          <th style={{ textAlign: 'center' }}>In Progress</th>
                          <th style={{ textAlign: 'center' }}>Success</th>
                          <th style={{ textAlign: 'center' }}>Success Rate</th>
                          <th>Pipeline</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.userBreakdown.map((u, i) => (
                          <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => navigateFiltered({ ownerFilter: u.id })}>
                            <td style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{i + 1}</td>
                            <td style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</td>
                            <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent)' }}>{u.total}</td>
                            <td style={{ textAlign: 'center', color: 'var(--in-progress)' }}>{u.in_progress}</td>
                            <td style={{ textAlign: 'center', color: 'var(--success)' }}>{u.success}</td>
                            <td style={{ textAlign: 'center' }}>
                              <span style={{ fontWeight: 700, color: u.successRate >= 50 ? 'var(--success)' : u.successRate > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                                {u.successRate}%
                              </span>
                            </td>
                            <td style={{ width: 120 }}>
                              <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                                {[['success', '#00d4aa'], ['in_progress', '#4a9eff'], ['pending', '#f5a623'], ['failed', '#ff6b6b']].map(([key, color]) => (
                                  u[key] > 0 && <div key={key} style={{ height: '100%', width: `${(u[key] / u.total) * 100}%`, background: color }} />
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Duplicate profiles */}
              {duplicateGroups.length > 0 && (
                <div className="card" style={{ marginBottom: 20, border: '1px solid rgba(255,107,107,0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 18 }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                      <div className="card-title" style={{ color: 'var(--error)', marginBottom: 2 }}>Duplicate Profiles ({duplicateGroups.length} group{duplicateGroups.length !== 1 ? 's' : ''})</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Candidates sharing the same name or email address</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {duplicateGroups.map((group, gi) => (
                      <div key={gi} style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                          {group.reason === 'name' ? '👤 Same name:' : '✉ Same email:'}{' '}
                          <span style={{ color: 'var(--error)', fontWeight: 600 }}>{group.value}</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {group.candidates.map(c => {
                            const recruiter = getRecruiter(c.recruiterId);
                            return (
                              <div key={c.id} onClick={e => navTo(e, `/candidates/${c.id}`)} onMouseDown={e => { if (e.button === 1) { e.preventDefault(); openTab(`/candidates/${c.id}`); } }}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', cursor: 'pointer', minWidth: 220 }}>
                                <Avatar src={c.photoUrl} name={c.fullName} size={28} />
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.fullName || '—'}</div>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                                    {c.email || '—'}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                                    <span className={`status-badge status-${c.status}`} style={{ padding: '1px 6px', fontSize: 9 }}>{STATUS_CONFIG[c.status]?.label || c.status}</span>
                                    {recruiter && (
                                      <span style={{ fontSize: 9, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 8, border: '1px solid var(--border)' }}>
                                        ◈ {recruiter.name}
                                      </span>
                                    )}
                                    {c.ownerId && (
                                      <span style={{ fontSize: 9, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 8, border: '1px solid var(--border)' }}>
                                        👤 {getOwnerName(c)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Candidates — sorted by time since last contact */}
              {activeCandidates.length > 0 && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div>
                      <div className="card-title" style={{ marginBottom: 2 }}>Active Candidates — Awaiting Follow-up</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {activeCandidates.length} in progress · contacted within 14 days · most recent first
                      </div>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => navigateFiltered({ statusFilter: 'in_progress' })}>
                      View all →
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: 32, color: 'var(--text-muted)', fontSize: 11 }}>No</th>
                          <th>Candidate</th>
                          <th>Role</th>
                          <th>Recruiter</th>
                          {user?.isAdmin && <th>Owner</th>}
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Last Contact</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeCandidates.map((c, i) => {
                          const recruiter = getRecruiter(c.recruiterId);
                          return (
                            <tr key={c.id} style={{ cursor: 'pointer' }} onClick={e => navTo(e, `/candidates/${c.id}`)} onMouseDown={e => { if (e.button === 1) { e.preventDefault(); openTab(`/candidates/${c.id}`); } }}>
                              <td style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{i + 1}</td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: c.photoUrl ? undefined : 'var(--accent-dim)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 11, border: '1.5px solid var(--border)' }}>
                                    {c.photoUrl ? <img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (c.fullName || '?').charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.fullName || '—'}</div>
                                    {c.currentTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.currentTitle}</div>}
                                  </div>
                                </div>
                              </td>
                              <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{getRoleLabel(c.role)}</td>
                              <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                {recruiter ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: 'var(--accent-dim)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 9 }}>
                                      {recruiter.photoUrl ? <img src={recruiter.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : recruiter.name.charAt(0).toUpperCase()}
                                    </div>
                                    {recruiter.name}
                                  </div>
                                ) : '—'}
                              </td>
                              {user?.isAdmin && (
                                <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{getOwnerName(c)}</td>
                              )}
                              <td><span className={`status-badge status-${c.status}`}>{STATUS_CONFIG[c.status]?.label || c.status}</span></td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                                    {formatAvgResponse(c.durationSinceLastMessageMs)}
                                  </span>
                                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{c.messageCount} msg{c.messageCount !== 1 ? 's' : ''}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* No-reply candidates — visible to all users */}
              {staleCandidates.length > 0 && (
                <div className="card" style={{ marginBottom: 20, border: '1px solid rgba(245,166,35,0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 18 }}>⏰</span>
                    <div style={{ flex: 1 }}>
                      <div className="card-title" style={{ color: 'var(--warning)', marginBottom: 2 }}>No Reply — Needs Follow-up ({staleCandidates.length})</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>In-progress candidates with no message activity for more than 3 days</div>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr>
                        <th style={{ width: 32, color: 'var(--text-muted)', fontSize: 11 }}>No</th>
                        <th></th><th>Candidate</th><th>Role</th><th>Last Message</th><th>Days Idle</th><th>Recruiter</th><th>User</th>
                      </tr></thead>
                      <tbody>
                        {staleCandidates.map((c, i) => {
                          const lastActivity = c.lastMessageAt || c.createdAt;
                          const days = Math.floor((Date.now() - new Date(lastActivity)) / (1000 * 60 * 60 * 24));
                          const recruiter = getRecruiter(c.recruiterId);
                          return (
                            <tr key={c.id} onClick={e => navTo(e, `/candidates/${c.id}`)} onMouseDown={e => { if (e.button === 1) { e.preventDefault(); openTab(`/candidates/${c.id}`); } }} style={{ cursor: 'pointer' }}>
                              <td style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{i + 1}</td>
                              <td><Avatar src={c.photoUrl} name={c.fullName} size={26} /></td>
                              <td style={{ fontWeight: 600 }}>{c.fullName || '—'}</td>
                              <td style={{ fontSize: 12 }}>{getRoleLabel(c.role)}</td>
                              <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {c.lastMessageAt
                                  ? new Date(c.lastMessageAt).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                  : 'No messages yet'}
                              </td>
                              <td><span style={{ color: days > 14 ? 'var(--error)' : 'var(--warning)', fontWeight: 700, fontSize: 13 }}>{days}d</span></td>
                              <td style={{ fontSize: 12 }}>{recruiter?.name || c.recruiterName || '—'}</td>
                              <td style={{ fontSize: 12 }}>{getOwnerName(c)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Pinned candidates */}
              {pinnedCandidates.length > 0 && (
                <div className="card" style={{ marginBottom: 20, border: '1px solid rgba(245,166,35,0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 18 }}>★</span>
                    <div>
                      <div className="card-title" style={{ color: '#f59e0b', marginBottom: 2 }}>Pinned Candidates ({pinnedCandidates.length})</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Your personally pinned candidates</div>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr>
                        <th style={{ width: 32 }}></th>
                        <th></th><th>Candidate</th><th>Role</th><th>Status</th><th>Recruiter</th><th>User</th>
                      </tr></thead>
                      <tbody>
                        {pinnedCandidates.map((c, i) => {
                          const recruiter = getRecruiter(c.recruiterId);
                          return (
                            <tr key={c.id} onClick={e => navTo(e, `/candidates/${c.id}`)} onMouseDown={e => { if (e.button === 1) { e.preventDefault(); openTab(`/candidates/${c.id}`); } }} style={{ cursor: 'pointer' }}>
                              <td style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{i + 1}</td>
                              <td><Avatar src={c.photoUrl} name={c.fullName} size={26} /></td>
                              <td style={{ fontWeight: 600 }}>{c.fullName || '—'}</td>
                              <td style={{ fontSize: 12 }}>{getRoleLabel(c.role)}</td>
                              <td><span className={`status-badge status-${c.status}`}>{STATUS_CONFIG[c.status]?.label || c.status}</span></td>
                              <td style={{ fontSize: 12 }}>{recruiter?.name || c.recruiterName || '—'}</td>
                              <td style={{ fontSize: 12 }}>{getOwnerName(c)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Quick actions */}
              <div className="card">
                <div className="card-title">Quick Actions</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Link to="/candidates" className="btn btn-secondary">◈ Add Candidate</Link>
                  <Link to="/generate" className="btn btn-secondary">◎ Generate Scenario</Link>
                  <Link to="/generate?tab=outreach" className="btn btn-secondary">✉ Create Outreach</Link>
                  <Link to="/settings" className="btn btn-secondary">⚙ Settings</Link>
                </div>
              </div>
            </>
          )}

          {/* ══════════════ DEEP ANALYSIS TAB ══════════════ */}
          {activeView === 'pipeline' && (
            <>
              {/* Conversion funnel */}
              <div className="grid-2" style={{ marginBottom: 20 }}>
                <div className="card">
                  <div className="card-title">Conversion Funnel</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>How candidates progress through your pipeline</div>
                  <FunnelChart stages={[
                    { label: 'Added to Pipeline',  icon: '◈', value: total,                                        color: 'var(--accent)' },
                    { label: 'Engaged (In Progress)', icon: '◑', value: (analytics?.statusCounts.in_progress || 0) + (analytics?.statusCounts.success || 0) + (analytics?.totalFailed || 0), color: 'var(--in-progress)' },
                    { label: 'Decision Reached',   icon: '⊕', value: (analytics?.statusCounts.success || 0) + (analytics?.totalFailed || 0), color: 'var(--warning)' },
                    { label: 'Successfully Hired', icon: '●', value: analytics?.statusCounts.success || 0,          color: 'var(--success)' },
                  ]} />
                  <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(0,212,170,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(0,212,170,0.15)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Overall Conversion Rate</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{analytics?.conversionRate || 0}%</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>of all candidates successfully hired</div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">Monthly Trend</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Candidates added per month (last 6 months)</div>
                  {analytics?.monthlyTrend && (
                    <>
                      <BarChart
                        data={analytics.monthlyTrend}
                        colorFn={(d, i) => `hsl(${160 + i * 10}, 70%, ${45 + i * 3}%)`}
                      />
                      <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
                        Total this period: <strong style={{ color: 'var(--text-primary)' }}>{analytics.monthlyTrend.reduce((s, m) => s + m.value, 0)}</strong> candidates
                        {analytics.monthlyTrend.length >= 2 && (() => {
                          const last  = analytics.monthlyTrend[analytics.monthlyTrend.length - 1].value;
                          const prev  = analytics.monthlyTrend[analytics.monthlyTrend.length - 2].value;
                          const delta = prev > 0 ? Math.round(((last - prev) / prev) * 100) : null;
                          return delta !== null ? (
                            <span style={{ marginLeft: 8, color: delta >= 0 ? 'var(--success)' : 'var(--error)' }}>
                              {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% vs last month
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Role × Status matrix */}
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-title">Role × Status Breakdown</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>How each role is distributed across pipeline stages</div>
                {roleBreakdown.length > 0 ? (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: 32, color: 'var(--text-muted)', fontSize: 11 }}>No</th>
                          <th>Role</th>
                          <th style={{ textAlign: 'center' }}>Total</th>
                          <th style={{ textAlign: 'center', color: 'var(--pending)' }}>Pending</th>
                          <th style={{ textAlign: 'center', color: 'var(--in-progress)' }}>In Progress</th>
                          <th style={{ textAlign: 'center', color: 'var(--success)' }}>Success</th>
                          <th style={{ textAlign: 'center', color: 'var(--error)' }}>Failed</th>
                          <th style={{ textAlign: 'center' }}>Success Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roleBreakdown.map((rb, i) => {
                          const roleCands = allCandidates.filter(c => c.role === rb.roleValue);
                          const sc = { pending: 0, in_progress: 0, success: 0, failed: 0 };
                          roleCands.forEach(c => { const k = FAILED_STATUSES.includes(c.status) ? 'failed' : c.status; if (sc[k] !== undefined) sc[k]++; });
                          const decided = sc.success + sc.failed;
                          const sr = decided > 0 ? Math.round((sc.success / decided) * 100) : null;
                          return (
                            <tr key={rb.label}>
                              <td style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{i + 1}</td>
                              <td style={{ fontWeight: 600 }}>{rb.label}</td>
                              <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--accent)' }}>{rb.value}</td>
                              <td style={{ textAlign: 'center', color: 'var(--pending)' }}>{sc.pending}</td>
                              <td style={{ textAlign: 'center', color: 'var(--in-progress)' }}>{sc.in_progress}</td>
                              <td style={{ textAlign: 'center', color: 'var(--success)' }}>{sc.success}</td>
                              <td style={{ textAlign: 'center', color: 'var(--error)' }}>{sc.failed}</td>
                              <td style={{ textAlign: 'center' }}>
                                {sr !== null ? (
                                  <span style={{ fontWeight: 700, color: sr >= 50 ? 'var(--success)' : sr > 0 ? 'var(--warning)' : 'var(--error)' }}>{sr}%</span>
                                ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No data yet — assign roles to candidates to see this breakdown.</div>}
              </div>

              {/* Stale candidates — no reply for 3+ days */}
              {staleCandidates.length > 0 && (
                <div className="card" style={{ marginBottom: 20, border: '1px solid rgba(245,166,35,0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 18 }}>⚠️</span>
                    <div>
                      <div className="card-title" style={{ color: 'var(--warning)', marginBottom: 2 }}>No Reply — Needs Attention ({staleCandidates.length})</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>In-progress candidates with no message activity for more than 3 days</div>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr>
                        <th style={{ width: 32, color: 'var(--text-muted)', fontSize: 11 }}>No</th>
                        <th></th><th>Candidate</th><th>Role</th><th>Last Message</th><th>Days Idle</th><th>Recruiter</th><th>User</th>
                      </tr></thead>
                      <tbody>
                        {staleCandidates.map((c, i) => {
                          const lastActivity = c.lastMessageAt || c.createdAt;
                          const days = Math.floor((Date.now() - new Date(lastActivity)) / (1000 * 60 * 60 * 24));
                          const recruiter = getRecruiter(c.recruiterId);
                          return (
                            <tr key={c.id} onClick={e => navTo(e, `/candidates/${c.id}`)} onMouseDown={e => { if (e.button === 1) { e.preventDefault(); openTab(`/candidates/${c.id}`); } }} style={{ cursor: 'pointer' }}>
                              <td style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{i + 1}</td>
                              <td><Avatar src={c.photoUrl} name={c.fullName} size={26} /></td>
                              <td style={{ fontWeight: 600 }}>{c.fullName || '—'}</td>
                              <td style={{ fontSize: 12 }}>{getRoleLabel(c.role)}</td>
                              <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {c.lastMessageAt
                                  ? new Date(c.lastMessageAt).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                  : 'No messages yet'}
                              </td>
                              <td><span style={{ color: days > 14 ? 'var(--error)' : 'var(--warning)', fontWeight: 700, fontSize: 13 }}>{days}d</span></td>
                              <td style={{ fontSize: 12 }}>{recruiter?.name || c.recruiterName || '—'}</td>
                              <td style={{ fontSize: 12 }}>{getOwnerName(c)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Recent successes */}
              {analytics?.statusCounts.success > 0 && (
                <div className="card">
                  <div className="card-title" style={{ color: 'var(--success)' }}>● Recent Successes</div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th style={{ width: 32, color: 'var(--text-muted)', fontSize: 11 }}>No</th><th></th><th>Candidate</th><th>Role</th><th>Recruiter</th><th>Added By</th><th>Date</th></tr></thead>
                      <tbody>
                        {allCandidates.filter(c => c.status === 'success').slice(0, 5).map((c, i) => (
                          <tr key={c.id} onClick={e => navTo(e, `/candidates/${c.id}`)} onMouseDown={e => { if (e.button === 1) { e.preventDefault(); openTab(`/candidates/${c.id}`); } }} style={{ cursor: 'pointer' }}>
                            <td style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{i + 1}</td>
                            <td><Avatar src={c.photoUrl} name={c.fullName} size={26} /></td>
                            <td style={{ fontWeight: 600, color: 'var(--success)' }}>{c.fullName || '—'}</td>
                            <td style={{ fontSize: 12 }}>{getRoleLabel(c.role)}</td>
                            <td style={{ fontSize: 12 }}>{getRecruiter(c.recruiterId)?.name || '—'}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getOwnerName(c)}</td>
                            <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══════════════ CANDIDATES TAB ══════════════ */}
          {activeView === 'candidates' && (
            <div className="card">
              <div style={{ marginBottom: 16 }}>
                <DateRangePicker
                  fromDate={fromDate} toDate={toDate}
                  onChange={(f, t) => { setFromDate(f); setToDate(t); }}
                />
              </div>
              <div className="flex items-center justify-between mb-16">
                <div className="card-title">
                  {groupMode === 'none' ? 'Recent Candidates' : groupMode === 'recruiter' ? 'By Recruiter' : 'By Hiring Manager'}
                </div>
                <div className="flex gap-8">
                  {groupButtons.map(b => (
                    <button key={b.mode} className={`btn btn-sm ${groupMode === b.mode ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setGroupMode(b.mode)}>{b.label}</button>
                  ))}
                  <Link to="/candidates" className="btn btn-secondary btn-sm">View All</Link>
                </div>
              </div>

              {groupMode === 'none' ? (
                recent.length === 0
                  ? <div className="empty-state"><div className="empty-state-icon">◈</div><div className="empty-state-title">No recent candidates</div><Link to="/candidates" className="btn btn-primary">Add Candidate</Link></div>
                  : <GroupTable candidates={recent} />
              ) : !allCandidatesLoaded ? (
                <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" style={{ width: 28, height: 28, borderWidth: 2 }} /></div>
              ) : allCandidates.length === 0 ? (
                <div className="empty-state"><div className="empty-state-icon">◈</div><div className="empty-state-title">No candidates yet</div><Link to="/candidates" className="btn btn-primary">Add Candidate</Link></div>
              ) : groupMode === 'recruiter' ? (
                <div>
                  {recruiters.map(r => {
                    const group = groupedByRecruiter[r.id] || [];
                    if (!group.length) return null;
                    return (
                      <div key={r.id} style={{ marginBottom: 28 }}>
                        <GroupHeader photoUrl={r.photoUrl} initial={(r.name||'?').charAt(0).toUpperCase()} name={r.name} subtitle={r.currentTitle} count={group.length} />
                        <GroupTable candidates={group} />
                      </div>
                    );
                  })}
                  {(groupedByRecruiter['__none__'] || []).length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <GroupHeader photoUrl={null} initial="—" name="No Recruiter Assigned" count={groupedByRecruiter['__none__'].length} />
                      <GroupTable candidates={groupedByRecruiter['__none__']} />
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {allUsers.map(u => {
                    const group = groupedByUser[u.id] || [];
                    if (!group.length) return null;

                    // Get this user's recruiters (recruiters have _ownerKey = recruiters_{userId})
                    const userRecruiters = recruiters.filter(r =>
                      r._ownerKey === `recruiters_${u.id}` || (!r._ownerKey && false)
                    );

                    // Sub-group this user's candidates by recruiter
                    const byRecruiter = {};
                    group.forEach(c => {
                      const key = c.recruiterId || '__none__';
                      if (!byRecruiter[key]) byRecruiter[key] = [];
                      byRecruiter[key].push(c);
                    });
                    const hasRecruiters = userRecruiters.length > 0 && Object.keys(byRecruiter).some(k => k !== '__none__' && byRecruiter[k].length > 0);

                    return (
                      <div key={u.id} style={{ marginBottom: 32, padding: '0 0 24px', borderBottom: '1px solid var(--border)' }}>
                        {/* User header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, color: 'var(--accent)', border: '2px solid var(--accent)', flexShrink: 0 }}>
                            {(u.displayName||u.username||'?').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{u.displayName || u.username}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.isAdmin ? 'Administrator' : 'Hiring Manager'} · {group.length} candidate{group.length !== 1 ? 's' : ''}</div>
                          </div>
                        </div>

                        {hasRecruiters ? (
                          // Sub-group by recruiter
                          <div style={{ paddingLeft: 16, borderLeft: '2px solid var(--border)' }}>
                            {userRecruiters.map(r => {
                              const rGroup = byRecruiter[r.id] || [];
                              if (!rGroup.length) return null;
                              return (
                                <div key={r.id} style={{ marginBottom: 20 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                    <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: r.photoUrl ? undefined : 'var(--bg-elevated)', overflow: 'hidden', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>
                                      {r.photoUrl ? <img src={r.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : r.name.charAt(0).toUpperCase()}
                                    </div>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{r.name}</span>
                                    {r.currentTitle && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {r.currentTitle}</span>}
                                    <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '1px 8px', borderRadius: 8 }}>{rGroup.length}</span>
                                  </div>
                                  <GroupTable candidates={rGroup} />
                                </div>
                              );
                            })}
                            {/* Unassigned under this user */}
                            {(byRecruiter['__none__'] || []).length > 0 && (
                              <div style={{ marginBottom: 20 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>— No Recruiter Assigned</span>
                                  <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '1px 8px', borderRadius: 8 }}>{byRecruiter['__none__'].length}</span>
                                </div>
                                <GroupTable candidates={byRecruiter['__none__']} />
                              </div>
                            )}
                          </div>
                        ) : (
                          // No recruiters — flat list
                          <GroupTable candidates={group} />
                        )}
                      </div>
                    );
                  })}
                  {(groupedByUser['__none__']||[]).length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <GroupHeader photoUrl={null} initial="?" name="No Owner" count={groupedByUser['__none__'].length} />
                      <GroupTable candidates={groupedByUser['__none__']} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
