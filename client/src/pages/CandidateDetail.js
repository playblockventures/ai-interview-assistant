import React, { useEffect, useState, useRef, useCallback, useContext } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import toast from 'react-hot-toast';
import { candidateApi, generateApi, interviewApi, notificationApi } from '../utils/api';

// Helper — download a blob response as a file
function downloadBlob(res, fallbackName) {
  const cd = res.headers?.['content-disposition'] || '';
  const match = cd.match(/filename="?([^";\n]+)"?/);
  const filename = match ? match[1] : fallbackName;
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  window.URL.revokeObjectURL(url);
}
import { useDropzone } from 'react-dropzone';
import { AppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

const TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly',     label: 'Friendly' },
  { value: 'casual',       label: 'Casual' },
  { value: 'assertive',    label: 'Assertive' },
  { value: 'feminine',     label: 'Feminine' },
];

const MESSAGE_TYPES = [
  { value: 'outreach',   label: 'Initial Outreach' },
  { value: 'screening',  label: 'Screening Invite' },
  { value: 'technical',  label: 'Technical Interview' },
  { value: 'followup',   label: 'Follow-up' },
];

const STATUS_OPTIONS = [
  { value: 'pending',     label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'success',     label: 'Success' },
  { value: 'failed',      label: 'Failed' },
];

