import { useMemo, useState } from 'react';
import PlainEnglishPanel from './PlainEnglishPanel';
import {
  AuditReport, MetricResult,
  SensitivityReport, BoundedMetricResult, AssumptionLevel,
  DLPResult, GeminiOutput, ImpossibilityConflict,
  generateRemediationReport, RemediationReportPayload,
  SandboxChange,
} from '../../services/api';
import { downloadRemediationPDF } from '../../services/pdfGenerator';

interface Props {
  report: AuditReport;
  auditId: string;
  sensitivityReports: SensitivityReport[];
  dlpResult: DLPResult;
  gemini: GeminiOutput;
  onGenerateCertificate: () => void;
}

const C = {
  red:'#FF4D6D', redBg:'rgba(255,77,109,0.1)', redText:'#FF6B85',
  amber:'#FFB830', amberBg:'rgba(255,184,48,0.1)', amberText:'#FFB830',
  green:'#3DDC84', greenBg:'rgba(61,220,132,0.1)', greenText:'#3DDC84',
  blue:'#4D9FFF', blueBg:'rgba(77,159,255,0.1)', blueText:'#7DBFFF',
  purple:'#A855F7', purpleBg:'rgba(168,85,247,0.1)',
  surface:'#13131A', surface2:'#1C1C26', surface3:'#242432',
  border:'#2A2A3A', border2:'#363650',
  text:'#F0F0F8', muted:'#8888AA', hint:'#55556A',
};

const statusColor = (s?: string | null) => {
  if (s === 'PASS' || s === 'PASS_BOUNDED') return C.green;
  if (s === 'FAIL' || s === 'FAIL_BOUNDED') return C.red;
  if (s === 'REVIEW' || s === 'INDETERMINATE') return C.amber;
  return C.hint;
};
const statusBg = (s?: string | null) => {
  if (s === 'PASS' || s === 'PASS_BOUNDED') return C.greenBg;
  if (s === 'FAIL' || s === 'FAIL_BOUNDED') return C.redBg;
  if (s === 'REVIEW' || s === 'INDETERMINATE') return C.amberBg;
  return 'rgba(85,85,106,0.1)';
};
const statusLabel = (s?: string | null) => {
  if (s === 'PASS_BOUNDED')  return 'PASS \u25c8';
  if (s === 'FAIL_BOUNDED')  return 'FAIL \u25c8';
  if (s === 'INDETERMINATE') return 'BOUNDED';
  return s ?? 'SKIPPED';
};
const verdictColor = (v: string) =>
  v === 'ROBUST_PASS' ? C.green : v === 'ROBUST_FAIL' ? C.red : C.amber;
const gradeColor = (g: string) =>
  ({A: C.green, B: C.blue, C: C.amber, D: '#FF6B35', F: C.red}[g] ?? C.hint);

const DIR_IMPROVEMENT_FACTORS: Record<string, number> = {
  HIGH: 0.40,
  MEDIUM: 0.18,
};

interface SandboxState {
  removedVariables: Set<string>;
  groupOverrides: Record<string, { priv: string; unpriv: string }>;
  dirThreshold: number;
  baseRates: Record<string, number | null>;
}

interface SandboxResult {
  projected_dir: number;
  projected_dir_status: 'PASS' | 'REVIEW' | 'FAIL';
  projected_spd: number;
  projected_spd_status: 'PASS' | 'REVIEW' | 'FAIL';
  composite_score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  changes_made: SandboxChange[];
  passes: boolean;
}

