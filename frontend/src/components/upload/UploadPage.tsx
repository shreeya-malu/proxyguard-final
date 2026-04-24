import { useState, useCallback } from 'react';
import { runAudit, AuditResponse, AuditConfig } from '../../services/api';

type Industry = 'finance' | 'healthcare' | 'hr';

interface Props {
  onAuditComplete: (result: AuditResponse) => void;
}

const INDUSTRY_META: Record<Industry, { icon: string; label: string; metric: string; description: string }> = {
  finance:    { icon: '🏦', label: 'Finance',     metric: 'FPR Parity',         description: 'Equal Credit Opportunity Act, Fair Housing Act' },
  hr:         { icon: '👥', label: 'HR / Hiring', metric: 'Demographic Parity', description: 'Title VII, EEOC 4/5ths Rule' },
  healthcare: { icon: '⚕',  label: 'Healthcare',  metric: 'TPR Parity',         description: 'Civil Rights Act Title VI, ADA §504' },
};

// ── Parse CSV headers from a File object (browser-side, reads first 4 KB only)
function parseCSVHeaders(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text    = e.target?.result as string;
        const first   = text.split('\n')[0] ?? '';
        const delim   = first.includes('\t') ? '\t' : ',';
        const headers = first
          .split(delim)
          .map(h => h.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
        if (headers.length === 0) throw new Error('No headers found.');
        resolve(headers);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file.slice(0, 4096));
  });
}

// ── Heuristic: guess protected attrs + outcome from column names
function guessColumns(headers: string[]) {
  const lower = headers.map(h => h.toLowerCase());
  const protectedKw = ['race', 'sex', 'gender', 'age', 'ethnicity', 'religion', 'nationality', 'disability'];
  const outcomeKw   = ['two_year_recid', 'recid', 'hired', 'approved', 'outcome', 'label',
                       'target', 'decision', 'default', 'charged', 'convicted', 'score_text', 'result'];

  const guessedProtected = headers.filter((_, i) => protectedKw.some(kw => lower[i].includes(kw)));
  const guessedOutcome   = headers.find((_, i) => outcomeKw.some(kw => lower[i] === kw || lower[i].includes(kw))) ?? null;

  return { protected: guessedProtected, outcome: guessedOutcome };
}

// ── Clickable column pill
function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily:  'var(--mono)',
        fontSize:    11,
        padding:     '4px 10px',
        borderRadius: 4,
        border:      `0.5px solid ${active ? 'var(--color-text-primary)' : 'var(--color-border-secondary)'}`,
        background:  active ? 'var(--color-text-primary)' : 'var(--color-background-primary)',
        color:       active ? 'var(--color-background-primary)' : 'var(--color-text-secondary)',
        cursor:      'pointer',
        transition:  'all 0.1s',
        whiteSpace:  'nowrap',
      }}
    >
      {active ? '✓ ' : ''}{label}
    </button>
  );
}

// ── Column picker section
function ColumnPicker({ label, hint, columns, selected, onToggle }: {
  label:    string;
  hint:     string;
  columns:  string[];
  selected: string[];
  onToggle: (col: string) => void;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="field-label">{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 5 }}>
        {columns.map((col, index) => (
          <Pill key={`${col}-${index}`} label={col} active={selected.includes(col)} onClick={() => onToggle(col)} />
        ))}
      </div>
      <div className="field-hint">{hint}</div>
    </div>
  );
}