function RecruiterSelect({ value, onChange }) {
  const { recruiters } = useContext(AppContext);
  if (!recruiters.length) return null;
  return (
    <div className="form-group">
      <label className="form-label">Recruiter Profile</label>
      <select className="form-select" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">No specific recruiter</option>
        {recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </div>
  );
}

function CompanySelect({ value, onChange }) {
  const { companies } = useContext(AppContext);
  if (!companies.length) return null;
  return (
    <div className="form-group">
      <label className="form-label">Company Context</label>
      <select className="form-select" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Default (no company)</option>
        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
        Selects which company&apos;s knowledge base and interview scenario to use.
      </div>
    </div>
  );
}

// Compact inline version for the conversation config bar
function CompanySelectInline({ value, onChange }) {
  const { companies } = useContext(AppContext);
  if (!companies.length) return null;
  return (
    <div className="form-group" style={{ flex: 1, minWidth: 160, margin: 0 }}>
      <label className="form-label">Company</label>
      <select className="form-select" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Default</option>
        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}

// ── Scenario Tab ──────────────────────────────────────────────────────────────
function ScenarioTab({ candidate, onScenarioApplied }) {
  const { roles } = useContext(AppContext);
  const [config, setConfig] = useState({
    role: candidate.role || '', goal: '', tone: 'professional',
    customInstructions: '', recruiterId: candidate.recruiterId || '',
    companyId: candidate.companyId || '',
  });
  const [scenario, setScenario] = useState('');
  const [history, setHistory] = useState(candidate.interviewScenarios || []);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [applying, setApplying] = useState(false);
  const [editingIdx, setEditingIdx] = useState(null);
  const [editText,   setEditText]   = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const set = (k, v) => setConfig(p => ({ ...p, [k]: v }));

  const startEdit  = (i) => { setEditingIdx(i); setEditText(history[i].content); };
  const cancelEdit = ()  => { setEditingIdx(null); setEditText(''); };

  const saveEdit = async (i) => {
    if (!editText.trim()) return;
    setSavingEdit(true);
    try {
      await interviewApi.editScenario(candidate.id, i, editText.trim());
      setHistory(h => h.map((s, idx) => idx === i ? { ...s, content: editText.trim() } : s));
      setEditingIdx(null);
      toast.success('Scenario updated');
    } catch (e) { toast.error(e.message); }
    finally { setSavingEdit(false); }
  };

  const generate = async () => {
    setLoading(true);
    try {
      const data = await generateApi.scenario({ candidateId: candidate.id, ...config });
      setScenario(data.scenario);
      setHistory(h => [{ content: data.scenario, role: config.role, createdAt: new Date().toISOString() }, ...h]);
      toast.success('Scenario generated!');
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  // Apply scenario — save it as the active scenario for conversation
  const applyScenario = async (content) => {
    setApplying(true);
    try {
      await candidateApi.update(candidate.id, (() => {
        const fd = new FormData();
        fd.append('appliedScenario', content);
        return fd;
      })());
      onScenarioApplied(content);
      toast.success('Scenario applied to conversation!');
    } catch (e) { toast.error(e.message); }
    finally { setApplying(false); }
  };

  const deleteScenario = async (i) => {
    if (!window.confirm('Delete this scenario?')) return;
    try {
      await interviewApi.deleteScenario(candidate.id, i);
      setHistory(h => h.filter((_, idx) => idx !== i));
      toast.success('Scenario deleted');
    } catch (e) { toast.error(e.message); }
  };

  const exportPdf = async () => {
    try {
      const res = await generateApi.exportPdf({ content: scenario, title: 'Interview Scenario', candidateName: candidate.fullName });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url;
      a.download = `scenario-${(candidate.fullName || 'candidate').replace(/\s+/g, '_')}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) { toast.error('Export failed: ' + e.message); }
  };

  return (
    <div>
      <div className="card mb-16">
        <div className="card-title">Configure Scenario</div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-select" value={config.role} onChange={e => set('role', e.target.value)}>
              <option value="">Select role...</option>
              {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Tone</label>
            <select className="form-select" value={config.tone} onChange={e => set('tone', e.target.value)}>
              {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Interview Goal</label>
          <input className="form-input" placeholder="e.g. Assess smart contract expertise..."
            value={config.goal} onChange={e => set('goal', e.target.value)} />
        </div>
        <RecruiterSelect value={config.recruiterId} onChange={v => set('recruiterId', v)} />
        <CompanySelect value={config.companyId} onChange={v => set('companyId', v)} />
        <div className="form-group">
          <label className="form-label">Custom Instructions</label>
          <textarea className="form-textarea" placeholder="Any specific topics or instructions..."
            value={config.customInstructions} onChange={e => set('customInstructions', e.target.value)} style={{ minHeight: 70 }} />
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={loading}>
          {loading ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Generating...</> : '◎ Generate Scenario'}
        </button>
      </div>

      {scenario && (
        <div className="card mb-16">
          <div className="flex items-center justify-between mb-16">
            <div className="card-title">Generated Scenario</div>
            <div className="flex gap-8">
              <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard.writeText(scenario); toast.success('Copied!'); }}>Copy</button>
              <button className="btn btn-secondary btn-sm" onClick={exportPdf}>↓ PDF</button>
              <button className="btn btn-secondary btn-sm" onClick={generate}>↺ Regenerate</button>
              <button className="btn btn-primary btn-sm" onClick={() => applyScenario(scenario)} disabled={applying}>
                {applying ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '▶ Apply to Conversation'}
              </button>
            </div>
          </div>
          <div className="markdown-output"><ReactMarkdown>{scenario}</ReactMarkdown></div>
        </div>
      )}

      {history.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-12" style={{ cursor: 'pointer' }} onClick={() => setShowHistory(h => !h)}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Past Scenarios ({history.length})</div>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{showHistory ? '▲ Hide' : '▼ Show'}</span>
          </div>
          {showHistory && history.map((s, i) => (
            <div key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined, paddingTop: i > 0 ? 12 : 0, marginTop: i > 0 ? 12 : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {s.role} · {new Date(s.createdAt).toLocaleString()}
                  {s.editedAt && <span style={{ marginLeft: 6 }}>(edited)</span>}
                </div>
                <div className="flex gap-8">
                  {editingIdx === i ? (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={() => saveEdit(i)} disabled={savingEdit}>
                        {savingEdit ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Save'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard.writeText(s.content); toast.success('Copied!'); }}>Copy</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => applyScenario(s.content)} disabled={applying} style={{ fontSize: 10 }}>▶ Apply</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => startEdit(i)}>✎ Edit</button>
                      <button onClick={() => deleteScenario(i)} className="btn btn-danger btn-sm">✕</button>
                    </>
                  )}
                </div>
              </div>
              {editingIdx === i ? (
                <textarea className="form-textarea" style={{ minHeight: 200, fontSize: 12 }}
                  value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
              ) : (
                <div className="markdown-output" style={{ fontSize: 12 }}><ReactMarkdown>{s.content}</ReactMarkdown></div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Outreach Tab ──────────────────────────────────────────────────────────────
function OutreachTab({ candidate }) {
  const { roles } = useContext(AppContext);
  const [config, setConfig] = useState({
    role: candidate.role || '', messageType: 'outreach', tone: 'professional',
    goal: '', customInstructions: '', recruiterId: candidate.recruiterId || '',
    companyId: candidate.companyId || '',
  });
  const [message,     setMessage]     = useState('');
  const [history,     setHistory]     = useState(
    (candidate.outreachMessages || []).map((m, i) => ({ ...m, _origIdx: i }))
  );
  const [loading,     setLoading]     = useState(false);
  const [showHistory, setShowHistory] = useState(history.length > 0);

  // Manual add state
  const [showManual,  setShowManual]  = useState(false);
  const [manualText,  setManualText]  = useState('');
  const [manualType,  setManualType]  = useState('manual');
  const [addingManual, setAddingManual] = useState(false);

  // Edit state
  const [editingIdx,  setEditingIdx]  = useState(null);
  const [editText,    setEditText]    = useState('');
  const [saving,      setSaving]      = useState(false);

  const set = (k, v) => setConfig(p => ({ ...p, [k]: v }));

  const generate = async () => {
    setLoading(true);
    try {
      const data = await generateApi.outreach({ candidateId: candidate.id, ...config });
      const newMsg = { content: data.message, type: config.messageType, createdAt: new Date().toISOString() };
      setMessage(data.message);
      setHistory(h => [{ ...newMsg, _origIdx: 0 }, ...h.map((m, i) => ({ ...m, _origIdx: i + 1 }))]);
      setShowHistory(true);
      toast.success('Message generated!');
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const addManual = async () => {
    if (!manualText.trim()) return;
    setAddingManual(true);
    try {
      await interviewApi.addOutreachMsg(candidate.id, manualText.trim(), manualType);
      const newMsg = { content: manualText.trim(), type: manualType, createdAt: new Date().toISOString() };
      setHistory(h => [...h, { ...newMsg, _origIdx: h.length }]);
      setManualText('');
      setShowManual(false);
      setShowHistory(true);
      toast.success('Message added');
    } catch (e) { toast.error(e.message); }
    finally { setAddingManual(false); }
  };

  const startEdit = (i) => { setEditingIdx(i); setEditText(history[i].content); };
  const cancelEdit = () => { setEditingIdx(null); setEditText(''); };

  const saveEdit = async (i) => {
    if (!editText.trim()) return;
    setSaving(true);
    try {
      const firestoreIdx = history[i]._origIdx ?? i;
      await interviewApi.editOutreachMsg(candidate.id, firestoreIdx, editText.trim());
      setHistory(h => h.map((m, idx) => idx === i ? { ...m, content: editText.trim() } : m));
      setEditingIdx(null);
      toast.success('Message updated');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const deleteMsg = async (i) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      const firestoreIdx = history[i]._origIdx ?? i;
      await interviewApi.deleteOutreachMsg(candidate.id, firestoreIdx);
      setHistory(h => h.filter((_, idx) => idx !== i).map((m, newIdx) => ({ ...m, _origIdx: newIdx })));
      toast.success('Message deleted');
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      {/* Generate panel */}
      <div className="card mb-16">
        <div className="card-title">Generate Outreach</div>
        <div className="grid-2">
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-select" value={config.role} onChange={e => set('role', e.target.value)}>
              <option value="">Select role...</option>
              {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Message Type</label>
            <select className="form-select" value={config.messageType} onChange={e => set('messageType', e.target.value)}>
              {MESSAGE_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Tone</label>
            <select className="form-select" value={config.tone} onChange={e => set('tone', e.target.value)}>
              {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Goal</label>
            <input className="form-input" placeholder="e.g. Schedule a 30-min call..."
              value={config.goal} onChange={e => set('goal', e.target.value)} />
          </div>
        </div>
        <RecruiterSelect value={config.recruiterId} onChange={v => set('recruiterId', v)} />
        <CompanySelect value={config.companyId} onChange={v => set('companyId', v)} />
        <div className="form-group">
          <label className="form-label">Custom Instructions</label>
          <textarea className="form-textarea" placeholder="Additional context or instructions..."
            value={config.customInstructions} onChange={e => set('customInstructions', e.target.value)} style={{ minHeight: 60 }} />
        </div>
        <div className="flex gap-8">
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Generating...</> : '✉ Generate Message'}
          </button>
          <button className="btn btn-secondary" onClick={() => setShowManual(v => !v)}>
            ✎ Write Manually
          </button>
        </div>
      </div>

      {/* Manual write panel */}
      {showManual && (
        <div className="card mb-16" style={{ border: '1px solid var(--border-light)' }}>
          <div className="card-title" style={{ marginBottom: 12 }}>Write Message Manually</div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <select className="form-select" value={manualType} onChange={e => setManualType(e.target.value)}>
              <option value="manual">Manual</option>
              {MESSAGE_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Message</label>
            <textarea className="form-textarea" style={{ minHeight: 140 }}
              placeholder="Write your outreach message here..."
              value={manualText} onChange={e => setManualText(e.target.value)} />
          </div>
          <div className="flex gap-8">
            <button className="btn btn-primary" onClick={addManual} disabled={addingManual || !manualText.trim()}>
              {addingManual ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : '+ Add Message'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setShowManual(false); setManualText(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Generated message preview */}
      {message && (
        <div className="card mb-16">
          <div className="flex items-center justify-between mb-16">
            <div className="card-title">Generated Message</div>
            <div className="flex gap-8">
              <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard.writeText(message); toast.success('Copied!'); }}>Copy</button>
              <button className="btn btn-secondary btn-sm" onClick={generate}>↺ Regenerate</button>
            </div>
          </div>
          <div className="markdown-output" style={{ fontSize: 13.5, lineHeight: 1.7 }}>
            <ReactMarkdown>{message}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-12" style={{ cursor: 'pointer' }} onClick={() => setShowHistory(h => !h)}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Message History ({history.length})</div>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{showHistory ? '▲ Hide' : '▼ Show'}</span>
          </div>
          {showHistory && history.map((m, i) => (
            <div key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined, paddingTop: i > 0 ? 14 : 0, marginTop: i > 0 ? 14 : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {m.type} · {new Date(m.createdAt).toLocaleString()}
                  {m.editedAt && <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>(edited)</span>}
                </div>
                <div className="flex gap-8">
                  {editingIdx === i ? (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={() => saveEdit(i)} disabled={saving}>
                        {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Save'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard.writeText(m.content); toast.success('Copied!'); }}>Copy</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => startEdit(i)}>✎ Edit</button>
                      <button onClick={() => deleteMsg(i)} className="btn btn-danger btn-sm">✕</button>
                    </>
                  )}
                </div>
              </div>
              {editingIdx === i ? (
                <textarea className="form-textarea" style={{ minHeight: 120, fontSize: 13 }}
                  value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
              ) : (
                <div className="markdown-output" style={{ fontSize: 13, lineHeight: 1.7 }}>
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Conversation Tab ──────────────────────────────────────────────────────────
// ── Conversation Tab ──────────────────────────────────────────────────────────
function ConversationTab({ candidate, appliedScenario, onStatusChange }) {
  const { roles, recruiters } = useContext(AppContext);
  const { user } = useAuth();
  const [config, setConfig] = useState({
    role: candidate.role || '', tone: 'professional',
    recruiterId: candidate.recruiterId || '',
    customInstructions: '',
    companyId: candidate.companyId || '',
  });
  const mapHistory = (arr) => (arr || []).map((m, originalIdx) => ({
    role:             m.role === 'assistant' ? 'assistant' : m.role === 'call_script' ? 'call_script' : 'user',
    content:          m.content,
    timestamp:        m.timestamp,
    imageBase64:      m.imageBase64      || null,
    imageMimeType:    m.imageMimeType    || null,
    attachedFileName: m.attachedFileName || null,
    attachedFileText: m.attachedFileText || null,
    _origIdx:         originalIdx,
  }));

  const [history, setHistory] = useState(() => mapHistory(candidate.conversationHistory));

  // Refresh history from server on mount and after external changes
  const refreshHistory = useCallback(async () => {
    try {
      const data = await interviewApi.getHistory(candidate.id);
      setHistory(mapHistory(data.conversationHistory));
    } catch (_) {}
  }, [candidate.id]); // eslint-disable-line

  useEffect(() => { refreshHistory(); }, [refreshHistory]);

  const [input, setInput] = useState('');
  const [pendingImage, setPendingImage] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);   // { name, text, size }
  const [pendingFileLoading, setPendingFileLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  // Manual message insertion
  const [showManual,   setShowManual]   = useState(false);
  const [manualRole,   setManualRole]   = useState('user');
  const [manualText,   setManualText]   = useState('');
  const [addingManual, setAddingManual] = useState(false);

  // Inline editing
  const [editingIdx, setEditingIdx] = useState(null);
  const [editText,   setEditText]   = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // When appliedScenario changes, show instructions panel and pre-fill
  useEffect(() => {
    if (appliedScenario) {
      setShowInstructions(true);
      // Don't overwrite customInstructions — scenario is sent to AI separately via appliedScenario
      toast.success('Scenario applied — instructions updated');
    }
  }, [appliedScenario]);

  const handleFilePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Images → vision API (base64 preview)
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        setPendingImage({ base64: dataUrl.split(',')[1], mimeType: file.type, preview: dataUrl });
        setPendingFile(null);
      };
      reader.readAsDataURL(file);
      return;
    }

    // Non-image files → extract text
    setPendingFile(null);
    setPendingImage(null);
    setPendingFileLoading(true);
    try {
      const isBinary = /\.(pdf|doc|docx)$/i.test(file.name);
      let text = '';
      if (isBinary) {
        const fd = new FormData();
        fd.append('file', file);
        const result = await candidateApi.parseAttachment(fd);
        text = result.text || '';
      } else {
        // Read as plain text on the client (txt, csv, json, code files, etc.)
        text = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = ev => resolve(ev.target.result || '');
          reader.onerror = reject;
          reader.readAsText(file);
        });
      }
      if (!text.trim()) toast('File attached (no text extracted — content will be noted)');
      setPendingFile({ name: file.name, text, size: file.size });
    } catch (err) {
      toast.error('Could not read file: ' + err.message);
    } finally {
      setPendingFileLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const clearImage = () => {
    setPendingImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearFile = () => {
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const buildPayload = (historySnapshot, userMsg, imgData, fileData) => ({
    candidateId:        candidate.id,
    candidateReply:     userMsg,
    role:               config.role,
    tone:               config.tone,
    recruiterId:        config.recruiterId,
    customInstructions: config.customInstructions,
    companyId:          config.companyId   || undefined,
    imageBase64:        imgData?.base64    || undefined,
    imageMimeType:      imgData?.mimeType  || undefined,
    attachedFileName:   fileData?.name     || undefined,
    attachedFileText:   fileData?.text     || undefined,
    history: historySnapshot.map(m => ({
      role:             m.role,
      content:          m.content,
      imageBase64:      m.imageBase64      || undefined,
      imageMimeType:    m.imageMimeType    || undefined,
      attachedFileName: m.attachedFileName || undefined,
      attachedFileText: m.attachedFileText || undefined,
    })),
  });

  const addManualMessage = async () => {
    if (!manualText.trim()) return;
    setAddingManual(true);
    try {
      await interviewApi.addConversationMsg(candidate.id, manualRole, manualText.trim());
      setHistory(h => [...h, {
        role: manualRole, content: manualText.trim(),
        timestamp: new Date().toISOString(),
        _origIdx: h.length,  // new message goes to the end
      }]);
      setManualText('');
      setShowManual(false);
      toast.success('Message added');
    } catch (e) { toast.error(e.message); }
    finally { setAddingManual(false); }
  };

  const startEdit = (i) => { setEditingIdx(i); setEditText(history[i].content); };
  const cancelEdit = () => { setEditingIdx(null); setEditText(''); };

  const saveEdit = async (i) => {
    if (!editText.trim()) return;
    setSavingEdit(true);
    try {
      // Use the Firestore-tracked original index, not the local display index
      const firestoreIdx = history[i]._origIdx ?? i;
      await interviewApi.editConversationMsg(candidate.id, firestoreIdx, editText.trim());
      setHistory(h => h.map((m, idx) => idx === i ? { ...m, content: editText.trim() } : m));
      setEditingIdx(null);
      toast.success('Message updated');
    } catch (e) { toast.error(e.message); }
    finally { setSavingEdit(false); }
  };

  const send = async () => {
    const userMsg = input.trim();
    const imgData = pendingImage;
    const fileData = pendingFile;
    if (!userMsg && !imgData && !fileData) return;

    setInput('');
    clearImage();
    clearFile();

    const userEntry = {
      role: 'user', content: userMsg, timestamp: new Date().toISOString(),
      imageBase64:      imgData?.base64    || null,
      imageMimeType:    imgData?.mimeType  || null,
      attachedFileName: fileData?.name     || null,
      attachedFileText: fileData?.text     || null,
    };
    const newHistory = [...history, userEntry];
    setHistory(newHistory);
    setLoading(true);

    try {
      const data = await generateApi.conversation(buildPayload(newHistory, userMsg, imgData, fileData));
      setHistory(h => [...h, { role: 'assistant', content: data.response, timestamp: new Date().toISOString(), _origIdx: h.length }]);
      // Reflect auto status change: pending → in_progress
      if (candidate.status === 'pending' && onStatusChange) onStatusChange('in_progress');
    } catch (e) {
      toast.error(e.message);
      setHistory(h => h.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  // Regenerate the last assistant reply using current (possibly updated) instructions
  const regenerateLastReply = async () => {
    if (history.length < 2) return;
    // Find last assistant message index in local state
    const lastAssistantIdx = [...history].reverse().findIndex(m => m.role === 'assistant');
    if (lastAssistantIdx === -1) return;
    const assistantIdx = history.length - 1 - lastAssistantIdx;

    // History without the last assistant reply
    const historyWithoutLast = history.slice(0, assistantIdx);
    // The last user message
    const lastUser = [...historyWithoutLast].reverse().find(m => m.role === 'user');
    if (!lastUser) return;

    setRegenerating(true);

    try {
      // Step 1: Delete the old assistant message from Firestore FIRST
      const firestoreIdx = history[assistantIdx]._origIdx ?? assistantIdx;
      await interviewApi.deleteConversationMsg(candidate.id, firestoreIdx);

      // Step 2: Update local state to remove it
      const reindexed = historyWithoutLast.map((m, i) => ({ ...m, _origIdx: i }));
      setHistory(reindexed);

      // Step 3: Generate new reply — server will append it to Firestore
      const data = await generateApi.conversation(buildPayload(reindexed, lastUser.content, null, null));
      setHistory(h => [...h, {
        role: 'assistant',
        content: data.response,
        timestamp: new Date().toISOString(),
        _origIdx: h.length,
      }]);
      toast.success('Reply regenerated');
    } catch (e) {
      toast.error(e.message);
      setHistory(history); // restore on error
    } finally {
      setRegenerating(false);
    }
  };

  const deleteMsg = async (i) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      const firestoreIdx = history[i]._origIdx ?? i;
      await interviewApi.deleteConversationMsg(candidate.id, firestoreIdx);
      // After delete, reassign original indices for remaining messages
      setHistory(h => h.filter((_, idx) => idx !== i).map((m, newIdx) => ({ ...m, _origIdx: newIdx })));
      toast.success('Message deleted');
    } catch (e) { toast.error(e.message); }
  };

  const clearHistory = async () => {
    if (!window.confirm('Clear entire conversation history?')) return;
    try {
      await interviewApi.clearConversation(candidate.id);
      setHistory([]);
      toast.success('Conversation cleared');
    } catch (e) { toast.error(e.message); }
  };

  const set = (k, v) => setConfig(p => ({ ...p, [k]: v }));

  const hasLastAssistant = history.some(m => m.role === 'assistant');

  // Call script state
  const [showCallScriptModal, setShowCallScriptModal] = useState(false);
  const [callScriptInstr,     setCallScriptInstr]     = useState('');
  const [generatingScript,    setGeneratingScript]    = useState(false);

  const generateCallScript = async () => {
    setGeneratingScript(true);
    try {
      const data = await generateApi.callScript({
        candidateId:        candidate.id,
        history:            history.map(m => ({ role: m.role, content: m.content })),
        role:               config.role,
        companyId:          config.companyId  || undefined,
        recruiterId:        config.recruiterId || undefined,
        customInstructions: callScriptInstr.trim() || undefined,
      });
      setShowCallScriptModal(false);
      setCallScriptInstr('');
      // Refresh history from server so _origIdx values are accurate and data is confirmed persisted
      await refreshHistory();
      toast.success('Call script generated!');
    } catch (e) { toast.error(e.message); }
    finally { setGeneratingScript(false); }
  };

  const downloadCallScriptPdf = async (content) => {
    try {
      const res = await generateApi.exportPdf({
        content,
        title: `Call Script — ${candidate.fullName || 'Candidate'}`,
        candidateName: candidate.fullName,
      });
      downloadBlob(res, `call_script_${(candidate.fullName || 'candidate').replace(/\s+/g, '_')}.pdf`);
    } catch (e) { toast.error('PDF export failed: ' + e.message); }
  };

  // Admin: send tip state
  const [showTipModal, setShowTipModal] = useState(false);
  const [tipMsg, setTipMsg]             = useState('');
  const [tipTitle, setTipTitle]         = useState('');
  const [sendingTip, setSendingTip]     = useState(false);

  const sendTip = async () => {
    if (!tipMsg.trim()) return toast.error('Enter a message');
    setSendingTip(true);
    try {
      await notificationApi.send({
        userIds:       [candidate.ownerId],
        title:         tipTitle.trim() || 'Guide Tip',
        message:       tipMsg.trim(),
        candidateId:   candidate.id,
        candidateName: candidate.fullName || '',
      });
      toast.success('Tip sent');
      setShowTipModal(false);
      setTipMsg('');
      setTipTitle('');
    } catch (e) { toast.error(e.message); }
    finally { setSendingTip(false); }
  };

  return (
    <div>
      {/* Applied scenario banner */}
      {candidate.appliedScenario && (
        <div style={{
          background: 'rgba(108,99,255,0.08)', border: '1px solid rgba(108,99,255,0.25)',
          borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 14,
          fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>▶</span>
          <span>An interview scenario is applied to this conversation. The AI will follow that scenario structure.</span>
        </div>
      )}

      {/* Config bar */}
      <div className="card mb-16">
        <div className="flex gap-12" style={{ flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 140, margin: 0 }}>
            <label className="form-label">Role</label>
            <select className="form-select" value={config.role} onChange={e => set('role', e.target.value)}>
              <option value="">Select role...</option>
              {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 140, margin: 0 }}>
            <label className="form-label">Tone</label>
            <select className="form-select" value={config.tone} onChange={e => set('tone', e.target.value)}>
              {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {recruiters.length > 0 && (
            <div className="form-group" style={{ flex: 1, minWidth: 160, margin: 0 }}>
              <label className="form-label">Recruiter</label>
              <select className="form-select" value={config.recruiterId} onChange={e => set('recruiterId', e.target.value)}>
                <option value="">Any recruiter</option>
                {recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}
          <CompanySelectInline value={config.companyId} onChange={v => set('companyId', v)} />
          <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 8, paddingBottom: 1 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowInstructions(v => !v)} style={{ whiteSpace: 'nowrap' }}>
              {showInstructions ? '▲ Instructions' : '✎ Instructions'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowManual(v => !v)} style={{ whiteSpace: 'nowrap' }}>
              + Manual Message
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowCallScriptModal(true)} style={{ whiteSpace: 'nowrap' }} title="Generate a call script based on the full conversation">
              📞 Call Script
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={regenerateLastReply}
              disabled={!hasLastAssistant || regenerating || loading}
              title={hasLastAssistant ? 'Regenerate last reply using current instructions' : 'No reply to regenerate yet'}
              style={{ whiteSpace: 'nowrap' }}
            >
              {regenerating ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↺ Regen Reply'}
            </button>
            {user?.isAdmin && candidate.ownerId && (
              <button className="btn btn-secondary btn-sm" onClick={() => setShowTipModal(true)} title="Send a guide tip to this candidate's owner" style={{ whiteSpace: 'nowrap' }}>
                💡 Send Tip
              </button>
            )}
            {history.length > 0 && (
              <button className="btn btn-danger btn-sm" onClick={clearHistory}>Clear All</button>
            )}
          </div>
        </div>

        {/* Call Script modal */}
        {showCallScriptModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
            onClick={() => !generatingScript && setShowCallScriptModal(false)}>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 24, width: 480, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>📞 Generate Call Script</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                AI will generate a structured call script based on the full conversation and all candidate resources.
              </div>

              <div className="form-group">
                <label className="form-label">
                  Custom Instructions <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
                </label>
                <textarea
                  className="form-textarea"
                  style={{ minHeight: 90 }}
                  placeholder={`e.g. Focus on salary negotiation talking points. Include objection handling for "I'm happy at my current company". Keep the tone warm and consultative.`}
                  value={callScriptInstr}
                  onChange={e => setCallScriptInstr(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="flex gap-8">
                <button className="btn btn-primary" onClick={generateCallScript} disabled={generatingScript}>
                  {generatingScript
                    ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Generating...</>
                    : '📞 Generate Call Script'}
                </button>
                <button className="btn btn-secondary" onClick={() => { setShowCallScriptModal(false); setCallScriptInstr(''); }} disabled={generatingScript}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Admin: Send Tip modal */}
        {showTipModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
            onClick={() => setShowTipModal(false)}>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 24, width: 420, maxWidth: '90vw' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>💡 Send Guide Tip</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                This will appear as a notification for <strong>{candidate.ownerName || 'the candidate owner'}</strong>.
              </div>
              <div className="form-group">
                <label className="form-label">Title <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
                <input className="form-input" placeholder="Guide Tip" value={tipTitle} onChange={e => setTipTitle(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Message</label>
                <textarea className="form-textarea" style={{ minHeight: 90 }}
                  placeholder={`e.g. For ${candidate.fullName || 'this candidate'}, focus on asking about system design experience...`}
                  value={tipMsg} onChange={e => setTipMsg(e.target.value)} autoFocus />
              </div>
              <div className="flex gap-8">
                <button className="btn btn-primary" onClick={sendTip} disabled={sendingTip || !tipMsg.trim()}>
                  {sendingTip ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Sending...</> : '▶ Send Tip'}
                </button>
                <button className="btn btn-secondary" onClick={() => setShowTipModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {showInstructions && (
          <div style={{ marginTop: 12 }}>
            {candidate.appliedScenario && (
              <div style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ marginBottom: 6 }}>Applied Scenario</label>
                <div style={{
                  background: 'var(--bg-deep)', border: '1px solid rgba(108,99,255,0.25)',
                  borderRadius: 'var(--radius-sm)', padding: '10px 14px',
                  maxHeight: 220, overflowY: 'auto', fontSize: 12, color: 'var(--text-secondary)',
                  lineHeight: 1.6, whiteSpace: 'pre-wrap',
                }}>
                  {candidate.appliedScenario}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  This full scenario is sent to the AI on every reply. Use the field below for additional notes only.
                </div>
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Additional Instructions</label>
              <textarea
                className="form-textarea" style={{ minHeight: 80 }}
                placeholder="e.g. Focus on blockchain experience. Ask technical questions about DeFi..."
                value={config.customInstructions}
                onChange={e => set('customInstructions', e.target.value)}
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                These instructions apply to all AI replies, including regenerated ones. Update here then click ↺ Regen Reply.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Manual message insertion panel */}
      {showManual && (
        <div className="card mb-16" style={{ border: '1px solid var(--border-light)' }}>
          <div className="card-title" style={{ marginBottom: 12 }}>Insert Message Manually</div>
          <div className="form-group">
            <label className="form-label">Who is speaking?</label>
            <div className="flex gap-8">
              <button
                className={`btn btn-sm ${manualRole === 'user' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setManualRole('user')}
              >
                👤 {candidate.fullName || 'Candidate'} (Candidate)
              </button>
              <button
                className={`btn btn-sm ${manualRole === 'assistant' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setManualRole('assistant')}
              >
                🎙 You (Recruiter)
              </button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Message</label>
            <textarea className="form-textarea" style={{ minHeight: 100 }}
              placeholder={manualRole === 'user' ? `Type what ${candidate.fullName || 'the candidate'} said...` : 'Type your recruiter message...'}
              value={manualText} onChange={e => setManualText(e.target.value)} />
          </div>
          <div className="flex gap-8">
            <button className="btn btn-primary" onClick={addManualMessage} disabled={addingManual || !manualText.trim()}>
              {addingManual ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Adding...</> : '+ Add to Conversation'}
            </button>
            <button className="btn btn-secondary" onClick={() => { setShowManual(false); setManualText(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Chat window */}
      <div className="card" style={{ minHeight: 300 }}>
        {history.length === 0 ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <div className="empty-state-icon">💬</div>
            <div className="empty-state-title">Start the conversation</div>
            <div className="empty-state-desc">Type the candidate's message or attach a file (image, PDF, doc, etc.)</div>
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            {history.map((msg, i) => {
              if (msg.role === 'call_script') {
                return (
                  <div key={i} style={{ margin: '12px 0', padding: '14px 18px', border: '2px solid #0d9488', borderRadius: 12, background: 'rgba(13,148,136,0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#0d9488' }}>📞 Call Script</span>
                      <div className="flex gap-8" style={{ alignItems: 'center' }}>
                        {msg.timestamp && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                            {new Date(msg.timestamp).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                        {editingIdx === i ? (
                          <>
                            <button className="btn btn-primary btn-sm" onClick={() => saveEdit(i)} disabled={savingEdit}>
                              {savingEdit ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Save'}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard.writeText(msg.content); toast.success('Copied!'); }}>Copy</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => downloadCallScriptPdf(msg.content)}>↓ PDF</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => startEdit(i)}>✎ Edit</button>
                            <button onClick={() => deleteMsg(i)} className="btn btn-danger btn-sm">✕</button>
                          </>
                        )}
                      </div>
                    </div>
                    {editingIdx === i ? (
                      <textarea className="form-textarea" style={{ minHeight: 120, fontSize: 13, marginTop: 6 }}
                        value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
                    ) : (
                      msg.content && (
                        <div className="markdown-output" style={{ fontSize: 13.5, lineHeight: 1.7 }}>
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )
                    )}
                  </div>
                );
              }
              return (
                <div key={i} className={`conversation-bubble bubble-${msg.role}`}>
                  <div className="bubble-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      {msg.role === 'user'
                        ? <>
                            {candidate.photoUrl && (
                              <img src={candidate.photoUrl} alt="" style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', marginRight: 5, verticalAlign: 'middle' }} />
                            )}
                            {candidate.fullName || 'Candidate'} (Candidate)
                          </>
                        : 'You (Recruiter)'}
                    </span>
                    <div className="flex gap-8" style={{ alignItems: 'center' }}>
                      {msg.timestamp && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                          {new Date(msg.timestamp).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                      {editingIdx === i ? (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={() => saveEdit(i)} disabled={savingEdit}>
                            {savingEdit ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Save'}
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard.writeText(msg.content); toast.success('Copied!'); }}>Copy</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => startEdit(i)}>✎ Edit</button>
                          <button onClick={() => deleteMsg(i)} className="btn btn-danger btn-sm">✕</button>
                        </>
                      )}
                    </div>
                  </div>

                  {msg.imageBase64 && (
                    <div style={{ marginBottom: 6 }}>
                      <img src={`data:${msg.imageMimeType || 'image/jpeg'};base64,${msg.imageBase64}`}
                        alt="attachment" style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8, border: '1px solid var(--border)' }} />
                    </div>
                  )}
                  {msg.attachedFileName && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '4px 10px', background: 'var(--bg-elevated)', borderRadius: 6, border: '1px solid var(--border)', width: 'fit-content', fontSize: 11, color: 'var(--text-secondary)' }}>
                      <span>📎</span>
                      <span style={{ fontWeight: 500 }}>{msg.attachedFileName}</span>
                      {msg.attachedFileText && (
                        <span style={{ color: 'var(--text-muted)' }}>· {Math.round(msg.attachedFileText.length / 1000)}k chars</span>
                      )}
                    </div>
                  )}

                  {/* Inline edit or display */}
                  {editingIdx === i ? (
                    <textarea className="form-textarea" style={{ minHeight: 80, fontSize: 13, marginTop: 6 }}
                      value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
                  ) : (
                    msg.content && (
                      <div className="markdown-output" style={{ fontSize: 13.5, lineHeight: 1.7 }}>
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    )
                  )}
                </div>
              );
            })}
            {(loading || regenerating) && (
              <div className="conversation-bubble bubble-assistant">
                <div className="bubble-label">You (Recruiter)</div>
                <span className="spinner" style={{ width: 16, height: 16 }} />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {pendingImage && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: 8,
          }}>
            <img src={pendingImage.preview} alt="preview" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />
            <span style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)' }}>Image attached</span>
            <button onClick={clearImage} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', fontSize: 16 }}>✕</button>
          </div>
        )}

        {pendingFile && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: 8,
          }}>
            <span style={{ fontSize: 20 }}>📎</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingFile.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {pendingFile.text ? `${Math.round(pendingFile.text.length / 1000)}k chars extracted` : 'No text extracted'}
                {pendingFile.size ? ` · ${(pendingFile.size / 1024).toFixed(0)} KB` : ''}
              </div>
            </div>
            <button onClick={clearFile} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', fontSize: 16 }}>✕</button>
          </div>
        )}

        {pendingFileLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            <span className="spinner" style={{ width: 14, height: 14 }} /> Extracting file content...
          </div>
        )}

        <div className="flex gap-8" style={{ marginTop: 8, alignItems: 'flex-end' }}>
          <div>
            <input ref={fileInputRef} type="file" accept="*" style={{ display: 'none' }} onChange={handleFilePick} />
            <button className="btn btn-secondary" style={{ padding: '10px 12px', flexShrink: 0 }}
              onClick={() => fileInputRef.current?.click()} title="Attach file (image, PDF, doc, txt, csv…)">📎</button>
          </div>
          <textarea
            className="form-textarea"
            placeholder={`Type ${candidate.fullName || 'candidate'}'s reply, or attach a file…`}
            value={input}
            onChange={e => setInput(e.target.value)}
            style={{ minHeight: 70, flex: 1 }}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) send(); }}
          />
          <div className="flex flex-col gap-8">
            <button className="btn btn-primary" onClick={send} disabled={loading || regenerating} style={{ whiteSpace: 'nowrap' }}>
              {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '→ Reply'}
            </button>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>Ctrl+Enter</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Status Tab ────────────────────────────────────────────────────────────────
function StatusTab({ candidate, onUpdated }) {
  const [status, setStatus] = useState(candidate.status);
  const [notes, setNotes] = useState(candidate.notes || '');
  const [saving, setSaving] = useState(false);

  const handleStatusChange = (newStatus) => {
    if (newStatus !== status) { setStatus(newStatus); setNotes(''); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await candidateApi.updateStatus(candidate.id, status, notes);
      toast.success('Status updated!');
      onUpdated();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div className="card-title">Interview Status</div>
      <div className="form-group">
        <label className="form-label">Status</label>
        <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.map(s => (
            <button key={s.value} onClick={() => handleStatusChange(s.value)} className="btn"
              style={{
                background: status === s.value ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                border: `1px solid ${status === s.value ? 'var(--accent)' : 'var(--border)'}`,
                color: status === s.value ? 'var(--accent)' : 'var(--text-secondary)',
              }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Notes</label>
        <textarea className="form-textarea" placeholder="Add notes about this candidate's progress..."
          value={notes} onChange={e => setNotes(e.target.value)} style={{ minHeight: 120 }} />
      </div>
      <button className="btn btn-primary" onClick={save} disabled={saving}>
        {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : 'Save Status'}
      </button>
    </div>
  );
}

// ── Edit Profile Modal ───────────────────────────────────────────────────────
function EditProfileModal({ candidate, onClose, onSaved }) {
  const { roles, recruiters, companies } = useContext(AppContext);
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({
    fullName:     candidate.fullName     || '',
    email:        candidate.email        || '',
    phone:        candidate.phone        || '',
    linkedinUrl:  candidate.linkedinUrl  || '',
    location:     candidate.location     || '',
    currentTitle: candidate.currentTitle || '',
    role:         candidate.role         || '',
    resumeUrl:    candidate.resumeUrl    || '',
    recruiterId:  candidate.recruiterId  || '',
    photoUrl:     candidate.photoUrl     || '',
    companyId:    candidate.companyId    || '',
    companyName:  candidate.companyName  || '',
  });
  const [saving,      setSaving]      = useState(false);
  const [extracting,  setExtracting]  = useState(false);
  const [resumeFile,  setResumeFile]  = useState(null);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleResumeChange = async (e) => {
    const file = e.target.files?.[0];
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
        photoUrl:     p.photoUrl     || data.photoUrl     || '',
      }));
      toast.success('Resume re-parsed — fields updated');
    } catch (e) { toast.error(e.message); }
    finally { setExtracting(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v || ''));
      const recruiterName = recruiters.find(r => r.id === form.recruiterId)?.name || '';
      fd.set('recruiterName', recruiterName);
      const companyName = companies.find(c => c.id === form.companyId)?.name || '';
      fd.set('companyName', companyName);
      if (resumeFile) fd.append('resume', resumeFile);
      await candidateApi.update(candidate.id, fd);
      toast.success('Profile updated!');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-title">Edit Candidate Profile</div>

        {/* Photo preview + resume upload */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, alignItems: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', flexShrink: 0, background: 'var(--bg-elevated)', border: '2px solid var(--border)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
            {form.photoUrl ? <img src={form.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
          </div>
          <div style={{ flex: 1 }}>
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{ display: 'none' }} onChange={handleResumeChange} />
            <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={extracting}>
              {extracting ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Parsing...</> : '📄 Upload New Resume'}
            </button>
            {resumeFile && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{resumeFile.name}</div>}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Upload to re-parse and auto-fill fields</div>
          </div>
        </div>

        <div className="grid-2">
          <div className="form-group"><label className="form-label">Full Name</label><input className="form-input" value={form.fullName} onChange={e => set('fullName', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Location</label><input className="form-input" value={form.location} onChange={e => set('location', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Current Title</label><input className="form-input" value={form.currentTitle} onChange={e => set('currentTitle', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">LinkedIn URL</label><input className="form-input" value={form.linkedinUrl} onChange={e => set('linkedinUrl', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Photo URL</label><input className="form-input" value={form.photoUrl} onChange={e => set('photoUrl', e.target.value)} placeholder="https://..." /></div>
          <div className="form-group"><label className="form-label">Resume URL</label><input className="form-input" value={form.resumeUrl} onChange={e => set('resumeUrl', e.target.value)} placeholder="https://..." /></div>
        </div>

        <div className="form-group">
          <label className="form-label">Role</label>
          <select className="form-select" value={form.role} onChange={e => set('role', e.target.value)}>
            <option value="">Select role...</option>
            {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Recruiter</label>
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
          </div>
        )}

        <div className="flex gap-8" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || extracting}>
            {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Profile Card ──────────────────────────────────────────────────────────────
function ProfileCard({ candidate }) {
  const { roles, recruiters } = useContext(AppContext);
  const getRoleLabel = (val) => roles.find(r => r.value === val)?.label || val || '—';
  const recruiter = recruiters.find(r => r.id === candidate.recruiterId);

  return (
    <div className="card mb-16" style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
        background: 'var(--bg-elevated)', border: '2px solid var(--border)',
        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
      }}>
        {candidate.photoUrl
          ? <img src={candidate.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : '👤'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{candidate.fullName || '—'}</div>
          <span className={`status-badge status-${candidate.status}`}>{candidate.status?.replace('_', ' ')}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
          {candidate.currentTitle && <span>💼 {candidate.currentTitle}</span>}
          {candidate.email && <span style={{ fontFamily: 'DM Mono, monospace' }}>✉ {candidate.email}</span>}
          {candidate.phone && <span>📞 {candidate.phone}</span>}
          {candidate.location && <span>📍 {candidate.location}</span>}
          {candidate.linkedinUrl && <a href={candidate.linkedinUrl.startsWith('http') ? candidate.linkedinUrl : `https://${candidate.linkedinUrl}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>LinkedIn ↗</a>}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
          {candidate.role && <div style={{ fontSize: 12, color: 'var(--accent)' }}>🎯 {getRoleLabel(candidate.role)}</div>}
          {recruiter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                background: recruiter.photoUrl ? undefined : 'var(--accent-dim)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)', fontSize: 9, fontWeight: 700,
              }}>
                {recruiter.photoUrl
                  ? <img src={recruiter.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : recruiter.name.charAt(0)}
              </div>
              <span>Recruiter: {recruiter.linkedinUrl
                ? <a href={recruiter.linkedinUrl.startsWith('http') ? recruiter.linkedinUrl : `https://${recruiter.linkedinUrl}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{recruiter.name} ↗</a>
                : recruiter.name}
              </span>
            </div>
          )}
          {candidate.ownerName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, color: 'var(--text-muted)',
              }}>
                {candidate.ownerName.charAt(0).toUpperCase()}
              </div>
              <span>Added by: {candidate.ownerName}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const TABS = ['Scenario', 'Outreach', 'Conversation', 'Status'];

export default function CandidateDetail() {
  const { id } = useParams();
  const location = useLocation();

  // Support ?tab=conversation from Generate page Apply redirect
  const urlTab = (() => {
    try {
      const p = new URLSearchParams(location.search);
      const t = p.get('tab');
      if (t === 'conversation') return 2;
      if (t === 'outreach')     return 1;
      if (t === 'status')       return 3;
    } catch (_) {}
    return 0;
  })();

  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(urlTab);
  const [appliedScenario, setAppliedScenario] = useState('');
  const [showEditProfile, setShowEditProfile] = useState(false);

  const fetchCandidate = useCallback(async () => {
    try {
      const data = await candidateApi.getById(id);
      setCandidate(data);
      if (data.appliedScenario) setAppliedScenario(data.appliedScenario);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchCandidate(); }, [fetchCandidate]);

  const handleScenarioApplied = (content) => {
    setAppliedScenario(content);
    setActiveTab(2); // Switch to Conversation tab
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
      <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
    </div>
  );
  if (!candidate) return <div className="page"><div style={{ color: 'var(--error)' }}>Candidate not found</div></div>;

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Link to="/candidates" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: 13 }}>← Candidates</Link>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowEditProfile(true)}>✎ Edit Profile</button>
      </div>
      <ProfileCard candidate={candidate} />
      <div className="tabs">
        {TABS.map((t, i) => (
          <button key={t} className={`tab ${activeTab === i ? 'active' : ''}`} onClick={() => setActiveTab(i)}>
            {t}{t === 'Conversation' && appliedScenario ? ' ▶' : ''}
          </button>
        ))}
      </div>
      {activeTab === 0 && <ScenarioTab candidate={candidate} onScenarioApplied={handleScenarioApplied} />}
      {activeTab === 1 && <OutreachTab candidate={candidate} />}
      {activeTab === 2 && <ConversationTab candidate={candidate} appliedScenario={appliedScenario} onStatusChange={(newStatus) => { setCandidate(c => ({ ...c, status: newStatus })); }} />}
      {activeTab === 3 && <StatusTab candidate={candidate} onUpdated={fetchCandidate} />}

      {showEditProfile && (
        <EditProfileModal
          candidate={candidate}
          onClose={() => setShowEditProfile(false)}
          onSaved={() => { setShowEditProfile(false); fetchCandidate(); }}
        />
      )}
    </div>
  );
}