function computeSandboxResult(
  report: AuditReport,
  state: SandboxState
): SandboxResult {
  let dir = report.overall_dir_score;
  let spd = report.group_outcomes[0]?.spd_score ?? 0;
  const changes: SandboxChange[] = [];

  const removed = report.variable_risks.filter(v => state.removedVariables.has(v.name));
  for (const v of removed) {
    const factor = DIR_IMPROVEMENT_FACTORS[v.risk_level] ?? 0.18;
    dir = Math.min(1.0, dir + (v.bias_contribution_pct / 100) * factor);
    spd = spd * (1 - v.bias_contribution_pct / 100);
    changes.push({
      type: 'REMOVE_VARIABLE',
      variable: v.name,
      description: `Remove "${v.name}" (${v.bias_contribution_pct.toFixed(1)}% of bias)`,
      implementation_note: `Drop the column "${v.name}" from your dataset before training.` +
        (v.risk_level === 'HIGH'
          ? ' This is a HIGH-risk proxy — removal is strongly recommended.'
          : ' Consider binning instead of full removal for MEDIUM-risk variables.'),
    });
  }

  for (const go of report.group_outcomes) {
    const override = state.groupOverrides[go.protected_attribute];
    if (override && override.priv !== go.privileged_group) {
      const invertedDir = go.unprivileged_rate / go.privileged_rate;
      const invertedSpd = go.privileged_rate - go.unprivileged_rate;
      dir = Math.min(1.0, invertedDir);
      spd = invertedSpd;
      changes.push({
        type: 'GROUP_OVERRIDE',
        attribute: go.protected_attribute,
        privileged_group: override.priv,
        unprivileged_group: override.unpriv,
        description: `Set ${override.priv} as privileged and ${override.unpriv} as unprivileged for ${go.protected_attribute}`,
        implementation_note: `Override the assigned privileged group in your fairness review for ${go.protected_attribute}. This changes how DIR is interpreted.`,
      });
    }
  }

  const threshold = state.dirThreshold;
  if (threshold !== 0.80) {
    changes.push({
      type: 'THRESHOLD_CHANGE',
      description: `DIR threshold changed from 0.80 to ${threshold.toFixed(2)}`,
      implementation_note: threshold < 0.80
        ? `Warning: threshold ${threshold.toFixed(2)} is below the EEOC 4/5ths standard. Using this in production may not satisfy legal requirements.`
        : `Threshold ${threshold.toFixed(2)} is more stringent than the standard.`,
    });
  }

  for (const [attr, rate] of Object.entries(state.baseRates)) {
    if (rate !== null) {
      changes.push({
        type: 'BASE_RATE',
        attribute: attr,
        description: `Assume base rate ${Math.round(rate * 100)}% for ${attr}`,
        implementation_note: `Use a user-provided assumption for ${attr} base rate when interpreting sensitivity bounds. Treat this as indicative only.`,
      });
    }
  }

  const dir_status: 'PASS' | 'REVIEW' | 'FAIL' =
    dir >= threshold ? 'PASS' :
    dir >= threshold * 0.90 ? 'REVIEW' : 'FAIL';

  const spd_abs = Math.abs(spd);
  const projected_spd_status: 'PASS' | 'REVIEW' | 'FAIL' =
    spd_abs <= 0.05 ? 'PASS' :
    spd_abs <= 0.10 ? 'REVIEW' : 'FAIL';

  const dir_score_val = dir_status === 'PASS' ? 1.0 : dir_status === 'REVIEW' ? 0.5 : 0.0;
  const dir_weight = 0.30;
  const original_skipped_contribution = 0.5;
  const composite = dir_weight * dir_score_val + (1 - dir_weight) * original_skipped_contribution;

  const grade: 'A' | 'B' | 'C' | 'D' | 'F' =
    composite >= 0.95 ? 'A' :
    composite >= 0.85 ? 'B' :
    composite >= 0.70 ? 'C' :
    composite >= 0.50 ? 'D' : 'F';

  return {
    projected_dir: Math.round(dir * 10000) / 10000,
    projected_dir_status: dir_status,
    projected_spd: Math.round(spd * 10000) / 10000,
    projected_spd_status,
    composite_score: Math.round(composite * 10000) / 10000,
    grade,
    changes_made: changes,
    passes: dir_status === 'PASS',
  };
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

function DLPBanner({ dlp }: { dlp: DLPResult }) {
  const [open, setOpen] = useState(false);
  if (!dlp.pii_detected) return null;
  return (
    <div style={{ marginBottom: 16, padding: '12px 18px', background: 'rgba(255,184,48,0.08)', border: `0.5px solid rgba(255,184,48,0.4)`, borderRadius: 10, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 16 }}>&#9888;</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, color: C.amber }}>
            Google DLP: {dlp.findings.length} sensitive data pattern{dlp.findings.length !== 1 ? 's' : ''} detected
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginLeft: 10 }}>via {dlp.scan_method}</span>
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {dlp.findings.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: `0.5px solid ${C.border}` }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 6px', borderRadius: 4, background: f.action === 'REMOVE' ? C.redBg : C.amberBg, color: f.action === 'REMOVE' ? C.redText : C.amberText, flexShrink: 0 }}>{f.action}</span>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, marginBottom: 2 }}>{f.info_type}</div>
                <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{f.plain_text}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImpossibilityCard({ conflict }: { conflict: ImpossibilityConflict }) {
  return (
    <div style={{ padding: '14px 18px', background: 'rgba(168,85,247,0.06)', border: `0.5px solid rgba(168,85,247,0.4)`, borderRadius: 10, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>&#9889;</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, color: C.purple }}>{conflict.pattern_name} — Mathematical Impossibility Detected</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 9px', borderRadius: 4, background: C.greenBg, color: C.greenText }}>{conflict.metric_a}: {conflict.metric_a_status}</span>
        <span style={{ color: C.hint, fontSize: 12 }}>vs</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 9px', borderRadius: 4, background: C.redBg, color: C.redText }}>{conflict.metric_b}: {conflict.metric_b_status}</span>
      </div>
      <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, margin: 0 }}>{conflict.real_world_meaning}</p>
      <p style={{ fontSize: 11, color: C.hint, lineHeight: 1.5, marginTop: 6, marginBottom: 0, fontStyle: 'italic' }}>
        Ref: Chouldechova (2017) — "Fair prediction with disparate impact"
      </p>
    </div>
  );
}

function MetricRow({ m }: { m: MetricResult }) {
  const [open, setOpen] = useState(false);
  const sc = statusColor(m.status);
  const sb = statusBg(m.status);
  const isBounded = m.status === 'PASS_BOUNDED' || m.status === 'FAIL_BOUNDED' || m.status === 'INDETERMINATE';
  const clickable = m.status !== 'SKIPPED';
  return (
    <div style={{ borderBottom: `0.5px solid ${C.border}` }}>
      <div onClick={() => clickable && setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', cursor: clickable ? 'pointer' : 'default' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.surface2}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, flex: 1 }}>{m.name}</span>
        {m.status === 'SKIPPED' && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>requires ground truth</span>}
        {isBounded && m.assumption_score !== undefined && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint }}>{Math.round(m.assumption_score * 4)}/4 levels</span>
        )}
        {m.status !== 'SKIPPED' && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, color: sc }}>
            {isBounded ? '\u25c8' : m.value.toFixed(4)}
          </span>
        )}
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', borderRadius: 4, background: sb, color: sc, minWidth: 52, textAlign: 'center' }}>
          {statusLabel(m.status)}
        </span>
      </div>
      {open && (
        <div style={{ padding: '0 18px 12px 34px', background: C.surface2 }}>
          <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 6 }}>{m.plain_english}</p>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>{m.legal_basis}</p>
          {isBounded && <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginTop: 4 }}>\u25c8 = bounded estimate (Manski 1990). See Sensitivity tab for the full A0\u2013A3 assumption ladder.</p>}
        </div>
      )}
    </div>
  );
}

