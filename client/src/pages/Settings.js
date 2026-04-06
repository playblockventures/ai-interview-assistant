import React, { useEffect, useState, useCallback, useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { settingsApi, candidateApi, authApi } from '../utils/api';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import UserManagement from './UserManagement';

const CATEGORY_LABELS = {
  company_docs:      'Company Docs',
  recruiter_profile: 'Recruiter Profile',
  instructions:      'Instructions',
};

// ── DB Banner ─────────────────────────────────────────────────────────────────
function DBBanner({ dbConnected, hasFirebase }) {
  if (dbConnected) return null;
  return (
    <div style={{ background: 'rgba(255,214,102,0.08)', border: '1px solid rgba(255,214,102,0.3)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--warning)' }}>
      <span style={{ fontSize: 16 }}>⚠</span>
      <span>{hasFirebase ? 'Database is connecting… some features may be limited.' : 'No database connected. Enter your Firebase Service Account credentials below.'}</span>
    </div>
  );
}

// ── Editable Roles ────────────────────────────────────────────────────────────
function RolesSection({ dbConnected }) {
  const { roles, DEFAULT_ROLES, refreshSettings } = useContext(AppContext);
  const [localRoles, setLocalRoles] = useState(roles);
  const [newLabel, setNewLabel]     = useState('');
  const [saving, setSaving]         = useState(false);

  useEffect(() => { setLocalRoles(roles); }, [roles]);

  const addRole = () => {
    const label = newLabel.trim();
    if (!label) return;
    const value = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (localRoles.find(r => r.value === value)) return;
    setLocalRoles(r => [...r, { value, label }]);
    setNewLabel('');
  };

  const removeRole = (value) => setLocalRoles(r => r.filter(x => x.value !== value));

  const moveUp = (i) => {
    if (i === 0) return;
    const arr = [...localRoles];
    [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    setLocalRoles(arr);
  };

  const saveRoles = async () => {
    if (!dbConnected) return toast.error('Connect Firebase first');
    setSaving(true);
    try {
      await settingsApi.save('custom_roles', localRoles);
      await refreshSettings();
      toast.success('Roles saved');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="card mt-16">
      <div className="card-title">Interview Roles</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Customise the role options shown throughout the app.</p>
      <div style={{ marginBottom: 14 }}>
        {localRoles.map((role, i) => (
          <div key={role.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', marginBottom: 5, border: '1px solid var(--border)' }}>
            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{role.label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{role.value}</span>
            <button onClick={() => moveUp(i)} style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? 'var(--border)' : 'var(--text-muted)', fontSize: 14 }}>↑</button>
            <button onClick={() => removeRole(role.value)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', fontSize: 14 }}>✕</button>
          </div>
        ))}
      </div>
      <div className="flex gap-8 mb-12">
        <input className="form-input" style={{ flex: 1 }} placeholder="Add new role (e.g. DevOps Engineer)"
          value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRole()} />
        <button className="btn btn-secondary" onClick={addRole} disabled={!newLabel.trim()}>+ Add</button>
      </div>
      <div className="flex gap-8">
        <button className="btn btn-primary" onClick={saveRoles} disabled={saving || !dbConnected}>
          {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : 'Save Roles'}
        </button>
        <button className="btn btn-secondary" onClick={() => setLocalRoles(DEFAULT_ROLES)}>Reset to Default</button>
      </div>
    </div>
  );
}

// ── Company Interview Scenario ────────────────────────────────────────────────
function CompanyScenarioSection({ dbConnected }) {
  const { companyScenario, refreshSettings } = useContext(AppContext);
  const [scenario, setScenario] = useState(companyScenario || '');
  const [saving, setSaving]     = useState(false);

  useEffect(() => { setScenario(companyScenario || ''); }, [companyScenario]);

  const save = async () => {
    if (!dbConnected) return toast.error('Connect Firebase first');
    setSaving(true);
    try {
      await settingsApi.saveCompanyScenario(scenario);
      await refreshSettings();
      toast.success('Company scenario saved — it will be applied to all conversations');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const clear = async () => {
    if (!window.confirm('Clear the company scenario?')) return;
    setSaving(true);
    try {
      await settingsApi.saveCompanyScenario('');
      setScenario('');
      await refreshSettings();
      toast.success('Company scenario cleared');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="card mt-16">
      <div className="card-title">Company Interview Scenario</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Define a global interview scenario or framework that will be automatically applied to all conversations.
        When set, the AI will follow this structure across all candidate conversations.
      </p>
      {companyScenario && (
        <div style={{ background: 'rgba(0,212,170,0.06)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: 'var(--radius-sm)', padding: '8px 14px', marginBottom: 14, fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>✓</span><span>A company scenario is active — all conversations will follow this structure.</span>
        </div>
      )}
      <div className="form-group">
        <label className="form-label">Scenario / Interview Framework</label>
        <textarea
          className="form-textarea" style={{ minHeight: 180 }}
          placeholder={`Define your company's standard interview structure. For example:\n\n1. Introduction (5 min) — Ask about the candidate's background and current role\n2. Technical Assessment (20 min) — Ask 3-4 role-specific technical questions\n3. Cultural Fit (10 min) — Ask about teamwork, values, remote work experience\n4. Candidate Questions (5 min) — Invite questions about the role and company\n5. Closing — Explain next steps and timeline\n\nKey things to assess: passion for Web3, problem-solving approach, communication clarity`}
          value={scenario}
          onChange={e => setScenario(e.target.value)}
          disabled={!dbConnected}
        />
      </div>
      <div className="flex gap-8">
        <button className="btn btn-primary" onClick={save} disabled={saving || !dbConnected}>
          {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : '▶ Save & Apply to All Conversations'}
        </button>
        {companyScenario && (
          <button className="btn btn-danger" onClick={clear} disabled={saving}>Clear Scenario</button>
        )}
      </div>
      {!dbConnected && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--warning)' }}>⚠ Requires database connection.</div>}
    </div>
  );
}

// ── Recruiter Profiles ────────────────────────────────────────────────────────
function RecruitersSection({ dbConnected }) {
  const { recruiters, refreshSettings } = useContext(AppContext);
  const [localRecruiters, setLocalRecruiters] = useState(recruiters);
  const blankForm = { name: '', email: '', phone: '', linkedinUrl: '', location: '', currentTitle: '', profile: '', photoUrl: '' };
  const [form, setForm]     = useState(blankForm);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [expanded, setExpanded]     = useState(null);

  useEffect(() => { setLocalRecruiters(recruiters); }, [recruiters]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'], 'application/msword': ['.doc'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'text/plain': ['.txt'] },
    maxFiles: 1,
    onDrop: async (files) => {
      const file = files[0];
      if (!file) return;
      setExtracting(true);
      try {
        const fd = new FormData();
        fd.append('resume', file);
        const data = await candidateApi.extract(fd);
        setForm(p => ({
          ...p,
          name:         p.name         || data.fullName    || '',
          email:        p.email        || data.email        || '',
          phone:        p.phone        || data.phone        || '',
          linkedinUrl:  p.linkedinUrl  || data.linkedinUrl  || '',
          location:     p.location     || data.location     || '',
          currentTitle: p.currentTitle || data.currentTitle || '',
          photoUrl:     p.photoUrl     || data.photoUrl     || '',
        }));
        toast.success('Recruiter info extracted');
      } catch (e) { toast.error('Could not extract: ' + e.message); }
      finally { setExtracting(false); }
    },
  });

  const save = async () => {
    if (!dbConnected) return toast.error('Connect Firebase first');
    setSaving(true);
    try {
      const updated = editId
        ? localRecruiters.map(r => r.id === editId ? { ...r, ...form } : r)
        : [...localRecruiters, { id: 'r_' + Date.now(), ...form }];
      await settingsApi.saveRecruiters(updated);
      await refreshSettings();
      setForm(blankForm);
      setEditId(null);
      toast.success(editId ? 'Recruiter updated' : 'Recruiter added');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Remove this recruiter?')) return;
    if (!dbConnected) return toast.error('Connect Firebase first');
    try {
      const updated = localRecruiters.filter(r => r.id !== id);
      await settingsApi.saveRecruiters(updated);
      await refreshSettings();
      toast.success('Recruiter removed');
    } catch (e) { toast.error(e.message); }
  };

  const startEdit = (r) => { setEditId(r.id); setForm({ name: r.name||'', email: r.email||'', phone: r.phone||'', linkedinUrl: r.linkedinUrl||'', location: r.location||'', currentTitle: r.currentTitle||'', profile: r.profile||'', photoUrl: r.photoUrl||'' }); };
  const cancelEdit = () => { setEditId(null); setForm(blankForm); };
  const sf = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="card mt-16">
      <div className="card-title">Recruiter Profiles</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Add recruiters with bios and photos. The AI personalises generated content using their profile.
        Upload a LinkedIn PDF or resume to auto-extract details.
      </p>

      {localRecruiters.map(r => (
        <div key={r.id} style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: r.photoUrl ? undefined : 'var(--accent-dim)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 14, border: '1.5px solid var(--border)' }}>
              {r.photoUrl ? <img src={r.photoUrl} alt={r.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (r.name||'?').charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{r.name}</div>
              {(r.currentTitle || r.email) && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{[r.currentTitle, r.email].filter(Boolean).join(' · ')}</div>}
            </div>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>{expanded === r.id ? '▲' : '▼'}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => startEdit(r)}>Edit</button>
            <button className="btn btn-danger btn-sm" onClick={() => remove(r.id)}>Remove</button>
          </div>
          {expanded === r.id && r.profile && (
            <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <pre style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{r.profile}</pre>
            </div>
          )}
        </div>
      ))}

      {/* Add / Edit form */}
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: 14, marginTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 12 }}>{editId ? '✎ Edit Recruiter' : '+ Add Recruiter'}</div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0, background: 'var(--bg-card)', border: '2px solid var(--border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
            {form.photoUrl ? <img src={form.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
              Upload Profile / Resume {extracting && <span style={{ color: 'var(--accent)', fontWeight: 400 }}>⟳ Extracting...</span>}
            </div>
            <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`} style={{ padding: '12px 14px', margin: 0 }}>
              <input {...getInputProps()} />
              <div className="dropzone-icon" style={{ fontSize: 16, marginBottom: 2 }}>📄</div>
              <div className="dropzone-text" style={{ fontSize: 11 }}>{extracting ? 'Extracting...' : isDragActive ? 'Drop here' : 'Drop LinkedIn PDF or resume to auto-fill'}</div>
            </div>
          </div>
        </div>

        <div className="grid-2" style={{ gap: '0 16px' }}>
          <div className="form-group"><label className="form-label">Name</label><input className="form-input" placeholder="e.g. Sarah Chen" value={form.name} onChange={e => sf('name', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" placeholder="sarah@company.com" value={form.email} onChange={e => sf('email', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Phone</label><input className="form-input" placeholder="+1 555 000 0000" value={form.phone} onChange={e => sf('phone', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Location</label><input className="form-input" placeholder="New York, USA" value={form.location} onChange={e => sf('location', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Title / Role</label><input className="form-input" placeholder="Senior Technical Recruiter" value={form.currentTitle} onChange={e => sf('currentTitle', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">LinkedIn URL</label><input className="form-input" placeholder="https://linkedin.com/in/..." value={form.linkedinUrl} onChange={e => sf('linkedinUrl', e.target.value)} /></div>
        </div>
        <div className="form-group"><label className="form-label">Profile / Bio</label><textarea className="form-textarea" style={{ minHeight: 90 }} placeholder="LinkedIn bio, resume summary, or interview style description..." value={form.profile} onChange={e => sf('profile', e.target.value)} /></div>

        <div className="flex gap-8">
          <button className="btn btn-primary" onClick={save} disabled={saving || !dbConnected}>
            {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : editId ? 'Update' : 'Add Recruiter'}
          </button>
          {editId && <button className="btn btn-secondary" onClick={cancelEdit}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}

// ── Knowledge Base ────────────────────────────────────────────────────────────
function KnowledgeSection({ dbConnected, targetUserId = null }) {
  const [items, setItems]               = useState([]);
  const [loading, setLoading]           = useState(false);
  const [urlInput, setUrlInput]         = useState('');
  const [instructions, setInstructions] = useState('');
  const [testPrompt, setTestPrompt]     = useState('');
  const [aiReply, setAiReply]           = useState('');
  const [category, setCategory]         = useState('company_docs');
  const [uploading, setUploading]       = useState(false);
  const [addingUrl, setAddingUrl]       = useState(false);
  const [savingInstr, setSavingInstr]   = useState(false);
  const [testingInstr, setTestingInstr] = useState(false);
  const [kbTab, setKbTab]               = useState(0);

  const fetchItems = useCallback(async () => {
    if (!dbConnected) { setItems([]); return; }
    setLoading(true);
    try { setItems(await settingsApi.getKnowledge()); }
    catch (e) { console.error(e.message); }
    finally { setLoading(false); }
  }, [dbConnected, targetUserId]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const onDrop = useCallback(async (files) => {
    if (!dbConnected) { toast.error('Connect Firebase first'); return; }
    setUploading(true);
    try {
      for (const f of files) { const fd = new FormData(); fd.append('file', f); fd.append('category', category); await settingsApi.uploadFile(fd); }
      toast.success(`${files.length} file(s) uploaded`);
      fetchItems();
    } catch (e) { toast.error(e.message); }
    finally { setUploading(false); }
  }, [category, dbConnected, fetchItems]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'], 'application/msword': ['.doc'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'text/plain': ['.txt'] } });

  const addUrl = async () => {
    if (!dbConnected) { toast.error('Connect Firebase first'); return; }
    setAddingUrl(true);
    try { const r = await settingsApi.addUrl(urlInput.trim(), category); toast.success(`URL added — ${r.charCount || 0} chars learned`); setUrlInput(''); fetchItems(); }
    catch (e) { toast.error(e.message); }
    finally { setAddingUrl(false); }
  };

  const saveInstructions = async () => {
    if (!dbConnected) { toast.error('Connect Firebase first'); return; }
    setSavingInstr(true);
    try { await settingsApi.addInstructions(instructions); toast.success('Instructions saved'); fetchItems(); }
    catch (e) { toast.error(e.message); }
    finally { setSavingInstr(false); }
  };

  const testInstructions = async () => {
    setTestingInstr(true); setAiReply('');
    try { const r = await settingsApi.testInstructions(instructions, testPrompt || undefined); setAiReply(r.reply); }
    catch (e) { toast.error(e.message); }
    finally { setTestingInstr(false); }
  };

  const deleteItem = async (id) => {
    if (!window.confirm('Remove this item?')) return;
    try { await settingsApi.deleteKnowledge(id); toast.success('Removed'); fetchItems(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="card mt-16">
      <div className="card-title">Knowledge Base</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
        Upload docs, add URLs, or write custom instructions. The AI uses this to personalise all generated content.
        {!dbConnected && <span style={{ color: 'var(--warning)', marginLeft: 6 }}>⚠ Requires database connection.</span>}
      </p>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {['Upload File', 'Add URL', 'Custom Instructions'].map((t, i) => (
          <button key={t} className={`tab ${kbTab === i ? 'active' : ''}`} onClick={() => setKbTab(i)}>{t}</button>
        ))}
      </div>

      {kbTab === 0 && (
        <>
          <div className="form-group"><label className="form-label">Category</label><select className="form-select" value={category} onChange={e => setCategory(e.target.value)}><option value="company_docs">Company Documentation</option><option value="recruiter_profile">Recruiter Profile</option></select></div>
          <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`} style={{ opacity: dbConnected ? 1 : 0.5 }}>
            <input {...getInputProps()} />
            <div className="dropzone-icon">📁</div>
            <div className="dropzone-text">{uploading ? 'Uploading...' : !dbConnected ? 'Connect Firebase first' : isDragActive ? 'Drop files here' : 'Drag & drop PDF, DOC, TXT files'}</div>
          </div>
        </>
      )}
      {kbTab === 1 && (
        <>
          <div className="form-group"><label className="form-label">Category</label><select className="form-select" value={category} onChange={e => setCategory(e.target.value)}><option value="company_docs">Company Documentation</option><option value="recruiter_profile">Recruiter Profile</option></select></div>
          <div className="flex gap-8">
            <input className="form-input" placeholder="https://yourcompany.com/about" value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addUrl()} style={{ flex: 1 }} disabled={!dbConnected} />
            <button className="btn btn-primary" onClick={addUrl} disabled={addingUrl || !dbConnected}>{addingUrl ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '+ Learn URL'}</button>
          </div>
          {addingUrl && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>⟳ Fetching and parsing URL content…</div>}
        </>
      )}
      {kbTab === 2 && (
        <>
          <div className="form-group"><label className="form-label">Custom AI Instructions</label><textarea className="form-textarea" style={{ minHeight: 140 }} placeholder="Describe your company, tone preferences, interview strategies..." value={instructions} onChange={e => { setInstructions(e.target.value); setAiReply(''); }} disabled={!dbConnected} /></div>
          <div className="form-group"><label className="form-label">Test Prompt <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label><input className="form-input" placeholder="e.g. What do you know about this company? or: Write an outreach for a Solidity developer" value={testPrompt} onChange={e => setTestPrompt(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>The test automatically includes your uploaded knowledge base — ask about the company to verify it was loaded correctly.</div>
          </div>
          <div className="flex gap-8 mb-16">
            <button className="btn btn-primary" onClick={saveInstructions} disabled={savingInstr || !dbConnected}>{savingInstr ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : 'Save Instructions'}</button>
            <button className="btn btn-secondary" onClick={testInstructions} disabled={testingInstr}>{testingInstr ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Testing...</> : '▶ Test Instructions'}</button>
          </div>
          {(testingInstr || aiReply) && (
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>AI Response Preview</div>
              {testingInstr ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <pre style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.7, fontFamily: 'DM Sans, sans-serif' }}>{aiReply}</pre>}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>ℹ This preview is not stored in the database.</div>
            </div>
          )}
        </>
      )}

      {dbConnected && items.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Stored Items ({items.length})</div>
          {loading ? <span className="spinner" /> : items.map(item => (
            <div key={item.id} className="flex items-center justify-between" style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', marginBottom: 6, gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.type === 'url' ? '🔗 ' : item.type === 'file' ? '📄 ' : '📝 '}{item.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {CATEGORY_LABELS[item.category]} · {item.type}
                  {item.url && <> · <a href={item.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>view ↗</a></>}
                  {' · '}{new Date(item.createdAt).toLocaleDateString()}
                  {item.content && <> · {Math.ceil(item.content.length / 4)} tokens</>}
                </div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => deleteItem(item.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Change Password (for self) ────────────────────────────────────────────────
function AccountSection() {
  const { user } = useAuth();
  const [form, setForm]         = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [saving, setSaving]     = useState(false);
  const [apiKey, setApiKey]     = useState('');
  const [hasKey, setHasKey]     = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => {
    settingsApi.getAll().then(d => setHasKey(!!d.userOpenAIKey)).catch(() => {});
  }, []);

  const submitPassword = async () => {
    if (form.newPassword !== form.confirm) return toast.error('Passwords do not match');
    setSaving(true);
    try {
      const { authApi } = await import('../utils/api');
      await authApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed successfully');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const saveApiKey = async () => {
    if (!apiKey.trim()) return;
    setSavingKey(true);
    try {
      await settingsApi.saveOpenAIKey(apiKey.trim());
      setHasKey(true);
      setApiKey('');
      toast.success('Your OpenAI API key saved');
    } catch (e) { toast.error(e.message); }
    finally { setSavingKey(false); }
  };

  const removeApiKey = async () => {
    if (!window.confirm('Remove your OpenAI API key?')) return;
    try {
      await settingsApi.deleteOpenAIKey();
      setHasKey(false);
      toast.success('API key removed');
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <div className="card mt-16">
        <div className="card-title">Account</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, padding: '12px 14px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: user?.isAdmin ? 'rgba(108,99,255,0.15)' : 'var(--bg-card)', border: `2px solid ${user?.isAdmin ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, color: user?.isAdmin ? 'var(--accent)' : 'var(--text-muted)' }}>
            {(user?.displayName || user?.username || '?').charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{user?.displayName || user?.username}</div>
            <div style={{ fontSize: 11, color: user?.isAdmin ? 'var(--accent)' : 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>@{user?.username} · {user?.isAdmin ? 'Administrator' : 'Hiring Manager'}</div>
          </div>
        </div>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 14 }}>Change Password</div>
        <div className="form-group"><label className="form-label">Current Password</label><input className="form-input" type="password" placeholder="Current password" value={form.currentPassword} onChange={e => setForm(p => ({ ...p, currentPassword: e.target.value }))} /></div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label">New Password</label><input className="form-input" type="password" placeholder="New password" value={form.newPassword} onChange={e => setForm(p => ({ ...p, newPassword: e.target.value }))} /></div>
          <div className="form-group"><label className="form-label">Confirm Password</label><input className="form-input" type="password" placeholder="Repeat new password" value={form.confirm} onChange={e => setForm(p => ({ ...p, confirm: e.target.value }))} /></div>
        </div>
        <button className="btn btn-primary" onClick={submitPassword} disabled={saving}>
          {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : '🔑 Change Password'}
        </button>
      </div>

      {/* OpenAI API Key — per user */}
      <div className="card mt-16">
        <div className="card-title">OpenAI API Key</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Add your own OpenAI API key. All AI features (scenario generation, conversations, outreach) will use your key.
          Each user has their own key — it is stored securely and never shared.
        </p>
        {hasKey && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(0,212,170,0.06)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: 'var(--radius-sm)', marginBottom: 14 }}>
            <span style={{ color: 'var(--success)', fontSize: 16 }}>✓</span>
            <span style={{ fontSize: 13, color: 'var(--success)', flex: 1 }}>Your OpenAI API key is configured</span>
            <button className="btn btn-danger btn-sm" onClick={removeApiKey}>Remove</button>
          </div>
        )}
        <div className="flex gap-8">
          <input
            className="form-input"
            type="password"
            placeholder={hasKey ? 'Enter new key to replace current one' : 'sk-proj-...'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveApiKey()}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={saveApiKey} disabled={savingKey || !apiKey.trim()}>
            {savingKey ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save Key'}
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>platform.openai.com/api-keys</a>
        </div>
      </div>
    </>
  );
}

// ── Admin: Browse any user's resources ───────────────────────────────────────
function AdminUserResources({ dbConnected }) {
  const [users,        setUsers]        = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [tab,          setTab]          = useState('kb'); // 'kb' | 'settings'
  const [userSettings, setUserSettings] = useState(null);
  const [loadingSettings, setLoadingSettings] = useState(false);

  useEffect(() => {
    authApi.listUsers().then(setUsers).catch(() => {});
  }, []);

  const loadUserSettings = async (userId) => {
    setLoadingSettings(true);
    try {
      const data = await settingsApi.getAll({ userId });
      setUserSettings(data);
    } catch (_) {}
    finally { setLoadingSettings(false); }
  };

  const selectUser = (u) => {
    setSelectedUser(u);
    setUserSettings(null);
    if (tab === 'settings') loadUserSettings(u.id);
  };

  const handleTabChange = (t) => {
    setTab(t);
    if (t === 'settings' && selectedUser) loadUserSettings(selectedUser.id);
  };

  return (
    <div className="card mt-16">
      <div className="card-title">Browse User Resources</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        View and manage knowledge bases and settings for any user.
      </p>

      {/* User selector */}
      <div className="form-group">
        <label className="form-label">Select User</label>
        <select className="form-select" value={selectedUser?.id || ''}
          onChange={e => {
            const u = users.find(u => u.id === e.target.value);
            if (u) selectUser(u); else setSelectedUser(null);
          }}>
          <option value="">— Select a user —</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>
              {u.displayName || u.username} {u.isAdmin ? '(Admin)' : ''}
            </option>
          ))}
        </select>
      </div>

      {selectedUser && (
        <>
          {/* Tab switcher */}
          <div className="tabs" style={{ marginBottom: 16 }}>
            {[['kb', '📁 Knowledge Base'], ['settings', '⚙ Settings']].map(([key, label]) => (
              <button key={key} className={`tab ${tab === key ? 'active' : ''}`}
                onClick={() => handleTabChange(key)}>{label}</button>
            ))}
          </div>

          {/* Knowledge base tab */}
          {tab === 'kb' && (
            <KnowledgeSection dbConnected={dbConnected} targetUserId={selectedUser.id} />
          )}

          {/* Settings tab */}
          {tab === 'settings' && (
            <div>
              {loadingSettings ? (
                <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner" /></div>
              ) : userSettings ? (
                <div>
                  {/* OpenAI key status */}
                  <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>OpenAI API Key</div>
                    <div style={{ fontSize: 13, color: userSettings.userOpenAIKey ? 'var(--success)' : 'var(--text-muted)' }}>
                      {userSettings.userOpenAIKey ? '✓ Configured (key hidden)' : '✗ Not set — using system key'}
                    </div>
                  </div>
                  {/* Company scenario */}
                  <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Company Scenario</div>
                    {userSettings.companyScenario
                      ? <pre style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 200, overflow: 'auto' }}>{userSettings.companyScenario}</pre>
                      : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>None set</div>}
                  </div>
                  {/* Recruiters */}
                  <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Recruiters</div>
                    {userSettings.recruiters?.length
                      ? userSettings.recruiters.map(r => (
                          <div key={r.id} style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                            {r.name} {r.email ? `— ${r.email}` : ''}
                          </div>
                        ))
                      : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No recruiters</div>}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Select a user to view their settings.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────
const TABS = [
  { key: 'general',  label: '⚙ General' },
  { key: 'account',  label: '👤 Account' },
  { key: 'users',    label: '👥 Users', adminOnly: true },
];

export default function Settings() {
  const { refreshSettings } = useContext(AppContext);
  const { user } = useAuth();
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const initTab = urlParams.get('tab') || 'general';

  const [activeTab, setActiveTab]           = useState(initTab);
  const [openaiKey, setOpenaiKey]           = useState('');
  const [firebaseCreds, setFirebaseCreds]   = useState('');
  const [hasOpenAI, setHasOpenAI]           = useState(false);
  const [hasFirebase, setHasFirebase]       = useState(false);
  const [dbConnected, setDbConnected]       = useState(false);
  const [savingKey, setSavingKey]           = useState(false);
  const [savingFirebase, setSavingFirebase] = useState(false);
  const [loading, setLoading]               = useState(true);

  useEffect(() => { setActiveTab(initTab); }, [initTab]);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await settingsApi.getAll();
      setHasOpenAI(data.hasOpenAI);
      setHasFirebase(data.hasFirebase);
      setDbConnected(data.dbConnected);
    } catch (e) { console.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const saveOpenAI = async () => {
    setSavingKey(true);
    try { await settingsApi.save('openai_api_key', openaiKey.trim()); setHasOpenAI(true); setOpenaiKey(''); toast.success('OpenAI API key saved'); }
    catch (e) { toast.error(e.message); }
    finally { setSavingKey(false); }
  };

  const saveFirebase = async () => {
    setSavingFirebase(true);
    try {
      JSON.parse(firebaseCreds.trim());
      const data = await settingsApi.save('firebase_service_account', firebaseCreds.trim());
      setHasFirebase(true); setDbConnected(data.dbConnected || false); setFirebaseCreds('');
      if (data.dbConnected) { toast.success('Firebase connected!'); await refreshSettings(); }
      else toast.error('Credentials saved but connection failed.');
    } catch (e) {
      if (e instanceof SyntaxError) toast.error('Invalid JSON — paste full service account key.');
      else toast.error(e.message);
    } finally { setSavingFirebase(false); }
  };

  const visibleTabs = TABS.filter(t => !t.adminOnly || user?.isAdmin);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Configure API keys, roles, recruiters, and AI context</div>
        </div>
        <span style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, background: dbConnected ? 'rgba(0,212,170,0.1)' : 'rgba(255,214,102,0.1)', color: dbConnected ? 'var(--success)' : 'var(--warning)', border: `1px solid ${dbConnected ? 'rgba(0,212,170,0.3)' : 'rgba(255,214,102,0.3)'}`, fontWeight: 600 }}>
          {loading ? '...' : dbConnected ? '● DB Connected' : '○ DB Disconnected'}
        </span>
      </div>

      {/* Tab navigation */}
      <div className="tabs" style={{ marginBottom: 24 }}>
        {visibleTabs.map(t => (
          <button key={t.key} className={`tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {/* ── Account tab ── */}
      {activeTab === 'account' && (
        <>
          <AccountSection />
          <KnowledgeSection dbConnected={dbConnected} />
        </>
      )}

      {/* ── Users tab (admin only) ── */}
      {activeTab === 'users' && user?.isAdmin && (
        <>
          <div className="card"><UserManagement /></div>
          <AdminUserResources dbConnected={dbConnected} />
        </>
      )}

      {/* ── General tab ── */}
      {activeTab === 'general' && (
        <>
          <DBBanner dbConnected={dbConnected} hasFirebase={hasFirebase} />

          {/* API Configuration — admin only */}
          {user?.isAdmin && <div className="card">
            <div className="card-title">API Configuration</div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>API keys are stored in memory immediately and persisted to the database once connected.</p>
            <div className="form-group">
              <label className="form-label">OpenAI API Key {hasOpenAI && <span style={{ color: 'var(--success)', marginLeft: 8 }}>✓ Configured</span>}</label>
              <div className="flex gap-8">
                <input className="form-input" type="password" placeholder={hasOpenAI ? '••••••••••••• (saved)' : 'sk-...'} value={openaiKey} onChange={e => setOpenaiKey(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveOpenAI()} style={{ flex: 1 }} />
                <button className="btn btn-primary" onClick={saveOpenAI} disabled={savingKey}>{savingKey ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save'}</button>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>platform.openai.com/api-keys</a></div>
            </div>
            <div className="form-group">
              <label className="form-label">Firebase Service Account {dbConnected ? <span style={{ color: 'var(--success)', marginLeft: 8 }}>✓ Connected</span> : hasFirebase ? <span style={{ color: 'var(--warning)', marginLeft: 8 }}>⚠ Not connected</span> : null}</label>
              <textarea className="form-input" rows={5} placeholder={hasFirebase ? '•••••••••••••••• (saved)' : 'Paste your Firebase service account JSON here\n{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}'} value={firebaseCreds} onChange={e => setFirebaseCreds(e.target.value)} style={{ width: '100%', fontFamily: 'DM Mono, monospace', fontSize: 12, resize: 'vertical' }} />
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-primary" onClick={saveFirebase} disabled={savingFirebase}>{savingFirebase ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Connecting...</> : 'Save & Connect'}</button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Download from <a href="https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Firebase Console → Service Accounts</a></span>
              </div>
            </div>
          </div>}

          <RolesSection dbConnected={dbConnected} />
          <CompanyScenarioSection dbConnected={dbConnected} />
          <RecruitersSection dbConnected={dbConnected} />

          {/* Deployment — admin only */}
          {user?.isAdmin && <div className="card mt-16">
            <div className="card-title">Deployment</div>
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', padding: 16, fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text-secondary)' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 8 }}># Required environment variables</div>
              <div>FIREBASE_SERVICE_ACCOUNT={'{ "type": "service_account", ... }'}</div>
              <div>OPENAI_API_KEY=sk-...</div>
              <div>JWT_SECRET=your-strong-secret-here</div>
              <div>CLIENT_URL=https://your-app.vercel.app</div>
            </div>
          </div>}
        </>
      )}
    </div>
  );
}
