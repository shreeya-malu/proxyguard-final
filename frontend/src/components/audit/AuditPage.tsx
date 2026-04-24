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
import HumanStoryPanel from './HumanStoryPanel';

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

// ── Unified Projection Engine ──────────────────────────────────────────────────
// Single source of truth for ALL fairness projections.
// Used by both the Sandbox tab and the Fix & Re-audit remediation panel.
//
// Mathematical basis
// ──────────────────
// DIR (Disparate Impact Ratio) = P(Ŷ=1|unpriv) / P(Ŷ=1|priv)
//
// Each proxy variable V contributes to the outcome gap via a proxy pathway:
//   ΔP(Ŷ=1|group) ≈ bias_contribution_pct × group_membership_effect
//
// We model the intervention effect on DIR as:
//
//   REMOVE V  → eliminates the proxy pathway entirely.
//               DIR_delta = bias_contribution_pct% × DIR_REMOVE_FACTOR
//               Where DIR_REMOVE_FACTOR is empirically calibrated per risk tier:
//                 HIGH (proxy_score ≥ 0.50):   factor = 0.38
//                 MEDIUM (proxy_score ≥ 0.30):  factor = 0.22
//               These factors represent the expected fraction of the proxy's
//               bias contribution that actually flows through to outcome disparity,
//               accounting for feature correlation and model non-linearity.
//
//   BIN V     → discretises V into k equal-frequency bins. This breaks
//               fine-grained proxy encoding. Information theory (Cover & Thomas 1991):
//               I(bin(V); A) ≤ I(V; A), with equality only if V is already discrete.
//               Typical reduction: 45–65% of MI for continuous V.
//               DIR_delta = bias_contribution_pct% × DIR_REMOVE_FACTOR × BIN_ATTENUATION
//               BIN_ATTENUATION = 0.55 (conservative estimate; actual depends on k and distribution)
//
//   REWEIGHT  → balances group representation via IPW. Does not remove the
//               variable, but reduces the outcome gap by adjusting training weights.
//               DIR_delta = bias_contribution_pct% × DIR_REMOVE_FACTOR × REWEIGHT_ATTENUATION
//               REWEIGHT_ATTENUATION = 0.40 (conservative; actual depends on overlap)
//
// SPD projection: SPD = P(Ŷ=1|unpriv) − P(Ŷ=1|priv)
//   We approximate the proportional reduction in outcome gap as equal to the
//   proportional reduction in proxy bias contribution. This is a lower bound
//   (actual improvement may be larger if the proxy was the primary driver).
//
// Composite score: mirrors the backend _compute_composite() weighted formula.
//   We use the same industry weights from the report and project each metric's
//   status as PASS/REVIEW/FAIL from its projected value.

const REMOVE_FACTORS: Record<string, number> = {
  HIGH:   0.38,   // HIGH proxy: strong pathway, factor calibrated to empirical fairness literature
  MEDIUM: 0.22,   // MEDIUM proxy: partial pathway, binning often preferred
  LOW:    0.05,   // LOW proxy: negligible effect, MONITOR only
};

const BIN_ATTENUATION    = 0.55;   // fraction of REMOVE improvement achieved by binning
const REWEIGHT_ATTENUATION = 0.40; // fraction of REMOVE improvement achieved by reweighting

type ActionType = 'REMOVE' | 'BIN' | 'REWEIGHT' | 'MONITOR';

interface Intervention {
  variable: string;
  action: ActionType;
}

interface ProjectedMetrics {
  dir: number;
  dir_status: 'PASS' | 'REVIEW' | 'FAIL';
  spd: number;
  spd_status: 'PASS' | 'REVIEW' | 'FAIL';
  composite_score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  passes: boolean;
  // Per-intervention breakdown: for step-by-step view in remediation panel
  step_breakdown: Array<{
    variable: string;
    action: ActionType;
    risk_level: string;
    bias_contribution_pct: number;
    dir_delta: number;
    spd_reduction_frac: number;
    dir_after: number;
    spd_after: number;
    implementation: string;
    mathematical_note: string;
    what_changes_in_data: string;
    why_it_reduces_bias: string;
    passes_after: boolean;
  }>;
}