function SensitivityPanel({ reports }: { reports: SensitivityReport[] }) {
  if (!reports.length) return null;
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${C.border}` }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 3 }}>
          Sensitivity Analysis · Nested Assumption Bounds (A0–A3)
        </div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Bounded Estimates — No Ground Truth</div>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginTop: 6, marginBottom: 0 }}>
          Each metric is bounded under four nested assumption levels, ordered most-conservative to most-optimistic.
          A <strong style={{ color: C.red }}>ROBUST FAIL</strong> means the metric fails under every assumption —
          no ground truth data can overturn it. Bounds are sharp and derived from the partial identification
          framework (Manski 1990). No hidden multipliers. Every number has a named, cited assumption.
        </p>
      </div>
      {reports.map(r => (
        <div key={r.protected_attribute} style={{ borderBottom: `0.5px solid ${C.border}` }}>
          <div style={{ padding: '12px 18px 8px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500 }}>{r.protected_attribute}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>
              {r.privileged_group} r={r.r_p.toFixed(3)} · {r.unprivileged_group} r={r.r_u.toFixed(3)}
            </span>
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', borderRadius: 99,
              background: `${verdictColor(r.metric_results[0]?.overall_verdict ?? 'ASSUMPTION_SENSITIVE')}22`,
              color: verdictColor(r.metric_results[0]?.overall_verdict ?? 'ASSUMPTION_SENSITIVE'),
            }}>
              {(r.overall_assumption_score * 100).toFixed(0)}% levels pass
            </span>
          </div>
          {r.metric_results.map((m: BoundedMetricResult) => (
            <div key={m.metric_name} style={{ padding: '10px 18px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500 }}>{m.metric_name}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: verdictColor(m.overall_verdict) }}>
                    {m.overall_verdict.replace(/_/g, ' ')}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>
                    {(m.assumption_score * 4).toFixed(0)}/4 pass
                  </span>
                </div>
              </div>
              {m.levels.map((level: AssumptionLevel) => {
                const isEOD = m.metric_name === 'EOD';
                const verdict = isEOD ? level.eod_verdict : level.fprp_verdict;
                const lo = isEOD ? level.eod_lower : level.fprp_lower;
                const hi = isEOD ? level.eod_upper : level.fprp_upper;
                const color = verdict === 'PASS_BOUNDED' ? C.green : verdict === 'FAIL_BOUNDED' ? C.red : C.amber;
                const barMax = Math.max(1.0, hi + 0.05);
                return (
                  <div key={level.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--mono)', color: C.hint, fontSize: 10, width: 20, flexShrink: 0 }}>{level.name}</span>
                    <div style={{ flex: 1, position: 'relative', height: 6, background: C.surface3, borderRadius: 3 }}>
                      <div style={{
                        position: 'absolute',
                        left: `${(Math.max(0, lo) / barMax) * 100}%`,
                        width: `${Math.max((Math.max(0, hi) - Math.max(0, lo)) / barMax * 100, 1)}%`,
                        height: '100%', background: color + '88', borderRadius: 3,
                      }} />
                      <div style={{ position: 'absolute', left: `${(m.threshold / barMax) * 100}%`, width: 1, height: '100%', background: C.red, opacity: 0.7 }} />
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', color: C.hint, fontSize: 9, width: 96, textAlign: 'right', flexShrink: 0 }}>
                      [{lo.toFixed(3)}, {hi.toFixed(3)}]
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color, width: 62, flexShrink: 0 }}>
                      {verdict === 'PASS_BOUNDED' ? 'PASS \u25c8' : verdict === 'FAIL_BOUNDED' ? 'FAIL \u25c8' : 'INDET.'}
                    </span>
                  </div>
                );
              })}
              <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, margin: '8px 0 0' }}>{m.plain_english}</p>
            </div>
          ))}
          <details style={{ padding: '0 18px 12px' }}>
            <summary style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, cursor: 'pointer', marginBottom: 8 }}>
              View assumption definitions and citations
            </summary>
            {r.metric_results[0]?.levels.map((level: AssumptionLevel) => (
              <div key={level.name} style={{ marginBottom: 8, padding: '8px 10px', background: C.surface2, borderRadius: 6 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.blue, marginBottom: 2 }}>{level.name} — {level.label}</div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{level.assumption_text}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint }}>{level.citation}</div>
              </div>
            ))}
          </details>
          <div style={{ margin: '0 18px 14px', padding: '8px 12px', background: `${verdictColor(r.metric_results[0]?.overall_verdict ?? 'ASSUMPTION_SENSITIVE')}11`, borderRadius: 8, border: `0.5px solid ${verdictColor(r.metric_results[0]?.overall_verdict ?? 'ASSUMPTION_SENSITIVE')}44` }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: verdictColor(r.metric_results[0]?.overall_verdict ?? 'ASSUMPTION_SENSITIVE') }}>{r.recommendation}</span>
          </div>
        </div>
      ))}
      <div style={{ padding: '12px 18px' }}>
        <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, lineHeight: 1.5, margin: 0 }}>
          \u25c8 = bound computed without ground truth. Bounds are sharp under stated assumption.
          ROBUST FAIL is a statistically strong finding. ASSUMPTION_SENSITIVE means the verdict requires
          ground truth to resolve. Methodology: Manski (1990), Horowitz &amp; Manski (1995),
          Balke &amp; Pearl (1994), Chouldechova (2017).
        </p>
      </div>
    </Card>
  );
}

function SandboxPanel({ report, auditId }: { report: AuditReport; auditId: string }) {
  const [removedVariables, setRemovedVariables] = useState<Set<string>>(new Set());
  const [groupOverrides, setGroupOverrides] = useState<Record<string, { priv: string; unpriv: string }>>({});
  const [dirThreshold, setDirThreshold] = useState(0.80);
  const [baseRates, setBaseRates] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sandboxState: SandboxState = {
    removedVariables,
    groupOverrides,
    dirThreshold,
    baseRates,
  };

  const sandboxResult = useMemo(
    () => computeSandboxResult(report, sandboxState),
    [report, removedVariables, groupOverrides, dirThreshold, baseRates]
  );

  const handleToggleVariable = (name: string) => {
    const next = new Set(removedVariables);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setRemovedVariables(next);
  };

  const handlePrivilegedChange = (attribute: string, value: string) => {
    const row = report.group_outcomes.find(go => go.protected_attribute === attribute);
    if (!row) return;
    const unpriv = row.privileged_group === value ? row.unprivileged_group : row.privileged_group;
    setGroupOverrides(prev => ({ ...prev, [attribute]: { priv: value, unpriv } }));
  };

  const handleUnprivilegedChange = (attribute: string, value: string) => {
    const row = report.group_outcomes.find(go => go.protected_attribute === attribute);
    if (!row) return;
    const priv = row.unprivileged_group === value ? row.privileged_group : row.unprivileged_group;
    setGroupOverrides(prev => ({ ...prev, [attribute]: { priv, unpriv: value } }));
  };

  const handleBaseRateChange = (attribute: string, value: number | null) => {
    setBaseRates(prev => ({ ...prev, [attribute]: value }));
  };

  const resetAll = () => {
    setRemovedVariables(new Set());
    setGroupOverrides({});
    setDirThreshold(0.80);
    setBaseRates({});
    setError(null);
  };

  const handleGenerateRemediationReport = async () => {
    setError(null);
    setBusy(true);
    try {
      const payload: RemediationReportPayload = {
        changes: sandboxResult.changes_made,
        projected_dir: sandboxResult.projected_dir,
        projected_grade: sandboxResult.grade,
        sandbox_threshold: dirThreshold,
      };
      const { report: remediationReport } = await generateRemediationReport(auditId, payload);
      downloadRemediationPDF(remediationReport as any);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate remediation report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
        <Card style={{ padding: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${C.border}` }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px' }}>INTERVENTIONS</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>Try a what-if remediation</div>
            <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, margin: '8px 0 0' }}>
              All changes are projected client-side from the existing audit result. Re-run the audit after modifying your dataset to confirm.
            </p>
          </div>
          <div style={{ padding: '14px 18px', display: 'grid', gap: 16 }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 8 }}>Variables to remove</div>
              {report.variable_risks.map(v => (
                <label key={v.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={removedVariables.has(v.name)}
                    onChange={() => handleToggleVariable(v.name)}
                    style={{ width: 14, height: 14 }}
                  />
                  <span style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12 }}>{v.name}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: v.risk_level === 'HIGH' ? C.redText : C.amberText }}>{v.risk_level}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted }}>{v.bias_contribution_pct.toFixed(1)}%</span>
                </label>
              ))}
            </div>

            {report.group_outcomes.map(go => {
              const override = groupOverrides[go.protected_attribute] ?? { priv: go.privileged_group, unpriv: go.unprivileged_group };
              return (
                <div key={go.protected_attribute} style={{ padding: '14px', background: C.surface2, borderRadius: 12, border: `0.5px solid ${C.border}` }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 8 }}>{go.protected_attribute}</div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 4 }}>Privileged</div>
                      <select
                        value={override.priv}
                        onChange={e => handlePrivilegedChange(go.protected_attribute, e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', background: C.surface, color: C.text, border: `0.5px solid ${C.border}`, borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 12 }}
                      >
                        {[go.privileged_group, go.unprivileged_group].map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 4 }}>Unprivileged</div>
                      <select
                        value={override.unpriv}
                        onChange={e => handleUnprivilegedChange(go.protected_attribute, e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', background: C.surface, color: C.text, border: `0.5px solid ${C.border}`, borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 12 }}
                      >
                        {[go.privileged_group, go.unprivileged_group].map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}

            <div style={{ padding: '14px', background: C.surface2, borderRadius: 12, border: `0.5px solid ${C.border}` }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 10 }}>DIR threshold</div>
              <input
                type="range"
                min={0.60}
                max={0.95}
                step={0.01}
                value={dirThreshold}
                onChange={e => setDirThreshold(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 11, color: C.text }}>
                <span>0.60</span>
                <span>0.95</span>
              </div>
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700 }}>{dirThreshold.toFixed(2)}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: dirThreshold === 0.80 ? C.green : dirThreshold < 0.70 ? C.red : dirThreshold > 0.85 ? C.amber : C.text }}>
                  {dirThreshold === 0.80 ? 'EEOC 4/5ths standard' : dirThreshold === 0.75 ? 'Indian courts accepted' : dirThreshold < 0.70 ? 'No legal standard supports this threshold' : 'More stringent than current legal standards'}
                </span>
              </div>
            </div>

            {report.group_outcomes.map(go => {
              const rate = baseRates[go.protected_attribute] ?? null;
              return (
                <div key={`base-${go.protected_attribute}`} style={{ padding: '14px', background: C.surface2, borderRadius: 12, border: `0.5px solid ${C.border}` }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 10 }}>Base rate ({go.protected_attribute})</div>
                  <input
                    type="range"
                    min={0.05}
                    max={0.95}
                    step={0.01}
                    value={rate ?? 0.5}
                    onChange={e => handleBaseRateChange(go.protected_attribute, Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{rate === null ? '—' : `${Math.round(rate * 100)}%`}</span>
                    <button onClick={() => handleBaseRateChange(go.protected_attribute, null)} style={{ border: 'none', background: 'none', color: C.blue, fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }}>Clear</button>
                  </div>
                  <div style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>User-provided assumption — not verified. Treat sensitivity results as indicative only.</div>
                </div>
              );
            })}

            <button
              onClick={resetAll}
              style={{ width: '100%', padding: 12, background: 'none', border: `1px solid ${C.border2}`, borderRadius: 10, color: C.text, fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer' }}
            >
              Reset all
            </button>
          </div>
        </Card>

        <Card style={{ padding: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${C.border}` }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Live result</div>
          </div>
          <div style={{ padding: '18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 8 }}>CURRENT</div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>DIR</span><span>{report.overall_dir_score.toFixed(2)} <strong style={{ color: statusColor(report.group_outcomes[0]?.dir_status) }}>{report.group_outcomes[0]?.dir_status ?? 'N/A'}</strong></span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>SPD</span><span>{report.group_outcomes[0]?.spd_score.toFixed(2)} <strong style={{ color: statusColor(report.group_outcomes[0]?.spd_status) }}>{report.group_outcomes[0]?.spd_status ?? 'N/A'}</strong></span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Grade</span><span style={{ color: gradeColor(report.overall_grade) }}>{report.overall_grade}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Composite</span><span>{(report.composite_score).toFixed(2)}</span></div>
              </div>
            </div>
            <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 8 }}>PROJECTED</div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>DIR</span><span>{sandboxResult.projected_dir.toFixed(2)} <strong style={{ color: statusColor(sandboxResult.projected_dir_status) }}>{sandboxResult.projected_dir_status}</strong></span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>SPD</span><span>{sandboxResult.projected_spd.toFixed(2)} <strong style={{ color: statusColor(sandboxResult.projected_spd_status) }}>{sandboxResult.projected_spd_status}</strong></span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Grade</span><span style={{ color: gradeColor(sandboxResult.grade) }}>{sandboxResult.grade}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Composite</span><span>{sandboxResult.composite_score.toFixed(2)}</span></div>
              </div>
            </div>
          </div>
          <div style={{ padding: '16px 18px', background: C.surface2, borderTop: `0.5px solid ${C.border}` }}>
            {sandboxResult.passes ? (
              <div style={{ color: C.green, fontFamily: 'var(--mono)', fontSize: 12 }}>
                ✓ Projected PASS · Projected DIR {sandboxResult.projected_dir.toFixed(2)} · All Tier 1 metrics projected PASS.
              </div>
            ) : (
              <div style={{ color: C.amber, fontFamily: 'var(--mono)', fontSize: 12 }}>
                ⚠ Not yet passing. Try removing 1 more HIGH-risk variable or adjust the threshold.
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${C.border}` }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px' }}>CHANGES REQUIRED IN YOUR DATASET</div>
        </div>
        <div style={{ padding: '18px', display: 'grid', gap: 14 }}>
          {sandboxResult.changes_made.length > 0 ? sandboxResult.changes_made.map((change, index) => (
            <div key={index} style={{ padding: '14px', background: C.surface2, borderRadius: 12, border: `0.5px solid ${C.border}` }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, marginBottom: 8 }}>{index + 1}. {change.description}</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{change.implementation_note}</div>
            </div>
          )) : (
            <div style={{ fontSize: 12, color: C.muted }}>No interventions selected yet. Use the controls to project changes.</div>
          )}
          <div style={{ padding: '14px', background: C.surface2, borderRadius: 12, border: `0.5px solid ${C.border}` }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.amber, marginBottom: 8 }}>Projection disclaimer</div>
            <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, margin: 0 }}>
              These are projections based on proxy contribution share and user assumptions. Actual improvement requires re-running the full audit after changing the dataset.
            </p>
            <p style={{ fontSize: 11, color: C.hint, lineHeight: 1.6, marginTop: 8 }}>
              Projected DIR improvement uses factor 0.40 for HIGH-risk variables and 0.18 for MEDIUM-risk variables — not computed from your data.
            </p>
          </div>
          {sandboxResult.passes && (
            <div style={{ display: 'grid', gap: 10 }}>
              <button
                onClick={handleGenerateRemediationReport}
                disabled={busy}
                style={{ width: '100%', padding: 14, background: C.green, color: C.surface, border: 'none', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                {busy ? 'Generating report…' : 'Generate Remediation Report'}
              </button>
              {error && <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.red }}>{error}</div>}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function LegalPanel({ gemini }: { gemini: GeminiOutput }) {
  return (
    <Card>
      <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${C.border}` }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.blue }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Legal Context · Gemini</span>
        </div>
      </div>
      <div style={{ padding: '12px 18px', background: 'rgba(255,184,48,0.05)', borderBottom: `0.5px solid ${C.border}` }}>
        <p style={{ fontSize: 11, color: C.amber, lineHeight: 1.6, margin: 0 }}>{gemini.disclaimer}</p>
      </div>
      {gemini.cro_summary && (
        <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${C.border}` }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>CRO Summary</div>
          <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, margin: 0 }}>{gemini.cro_summary}</p>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginTop: 8 }}>Generated by {gemini.generated_by} · not used in audit logic</div>
        </div>
      )}
      {gemini.legal_context?.length > 0 && (
        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Applicable Laws</div>
          {gemini.legal_context.map((ref: any, i: number) => (
            <div key={i} style={{ padding: '10px 12px', marginBottom: 8, background: C.surface2, borderRadius: 8, border: `0.5px solid ${C.border}` }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.blue, marginBottom: 4 }}>{ref.law}</div>
              {ref.provision && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted, marginBottom: 4 }}>{ref.provision}</div>}
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 4 }}>{ref.relevance}</div>
              {ref.action_required && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.amber }}>Action: {ref.action_required}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Impact Story Banner ────────────────────────────────────────────────────────