// ── Main component
export default function UploadPage({ onAuditComplete }: Props) {
  const [file,          setFile]          = useState<File | null>(null);
  const [columns,       setColumns]       = useState<string[]>([]);
  const [parsing,       setParsing]       = useState(false);
  const [industry,      setIndustry]      = useState<Industry>('hr');
  const [protectedCols, setProtectedCols] = useState<string[]>([]);
  const [outcomeCol,    setOutcomeCol]    = useState<string | null>(null);
  const [isDragging,    setIsDragging]    = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  const loadFile = useCallback(async (f: File) => {
    if (!f.name.endsWith('.csv')) { setError('Only CSV files are supported.'); return; }
    setFile(f);
    setError(null);
    setColumns([]);
    setProtectedCols([]);
    setOutcomeCol(null);
    setParsing(true);
    try {
      const headers = await parseCSVHeaders(f);
      setColumns(headers);
      const g = guessColumns(headers);
      setProtectedCols(g.protected);
      setOutcomeCol(g.outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read CSV headers.');
    } finally {
      setParsing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  }, [loadFile]);

  const toggleProtected = (col: string) =>
    setProtectedCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);

  const toggleOutcome = (col: string) =>
    setOutcomeCol(prev => prev === col ? null : col);

  const handleSubmit = async () => {
    if (!file)                     { setError('Please upload a CSV file.');                 return; }
    if (protectedCols.length === 0){ setError('Select at least one protected attribute.');  return; }
    if (!outcomeCol)               { setError('Select the outcome column.');                return; }
    if (protectedCols.includes(outcomeCol)) {
      setError('Outcome column cannot also be a protected attribute.'); return;
    }
    setLoading(true); setError(null);
    try {
      const result = await runAudit({
        file,
        protectedAttributes: protectedCols.join(', '),
        outcomeColumn:       outcomeCol,
        industry,
        region:              'india',   // default; user-selectable in future
      } as AuditConfig);
      onAuditComplete(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Audit failed. Is the API running?');
    } finally {
      setLoading(false);
    }
  };

  // Button label adapts to guide the user step-by-step
  const btnLabel = loading             ? 'Analysing…'
    : !file                            ? 'Upload a CSV to begin'
    : parsing                          ? 'Reading headers…'
    : protectedCols.length === 0       ? 'Select protected attributes ↑'
    : !outcomeCol                      ? 'Select outcome column ↑'
    : 'Run Fairness Audit →';

  const canSubmit = !!(file && !parsing && protectedCols.length > 0 && outcomeCol && !loading);

  return (
    <div className="upload-page">
      <div className="upload-headline">Audit your dataset<br /><em>before</em> you train.</div>
      <p className="upload-sub">
        Upload a CSV. ProxyGuard reads the column headers automatically — click to select
        your protected attributes and outcome column. No typing required.
      </p>

      {/* Drop zone */}
      <div
        className={`dropzone ${isDragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => !file && document.getElementById('pg-file-input')?.click()}
        style={{ cursor: file ? 'default' : 'pointer' }}
      >
        <input id="pg-file-input" type="file" accept=".csv"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
        />
        <div className="dz-icon">{parsing ? '⏳' : file ? '✓' : '↑'}</div>
        <div className="dz-label">
          {parsing
            ? 'Reading column headers…'
            : file
            ? `${file.name}  ·  ${(file.size / 1024).toFixed(0)} KB  ·  ${columns.length} columns detected`
            : 'Drop CSV here or click to upload'}
        </div>
        <div className="dz-hint">
          {file && !parsing
            ? (
              <span
                style={{ cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--mono)', fontSize: 11 }}
                onClick={(e) => { e.stopPropagation(); document.getElementById('pg-file-input')?.click(); }}
              >
                Change file
              </span>
            )
            : 'CSV only · max 100MB'
          }
        </div>
      </div>

      {/* Column pickers — appear once headers are parsed */}
      {columns.length > 0 && (
        <div style={{
          background:    'var(--color-background-primary)',
          border:        '0.5px solid var(--color-border-tertiary)',
          borderRadius:  'var(--border-radius-lg)',
          padding:       '18px 20px',
          marginBottom:  20,
        }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.8px',
            textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 16,
          }}>
            Column Configuration · {columns.length} columns · click to select
          </div>

          <ColumnPicker
            label="Protected Attributes"
            hint="Select all legally protected columns — race, sex, age, etc. Multiple allowed."
            columns={columns}
            selected={protectedCols}
            onToggle={toggleProtected}
          />

          <ColumnPicker
            label="Outcome Column"
            hint="Select the binary 0/1 label — the decision your model will predict."
            columns={columns}
            selected={outcomeCol ? [outcomeCol] : []}
            onToggle={toggleOutcome}
          />

          {/* Live selection summary */}
          {(protectedCols.length > 0 || outcomeCol) && (
            <div style={{
              padding: '10px 14px', marginTop: 4,
              background: 'var(--color-background-secondary)',
              borderRadius: 'var(--border-radius-md)',
              fontFamily: 'var(--mono)', fontSize: 11,
              color: 'var(--color-text-secondary)', lineHeight: 1.8,
            }}>
              {protectedCols.length > 0 && (
                <div>Protected: <strong style={{ color: 'var(--color-text-primary)' }}>{protectedCols.join(', ')}</strong></div>
              )}
              {outcomeCol && (
                <div>Outcome:&nbsp;&nbsp;&nbsp;
                  <strong style={{ color: 'var(--color-text-primary)' }}>{outcomeCol}</strong>
                </div>
              )}
              {/* Warn if outcome is also selected as protected */}
              {outcomeCol && protectedCols.includes(outcomeCol) && (
                <div style={{ color: '#E24B4A', marginTop: 4 }}>
                  ⚠ Outcome column is also selected as a protected attribute — please deselect one.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Industry selector */}
      <div className="field-group">
        <div className="field-label">Industry Context</div>
        <div className="industry-grid">
          {(Object.entries(INDUSTRY_META) as [Industry, typeof INDUSTRY_META[Industry]][]).map(([key, meta]) => (
            <button key={key}
              className={`industry-btn ${industry === key ? 'selected' : ''}`}
              onClick={() => setIndustry(key)}
            >
              <span className="ind-icon">{meta.icon}</span>
              <span className="ind-label">{meta.label}</span>
              <span className="ind-metric">{meta.metric}</span>
              <span className="ind-desc">{meta.description}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <button
        className="run-btn"
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{ opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
      >
        {btnLabel}
      </button>
    </div>
  );
}
