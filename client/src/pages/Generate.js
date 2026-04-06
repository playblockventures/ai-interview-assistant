import React, { useState, useEffect, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';
import { generateApi, candidateApi } from '../utils/api';
import { AppContext } from '../context/AppContext';

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

const TABS = ['Interview Scenario', 'Outreach Message'];

export default function Generate() {
  const location = useLocation();
  const navigate  = useNavigate();
  const params    = new URLSearchParams(location.search);
  const initTab   = params.get('tab') === 'outreach' ? 1 : 0;
  const { roles, recruiters } = useContext(AppContext);

  const [activeTab,   setActiveTab]   = useState(initTab);
  const [candidates,  setCandidates]  = useState([]);
  const [result,      setResult]      = useState('');
  const [loading,     setLoading]     = useState(false);
  const [applying,    setApplying]    = useState(false);

  const [scenarioConfig, setScenarioConfig] = useState({
    candidateId: '', role: '', goal: '', tone: 'professional', customInstructions: '', recruiterId: '',
  });
  const [outreachConfig, setOutreachConfig] = useState({
    candidateId: '', role: '', messageType: 'outreach', tone: 'professional', goal: '', customInstructions: '', recruiterId: '',
  });

  useEffect(() => {
    candidateApi.getAll({ limit: 100 }).then(d => setCandidates(d.candidates || [])).catch(() => {});
  }, []);

  const generateScenario = async () => {
    setLoading(true); setResult('');
    try {
      const data = await generateApi.scenario(scenarioConfig);
      setResult(data.scenario);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const generateOutreach = async () => {
    setLoading(true); setResult('');
    try {
      const data = await generateApi.outreach(outreachConfig);
      setResult(data.message);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const exportPdf = async () => {
    if (!result) return;
    try {
      const res = await generateApi.exportPdf({ content: result, title: activeTab === 0 ? 'Interview Scenario' : 'Outreach Message' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url;
      a.download = `${activeTab === 0 ? 'scenario' : 'outreach'}-${Date.now()}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) { toast.error('Export failed: ' + e.message); }
  };

  // Apply scenario to a candidate's conversation
  const applyToConversation = async () => {
    const candidateId = scenarioConfig.candidateId;
    if (!candidateId) {
      toast.error('Select a candidate first to apply the scenario');
      return;
    }
    if (!result) return;
    setApplying(true);
    try {
      const fd = new FormData();
      fd.append('appliedScenario', result);
      await candidateApi.update(candidateId, fd);
      toast.success('Scenario applied! Redirecting to conversation...');
      setTimeout(() => navigate(`/candidates/${candidateId}?tab=conversation`), 800);
    } catch (e) { toast.error(e.message); }
    finally { setApplying(false); }
  };

  const setS = (k, v) => setScenarioConfig(p => ({ ...p, [k]: v }));
  const setO = (k, v) => setOutreachConfig(p => ({ ...p, [k]: v }));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Generate Content</div>
          <div className="page-subtitle">Create interview scenarios and outreach messages with AI</div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t, i) => (
          <button key={t} className={`tab ${activeTab === i ? 'active' : ''}`}
            onClick={() => { setActiveTab(i); setResult(''); }}>{t}</button>
        ))}
      </div>

      <div className="grid-2" style={{ gap: 20, alignItems: 'flex-start' }}>
        {/* Config panel */}
        <div className="card">
          <div className="card-title">{activeTab === 0 ? 'Scenario Settings' : 'Message Settings'}</div>

          <div className="form-group">
            <label className="form-label">Link to Candidate (optional)</label>
            <select className="form-select"
              value={activeTab === 0 ? scenarioConfig.candidateId : outreachConfig.candidateId}
              onChange={e => activeTab === 0 ? setS('candidateId', e.target.value) : setO('candidateId', e.target.value)}>
              <option value="">No candidate (generic)</option>
              {candidates.map(c => <option key={c.id} value={c.id}>{c.fullName || c.email}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-select"
              value={activeTab === 0 ? scenarioConfig.role : outreachConfig.role}
              onChange={e => activeTab === 0 ? setS('role', e.target.value) : setO('role', e.target.value)}>
              <option value="">Select role...</option>
              {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          {activeTab === 1 && (
            <div className="form-group">
              <label className="form-label">Message Type</label>
              <select className="form-select" value={outreachConfig.messageType}
                onChange={e => setO('messageType', e.target.value)}>
                {MESSAGE_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Tone</label>
            <select className="form-select"
              value={activeTab === 0 ? scenarioConfig.tone : outreachConfig.tone}
              onChange={e => activeTab === 0 ? setS('tone', e.target.value) : setO('tone', e.target.value)}>
              {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">{activeTab === 0 ? 'Interview Goal' : 'Message Goal'}</label>
            <input className="form-input"
              placeholder={activeTab === 0 ? 'e.g. Assess leadership and DeFi knowledge' : 'e.g. Schedule an intro call'}
              value={activeTab === 0 ? scenarioConfig.goal : outreachConfig.goal}
              onChange={e => activeTab === 0 ? setS('goal', e.target.value) : setO('goal', e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Custom Instructions</label>
            <textarea className="form-textarea" style={{ minHeight: 80 }}
              placeholder="Any additional instructions for the AI..."
              value={activeTab === 0 ? scenarioConfig.customInstructions : outreachConfig.customInstructions}
              onChange={e => activeTab === 0 ? setS('customInstructions', e.target.value) : setO('customInstructions', e.target.value)} />
          </div>

          {recruiters.length > 0 && (
            <div className="form-group">
              <label className="form-label">Recruiter Profile</label>
              <select className="form-select"
                value={activeTab === 0 ? scenarioConfig.recruiterId : outreachConfig.recruiterId}
                onChange={e => activeTab === 0 ? setS('recruiterId', e.target.value) : setO('recruiterId', e.target.value)}>
                <option value="">No specific recruiter</option>
                {recruiters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}

          <button className="btn btn-primary w-full btn-lg"
            onClick={activeTab === 0 ? generateScenario : generateOutreach}
            disabled={loading}>
            {loading
              ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Generating with GPT-4o...</>
              : activeTab === 0 ? '◎ Generate Scenario' : '✉ Generate Message'}
          </button>
        </div>

        {/* Output panel */}
        <div className="card" style={{ minHeight: 300 }}>
          <div className="flex items-center justify-between mb-16">
            <div className="card-title">Output</div>
            {result && (
              <div className="flex gap-8">
                <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard.writeText(result); toast.success('Copied!'); }}>Copy</button>
                <button className="btn btn-secondary btn-sm" onClick={exportPdf}>↓ PDF</button>
                {activeTab === 0 && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={applyToConversation}
                    disabled={applying}
                    title={scenarioConfig.candidateId ? 'Apply this scenario to the candidate\'s conversation' : 'Select a candidate first'}
                  >
                    {applying
                      ? <span className="spinner" style={{ width: 12, height: 12 }} />
                      : '▶ Apply to Conversation'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Apply hint when no candidate selected */}
          {result && activeTab === 0 && !scenarioConfig.candidateId && (
            <div style={{
              background: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.2)',
              borderRadius: 'var(--radius-sm)', padding: '8px 12px',
              fontSize: 12, color: 'var(--accent)', marginBottom: 14,
            }}>
              ℹ Select a candidate on the left to enable "Apply to Conversation"
            </div>
          )}

          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, gap: 16 }}>
              <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>AI is generating your content...</span>
            </div>
          )}

          {!loading && !result && (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state-icon">◎</div>
              <div className="empty-state-title">Nothing generated yet</div>
              <div className="empty-state-desc">Configure settings and click Generate to create content</div>
            </div>
          )}

          {!loading && result && (
            activeTab === 0
              ? <div className="markdown-output"><ReactMarkdown>{result}</ReactMarkdown></div>
              : <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'DM Sans, sans-serif', fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{result}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