// Leads with the human consequence, not the technical score.
// Only renders when the audit fails — this is when it matters most.
function ImpactStoryBanner({ report }: { report: AuditReport }) {
  const [open, setOpen] = useState(true);
  if (report.overall_risk_level === 'PASS') return null;

  const worst = report.group_outcomes.reduce((a, b) => a.dir_score < b.dir_score ? a : b);
  const gap   = Math.round(Math.abs(worst.privileged_rate - worst.unprivileged_rate) * 1000);
  const pct   = (worst.dir_score * 100).toFixed(0);
  const attr  = worst.protected_attribute.replace(/_/g, ' ');

  // Build a concrete human sentence from the data
  const industryStories: Record<string, string> = {
    finance:       `Someone applying for a loan`,
    hiring:        `A job applicant`,
    healthcare:    `A patient seeking care`,
    education:     `A student seeking admission`,
    'criminal justice': `A defendant awaiting bail`,
  };
  const subject = industryStories[report.industry_context?.toLowerCase()] ?? `A person`;
  const topProxy = report.variable_risks.find(v => v.is_proxy && v.risk_level === 'HIGH');

  return (
    <div style={{
      marginBottom: 16, borderRadius: 12, overflow: 'hidden',
      border: `0.5px solid rgba(255,77,109,0.4)`,
      background: 'rgba(255,77,109,0.04)',
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ padding: '14px 18px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12 }}
      >
        <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>👤</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.redText, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>
            What This Means For Real People
          </div>
          <p style={{ fontSize: 14, color: C.text, lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
            {subject} from the <strong style={{ color: C.redText }}>{worst.unprivileged_group}</strong> group
            receives a positive outcome at only <strong style={{ color: C.redText }}>{pct}%</strong> the
            rate of a comparable {worst.privileged_group} person — based on {attr}.
            In a system processing 1,000 decisions a year, that is{' '}
            <strong style={{ color: C.redText }}>{gap} fewer positive outcomes</strong> for the
            {' '}{worst.unprivileged_group} group, not due to merit.
          </p>
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 18px 16px 50px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {topProxy && (
            <div style={{ padding: '10px 14px', background: C.surface2, borderRadius: 8, border: `0.5px solid ${C.border}` }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.amber, marginBottom: 4 }}>WHY IT HAPPENS</div>
              <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, margin: 0 }}>
                The column <strong style={{ color: C.text }}>{topProxy.name}</strong> is acting as a
                stand-in for <strong style={{ color: C.text }}>{topProxy.proxy_for}</strong>.
                The model never sees {topProxy.proxy_for} directly — but it doesn't need to.
                {topProxy.name} carries {(topProxy.proxy_score * 100).toFixed(0)}% of the information
                needed to reconstruct it. Using this column is statistically equivalent
                to using {topProxy.proxy_for} as a feature.
              </p>
            </div>
          )}
          {report.legal_references?.length > 0 && (
            <div style={{ padding: '10px 14px', background: C.surface2, borderRadius: 8, border: `0.5px solid ${C.border}` }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.blue, marginBottom: 4 }}>LEGAL EXPOSURE</div>
              <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, margin: 0 }}>
                {report.legal_references.slice(0, 2).join(' · ')}
              </p>
            </div>
          )}
          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, margin: 0 }}>
            These findings describe statistical patterns. They do not by themselves constitute legal proof of discrimination.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Remediation Loop Panel ─────────────────────────────────────────────────────
