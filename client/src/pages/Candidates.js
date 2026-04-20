import React, { useEffect, useState, useCallback, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { candidateApi, generateApi, authApi, settingsApi } from '../utils/api';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

const STATUS_OPTIONS = ['pending', 'in_progress', 'success', 'failed'];

// ─────────────────────────────────────────────────────────────────────────────
// Add / Edit Candidate Modal
// ─────────────────────────────────────────────────────────────────────────────
function CandidateModal({ onClose, onSaved, initial = null }) {
  const isEdit = !!initial;
  const { roles, recruiters, companies } = useContext(AppContext);

  const [form, setForm] = useState({
    fullName:     initial?.fullName     || '',
    email:        initial?.email        || '',
    phone:        initial?.phone        || '',
    linkedinUrl:  initial?.linkedinUrl  || '',
    location:     initial?.location     || '',
    currentTitle: initial?.currentTitle || '',
    role:         initial?.role         || '',
    resumeUrl:    initial?.resumeUrl    || '',
    recruiterId:  initial?.recruiterId  || '',
    companyId:    initial?.companyId    || '',
    notes:        initial?.notes        || '',
  });
  const [photoPreview, setPhotoPreview] = useState(initial?.photoUrl || '');
  const [photoData, setPhotoData]       = useState('');
  const [resumeFile, setResumeFile]         = useState(null);
  const [resumeText, setResumeText]         = useState('');
  const [extracting, setExtracting]         = useState(false);
  const [recommending, setRecommending]     = useState(false);
  const [roleHint, setRoleHint]             = useState('');
  const [saving, setSaving]                 = useState(false);
  const [linkedinInput, setLinkedinInput]   = useState('');
  const [extractingLi, setExtractingLi]     = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const onDrop = useCallback(async (files) => {
    const file = files[0];
    if (!file) return;
    setResumeFile(file);
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append('resume', file);
      const data = await candidateApi.extract(fd);
      setForm(p => ({
        ...p,
        fullName:     p.fullName     || data.fullName     || '',
        email:        p.email        || data.email        || '',
        phone:        p.phone        || data.phone        || '',
        linkedinUrl:  p.linkedinUrl  || data.linkedinUrl  || '',
        location:     p.location     || data.location     || '',
        currentTitle: p.currentTitle || data.currentTitle || '',
      }));
      if (data.photoUrl) { setPhotoPreview(data.photoUrl); setPhotoData(data.photoUrl); }
      if (data.resumeText) setResumeText(data.resumeText);
      toast.success('Resume parsed — fields auto-filled');
    } catch (e) {
      toast.error('Could not extract resume data: ' + e.message);
    } finally {
      setExtracting(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
    },
    maxFiles: 1,
    onDrop,
  });

  const recommendRole = async () => {
    setRecommending(true); setRoleHint('');
    try {
      const data = await generateApi.recommendRole({
        resumeText: resumeText || form.currentTitle || '',
        candidateId: initial?.id || '',
      });
      if (data.roleValue) {
        set('role', data.roleValue);
        setRoleHint(`${data.recommendedRole} (${data.confidence}) — ${data.reasoning}`);
        toast.success('Role recommended!');
      }
    } catch (e) { toast.error('Could not recommend role: ' + e.message); }
    finally { setRecommending(false); }
  };

  const extractFromLinkedIn = async () => {
    const url = linkedinInput.trim();
    if (!url) return;
    setExtractingLi(true);
    try {
      const data = await settingsApi.extractLinkedIn(url);
      setForm(p => ({
        ...p,
        fullName:     data.fullName     || p.fullName     || '',
        email:        data.email        || p.email        || '',
        phone:        data.phone        || p.phone        || '',
        linkedinUrl:  url,
        location:     data.location     || p.location     || '',
        currentTitle: data.currentTitle || p.currentTitle || '',
      }));
      if (data.photoUrl) { setPhotoPreview(data.photoUrl); setPhotoData(data.photoUrl); }
      if (data.resumeText) setResumeText(data.resumeText);
      toast.success('LinkedIn profile extracted — fields auto-filled');
    } catch (e) { toast.error(e.message); }
    finally { setExtractingLi(false); }
  };

  const getRecruiterName = (id) => recruiters.find(r => r.id === id)?.name || '';
  const getCompanyName   = (id) => companies.find(c => c.id === id)?.name  || '';

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v || ''));
      fd.set('recruiterName', getRecruiterName(form.recruiterId));
      fd.set('companyName',   getCompanyName(form.companyId));
      if (photoData) fd.append('photoUrl', photoData);
      if (resumeFile) fd.append('resume', resumeFile);
      if (isEdit) {
        await candidateApi.update(initial.id, fd);
        toast.success('Candidate updated!');
      } else {
        await candidateApi.create(fd);
        toast.success('Candidate added!');
      }
      onSaved(); onClose();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-title">{isEdit ? 'Edit Candidate' : 'Add Candidate'}</div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 20, alignItems: 'flex-start' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', flexShrink: 0, background: 'var(--bg-elevated)', border: '2px solid var(--border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
            {photoPreview ? <img src={photoPreview} alt="Photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="form-label" style={{ marginBottom: 2 }}>
              Import from Resume or LinkedIn
            </div>
            {/* Resume drop zone */}
            <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`} style={{ padding: '10px 14px', marginBottom: 0 }}>
              <input {...getInputProps()} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ fontSize: 16 }}>📄</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {resumeFile ? resumeFile.name : extracting ? '⟳ Extracting...' : isDragActive ? 'Drop here' : 'Drop or click to upload resume (PDF/DOC/TXT)'}
                </span>
              </div>
            </div>
            {/* LinkedIn extraction */}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="form-input"
                style={{ flex: 1, fontSize: 12 }}
                placeholder="Or paste LinkedIn URL to auto-fill..."
                value={linkedinInput}
                onChange={e => setLinkedinInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && extractFromLinkedIn()}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={extractFromLinkedIn}
                disabled={extractingLi || !linkedinInput.trim()}
                style={{ whiteSpace: 'nowrap' }}
              >
                {extractingLi ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Extracting...</> : '🔗 Extract'}
              </button>
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="form-group"><label className="form-label">Full Name</label><input className="form-input" value={form.fullName} onChange={e => set('fullName', e.target.value)} placeholder="Jane Smith" /></div>
          <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" /></div>
          <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+1 555 000 0000" /></div>
          <div className="form-group"><label className="form-label">Location / Country</label><input className="form-input" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Manila, Philippines" /></div>
          <div className="form-group"><label className="form-label">Current Title</label><input className="form-input" value={form.currentTitle} onChange={e => set('currentTitle', e.target.value)} placeholder="Senior Solidity Developer" /></div>
          <div className="form-group"><label className="form-label">LinkedIn URL</label><input className="form-input" value={form.linkedinUrl} onChange={e => set('linkedinUrl', e.target.value)} placeholder="https://linkedin.com/in/..." /></div>

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Role</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={recommendRole} disabled={recommending} style={{ fontSize: 11, padding: '3px 10px' }}>
                {recommending ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Analysing...</> : '✨ Recommend Role'}
              </button>
            </label>
            <select className="form-select" value={form.role} onChange={e => { set('role', e.target.value); setRoleHint(''); }}>
              <option value="">Select role...</option>
              {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {roleHint && <div style={{ marginTop: 5, fontSize: 11, color: 'var(--accent)', lineHeight: 1.5 }}>✨ {roleHint}</div>}
          </div>

          <div className="form-group">
            <label className="form-label">Assigned Recruiter</label>
            <select className="form-select" value={form.recruiterId} onChange={e => set('recruiterId', e.target.value)}>
              <option value="">No recruiter assigned</option>
              {recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          {companies.length > 0 && (
            <div className="form-group">
              <label className="form-label">Company</label>
              <select className="form-select" value={form.companyId} onChange={e => set('companyId', e.target.value)}>
                <option value="">No company assigned</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                The AI will use only this company&apos;s knowledge base when generating content.
              </div>
            </div>
          )}
        </div>

        {!resumeFile && (
          <div className="form-group">
            <label className="form-label">Resume URL (optional)</label>
            <input className="form-input" value={form.resumeUrl} onChange={e => set('resumeUrl', e.target.value)} placeholder="https://drive.google.com/..." />
          </div>
        )}

        <div className="flex gap-8" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || extracting}>
            {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : isEdit ? 'Save Changes' : 'Add Candidate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidates page
// ─────────────────────────────────────────────────────────────────────────────
const FILTER_KEY = 'candidates_filters';
function loadFilters() {
  try { return JSON.parse(sessionStorage.getItem(FILTER_KEY)) || {}; }
  catch { return {}; }
}

export default function Candidates() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { roles, recruiters } = useContext(AppContext);

  const saved = loadFilters();

  const [candidates,      setCandidates]      = useState([]);
  const [pinnedCandidates, setPinnedCandidates] = useState([]);
  const [total,           setTotal]            = useState(0);
  const [loading,         setLoading]          = useState(true);
  const [showAdd,         setShowAdd]          = useState(false);
  const [editCandidate,   setEditCandidate]    = useState(null);
  const [search,          setSearch]           = useState(saved.search          || '');
  const [statusFilter,    setStatusFilter]     = useState(saved.statusFilter    || '');
  const [recruiterFilter, setRecruiterFilter]  = useState(saved.recruiterFilter || '');
  const [ownerFilter,     setOwnerFilter]      = useState(saved.ownerFilter     || '');
  const [page,            setPage]             = useState(saved.page            || 1);
  const [pageSize,        setPageSize]         = useState(saved.pageSize        || 20);

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify({ search, statusFilter, recruiterFilter, ownerFilter, page, pageSize }));
    } catch {}
  }, [search, statusFilter, recruiterFilter, ownerFilter, page, pageSize]);

  // For admin: list of all users to filter by
  const [allUsers, setAllUsers] = useState([]);
  useEffect(() => {
    if (user?.isAdmin) authApi.listUsers().then(setAllUsers).catch(() => {});
  }, [user]);

  // ── Pins ──────────────────────────────────────────────────────────────────
  const [pinnedIds, setPinnedIds] = useState(new Set());
  useEffect(() => {
    settingsApi.getPins().then(d => setPinnedIds(new Set(d.pins || []))).catch(() => {});
  }, []);

  // Fetch pinned candidates separately whenever pinnedIds changes
  useEffect(() => {
    if (!pinnedIds.size) { setPinnedCandidates([]); return; }
    candidateApi.getByIds([...pinnedIds]).then(d => setPinnedCandidates(d.candidates || [])).catch(() => {});
  }, [pinnedIds]);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const params = { search, status: statusFilter, page, limit: pageSize };
      if (recruiterFilter) params.recruiterId = recruiterFilter;
      if (user?.isAdmin && ownerFilter) params.ownerId = ownerFilter;
      // Exclude pinned IDs so they don't appear twice
      const data = await candidateApi.getAll(params);
      const pinSet = pinnedIds;
      setCandidates((data.candidates || []).filter(c => !pinSet.has(c.id)));
      setTotal(data.total || 0);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, recruiterFilter, ownerFilter, page, pageSize, user, pinnedIds]);

  useEffect(() => { fetchCandidates(); }, [fetchCandidates]);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('Delete this candidate?')) return;
    try {
      await candidateApi.delete(id);
      toast.success('Candidate deleted');
      setPinnedIds(s => { const n = new Set(s); n.delete(id); return n; });
      fetchCandidates();
    } catch (e) { toast.error(e.message); }
  };

  const togglePin = async (e, c) => {
    e.stopPropagation();
    const isPinned = pinnedIds.has(c.id);
    try {
      if (isPinned) {
        await settingsApi.removePin(c.id);
        setPinnedIds(s => { const n = new Set(s); n.delete(c.id); return n; });
        toast.success('Unpinned');
      } else {
        await settingsApi.addPin(c.id);
        setPinnedIds(s => new Set([...s, c.id]));
        toast.success('Pinned');
      }
    } catch (err) { toast.error(err.message); }
  };

  const getRoleLabel  = (val) => roles.find(r => r.value === val)?.label || val || '—';
  const getRecruiter  = (id)  => recruiters.find(r => r.id === id) || null;

  const resetPage = () => setPage(1);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Candidates</div>
          <div className="page-subtitle">{total} candidate{total !== 1 ? 's' : ''} in pipeline{ownerFilter ? ` — filtered by user` : ''}</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Candidate</button>
      </div>

      <div className="card">
        {/* ── Filter bar ── */}
        <div className="flex gap-12 mb-16" style={{ flexWrap: 'wrap' }}>
          {/* Search */}
          <div className="input-wrap" style={{ flex: 1, minWidth: 200, position: 'relative' }}>
            <span className="input-icon">🔍</span>
            <input className="form-input" placeholder="Search by name, email, role, location..."
              value={search} onChange={e => { setSearch(e.target.value); resetPage(); }} />
            {search && (
              <button onClick={() => { setSearch(''); resetPage(); }}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 0 }}
                title="Clear search">✕</button>
            )}
          </div>

          {/* Status filter */}
          <select className="form-select" style={{ width: 150 }} value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); resetPage(); }}>
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>

          {/* Recruiter filter — always shown when recruiters exist */}
          {recruiters.length > 0 && (
            <select className="form-select" style={{ width: 170 }} value={recruiterFilter}
              onChange={e => { setRecruiterFilter(e.target.value); resetPage(); }}>
              <option value="">All Recruiters</option>
              {recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}

          {/* Admin: filter by hiring manager / owner */}
          {user?.isAdmin && allUsers.length > 0 && (
            <select className="form-select" style={{ width: 170 }} value={ownerFilter}
              onChange={e => { setOwnerFilter(e.target.value); resetPage(); }}>
              <option value="">All Users</option>
              {allUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.displayName || u.username}{u.isAdmin ? ' (admin)' : ''}
                </option>
              ))}
            </select>
          )}

          {/* Page size */}
          <select className="form-select" style={{ width: 100 }} value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); resetPage(); }}>
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </div>

        {/* ── Pinned candidates — always shown at top ── */}
        {pinnedCandidates.length > 0 && (
          <div style={{ marginBottom: 16, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', marginBottom: 8 }}>★ Pinned ({pinnedCandidates.length})</div>
            <div className="table-wrap">
              <table className="data-table">
                <tbody>
                  {pinnedCandidates.map(c => {
                    const recruiter = getRecruiter(c.recruiterId);
                    return (
                      <tr key={c.id} onClick={() => navigate(`/candidates/${c.id}`)} style={{ cursor: 'pointer', background: 'rgba(245,158,11,0.04)' }}>
                        <td style={{ width: 32 }}><span style={{ color: '#f59e0b' }}>★</span></td>
                        <td style={{ width: 40 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-elevated)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                            {c.photoUrl ? <img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
                          </div>
                        </td>
                        <td><div style={{ fontWeight: 600 }}>{c.fullName || '—'}</div>{c.currentTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.currentTitle}</div>}</td>
                        <td style={{ fontSize: 12 }}>{getRoleLabel(c.role)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.location || '—'}</td>
                        <td style={{ fontSize: 12 }}>{recruiter?.name || c.recruiterName || '—'}</td>
                        <td><span className={`status-badge status-${c.status}`}>{c.status?.replace('_', ' ')}</span></td>
                        <td onClick={e => e.stopPropagation()}>
                          <button onClick={e => togglePin(e, c)} title="Unpin"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#f59e0b', padding: '0 4px' }}>★</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
          </div>
        ) : candidates.length === 0 && pinnedCandidates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">◈</div>
            <div className="empty-state-title">No candidates found</div>
            <div className="empty-state-desc">Try adjusting your filters or add a new candidate</div>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>Add Candidate</button>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 32, color: 'var(--text-muted)', fontSize: 11 }}>No</th>
                    <th style={{ width: 40 }}></th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Location</th>
                    <th>Recruiter</th>
                    <th>Added By</th>
                    <th>Status</th>
                    <th>Last Message</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map(c => {
                    const recruiter = getRecruiter(c.recruiterId);
                    return (
                      <tr key={c.id} onClick={() => navigate(`/candidates/${c.id}`)}>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{(page - 1) * 20 + candidates.indexOf(c) + 1}</td>
                        {/* Avatar */}
                        <td>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-elevated)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                            {c.photoUrl ? <img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
                          </div>
                        </td>
                        {/* Name + title */}
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            {pinnedIds.has(c.id) && <span style={{ color: '#f59e0b', fontSize: 13 }}>★</span>}
                            {c.fullName || '—'}
                          </div>
                          {c.currentTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.currentTitle}</div>}
                        </td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12 }}>{c.email || '—'}</td>
                        <td style={{ fontSize: 12 }}>{getRoleLabel(c.role)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.location || '—'}</td>
                        {/* Recruiter with photo */}
                        <td>
                          {recruiter ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: recruiter.photoUrl ? undefined : 'var(--accent-dim)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 10 }}>
                                {recruiter.photoUrl ? <img src={recruiter.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : recruiter.name.charAt(0).toUpperCase()}
                              </div>
                              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{recruiter.name}</span>
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        {/* User who added this candidate */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>
                              {(c.ownerName || '?').charAt(0).toUpperCase()}
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.ownerName || '—'}</span>
                          </div>
                        </td>
                        <td><span className={`status-badge status-${c.status}`}>{c.status?.replace('_', ' ')}</span></td>
                        <td style={{ fontSize: 11, color: c.lastMessageAt ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                          {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td>
                          <div className="flex gap-8" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={e => togglePin(e, c)}
                              title={pinnedIds.has(c.id) ? 'Unpin' : 'Pin'}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 4px', color: pinnedIds.has(c.id) ? '#f59e0b' : 'var(--text-muted)' }}>
                              {pinnedIds.has(c.id) ? '★' : '☆'}
                            </button>
                            <button className="btn btn-secondary btn-sm"
                              onClick={e => { e.stopPropagation(); setEditCandidate(c); }}>✎ Edit</button>
                            <button onClick={e => handleDelete(e, c.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', fontSize: 16, padding: '0 4px' }} title="Delete">✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {total > pageSize && (
              <div className="flex items-center justify-between mt-16" style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Page {page} of {Math.ceil(total / pageSize)}</span>
                <div className="flex gap-8">
                  <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                  <button className="btn btn-secondary btn-sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage(p => p + 1)}>Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showAdd && <CandidateModal onClose={() => setShowAdd(false)} onSaved={fetchCandidates} />}
      {editCandidate && <CandidateModal onClose={() => setEditCandidate(null)} onSaved={fetchCandidates} initial={editCandidate} />}
    </div>
  );
}