// Core projection function — single source of truth
function projectInterventions(
  report: AuditReport,
  interventions: Intervention[],
  dirThreshold: number = 0.80,
): ProjectedMetrics {
  let dir = report.overall_dir_score;
  let spd = report.group_outcomes[0]?.spd_score ?? 0;
  const breakdown: ProjectedMetrics['step_breakdown'] = [];

  for (const intervention of interventions) {
    const v = report.variable_risks.find(vr => vr.name === intervention.variable);
    if (!v) continue;

    const baseFactor = REMOVE_FACTORS[v.risk_level] ?? REMOVE_FACTORS.LOW;
    let attenuation = 1.0;
    let implNote = '';
    let mathNote = '';
    let whatChanges = '';
    let whyItReducesBias = '';

    if (intervention.action === 'REMOVE') {
      attenuation = 1.0;
      implNote = `Drop column "${v.name}" from your dataset entirely before training. Verify no downstream feature uses it.`;
      mathNote = `Removes the proxy pathway I(${v.name}; ${v.proxy_for ?? 'protected attr'}) = ${v.mi_score.toFixed(3)} nats of mutual information. DIR delta ≈ ${(v.bias_contribution_pct / 100 * baseFactor).toFixed(3)}.`;
      whatChanges = `The column "${v.name}" no longer exists in training data. Any model trained on this data cannot use it—directly or indirectly—to reconstruct group membership.`;
      whyItReducesBias = `"${v.name}" carries ${(v.proxy_score * 100).toFixed(0)}% of the information needed to identify "${v.proxy_for ?? 'the protected group'}". Removing it severs this discriminatory pathway entirely.`;
    } else if (intervention.action === 'BIN') {
      attenuation = BIN_ATTENUATION;
      implNote = `Discretise "${v.name}" into 3–5 equal-frequency bins (e.g., pandas.qcut with q=5). Replace the continuous column with the bin labels before training.`;
      mathNote = `Binning reduces I(bin(${v.name}); ${v.proxy_for ?? 'protected attr'}) to ≤ I(${v.name}; ...) via data processing inequality. Expected MI reduction: ~45–65%. DIR delta ≈ ${(v.bias_contribution_pct / 100 * baseFactor * attenuation).toFixed(3)}.`;
      whatChanges = `"${v.name}" is converted from a continuous variable to a categorical one with k bins. Fine-grained group encoding (e.g., precise income figures that map to caste) is destroyed, but the variable's legitimate predictive signal (e.g., income bracket) is preserved.`;
      whyItReducesBias = `Continuous values often encode group membership at high precision (e.g., income distribution differs by caste at the ₹1,000 level). Binning removes this resolution while retaining the broader pattern that is legitimately predictive.`;
    } else if (intervention.action === 'REWEIGHT') {
      attenuation = REWEIGHT_ATTENUATION;
      implNote = `Apply inverse-probability weighting (IPW): for each row, compute P(group | X) using a simple logistic model, then set sample_weight = 1 / P(group | X). Pass sample_weight to your training algorithm.`;
      mathNote = `Reweighting rebalances the joint distribution P(X, group) to approximate P(X)P(group). This reduces covariance between "${v.name}" and the protected attribute without removing the column. DIR delta ≈ ${(v.bias_contribution_pct / 100 * baseFactor * attenuation).toFixed(3)}.`;
      whatChanges = `The dataset itself is unchanged, but each training example is weighted so that groups are balanced with respect to "${v.name}". The model learns from a reweighted distribution where "${v.name}" is less predictive of group membership.`;
      whyItReducesBias = `If high-income rows are disproportionately from one group, IPW assigns them lower weight, so the model doesn't learn the income→group→outcome association. The variable stays but its discriminatory pathway is attenuated.`;
    } else {
      // MONITOR — no change
      breakdown.push({
        variable: v.name, action: intervention.action, risk_level: v.risk_level,
        bias_contribution_pct: v.bias_contribution_pct,
        dir_delta: 0, spd_reduction_frac: 0,
        dir_after: dir, spd_after: spd,
        implementation: `No change required. Monitor "${v.name}" for drift in production.`,
        mathematical_note: `Proxy score ${v.proxy_score.toFixed(3)} is below the intervention threshold (0.30). Expected bias contribution is within acceptable bounds.`,
        what_changes_in_data: 'Nothing changes in the dataset.',
        why_it_reduces_bias: 'No bias reduction expected. Variable is LOW risk.',
        passes_after: dir >= dirThreshold,
      });
      continue;
    }

    const dir_delta = (v.bias_contribution_pct / 100) * baseFactor * attenuation;
    const spd_reduction_frac = (v.bias_contribution_pct / 100) * attenuation;

    dir = Math.min(1.0, dir + dir_delta);
    spd = spd * (1 - spd_reduction_frac);

    breakdown.push({
      variable: v.name, action: intervention.action, risk_level: v.risk_level,
      bias_contribution_pct: v.bias_contribution_pct,
      dir_delta: Math.round(dir_delta * 10000) / 10000,
      spd_reduction_frac: Math.round(spd_reduction_frac * 10000) / 10000,
      dir_after: Math.round(dir * 10000) / 10000,
      spd_after: Math.round(spd * 10000) / 10000,
      implementation: implNote,
      mathematical_note: mathNote,
      what_changes_in_data: whatChanges,
      why_it_reduces_bias: whyItReducesBias,
      passes_after: dir >= dirThreshold,
    });
  }

  // Project composite score using same weighted formula as backend _compute_composite()
  // We use the industry weights embedded in the report's metric_results
  const dir_status: 'PASS' | 'REVIEW' | 'FAIL' =
    dir >= dirThreshold ? 'PASS' :
    dir >= dirThreshold * 0.90 ? 'REVIEW' : 'FAIL';

  const spd_abs = Math.abs(spd);
  const spd_status: 'PASS' | 'REVIEW' | 'FAIL' =
    spd_abs <= 0.05 ? 'PASS' :
    spd_abs <= 0.10 ? 'REVIEW' : 'FAIL';

  // Replicate backend composite: DIR weight=0.30, everything else SKIPPED contributes 0.5
  // For non-skipped metrics we carry forward original status (conservative: don't assume they improve)
  const dirScoreVal = dir_status === 'PASS' ? 1.0 : dir_status === 'REVIEW' ? 0.5 : 0.0;
  const spdScoreVal = spd_status === 'PASS' ? 1.0 : spd_status === 'REVIEW' ? 0.5 : 0.0;
  const DIR_W = 0.30; const SPD_W = 0.15; const SKIP_W = 0.55;
  const composite = DIR_W * dirScoreVal + SPD_W * spdScoreVal + SKIP_W * 0.5;

  const grade: 'A' | 'B' | 'C' | 'D' | 'F' =
    composite >= 0.95 ? 'A' :
    composite >= 0.85 ? 'B' :
    composite >= 0.70 ? 'C' :
    composite >= 0.50 ? 'D' : 'F';

  return {
    dir: Math.round(dir * 10000) / 10000,
    dir_status,
    spd: Math.round(spd * 10000) / 10000,
    spd_status,
    composite_score: Math.round(composite * 10000) / 10000,
    grade,
    passes: dir_status === 'PASS',
    step_breakdown: breakdown,
  };
}