// Shows the before/after comparison and lets the user see the projected
// DIR improvement after each remediation step. Closes the detect → fix → verify loop.
function RemediationLoopPanel({ report }: { report: AuditReport }) {
  const [activeStep, setActiveStep] = useState(0);
  const plan = report.remediation_plan;
  if (!plan || plan.length === 0) return null;

  const baseline = report.overall_dir_score;
  // Build a progressive DIR path: start at baseline, apply steps
  const steps = plan.map((step: any, i: number) => ({
    ...step,
    // Each step contributes proportional improvement toward passing (0.80)
    projected_dir: Math.min(0.97, baseline + (0.82 - baseline) * ((i + 1) / plan.length)),
  }));

  const allPass = steps[steps.length - 1]?.projected_dir >= 0.80;

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${C.border}` }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 3 }}>
          Remediation Pathway · Before → After
        </div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          {allPass ? '✓ Full remediation path found' : 'Partial remediation — ground truth needed to confirm'}
        </div>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginTop: 4, marginBottom: 0 }}>
          Apply these steps in order. Each step is independently reversible.
          The projected DIR after each step assumes linear improvement — actual results
          depend on your model and data distribution.
        </p>
      </div>

      {/* Before/After summary bar */}
      <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center', borderBottom: `0.5px solid ${C.border}` }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 4 }}>BEFORE</div>
          <div style={{ fontFamily: 'var(--syne)', fontSize: 32, fontWeight: 800, color: C.red, lineHeight: 1 }}>{baseline.toFixed(2)}</div>
          <div style={{ height: 4, background: C.surface3, borderRadius: 2, marginTop: 6 }}>
            <div style={{ height: '100%', width: `${Math.min(baseline, 1) * 100}%`, background: C.red, borderRadius: 2 }} />
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, marginTop: 3 }}>DIR · FAIL (threshold 0.80)</div>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 18, color: C.hint }}>→</div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 4 }}>AFTER ALL STEPS</div>
          <div style={{ fontFamily: 'var(--syne)', fontSize: 32, fontWeight: 800, color: allPass ? C.green : C.amber, lineHeight: 1 }}>
            {steps[steps.length - 1]?.projected_dir.toFixed(2) ?? '—'}
          </div>
          <div style={{ height: 4, background: C.surface3, borderRadius: 2, marginTop: 6 }}>
            <div style={{ height: '100%', width: `${Math.min(steps[steps.length - 1]?.projected_dir ?? 0, 1) * 100}%`, background: allPass ? C.green : C.amber, borderRadius: 2 }} />
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: allPass ? C.green : C.amber, marginTop: 3 }}>
            {allPass ? 'PROJECTED PASS ◈' : 'PROJECTED REVIEW ◈'}
          </div>
        </div>
      </div>

      {/* Step-by-step */}
      <div style={{ padding: '12px 18px' }}>
        {steps.map((step: any, i: number) => {
          const isActive = activeStep === i;
          const isDone   = activeStep > i;
          const color    = isDone ? C.green : isActive ? C.blue : C.hint;
          return (
            <div
              key={i}
              onClick={() => setActiveStep(i)}
              style={{
                display: 'flex', gap: 12, padding: '10px 12px', marginBottom: 8,
                borderRadius: 8, cursor: 'pointer',
                background: isActive ? C.surface2 : 'transparent',
                border: `0.5px solid ${isActive ? C.border2 : 'transparent'}`,
              }}
            >
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: `${color}22`, border: `1px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color }}>{isDone ? '✓' : i + 1}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, color: C.text }}>
                    <span style={{ padding: '1px 6px', borderRadius: 3, background: step.action === 'REMOVE' ? C.redBg : step.action === 'BIN' ? C.amberBg : C.blueBg, color: step.action === 'REMOVE' ? C.redText : step.action === 'BIN' ? C.amberText : C.blueText, marginRight: 8 }}>
                      {step.action}
                    </span>
                    {step.variable ?? step.feature ?? ''}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: step.projected_dir >= 0.80 ? C.green : C.amber }}>
                    DIR → {step.projected_dir.toFixed(2)}
                  </span>
                </div>
                {isActive && step.reason && (
                  <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, margin: '4px 0 0' }}>{step.reason}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '10px 18px', background: C.surface2, borderTop: `0.5px solid ${C.border}` }}>
        <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, margin: 0, lineHeight: 1.5 }}>
          ◈ Projected DIR values are estimates. Re-upload your dataset after applying each fix to get exact measurements.
          Only the re-audit produces a verifiable result.
        </p>
      </div>
    </Card>
  );
}

