import React, { useEffect, useState, useCallback, useContext, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { candidateApi, generateApi, authApi, settingsApi } from '../utils/api';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

// ── Date range picker ────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { label: '1W', days: 7 }, { label: '2W', days: 14 },
  { label: '1M', days: 30 }, { label: '3M', days: 90 },
  { label: 'All', days: null },
];
const isoToday = () => new Date().toISOString().split('T')[0];
const isoDaysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; };

function DateRangePicker({ fromDate, toDate, onChange }) {
  const today = isoToday();
  const active = DATE_PRESETS.find(p =>
    p.days === null ? (!fromDate && !toDate) : (fromDate === isoDaysAgo(p.days) && toDate === today)
  );
  const apply = (days) => {
    if (days === null) onChange('', '');
    else onChange(isoDaysAgo(days), today);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Period:</span>
      {DATE_PRESETS.map(p => (
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

const formatDate = (iso) => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const STATUS_LABELS = {
  pending: 'Pending', in_progress: 'In Progress', success: 'Success', failed: 'Failed',
  no_response: 'No Response', not_interested: 'Not Interested',
  other_job: 'Already Occupied', have_a_doubt: 'Have a Doubt', dangerous: 'Dangerous',
};

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
  const [linkedinProfile, setLinkedinProfile] = useState(initial?.linkedinProfile || null);
  const [dangerousWarning, setDangerousWarning]     = useState(null);
  const [confirmDangerous, setConfirmDangerous]     = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const checkDangerous = async (email, linkedinUrl) => {
    if (isEdit) return;
    if (!email && !linkedinUrl) return;
    try {
      const data = await candidateApi.checkDangerous({ email: email || undefined, linkedinUrl: linkedinUrl || undefined });
      setDangerousWarning(data.dangerous ? data.candidate : null);
      setConfirmDangerous(false);
    } catch {}
  };

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
      if (data.linkedinProfile) setLinkedinProfile(data.linkedinProfile);
      await checkDangerous(data.email || '', url);
      toast.success('LinkedIn profile extracted — fields auto-filled');
    } catch (e) { toast.error(e.message); }
    finally { setExtractingLi(false); }
  };

  const getRecruiterName = (id) => recruiters.find(r => r.id === id)?.name || '';
  const getCompanyName   = (id) => companies.find(c => c.id === id)?.name  || '';

  const handleSubmit = async () => {
    if (dangerousWarning && !confirmDangerous) {
      setConfirmDangerous(true);
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v || ''));
      fd.set('recruiterName', getRecruiterName(form.recruiterId));
      fd.set('companyName',   getCompanyName(form.companyId));
      if (photoData) fd.append('photoUrl', photoData);
      if (resumeFile) fd.append('resume', resumeFile);
      if (linkedinProfile) fd.append('linkedinProfile', JSON.stringify(linkedinProfile));
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
          <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} onBlur={e => checkDangerous(e.target.value, form.linkedinUrl)} placeholder="jane@example.com" /></div>
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

        {dangerousWarning && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', marginBottom: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 8 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#ef4444' }}>Dangerous Candidate</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                <strong>{dangerousWarning.fullName || 'This candidate'}</strong> is already registered and marked as <strong>Dangerous</strong>.
                {confirmDangerous && <span style={{ color: '#ef4444', fontWeight: 600 }}> Are you sure you want to add them anyway?</span>}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-8" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={confirmDangerous ? () => setConfirmDangerous(false) : onClose}>
            {confirmDangerous ? 'Go Back' : 'Cancel'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || extracting}
            style={confirmDangerous ? { background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 13 } : undefined}
            className={confirmDangerous ? undefined : 'btn btn-primary'}>
            {saving
              ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</>
              : confirmDangerous
                ? '⚠️ Add Anyway'
                : isEdit ? 'Save Changes' : 'Add Candidate'}
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
  const openTab = (path) => {
    const a = document.createElement('a');
    a.href = path; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };
  const navTo = (e, path) => {
    if (e.ctrlKey || e.metaKey || e.button === 1) { e.preventDefault(); openTab(path); }
    else navigate(path);
  };
  const { user } = useAuth();
  const { roles, recruiters } = useContext(AppContext);

  const saved = loadFilters();

  const [candidates,       setCandidates]       = useState([]);
  const [pinnedCandidates, setPinnedCandidates] = useState([]);
  const [total,            setTotal]            = useState(0);
  const [loading,          setLoading]          = useState(true);
  const [showAdd,          setShowAdd]          = useState(false);
  const [editCandidate,    setEditCandidate]    = useState(null);
  const [search,           setSearch]           = useState(saved.search          || '');
  const [statusFilter,      setStatusFilter]      = useState(saved.statusFilter     || '');
  const [engagementFilter,  setEngagementFilter]  = useState(saved.engagementFilter || '');
  const [recruiterFilter,   setRecruiterFilter]   = useState(saved.recruiterFilter  || '');
  const [ownerFilter,       setOwnerFilter]        = useState(saved.ownerFilter      || '');
  const [page,             setPage]             = useState(saved.page            || 1);
  const [pageSize,         setPageSize]         = useState(saved.pageSize        || 20);
  const [fromDate,         setFromDate]         = useState(saved.fromDate || '');
  const [toDate,           setToDate]           = useState(saved.toDate   || '');

  // ── Selection state ────────────────────────────────────────────────────────
  const [selectedIds,      setSelectedIds]      = useState(new Set());
  const [bulkMoveTo,       setBulkMoveTo]       = useState('');
  const [bulkSaving,       setBulkSaving]       = useState(false);
  const [bulkRecommending, setBulkRecommending] = useState(false);
  const [recommendedIds,   setRecommendedIds]   = useState(new Set());

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify({ search, statusFilter, engagementFilter, recruiterFilter, ownerFilter, page, pageSize, fromDate, toDate }));
    } catch {}
  }, [search, statusFilter, engagementFilter, recruiterFilter, ownerFilter, page, pageSize, fromDate, toDate]);

  // For admin: list of all users to filter/move by
  const [allUsers, setAllUsers] = useState([]);
  useEffect(() => {
    if (user?.isAdmin) authApi.listUsers().then(setAllUsers).catch(() => {});
  }, [user]);

  // For admin: map of userId → recruiter[] for relative filtering
  const [allUsersRecruiters, setAllUsersRecruiters] = useState({});
  useEffect(() => {
    if (!user?.isAdmin || !allUsers.length) return;
    Promise.all(
      allUsers.map(u =>
        settingsApi.getAll({ userId: u.id })
          .then(d => [u.id, Array.isArray(d.recruiters) ? d.recruiters : []])
          .catch(() => [u.id, []])
      )
    ).then(entries => setAllUsersRecruiters(Object.fromEntries(entries)));
  }, [user?.isAdmin, allUsers]); // eslint-disable-line

  // ── Pins ──────────────────────────────────────────────────────────────────
  const [pinnedIds, setPinnedIds] = useState(new Set());
  useEffect(() => {
    settingsApi.getPins().then(d => setPinnedIds(new Set(d.pins || []))).catch(() => {});
    settingsApi.getRecommended().then(d => setRecommendedIds(new Set(d.recommended || []))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!pinnedIds.size) { setPinnedCandidates([]); return; }
    candidateApi.getByIds([...pinnedIds]).then(d => setPinnedCandidates(d.candidates || [])).catch(() => {});
  }, [pinnedIds]);

  const filteredPinned = useMemo(() => {
    let list = pinnedCandidates;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        (c.fullName      || '').toLowerCase().includes(q) ||
        (c.email         || '').toLowerCase().includes(q) ||
        (c.currentTitle  || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter)    list = list.filter(c => c.status === statusFilter);
    if (recruiterFilter) list = list.filter(c => c.recruiterId === recruiterFilter);
    if (ownerFilter)     list = list.filter(c => c.ownerId === ownerFilter);
    if (fromDate)        list = list.filter(c => c.createdAt && c.createdAt >= fromDate);
    if (toDate)          list = list.filter(c => c.createdAt && c.createdAt <= toDate + 'T23:59:59');
    if (engagementFilter) {
      const labelSet = new Set(engagementFilter.split(',').map(l => l.trim()).filter(Boolean));
      list = list.filter(c => {
        const s   = c.combinedEngagementScore ?? ((c.engagementScore || 1) - 1) / 4 * 9 + 1;
        const lbl = s >= 8.5 ? 'Very Active' : s >= 6.5 ? 'Active' : s >= 4.5 ? 'Engaged' : s >= 2.5 ? 'Passive' : 'Unresponsive';
        return labelSet.has(lbl);
      });
    }

    return list;
  }, [pinnedCandidates, search, statusFilter, engagementFilter, recruiterFilter, ownerFilter, fromDate, toDate]);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const params = { search, status: statusFilter, page, limit: pageSize };
      if (engagementFilter) params.engagementLabel = engagementFilter;
      if (recruiterFilter)  params.recruiterId     = recruiterFilter;
      if (user?.isAdmin && ownerFilter) params.ownerId = ownerFilter;
      if (fromDate) params.fromDate = fromDate;
      if (toDate)   params.toDate   = toDate;
      const data = await candidateApi.getAll(params);
      setCandidates(data.candidates || []);
      setTotal(data.total || 0);
      setSelectedIds(new Set());
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, engagementFilter, recruiterFilter, ownerFilter, page, pageSize, user, fromDate, toDate]);

  useEffect(() => { fetchCandidates(); }, [fetchCandidates]);

  // ── Selection helpers ──────────────────────────────────────────────────────
  const allPageIds     = candidates.map(c => c.id);
  const allSelected    = allPageIds.length > 0 && allPageIds.every(id => selectedIds.has(id));
  const someSelected   = allPageIds.some(id => selectedIds.has(id));

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => { const next = new Set(prev); allPageIds.forEach(id => next.delete(id)); return next; });
    } else {
      setSelectedIds(prev => new Set([...prev, ...allPageIds]));
    }
  };

  // ── Bulk actions ───────────────────────────────────────────────────────────
  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} candidate${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBulkSaving(true);
    try {
      await Promise.all(ids.map(id => candidateApi.delete(id)));
      setPinnedIds(s => { const n = new Set(s); ids.forEach(id => n.delete(id)); return n; });
      toast.success(`${ids.length} candidate${ids.length !== 1 ? 's' : ''} deleted`);
      fetchCandidates();
    } catch (e) { toast.error(e.message); }
    finally { setBulkSaving(false); }
  };

  const handleBulkMove = async () => {
    const ids = [...selectedIds];
    if (!ids.length || !bulkMoveTo) return;
    const targetUser = allUsers.find(u => u.id === bulkMoveTo);
    if (!window.confirm(`Move ${ids.length} candidate${ids.length !== 1 ? 's' : ''} to ${targetUser?.displayName || targetUser?.username || bulkMoveTo}?`)) return;
    setBulkSaving(true);
    try {
      await candidateApi.bulkReassignOwner(ids, bulkMoveTo);
      toast.success(`${ids.length} candidate${ids.length !== 1 ? 's' : ''} moved to ${targetUser?.displayName || targetUser?.username}`);
      fetchCandidates();
    } catch (e) { toast.error(e.message); }
    finally { setBulkSaving(false); }
  };

  const handleBulkRecommend = async () => {
    const ids = [...selectedIds].filter(id => !recommendedIds.has(id));
    if (!ids.length) return;
    setBulkRecommending(true);
    try {
      await settingsApi.bulkSharePin(ids);
      setRecommendedIds(prev => new Set([...prev, ...ids]));
      toast.success(`${ids.length} candidate${ids.length > 1 ? 's' : ''} recommended`);
      setSelectedIds(new Set());
    } catch (e) { toast.error(e.message); }
    finally { setBulkRecommending(false); }
  };

  const handleBulkUnrecommend = async () => {
    const ids = [...selectedIds].filter(id => recommendedIds.has(id));
    if (!ids.length) return;
    setBulkRecommending(true);
    try {
      await settingsApi.bulkUnsharePin(ids);
      setRecommendedIds(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next; });
      toast.success(`${ids.length} recommendation${ids.length > 1 ? 's' : ''} removed`);
      setSelectedIds(new Set());
    } catch (e) { toast.error(e.message); }
    finally { setBulkRecommending(false); }
  };

  const handleToggleRecommend = async (e, candidateId) => {
    e.stopPropagation();
    const isRec = recommendedIds.has(candidateId);
    try {
      if (isRec) {
        await settingsApi.unsharePin(candidateId);
        setRecommendedIds(prev => { const next = new Set(prev); next.delete(candidateId); return next; });
        toast.success('Recommendation removed.');
      } else {
        await settingsApi.sharePin(candidateId);
        setRecommendedIds(prev => new Set([...prev, candidateId]));
        toast.success('Recommended!');
      }
    } catch (e) { toast.error(e.message); }
  };

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

  const getRoleLabel = (val) => roles.find(r => r.value === val)?.label || val || '—';
  const getRecruiter = (id)  => recruiters.find(r => r.id === id) || null;
  const resetPage    = ()    => setPage(1);

  // Relative filter helpers (admin only)
  const displayedRecruiters = user?.isAdmin
    ? ownerFilter
      ? (allUsersRecruiters[ownerFilter] || [])
      : Object.values(allUsersRecruiters).flat().filter((r, i, arr) => arr.findIndex(x => x.id === r.id) === i)
    : recruiters;

  const handleOwnerFilterChange = (uid) => {
    setOwnerFilter(uid);
    resetPage();
    if (uid && recruiterFilter) {
      const userRecs = allUsersRecruiters[uid] || [];
      if (!userRecs.some(r => r.id === recruiterFilter)) setRecruiterFilter('');
    }
  };

  const handleRecruiterFilterChange = (rid) => {
    setRecruiterFilter(rid);
    resetPage();
    if (user?.isAdmin && rid && !ownerFilter) {
      const ownerEntry = Object.entries(allUsersRecruiters).find(([, rs]) => rs.some(r => r.id === rid));
      if (ownerEntry) setOwnerFilter(ownerEntry[0]);
    }
  };

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
        {/* ── Date range filter ── */}
        <div style={{ marginBottom: 12 }}>
          <DateRangePicker
            fromDate={fromDate} toDate={toDate}
            onChange={(f, t) => { setFromDate(f); setToDate(t); setPage(1); }}
          />
        </div>
        {/* ── Filter bar ── */}
        <div className="flex gap-12 mb-16" style={{ flexWrap: 'wrap' }}>
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

          <select className="form-select" style={{ width: 160 }} value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); resetPage(); }}>
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="success">Success</option>
            <optgroup label="Failed" style={{ color: '#ef4444' }}>
              <option value="failed,no_response,not_interested,other_job,have_a_doubt,dangerous" style={{ color: '#ef4444', fontWeight: 600 }}>Failed (any)</option>
              <option value="no_response"     style={{ color: '#ef4444' }}>↳ No Response</option>
              <option value="not_interested"  style={{ color: '#ef4444' }}>↳ Not Interested</option>
              <option value="other_job"       style={{ color: '#ef4444' }}>↳ Already Occupied</option>
              <option value="have_a_doubt"    style={{ color: '#ef4444' }}>↳ Have a Doubt</option>
              <option value="dangerous"       style={{ color: '#ef4444' }}>↳ Dangerous</option>
            </optgroup>
          </select>

          <select className="form-select" style={{ width: 150 }} value={engagementFilter}
            onChange={e => { setEngagementFilter(e.target.value); resetPage(); }}>
            <option value="">All Scores</option>
            <option value="Active,Very Active" style={{ color: '#10b981', fontWeight: 600 }}>Active or above</option>
            <option value="Very Active"  style={{ color: '#6366f1' }}>↳ Very Active</option>
            <option value="Active"       style={{ color: '#10b981' }}>↳ Active</option>
            <option value="Engaged"      style={{ color: '#3b82f6' }}>Engaged</option>
            <option value="Passive"      style={{ color: '#f59e0b' }}>Passive</option>
            <option value="Unresponsive" style={{ color: '#9ca3af' }}>Unresponsive</option>
          </select>

          {displayedRecruiters.length > 0 && (
            <select className="form-select" style={{ width: 170 }} value={recruiterFilter}
              onChange={e => handleRecruiterFilterChange(e.target.value)}>
              <option value="">All Recruiters</option>
              {displayedRecruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}

          {user?.isAdmin && allUsers.length > 0 && (
            <select className="form-select" style={{ width: 170 }} value={ownerFilter}
              onChange={e => handleOwnerFilterChange(e.target.value)}>
              <option value="">All Users</option>
              {allUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.displayName || u.username}{u.isAdmin ? ' (admin)' : ''}
                </option>
              ))}
            </select>
          )}

          <select className="form-select" style={{ width: 100 }} value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); resetPage(); }}>
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </div>

        {/* ── Bulk action bar — shown when anything is selected ── */}
        {selectedIds.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginBottom: 12, background: 'var(--accent-dim)', borderRadius: 8, border: '1px solid var(--accent)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
              {selectedIds.size} selected
            </span>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelectedIds(new Set())}>
              Deselect all
            </button>
            {(() => {
              const ids           = [...selectedIds];
              const toRecommend   = ids.filter(id => !recommendedIds.has(id));
              const toUnrecommend = ids.filter(id =>  recommendedIds.has(id));
              return (
                <>
                  {toRecommend.length > 0 && (
                    <button className="btn btn-secondary btn-sm" disabled={bulkRecommending}
                      onClick={handleBulkRecommend}
                      title={user?.isAdmin ? 'Recommend to each candidate\'s owner' : 'Recommend to admin'}>
                      {bulkRecommending ? <span className="spinner" style={{ width: 12, height: 12 }} /> : `↗ Recommend (${toRecommend.length})`}
                    </button>
                  )}
                  {toUnrecommend.length > 0 && (
                    <button className="btn btn-secondary btn-sm" disabled={bulkRecommending}
                      onClick={handleBulkUnrecommend}
                      style={{ borderColor: '#10b981', color: '#10b981' }}
                      title="Remove recommendation">
                      {bulkRecommending ? <span className="spinner" style={{ width: 12, height: 12 }} /> : `↩ Unrecommend (${toUnrecommend.length})`}
                    </button>
                  )}
                </>
              );
            })()}
            <div style={{ flex: 1 }} />
            {/* Admin: move to user */}
            {user?.isAdmin && allUsers.length > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select className="form-select" style={{ width: 170, height: 32, fontSize: 12 }}
                  value={bulkMoveTo} onChange={e => setBulkMoveTo(e.target.value)}>
                  <option value="">Move to user…</option>
                  {allUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.displayName || u.username}{u.isAdmin ? ' (admin)' : ''}</option>
                  ))}
                </select>
                <button className="btn btn-primary btn-sm" disabled={!bulkMoveTo || bulkSaving} onClick={handleBulkMove}>
                  {bulkSaving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Move'}
                </button>
              </div>
            )}
            {/* Delete selected */}
            <button className="btn btn-sm" disabled={bulkSaving}
              style={{ background: 'var(--error)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
              onClick={handleBulkDelete}>
              {bulkSaving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : `Delete (${selectedIds.size})`}
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
          </div>
        ) : candidates.length === 0 && filteredPinned.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">◈</div>
            <div className="empty-state-title">No candidates found</div>
            <div className="empty-state-desc">Try adjusting your filters or add a new candidate</div>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>Add Candidate</button>
          </div>
        ) : (
          <>
            {/* ── Pinned candidates — separate section ── */}
            {filteredPinned.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '0 2px' }}>
                  <span style={{ fontSize: 14, color: '#f59e0b' }}>★</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>Pinned Candidates</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({filteredPinned.length})</span>
                </div>
                <div className="table-wrap" style={{ border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, overflow: 'hidden' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 32 }} onClick={e => e.stopPropagation()}></th>
                        <th style={{ width: 32, color: 'var(--text-muted)', fontSize: 11 }}>No</th>
                        <th style={{ width: 40 }}></th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Location</th>
                        <th>Recruiter</th>
                        <th>Added By</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'center' }}>Score</th>
                        <th>Last Message</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPinned.map((c, pidx) => {
                        const recruiter  = getRecruiter(c.recruiterId);
                        const isSelected = selectedIds.has(c.id);
                        return (
                          <tr key={`pin-${c.id}`} style={{ background: isSelected ? 'var(--accent-dim)' : 'rgba(245,158,11,0.04)', cursor: 'pointer' }} onClick={e => navTo(e, `/candidates/${c.id}`)} onMouseDown={e => { if (e.button === 1) { e.preventDefault(); openTab(`/candidates/${c.id}`); } }}>
                            <td onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(c.id)}
                                style={{ cursor: 'pointer', width: 15, height: 15 }} />
                            </td>
                            <td style={{ cursor: 'pointer' }}>
                              <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>{pidx + 1}</span>
                            </td>
                            <td style={{ cursor: 'pointer' }}>
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-elevated)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                                {c.photoUrl ? <img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
                              </div>
                            </td>
                            <td style={{ cursor: 'pointer' }}>
                              <div style={{ fontWeight: 600 }}>{c.fullName || '—'}</div>
                              {c.currentTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.currentTitle}</div>}
                            </td>
                            <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, cursor: 'pointer' }}>{c.email || '—'}</td>
                            <td style={{ fontSize: 12, cursor: 'pointer' }}>{getRoleLabel(c.role)}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>{c.location || '—'}</td>
                            <td style={{ cursor: 'pointer' }}>
                              {recruiter ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: recruiter.photoUrl ? undefined : 'var(--accent-dim)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 10 }}>
                                    {recruiter.photoUrl ? <img src={recruiter.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : recruiter.name.charAt(0).toUpperCase()}
                                  </div>
                                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{recruiter.name}</span>
                                </div>
                              ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
                            </td>
                            <td style={{ cursor: 'pointer' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>
                                  {(c.ownerName || '?').charAt(0).toUpperCase()}
                                </div>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.ownerName || '—'}</span>
                              </div>
                            </td>
                            <td style={{ cursor: 'pointer' }}>
                              <span className={`status-badge status-${c.status}`}>{STATUS_LABELS[c.status] || c.status?.replace(/_/g, ' ')}</span>
                            </td>
                            <td style={{ textAlign: 'center', cursor: 'pointer' }}>
                              {(() => {
                                const LABEL_COLORS = { 'Unresponsive': '#9ca3af', 'Passive': '#f59e0b', 'Engaged': '#3b82f6', 'Active': '#10b981', 'Very Active': '#6366f1' };
                                const s = c.combinedEngagementScore ?? ((c.engagementScore || 1) - 1) / 4 * 9 + 1;
                                const lbl = s >= 8.5 ? 'Very Active' : s >= 6.5 ? 'Active' : s >= 4.5 ? 'Engaged' : s >= 2.5 ? 'Passive' : 'Unresponsive';
                                const col = LABEL_COLORS[lbl];
                                return c.combinedEngagementScore != null || c.engagementScore != null ? (
                                  <div title={c.aiEngagementReasoning || lbl} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: col }}>{s.toFixed(2)}</span>
                                    <span style={{ fontSize: 9, color: col, fontWeight: 600 }}>{lbl}{c.aiEngagementScore != null ? ' ★' : ''}</span>
                                  </div>
                                ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
                              })()}
                            </td>
                            <td style={{ fontSize: 11, color: c.lastMessageAt ? 'var(--text-secondary)' : 'var(--text-muted)', cursor: 'pointer' }}>
                              {formatDate(c.lastMessageAt)}
                            </td>
                            <td>
                              <div className="flex gap-8" onClick={e => e.stopPropagation()}>
                                <button onClick={e => togglePin(e, c)} title="Unpin"
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#f59e0b', padding: '0 4px' }}>★</button>
                                <button onClick={e => handleToggleRecommend(e, c.id)}
                                  title={recommendedIds.has(c.id) ? 'Remove recommendation' : 'Recommend'}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '0 4px', color: recommendedIds.has(c.id) ? '#10b981' : 'var(--text-muted)' }}>
                                  {recommendedIds.has(c.id) ? '✓↗' : '↗'}
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
              </div>
            )}

            {/* ── General candidates section ── */}
            {candidates.length > 0 && (
              <>
                {filteredPinned.length > 0 && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, padding: '0 2px' }}>
                    All Candidates <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({total})</span>
                  </div>
                )}
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 32 }} onClick={e => e.stopPropagation()}>
                          <input type="checkbox"
                            checked={allSelected}
                            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                            onChange={toggleSelectAll}
                            style={{ cursor: 'pointer', width: 15, height: 15 }}
                            title={allSelected ? 'Deselect all on page' : 'Select all on page'} />
                        </th>
                        <th style={{ width: 32, color: 'var(--text-muted)', fontSize: 11 }}>No</th>
                        <th style={{ width: 40 }}></th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Location</th>
                        <th>Recruiter</th>
                        <th>Added By</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'center' }}>Score</th>
                        <th>Last Message</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c, idx) => {
                        const recruiter  = getRecruiter(c.recruiterId);
                        const isSelected = selectedIds.has(c.id);
                        return (
                          <tr key={c.id} style={{ background: isSelected ? 'var(--accent-dim)' : undefined, cursor: 'pointer' }} onClick={e => navTo(e, `/candidates/${c.id}`)} onMouseDown={e => { if (e.button === 1) { e.preventDefault(); openTab(`/candidates/${c.id}`); } }}>
                            <td onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(c.id)}
                                style={{ cursor: 'pointer', width: 15, height: 15 }} />
                            </td>
                            <td style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, cursor: 'pointer' }}>
                              {(page - 1) * pageSize + idx + 1}
                            </td>
                            <td style={{ cursor: 'pointer' }}>
                              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-elevated)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                                {c.photoUrl ? <img src={c.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
                              </div>
                        </td>
                        <td style={{ cursor: 'pointer' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.fullName || '—'}</div>
                          {c.currentTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.currentTitle}</div>}
                        </td>
                        <td style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, cursor: 'pointer' }}>{c.email || '—'}</td>
                        <td style={{ fontSize: 12, cursor: 'pointer' }}>{getRoleLabel(c.role)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>{c.location || '—'}</td>
                        <td style={{ cursor: 'pointer' }}>
                          {recruiter ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: recruiter.photoUrl ? undefined : 'var(--accent-dim)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 10 }}>
                                {recruiter.photoUrl ? <img src={recruiter.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : recruiter.name.charAt(0).toUpperCase()}
                              </div>
                              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{recruiter.name}</span>
                            </div>
                          ) : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>
                              {(c.ownerName || '?').charAt(0).toUpperCase()}
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.ownerName || '—'}</span>
                          </div>
                        </td>
                        <td style={{ cursor: 'pointer' }}>
                          <span className={`status-badge status-${c.status}`}>{STATUS_LABELS[c.status] || c.status?.replace(/_/g, ' ')}</span>
                        </td>
                        <td style={{ textAlign: 'center', cursor: 'pointer' }}>
                          {(() => {
                            const LABEL_COLORS = { 'Unresponsive': '#9ca3af', 'Passive': '#f59e0b', 'Engaged': '#3b82f6', 'Active': '#10b981', 'Very Active': '#6366f1' };
                            const s = c.combinedEngagementScore ?? ((c.engagementScore || 1) - 1) / 4 * 9 + 1;
                            const lbl = s >= 8.5 ? 'Very Active' : s >= 6.5 ? 'Active' : s >= 4.5 ? 'Engaged' : s >= 2.5 ? 'Passive' : 'Unresponsive';
                            const col = LABEL_COLORS[lbl];
                            return c.combinedEngagementScore != null || c.engagementScore != null ? (
                              <div title={c.aiEngagementReasoning || lbl} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.2 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: col }}>{s.toFixed(2)}</span>
                                <span style={{ fontSize: 9, color: col, fontWeight: 600 }}>{lbl}{c.aiEngagementScore != null ? ' ★' : ''}</span>
                              </div>
                            ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
                          })()}
                        </td>
                        <td style={{ fontSize: 11, color: c.lastMessageAt ? 'var(--text-secondary)' : 'var(--text-muted)', cursor: 'pointer' }}>
                          {formatDate(c.lastMessageAt)}
                        </td>
                        <td>
                          <div className="flex gap-8" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={e => togglePin(e, c)}
                              title={pinnedIds.has(c.id) ? 'Unpin' : 'Pin'}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '0 4px', color: pinnedIds.has(c.id) ? '#f59e0b' : 'var(--text-muted)' }}>
                              {pinnedIds.has(c.id) ? '★' : '☆'}
                            </button>
                            <button onClick={e => handleToggleRecommend(e, c.id)}
                              title={recommendedIds.has(c.id) ? 'Remove recommendation' : 'Recommend'}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '0 4px', color: recommendedIds.has(c.id) ? '#10b981' : 'var(--text-muted)' }}>
                              {recommendedIds.has(c.id) ? '✓↗' : '↗'}
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

                {total > pageSize && (() => {
                  const totalPages = Math.ceil(total / pageSize);
                  const delta = 2;
                  const pages = [];
                  for (let i = 1; i <= totalPages; i++) {
                    if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
                      pages.push(i);
                    } else if (pages[pages.length - 1] !== '...') {
                      pages.push('...');
                    }
                  }
                  return (
                    <div className="flex items-center gap-8 mt-16" style={{ paddingTop: 12, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                      <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>←</button>
                      {pages.map((p, i) =>
                        p === '...'
                          ? <span key={`ellipsis-${i}`} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 2px' }}>…</span>
                          : <button key={p} className="btn btn-sm" onClick={() => setPage(p)}
                              style={{ minWidth: 32, fontWeight: page === p ? 700 : 400, background: page === p ? 'var(--accent)' : 'var(--bg-elevated)', color: page === p ? '#fff' : 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>
                              {p}
                            </button>
                      )}
                      <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>→</button>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>{total} total</span>
                    </div>
                  );
                })()}
              </>
            )}
          </>
        )}
      </div>

      {showAdd && <CandidateModal onClose={() => setShowAdd(false)} onSaved={fetchCandidates} />}
      {editCandidate && <CandidateModal onClose={() => setEditCandidate(null)} onSaved={fetchCandidates} initial={editCandidate} />}
    </div>
  );
}