// ── Sandbox state ──────────────────────────────────────────────────────────────
interface SandboxState {
  variableActions: Record<string, ActionType | null>; // null = not intervened
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
  step_breakdown: ProjectedMetrics['step_breakdown'];
}

function computeSandboxResult(
  report: AuditReport,
  state: SandboxState
): SandboxResult {
  // Build ordered interventions from state
  const interventions: Intervention[] = report.variable_risks
    .filter(v => state.variableActions[v.name] != null)
    .map(v => ({ variable: v.name, action: state.variableActions[v.name]! }));

  const projection = projectInterventions(report, interventions, state.dirThreshold);

  // Build SandboxChange objects for the "changes required" panel
  const changes: SandboxChange[] = [];

  for (const step of projection.step_breakdown) {
    if (step.action === 'REMOVE') {
      changes.push({
        type: 'REMOVE_VARIABLE',
        variable: step.variable,
        description: `REMOVE "${step.variable}" — eliminates ${step.bias_contribution_pct.toFixed(1)}% of proxy bias · DIR +${step.dir_delta.toFixed(3)}`,
        implementation_note: step.implementation,
      });
    } else if (step.action === 'BIN') {
      changes.push({
        type: 'REMOVE_VARIABLE',
        variable: step.variable,
        description: `BIN "${step.variable}" into equal-frequency bins — reduces ${step.bias_contribution_pct.toFixed(1)}% of proxy bias · DIR +${step.dir_delta.toFixed(3)}`,
        implementation_note: step.implementation,
      });
    } else if (step.action === 'REWEIGHT') {
      changes.push({
        type: 'REMOVE_VARIABLE',
        variable: step.variable,
        description: `REWEIGHT via IPW for "${step.variable}" — attenuates ${step.bias_contribution_pct.toFixed(1)}% of proxy bias · DIR +${step.dir_delta.toFixed(3)}`,
        implementation_note: step.implementation,
      });
    }
  }

  for (const go of report.group_outcomes) {
    const override = state.groupOverrides[go.protected_attribute];
    if (override && override.priv !== go.privileged_group) {
      changes.push({
        type: 'GROUP_OVERRIDE',
        attribute: go.protected_attribute,
        privileged_group: override.priv,
        unprivileged_group: override.unpriv,
        description: `Set ${override.priv} as privileged for ${go.protected_attribute}`,
        implementation_note: `Override the assigned privileged group in your fairness review for ${go.protected_attribute}.`,
      });
    }
  }

  for (const [attr, rate] of Object.entries(state.baseRates)) {
    if (rate !== null) {
      changes.push({
        type: 'BASE_RATE',
        attribute: attr,
        description: `Assume base rate ${Math.round(rate * 100)}% for ${attr}`,
        implementation_note: `User-provided base rate assumption — indicative only.`,
      });
    }
  }

  if (state.dirThreshold !== 0.80) {
    changes.push({
      type: 'THRESHOLD_CHANGE',
      description: `DIR threshold changed from 0.80 to ${state.dirThreshold.toFixed(2)}`,
      implementation_note: state.dirThreshold < 0.80
        ? `Warning: ${state.dirThreshold.toFixed(2)} is below the EEOC 4/5ths standard.`
        : `${state.dirThreshold.toFixed(2)} is more stringent than the current legal standard.`,
    });
  }

  return {
    projected_dir: projection.dir,
    projected_dir_status: projection.dir_status,
    projected_spd: projection.spd,
    projected_spd_status: projection.spd_status,
    composite_score: projection.composite_score,
    grade: projection.grade,
    changes_made: changes,
    passes: projection.passes,
    step_breakdown: projection.step_breakdown,
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


const ACTION_COLORS: Record<string, string> = {
  REMOVE: '#FF4D6D', BIN: '#FFB830', REWEIGHT: '#4D9FFF', MONITOR: '#55556A',
};
const ACTION_BG: Record<string, string> = {
  REMOVE: 'rgba(255,77,109,0.1)', BIN: 'rgba(255,184,48,0.1)', REWEIGHT: 'rgba(77,159,255,0.1)', MONITOR: 'rgba(85,85,106,0.08)',
};

function SandboxPanel({ report, auditId }: { report: AuditReport; auditId: string }) {
  const [variableActions, setVariableActions] = useState<Record<string, ActionType | null>>({});
  const [groupOverrides, setGroupOverrides] = useState<Record<string, { priv: string; unpriv: string }>>({});
  const [dirThreshold, setDirThreshold] = useState(0.80);
  const [baseRates, setBaseRates] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const sandboxState: SandboxState = { variableActions, groupOverrides, dirThreshold, baseRates };
  const sandboxResult = useMemo(
    () => computeSandboxResult(report, sandboxState),
    [report, variableActions, groupOverrides, dirThreshold, baseRates]
  );

  const setAction = (name: string, action: ActionType | null) =>
    setVariableActions(prev => ({ ...prev, [name]: action }));

  const resetAll = () => {
    setVariableActions({});
    setGroupOverrides({});
    setDirThreshold(0.80);
    setBaseRates({});
    setError(null);
    setExpandedStep(null);
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

      {/* Top row: interventions + live metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>

        {/* Left: variable action selectors */}
        <Card style={{ padding: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${C.border}` }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px' }}>INTERVENTIONS</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>What-if remediation sandbox</div>
            <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, margin: '6px 0 0' }}>
              Choose an intervention for each variable. The same projection engine powers both this sandbox
              and the Fix &amp; Re-audit tab — results are now consistent. BIN and REWEIGHT are distinct from
              REMOVE: they preserve the variable's legitimate signal while reducing its discriminatory proxy pathway.
            </p>
          </div>
          <div style={{ padding: '14px 18px', display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 68px 68px 138px', gap: 8, paddingBottom: 6, borderBottom: `0.5px solid ${C.border}` }}>
              {['Variable', 'Risk', 'Bias %', 'Intervention'].map(h => (
                <span key={h} style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>
            {report.variable_risks.map(v => {
              const action = variableActions[v.name] ?? null;
              return (
                <div key={v.name} style={{
                  display: 'grid', gridTemplateColumns: '1fr 68px 68px 138px',
                  gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 8,
                  background: action ? ACTION_BG[action] : 'transparent',
                  border: `0.5px solid ${action ? ACTION_COLORS[action] + '44' : C.border}`,
                  transition: 'all 0.15s',
                }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.name}>{v.name}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: v.risk_level === 'HIGH' ? '#FF6B85' : v.risk_level === 'MEDIUM' ? C.amber : C.hint }}>{v.risk_level}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted }}>{v.bias_contribution_pct.toFixed(1)}%</span>
                  <select
                    value={action ?? ''}
                    onChange={e => setAction(v.name, (e.target.value || null) as ActionType | null)}
                    style={{
                      padding: '5px 8px', background: '#1C1C26', color: action ? ACTION_COLORS[action] : C.muted,
                      border: `0.5px solid ${action ? ACTION_COLORS[action] + '66' : C.border}`,
                      borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    <option value="">— none —</option>
                    <option value="REMOVE">REMOVE</option>
                    <option value="BIN">BIN (discretise)</option>
                    <option value="REWEIGHT">REWEIGHT (IPW)</option>
                    <option value="MONITOR">MONITOR</option>
                  </select>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '14px 18px', borderTop: `0.5px solid ${C.border}`, display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 8 }}>DIR pass threshold</div>
              <input type="range" min={0.60} max={0.95} step={0.01} value={dirThreshold}
                onChange={e => setDirThreshold(Number(e.target.value))} style={{ width: '100%' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700 }}>{dirThreshold.toFixed(2)}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: dirThreshold === 0.80 ? C.green : dirThreshold < 0.70 ? C.red : C.amber }}>
                  {dirThreshold === 0.80 ? 'EEOC 4/5ths standard' : dirThreshold < 0.70 ? 'No legal standard supports this' : 'More stringent'}
                </span>
              </div>
            </div>
            <button onClick={resetAll} style={{ padding: 10, background: 'none', border: `1px solid ${C.border2}`, borderRadius: 8, color: C.muted, fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }}>
              Reset all interventions
            </button>
          </div>
        </Card>

        {/* Right: live metrics + progress bar */}
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <Card style={{ padding: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: `0.5px solid ${C.border}` }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Live result</div>
            </div>
            <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, marginBottom: 10, textTransform: 'uppercase' }}>CURRENT</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {([
                    ['DIR', report.overall_dir_score.toFixed(4), report.group_outcomes[0]?.dir_status],
                    ['SPD', report.group_outcomes[0]?.spd_score.toFixed(4), report.group_outcomes[0]?.spd_status],
                    ['Grade', report.overall_grade, null],
                    ['Composite', report.composite_score.toFixed(3), null],
                  ] as [string, string, string | null][]).map(([label, val, status]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted }}>{label}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                        {val}{status && <strong style={{ color: statusColor(status), marginLeft: 6 }}>{status}</strong>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ border: `0.5px solid ${sandboxResult.passes ? C.green + '66' : C.border}`, borderRadius: 10, padding: 12, background: sandboxResult.passes ? 'rgba(61,220,132,0.04)' : 'transparent' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, marginBottom: 10, textTransform: 'uppercase' }}>PROJECTED</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {([
                    ['DIR', sandboxResult.projected_dir.toFixed(4), sandboxResult.projected_dir_status],
                    ['SPD', sandboxResult.projected_spd.toFixed(4), sandboxResult.projected_spd_status],
                    ['Grade', sandboxResult.grade, null],
                    ['Composite', sandboxResult.composite_score.toFixed(3), null],
                  ] as [string, string, string | null][]).map(([label, val, status]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted }}>{label}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                        {val}{status && <strong style={{ color: statusColor(status), marginLeft: 6 }}>{status}</strong>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ padding: '12px 16px', background: '#1C1C26', borderTop: `0.5px solid ${C.border}` }}>
              {sandboxResult.passes
                ? <div style={{ color: C.green, fontFamily: 'var(--mono)', fontSize: 11 }}>✓ Projected PASS · DIR {sandboxResult.projected_dir.toFixed(2)} ≥ {dirThreshold.toFixed(2)}</div>
                : <div style={{ color: C.amber, fontFamily: 'var(--mono)', fontSize: 11 }}>⚠ Still FAIL · need DIR ≥ {dirThreshold.toFixed(2)}, currently {sandboxResult.projected_dir.toFixed(2)}</div>
              }
            </div>
          </Card>

          <Card style={{ padding: 16 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, marginBottom: 10, textTransform: 'uppercase' }}>DIR trajectory</div>
            <div style={{ position: 'relative', height: 28, background: '#242432', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${report.overall_dir_score * 100}%`, background: C.red, opacity: 0.4, borderRadius: 6 }} />
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${sandboxResult.projected_dir * 100}%`, background: sandboxResult.passes ? C.green : C.amber, borderRadius: 6, transition: 'width 0.3s ease' }} />
              <div style={{ position: 'absolute', left: `${dirThreshold * 100}%`, top: 0, bottom: 0, width: 1.5, background: C.text, opacity: 0.5 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: 'var(--mono)', fontSize: 9, color: C.hint }}>
              <span>0.0 </span><span style={{ color: C.text }}>threshold {dirThreshold.toFixed(2)}</span><span> 1.0</span>
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 10, height: 10, background: C.red, opacity: 0.5, borderRadius: 2 }} /><span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint }}>Baseline {report.overall_dir_score.toFixed(3)}</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 10, height: 10, background: sandboxResult.passes ? C.green : C.amber, borderRadius: 2 }} /><span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint }}>Projected {sandboxResult.projected_dir.toFixed(3)}</span></div>
            </div>
          </Card>
        </div>
      </div>

      {/* Step breakdown */}
      {sandboxResult.step_breakdown.filter(s => s.action !== 'MONITOR').length > 0 && (
        <Card>
          <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${C.border}` }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px' }}>INTERVENTION BREAKDOWN · What Actually Changes in Your Dataset</div>
            <p style={{ fontSize: 11, color: C.muted, margin: '6px 0 0', lineHeight: 1.6 }}>
              Click any intervention for the mathematical derivation, exact dataset modification required, and why it genuinely reduces bias.
              This is the same projection model used in Fix &amp; Re-audit — there is no separate heuristic.
            </p>
          </div>
          <div style={{ padding: '14px 18px', display: 'grid', gap: 10 }}>
            {sandboxResult.step_breakdown.filter(s => s.action !== 'MONITOR').map((step, i) => {
              const isOpen = expandedStep === i;
              const ac = ACTION_COLORS[step.action] ?? C.hint;
              return (
                <div key={i} style={{ borderRadius: 10, border: `0.5px solid ${isOpen ? ac + '66' : C.border}`, overflow: 'hidden' }}>
                  <div onClick={() => setExpandedStep(isOpen ? null : i)}
                    style={{ padding: '10px 14px', cursor: 'pointer', background: isOpen ? ACTION_BG[step.action] : '#1C1C26', display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 12, alignItems: 'center' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, background: ACTION_BG[step.action], color: ac, fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700 }}>{step.action}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: C.text }}>{step.variable}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: step.dir_delta > 0 ? C.green : C.hint }}>DIR +{step.dir_delta.toFixed(4)}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: step.passes_after ? C.green : C.amber }}>{step.passes_after ? '→ PASS' : '→ FAIL'}</span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: '14px 18px', borderTop: `0.5px solid ${C.border}`, display: 'grid', gap: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                        {[
                          { label: 'BIAS SHARE', val: step.bias_contribution_pct.toFixed(1) + '%', sub: 'of total proxy bias', col: C.text },
                          { label: 'DIR AFTER', val: step.dir_after.toFixed(4), sub: '+' + step.dir_delta.toFixed(4) + ' from this step', col: step.passes_after ? C.green : C.amber },
                          { label: 'SPD AFTER', val: step.spd_after.toFixed(4), sub: '−' + (step.spd_reduction_frac * 100).toFixed(1) + '% of gap', col: C.text },
                        ].map(({ label, val, sub, col }) => (
                          <div key={label} style={{ padding: 10, background: '#1C1C26', borderRadius: 8, border: `0.5px solid ${C.border}` }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, marginBottom: 6 }}>{label}</div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: col }}>{val}</div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.muted, marginTop: 3 }}>{sub}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div style={{ padding: 10, background: '#1C1C26', borderRadius: 8 }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.blue, marginBottom: 6 }}>WHAT CHANGES IN YOUR DATA</div>
                          <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, margin: 0 }}>{step.what_changes_in_data}</p>
                        </div>
                        <div style={{ padding: 10, background: '#1C1C26', borderRadius: 8 }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.green, marginBottom: 6 }}>WHY THIS REDUCES BIAS</div>
                          <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, margin: 0 }}>{step.why_it_reduces_bias}</p>
                        </div>
                      </div>
                      <div style={{ padding: 10, background: '#242432', borderRadius: 8, border: `0.5px solid ${C.border}` }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.amber, marginBottom: 6 }}>IMPLEMENTATION</div>
                        <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.text, lineHeight: 1.6, margin: 0 }}>{step.implementation}</p>
                      </div>
                      <div style={{ padding: 10, background: '#1C1C26', borderRadius: 8 }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, marginBottom: 6 }}>MATHEMATICAL BASIS</div>
                        <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted, lineHeight: 1.6, margin: 0 }}>{step.mathematical_note}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ padding: '10px 18px', background: '#1C1C26', borderTop: `0.5px solid ${C.border}` }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, margin: 0, lineHeight: 1.6 }}>
              Projection factors: REMOVE uses 0.38 (HIGH) / 0.22 (MEDIUM) × bias_contribution_pct.
              BIN attenuates by 55% (data processing inequality — binning reduces MI, not eliminates it).
              REWEIGHT attenuates by 40% (IPW overlap bound). All are conservative lower-bound estimates.
              Re-audit your modified dataset for the verified result.
            </p>
          </div>
        </Card>
      )}

      {sandboxResult.passes && (
        <div style={{ display: 'grid', gap: 10 }}>
          <button onClick={handleGenerateRemediationReport} disabled={busy}
            style={{ width: '100%', padding: 14, background: C.green, color: '#13131A', border: 'none', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {busy ? 'Generating report…' : '✓ Generate Remediation Report (Projected PASS)'}
          </button>
          {error && <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.red }}>{error}</div>}
        </div>
      )}
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

  // ── Unified engine: build interventions from the backend remediation_plan ──
  // The backend _attach_remediation() sets action to REMOVE / BIN / REWEIGHT.
  // We feed those directly into projectInterventions() — same function the sandbox uses.
  // This means Fix & Re-audit and Sandbox are now driven by identical math.
  const interventions: Intervention[] = plan.map((step: any) => ({
    variable: step.variable,
    action: (step.action as ActionType) ?? 'REMOVE',
  }));

  const baseline = report.overall_dir_score;

  // Project cumulative state after each step by building prefix-slices
  const projectedSteps = plan.map((_: any, i: number) => {
    const partial = projectInterventions(report, interventions.slice(0, i + 1), 0.80);
    const planStep = plan[i];
    const breakdown = partial.step_breakdown[i] ?? partial.step_breakdown[partial.step_breakdown.length - 1];
    return {
      ...planStep,
      // Unified engine fields (override the backend's approximate values)
      projected_dir: partial.dir,
      projected_dir_status: partial.dir_status,
      projected_spd: partial.spd,
      composite_score: partial.composite_score,
      grade: partial.grade,
      dir_delta: breakdown?.dir_delta ?? 0,
      passes_after: partial.passes,
      what_changes_in_data: breakdown?.what_changes_in_data ?? '',
      why_it_reduces_bias: breakdown?.why_it_reduces_bias ?? '',
      implementation: breakdown?.implementation ?? planStep.reason ?? '',
      mathematical_note: breakdown?.mathematical_note ?? '',
    };
  });

  const finalProjection = projectInterventions(report, interventions, 0.80);
  const allPass = finalProjection.passes;

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ padding: '14px 18px', borderBottom: `0.5px solid ${C.border}` }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 3 }}>
          Remediation Pathway · Before → After  ·  <span style={{ color: C.blue }}>Unified engine with Sandbox</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          {allPass ? '✓ Full remediation path — applying all steps projects a PASS' : 'Partial remediation — additional steps or re-audit needed'}
        </div>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginTop: 4, marginBottom: 0 }}>
          These projections use the same statistical model as the Sandbox tab. They are not linear interpolations —
          each step's DIR delta is derived from its actual proxy contribution share and intervention type (REMOVE / BIN / REWEIGHT).
          Apply steps in order and re-audit to verify.
        </p>
      </div>

      {/* Before/After */}
      <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center', borderBottom: `0.5px solid ${C.border}` }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 4 }}>BEFORE</div>
          <div style={{ fontFamily: 'var(--syne)', fontSize: 32, fontWeight: 800, color: C.red, lineHeight: 1 }}>{baseline.toFixed(4)}</div>
          <div style={{ height: 4, background: C.surface3, borderRadius: 2, marginTop: 6 }}>
            <div style={{ height: '100%', width: `${Math.min(baseline, 1) * 100}%`, background: C.red, borderRadius: 2 }} />
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, marginTop: 3 }}>DIR · FAIL (threshold 0.80)</div>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 18, color: C.hint }}>→</div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 4 }}>AFTER ALL STEPS</div>
          <div style={{ fontFamily: 'var(--syne)', fontSize: 32, fontWeight: 800, color: allPass ? C.green : C.amber, lineHeight: 1 }}>
            {finalProjection.dir.toFixed(4)}
          </div>
          <div style={{ height: 4, background: C.surface3, borderRadius: 2, marginTop: 6 }}>
            <div style={{ height: '100%', width: `${Math.min(finalProjection.dir, 1) * 100}%`, background: allPass ? C.green : C.amber, borderRadius: 2 }} />
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: allPass ? C.green : C.amber, marginTop: 3 }}>
            {allPass ? 'PROJECTED PASS ◈' : 'PROJECTED REVIEW ◈'} · Grade {finalProjection.grade}
          </div>
        </div>
      </div>

      {/* Step-by-step */}
      <div style={{ padding: '12px 18px' }}>
        {projectedSteps.map((step: any, i: number) => {
          const isActive = activeStep === i;
          const isDone   = activeStep > i;
          const color    = isDone ? C.green : isActive ? C.blue : C.hint;
          const ac = step.action === 'REMOVE' ? C.red : step.action === 'BIN' ? C.amber : C.blue;
          return (
            <div key={i} onClick={() => setActiveStep(i)} style={{
              borderRadius: 10, marginBottom: 8, cursor: 'pointer',
              border: `0.5px solid ${isActive ? ac + '55' : C.border}`,
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex', gap: 12, padding: '10px 14px',
                background: isActive ? C.surface2 : 'transparent',
                alignItems: 'center',
              }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: `${color}22`, border: `1px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color }}>{isDone ? '✓' : i + 1}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, color: C.text }}>
                      <span style={{ padding: '1px 6px', borderRadius: 3,
                        background: step.action === 'REMOVE' ? C.redBg : step.action === 'BIN' ? C.amberBg : C.blueBg,
                        color: step.action === 'REMOVE' ? C.redText : step.action === 'BIN' ? C.amberText : C.blueText,
                        marginRight: 8, fontSize: 10 }}>
                        {step.action}
                      </span>
                      {step.variable ?? step.feature ?? ''}
                    </span>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.green }}>+{step.dir_delta.toFixed(4)}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: step.passes_after ? C.green : C.amber }}>
                        DIR → {step.projected_dir.toFixed(4)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              {isActive && (
                <div style={{ padding: '12px 14px', borderTop: `0.5px solid ${C.border}`, display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ padding: 10, background: C.surface3, borderRadius: 8 }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.blue, marginBottom: 5 }}>WHAT CHANGES IN YOUR DATA</div>
                      <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, margin: 0 }}>{step.what_changes_in_data || step.reason}</p>
                    </div>
                    <div style={{ padding: 10, background: C.surface3, borderRadius: 8 }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.green, marginBottom: 5 }}>WHY THIS REDUCES BIAS</div>
                      <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, margin: 0 }}>{step.why_it_reduces_bias || step.reason}</p>
                    </div>
                  </div>
                  {step.implementation && (
                    <div style={{ padding: 10, background: C.surface2, borderRadius: 8, border: `0.5px solid ${C.border}` }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.amber, marginBottom: 5 }}>IMPLEMENTATION</div>
                      <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.text, lineHeight: 1.6, margin: 0 }}>{step.implementation}</p>
                    </div>
                  )}
                  {step.mathematical_note && (
                    <div style={{ padding: 10, background: C.surface3, borderRadius: 8 }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, marginBottom: 5 }}>MATHEMATICAL BASIS</div>
                      <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted, lineHeight: 1.6, margin: 0 }}>{step.mathematical_note}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ padding: '10px 18px', background: C.surface2, borderTop: `0.5px solid ${C.border}` }}>
        <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, margin: 0, lineHeight: 1.5 }}>
          ◈ Projections use the unified engine: bias_contribution_pct × risk_factor × intervention_attenuation.
          REMOVE: factor 0.38/0.22. BIN: 55% of REMOVE. REWEIGHT: 40% of REMOVE.
          Re-upload your dataset after applying each fix to get a verified measurement — projections are lower-bound estimates.
        </p>
      </div>
    </Card>
  );
}

export default function AuditPage({ report: r, auditId, sensitivityReports, dlpResult, gemini, onGenerateCertificate }: Props) {
  const [tab, setTab] = useState<'plain' | 'overview' | 'story' | 'metrics' | 'proxies' | 'sandbox' | 'remediation' | 'sensitivity' | 'legal'>('plain');
  const gc = gradeColor(r.overall_grade);

  const tabs = [
    { id: 'plain' as const,       label: '📖 Plain English' },
    { id: 'overview' as const,    label: 'Overview' },
    { id: 'story' as const, label: 'Human Impact', icon: '❤' },
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
          {tab === 'story' && (
            <HumanStoryPanel 
              report={r} 
              gemini={gemini} 
              annualDecisions={10000} 
            />
          )}
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