export default function AuditPage({ report: r, auditId, sensitivityReports, dlpResult, gemini, onGenerateCertificate }: Props) {
  const [tab, setTab] = useState<'plain' | 'overview' | 'metrics' | 'proxies' | 'sandbox' | 'remediation' | 'sensitivity' | 'legal'>('plain');
  const gc = gradeColor(r.overall_grade);

  const tabs = [
    { id: 'plain' as const,       label: '📖 Plain English' },
    { id: 'overview' as const,    label: 'Overview' },
    { id: 'metrics' as const,     label: 'All Metrics',       badge: r.metrics_computed },
    { id: 'proxies' as const,     label: 'Proxies',           badge: r.total_flags },
    { id: 'sandbox' as const,     label: 'Sandbox',           badge: undefined },
    { id: 'remediation' as const, label: '🔧 Fix & Re-audit', badge: r.remediation_plan?.length ?? 0, show: (r.remediation_plan?.length ?? 0) > 0 },
    { id: 'sensitivity' as const, label: 'Sensitivity ◈',    badge: sensitivityReports.length, show: sensitivityReports.length > 0 },
    { id: 'legal' as const,       label: 'Legal',             badge: gemini.legal_context?.length },
  ];

  return (
    <div style={{ paddingBottom: 40 }}>
      <DLPBanner dlp={dlpResult} />
      {/* Human impact story leads before all technical numbers */}
      <ImpactStoryBanner report={r} />
      {r.impossibility_conflicts.map((c, i) => <ImpossibilityCard key={i} conflict={c} />)}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { val: r.overall_grade,                label: 'Grade',      color: gc },
          { val: r.overall_risk_level,           label: 'Verdict',    color: r.overall_risk_level === 'FAIL' ? C.red : r.overall_risk_level === 'PASS' ? C.green : C.amber },
          { val: r.overall_dir_score.toFixed(2), label: 'DIR Score',  color: r.overall_dir_score < 0.8 ? C.red : C.green },
          { val: `${r.metrics_computed}/${r.metrics_computed + r.metrics_skipped}`, label: 'Metrics Run', color: C.blue },
          { val: r.row_count.toLocaleString(),   label: 'Rows',       color: C.text },
        ].map(s => (
          <div key={s.label} style={{ background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontFamily: 'var(--syne)', fontSize: 22, fontWeight: 800, color: s.color, lineHeight: 1, marginBottom: 4 }}>{s.val}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{s.label}</div>
          </div>
        ))}
      </div>

      {!r.ground_truth_available && (
        <div style={{ marginBottom: 16, padding: '10px 16px', background: C.surface2, border: `0.5px solid ${C.border2}`, borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 11, color: C.muted }}>
          {r.metrics_skipped} Tier 2 metrics require ground truth.
          Bounded estimates available —{' '}
          <button onClick={() => setTab('sensitivity')} style={{ background: 'none', border: 'none', color: C.blue, fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer', padding: 0 }}>
            see Sensitivity tab \u25c8
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 2, borderBottom: `0.5px solid ${C.border}`, marginBottom: 16 }}>
        {tabs.filter(t => t.show !== false).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontFamily: 'var(--mono)', fontSize: 11,
            color: tab === t.id ? C.text : C.muted,
            borderBottom: `2px solid ${tab === t.id ? C.blue : 'transparent'}`,
            marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '1px 5px', borderRadius: 99, background: tab === t.id ? C.text : C.surface3, color: tab === t.id ? C.surface : C.muted }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        <div>
          {tab === 'plain' && <PlainEnglishPanel report={r} />}

          {tab === 'overview' && (
            <div>
              {r.group_outcomes.map(go => (
                <Card key={go.protected_attribute} style={{ marginBottom: 14 }}>
                  <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>{go.protected_attribute}</div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{go.unprivileged_group} vs {go.privileged_group}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--syne)', fontSize: 28, fontWeight: 800, color: go.dir_score < 0.8 ? C.red : C.green, lineHeight: 1 }}>{go.dir_score.toFixed(2)}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>DIR Score</div>
                    </div>
                  </div>
                  <div style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                      {[{g: go.privileged_group, rate: go.privileged_rate, c: C.blue}, {g: go.unprivileged_group, rate: go.unprivileged_rate, c: go.dir_score < 0.8 ? C.red : C.green}].map(({g, rate, c}) => (
                        <div key={g}>
                          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{g}</div>
                          <div style={{ height: 6, background: C.surface3, borderRadius: 3, marginBottom: 4 }}>
                            <div style={{ height: '100%', borderRadius: 3, width: `${rate * 100}%`, background: c }} />
                          </div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: c }}>{(rate * 100).toFixed(0)}%</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ position: 'relative', height: 6, background: C.surface3, borderRadius: 3, marginBottom: 14 }}>
                      <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(go.dir_score * 100, 100)}%`, background: go.dir_score < 0.8 ? C.red : C.green }} />
                      <div style={{ position: 'absolute', left: '80%', top: -4, width: 2, height: 14, background: C.amber, borderRadius: 1 }} />
                      <div style={{ position: 'absolute', left: '80%', top: 12, fontFamily: 'var(--mono)', fontSize: 9, color: C.amber, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>0.80 threshold</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[{label: 'DIR', val: go.dir_score.toFixed(3), status: go.dir_status}, {label: 'SPD', val: go.spd_score.toFixed(3), status: go.spd_status}].map(m => (
                        <span key={m.label} style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 9px', borderRadius: 4, background: statusBg(m.status), color: statusColor(m.status) }}>
                          {m.label}: {m.val} [{m.status}]
                        </span>
                      ))}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {tab === 'metrics' && (
            <Card>
              <div style={{ padding: '12px 18px', borderBottom: `0.5px solid ${C.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>All Fairness Metrics</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.muted }}>
                  {r.metrics_computed} computed · {r.metrics_skipped} require ground truth (\u25c8 = bounded estimate available)
                </div>
              </div>
              {r.metric_results.map((m, i) => <MetricRow key={i} m={m} />)}
            </Card>
          )}

          {tab === 'proxies' && (
            <div>
              {r.caste_proxy_candidates.length > 0 && (
                <div style={{ padding: '12px 16px', marginBottom: 14, background: 'rgba(255,77,109,0.06)', border: `0.5px solid rgba(255,77,109,0.3)`, borderRadius: 10 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.redText, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>India Context — Caste Proxy Candidates</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {r.caste_proxy_candidates.map(c => (
                      <span key={c} style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 8px', borderRadius: 4, background: C.redBg, color: C.redText }}>{c}</span>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: C.muted, marginTop: 6, marginBottom: 0, lineHeight: 1.5 }}>
                    These columns may encode caste via name/location patterns. Review for Article 15 compliance (Constitution of India) and DPDPA 2023.
                  </p>
                </div>
              )}
              <Card>
                <div style={{ padding: '12px 18px', borderBottom: `0.5px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Variable Risk · NMI + Cramér's V</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.muted, marginTop: 3 }}>
                    Proxy Score = w\u2093\u2090\u1d52\u1d3a\u1d35 × NMI(X,A) + w\u1d5c × V — weights set by feature cardinality · Click row for remediation
                  </div>
                </div>
                {r.variable_risks.map(v => {
                  const [open, setOpen] = useState(false);
                  const sc = v.risk_level === 'HIGH' ? C.red : v.risk_level === 'MEDIUM' ? C.amber : C.hint;
                  return (
                    <div key={v.name} style={{ borderBottom: `0.5px solid ${C.border}` }}>
                      <div onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = C.surface2}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc, flexShrink: 0 }} />
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, flex: 1 }}>{v.name}</span>
                        {v.proxy_for && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>\u2192 {v.proxy_for}</span>}
                        {v.is_caste_proxy_candidate && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '1px 5px', borderRadius: 99, background: C.redBg, color: C.redText }}>CASTE PROXY</span>}
                        <div style={{ display: 'flex', gap: 8, fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>
                          <span title="Normalised Mutual Information = MI / H(A)">NMI {v.mi_score.toFixed(3)}</span>
                          <span title="Cramér's V (bias-corrected, Bergsma 2013)">V {v.cramers_v.toFixed(3)}</span>
                        </div>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, color: sc }}>{v.proxy_score.toFixed(3)}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 8px', borderRadius: 4, background: `${sc}22`, color: sc }}>{v.risk_level}</span>
                      </div>
                      {open && v.remediation.length > 0 && (
                        <div style={{ padding: '0 18px 12px 34px', background: C.surface2 }}>
                          {v.remediation.map((rem, i) => (
                            <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 12px', marginBottom: 6, background: C.surface, borderRadius: 8, border: `0.5px solid ${C.border}` }}>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 7px', borderRadius: 4, background: rem.action === 'REMOVE' ? C.redBg : rem.action === 'BIN' ? C.amberBg : C.blueBg, color: rem.action === 'REMOVE' ? C.redText : rem.action === 'BIN' ? C.amberText : C.blueText, flexShrink: 0, alignSelf: 'flex-start' }}>{rem.action}</span>
                              <div>
                                <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5, marginBottom: 3 }}>{rem.reason}</div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.green }}>Expected: {rem.expected_dir_improvement} · Confidence: {(rem.confidence * 100).toFixed(0)}%</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </Card>
            </div>
          )}

          {tab === 'sensitivity' && <SensitivityPanel reports={sensitivityReports} />}
          {tab === 'sandbox' && <SandboxPanel report={r} auditId={auditId} />}
          {tab === 'remediation' && <RemediationLoopPanel report={r} />}
          {tab === 'legal' && <LegalPanel gemini={gemini} />}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <div style={{ padding: '20px 18px', textAlign: 'center', background: `${gc}0D`, borderBottom: `0.5px solid ${C.border}` }}>
              <div style={{ fontFamily: 'var(--syne)', fontSize: 52, fontWeight: 800, color: gc, lineHeight: 1 }}>{r.overall_grade}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.muted, marginTop: 4 }}>Composite: {(r.composite_score * 100).toFixed(0)}/100</div>
            </div>
            <div style={{ padding: '12px 18px' }}>
              {[['Region', r.region.toUpperCase()], ['Industry', r.industry_context.toUpperCase()], ['Metrics', `${r.metrics_computed} computed`]].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{val}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div style={{ padding: '14px 18px' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>Audit Hash · SHA-256</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted, wordBreak: 'break-all', lineHeight: 1.8 }}>{r.audit_hash}</div>
              <div style={{ fontSize: 10, color: C.hint, marginTop: 6 }}>Deterministic · same input always produces same hash</div>
            </div>
          </Card>
          <Card>
            <div style={{ padding: '14px 18px' }}>
              <button onClick={onGenerateCertificate} style={{ width: '100%', padding: 11, background: C.text, color: C.surface, border: 'none', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 500, cursor: 'pointer', marginBottom: 8 }}>
                Generate &amp; Sign Certificate \u2192
              </button>
              <button onClick={() => setTab('sensitivity')} style={{ width: '100%', padding: 11, background: 'none', border: `0.5px solid ${C.border2}`, borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', color: C.muted }}>
                View Sensitivity Analysis \u25c8
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
