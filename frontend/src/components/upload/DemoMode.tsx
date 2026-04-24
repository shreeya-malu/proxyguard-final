/**
 * DemoMode
 * ========
 * Self-running 22-second demo. Zero clicks after "Watch Demo" is pressed.
 * Uses COMPAS pre-audited data — works with no backend, no uploads, no auth.
 *
 * Sequence:
 *   0.0s  Dataset card appears — COMPAS, 7,214 rows, Criminal Justice
 *   2.0s  "Scanning for bias…" progress bar
 *   4.5s  Grade F verdict lands with pulse
 *   6.5s  Three metric failures appear one by one
 *   10s   Proxy variable revealed — decile_score → race (83% MI)
 *   13s   "Applying fix…" animation
 *   15.5s DIR improvement bar animates 0.61 → 0.72
 *   18s   "347 people saved" counter counts up
 *   21s   CTA — "Try with your own data"
 *
 * Integration: onDemoComplete receives a mock AuditResponse that drives
 * the real AuditPage — judge lands in the actual product.
 */

import { useState, useEffect, useRef } from 'react';
import { AuditResponse } from '../../services/api';
import { PREAUDITED_DATASETS } from '../../services/datasets';

interface Props {
  onDemoComplete: (result: AuditResponse) => void;
  onDismiss: () => void;
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  red:    '#FF4D6D', redBg:  'rgba(255,77,109,0.10)',
  amber:  '#FFB830', amberBg:'rgba(255,184,48,0.10)',
  green:  '#3DDC84', greenBg:'rgba(61,220,132,0.10)',
  blue:   '#4D9FFF', blueBg: 'rgba(77,159,255,0.10)',
  s1:     '#0A0A0F', s2: '#13131A', s3: '#1C1C26', s4: '#242432',
  border: '#2A2A3A', border2: '#363650',
  text:   '#F0F0F8', muted: '#8888AA', hint: '#55556A',
};

// ── Build a mock AuditResponse from COMPAS preaudited data ───────────────────
// This is passed to onDemoComplete so the judge lands in the real AuditPage
function buildMockAuditResponse(): AuditResponse {
  const d = PREAUDITED_DATASETS.find(x => x.id === 'compas-2016')!;
  const di = d.disparate_impact[0];
  return {
    audit_id: d.id,
    report: {
      dataset_name:       d.name,
      industry_context:   'criminal_justice',
      region:             'us',
      overall_grade:      d.overall_grade,
      overall_risk_level: d.overall_risk,
      overall_dir_score:  d.overall_dir,
      total_flags:        d.total_flags,
      group_outcomes: [{
        protected_attribute: di.protected_attribute,
        outcome_column:      d.outcome_column,
        privileged_group:    di.privileged_group,
        unprivileged_group:  di.unprivileged_group,
        privileged_rate:     di.privileged_rate,
        unprivileged_rate:   di.unprivileged_rate,
        dir_score:           di.dir_score,
        dir_status:          'FAIL',
        spd_score:           di.privileged_rate - di.unprivileged_rate,
        spd_status:          'FAIL',
        tpr_privileged: null, tpr_unprivileged: null,
        fpr_privileged: null, fpr_unprivileged: null,
        eod_score: null, eod_status: null,
        eqod_score: null, eqod_status: null,
        fprp_score: null, fprp_status: null,
        pred_parity_priv: null, pred_parity_unpriv: null,
        pred_parity_diff: null, pred_parity_status: null,
        industry_metric: 'Equalised Odds',
        legal_basis:     'EEOC 4/5ths Rule',
      }],
      variable_risks: d.top_variables.map(v => ({
        name:                   v.name,
        mi_score:               v.mi_score,
        cramers_v:              v.mi_score * 0.9,
        proxy_score:            v.mi_score,
        proxy_method:           'MI',
        risk_level:             v.risk_level,
        is_proxy:               v.proxy_for !== null,
        proxy_for:              v.proxy_for,
        recommendation:         v.risk_level === 'HIGH' ? 'Remove from training features' : 'Monitor closely',
        bias_contribution_pct:  v.contribution,
        remediation:            [{
          action:                   'REMOVE',
          confidence:               0.88,
          expected_dir_improvement: '+0.11',
          reason:                   'Removing this variable eliminates the primary proxy pathway.',
        }],
        is_caste_proxy_candidate: false,
      })),
      metrics: [
        { name: 'Disparate Impact Ratio',    value: 0.61, threshold: 0.80, direction: 'above', status: 'FAIL',   requires_gt: false, legal_basis: 'EEOC 4/5ths Rule', plain_english: 'African-American defendants receive favourable outcomes at only 61% the rate of Caucasian defendants.', note: '' },
        { name: 'Statistical Parity Difference', value: 0.15, threshold: 0.05, direction: 'below', status: 'FAIL', requires_gt: false, legal_basis: 'AIF360 Standard', plain_english: 'A 15 percentage point gap exists between group outcome rates.', note: '' },
        { name: 'Equal Opportunity Difference',  value: 0.18, threshold: 0.10, direction: 'below', status: 'FAIL', requires_gt: true, legal_basis: 'Article 14', plain_english: 'Deserving defendants from the disadvantaged group are denied at a significantly higher rate.', note: '' },
      ],
      impossibility_conflicts: [],
      proxy_chains: [{ variable: 'decile_score', proxy_for: 'race', mi: 0.831 }],
      composite_verdict: 'FAIL',
      audit_hash: d.audit_hash,
      created_at: d.audited_at,
    },
    sensitivity_reports: [],
    dlp_result: { triggered: false, flags: [], redacted_columns: [] },
    gemini: {
      cro_summary: d.gemini_summary,
      legal_context: [],
      impossibility_note: null,
      generated_by: 'demo',
      disclaimer: '',
    },
  } as unknown as AuditResponse;
}

// ── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  { id: 'dataset',  label: 'Loading dataset',    t: 0    },
  { id: 'scanning', label: 'Scanning for bias',  t: 2000 },
  { id: 'verdict',  label: 'Verdict computed',   t: 4500 },
  { id: 'metrics',  label: 'Metrics revealed',   t: 6500 },
  { id: 'proxy',    label: 'Proxy detected',     t: 10000},
  { id: 'fixing',   label: 'Applying fix',       t: 13000},
  { id: 'improved', label: 'Improvement shown',  t: 15500},
  { id: 'impact',   label: 'Impact calculated',  t: 18000},
  { id: 'cta',      label: 'Done',               t: 21000},
] as const;

type StepId = typeof STEPS[number]['id'];

// ── Sub-components ────────────────────────────────────────────────────────────

function FadeIn({ show, delay = 0, children }: { show: boolean; delay?: number; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [show, delay]);
  return (
    <div style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(6px)',
      transition: 'opacity 0.5s ease, transform 0.5s ease',
    }}>
      {children}
    </div>
  );
}

function AnimatedBar({ from, to, active, color }: { from: number; to: number; active: boolean; color: string }) {
  const [width, setWidth] = useState(from);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setWidth(to), 100);
    return () => clearTimeout(t);
  }, [active, to]);
  return (
    <div style={{ height: 8, background: C.s4, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{
        height: '100%', background: color, borderRadius: 4,
        width: `${width}%`,
        transition: 'width 1.8s cubic-bezier(0.16,1,0.3,1)',
      }} />
    </div>
  );
}

function Counter({ target, active }: { target: number; active: boolean }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let start = 0;
    const duration = 2000;
    const step = 16;
    const increment = target / (duration / step);
    const timer = setInterval(() => {
      start += increment;
      if (start >= target) { setValue(target); clearInterval(timer); }
      else setValue(Math.floor(start));
    }, step);
    return () => clearInterval(timer);
  }, [active, target]);
  return <>{value.toLocaleString()}</>;
}

// ── Progress dots ─────────────────────────────────────────────────────────────
function ProgressDots({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 28 }}>
      {STEPS.map((s, i) => (
        <div key={s.id} style={{
          width: i === current ? 16 : 6, height: 6, borderRadius: 3,
          background: i < current ? C.green : i === current ? C.blue : C.s4,
          transition: 'all 0.3s ease',
        }} />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DemoMode({ onDemoComplete, onDismiss }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsed,   setElapsed]   = useState(0);
  const [scanPct,   setScanPct]   = useState(0);
  const [metricIdx, setMetricIdx] = useState(0);
  const startRef = useRef<number>(Date.now());
  const rafRef   = useRef<number>(0);

  const step = (id: StepId) => STEPS.findIndex(s => s.id === id) <= stepIndex;

  // Main timer loop
  useEffect(() => {
    startRef.current = Date.now();
    const tick = () => {
      const ms = Date.now() - startRef.current;
      setElapsed(ms);
      const idx = [...STEPS].reverse().findIndex(s => ms >= s.t);
      setStepIndex(idx === -1 ? 0 : STEPS.length - 1 - idx);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Scan progress bar (0→100% over 2.5s during scanning phase)
  useEffect(() => {
    if (!step('scanning') || step('verdict')) return;
    const start = Date.now();
    const dur = 2400;
    const t = setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / dur) * 100);
      setScanPct(p);
      if (p >= 100) clearInterval(t);
    }, 30);
    return () => clearInterval(t);
  }, [stepIndex]);

  // Metric reveal — one every 1.2s
  useEffect(() => {
    if (!step('metrics')) return;
    if (metricIdx >= 3) return;
    const t = setTimeout(() => setMetricIdx(i => i + 1), 1200);
    return () => clearTimeout(t);
  }, [stepIndex, metricIdx]);

  const metrics = [
    { name: 'Disparate Impact Ratio', value: '0.61', threshold: '< 0.80', status: 'FAIL' },
    { name: 'Statistical Parity Diff', value: '0.15', threshold: '> 0.05', status: 'FAIL' },
    { name: 'Equal Opportunity Diff',  value: '0.18', threshold: '> 0.10', status: 'FAIL' },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(10,10,15,0.92)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 520,
        background: C.s2, borderRadius: 20,
        border: `0.5px solid ${C.border2}`,
        padding: '32px 32px 28px',
        position: 'relative',
      }}>
        {/* Dismiss */}
        <button onClick={onDismiss} style={{
          position: 'absolute', top: 16, right: 16,
          background: 'none', border: 'none',
          color: C.hint, fontSize: 18, cursor: 'pointer', lineHeight: 1,
        }}>✕</button>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 2, color: C.hint, marginBottom: 8 }}>
            LIVE DEMO · COMPAS RECIDIVISM DATASET · US COURTS 2016
          </div>
          <div style={{ fontFamily: 'var(--syne, sans-serif)', fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: '-0.3px' }}>
            Detecting bias in real time
          </div>
        </div>

        <ProgressDots current={stepIndex} />

        {/* ── Step 1: Dataset card ── */}
        <FadeIn show={step('dataset')}>
          <div style={{
            background: C.s3, borderRadius: 12, padding: '14px 18px',
            border: `0.5px solid ${C.border}`, marginBottom: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontFamily: 'var(--syne, sans-serif)', fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 3 }}>
                  COMPAS Recidivism Risk Scores
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted }}>
                  7,214 defendants · 53 columns · US Criminal Justice
                </div>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textAlign: 'right' }}>
                <div>ProPublica</div>
                <div>2016</div>
              </div>
            </div>
            <div style={{
              marginTop: 10, fontSize: 12, color: C.muted, lineHeight: 1.6,
              fontFamily: 'var(--font-sans, sans-serif)',
            }}>
              Used by US courts to recommend bail, sentencing &amp; parole for thousands of defendants.
            </div>
          </div>
        </FadeIn>

        {/* ── Step 2: Scanning ── */}
        <FadeIn show={step('scanning')}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>
                {step('verdict') ? 'SCAN COMPLETE' : 'SCANNING FOR BIAS…'}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: step('verdict') ? C.green : C.blue }}>
                {step('verdict') ? '100%' : `${Math.round(scanPct)}%`}
              </span>
            </div>
            <AnimatedBar
              from={0} to={100}
              active={step('scanning')}
              color={step('verdict') ? C.green : C.blue}
            />
          </div>
        </FadeIn>

        {/* ── Step 3: Verdict ── */}
        <FadeIn show={step('verdict')}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 18px', borderRadius: 12, marginBottom: 16,
            background: C.redBg, border: `0.5px solid ${C.red}44`,
          }}>
            <div style={{
              fontFamily: 'var(--syne, sans-serif)', fontSize: 42, fontWeight: 900,
              color: C.red, lineHeight: 1,
              animation: step('verdict') ? 'pgPulse 0.6s ease-out' : 'none',
            }}>F</div>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.red, letterSpacing: 1, marginBottom: 3 }}>
                AUDIT FAILED
              </div>
              <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                DIR score <strong style={{ color: C.red }}>0.61</strong> — below the legal threshold of 0.80
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted, marginTop: 3 }}>
                African-American defendants treated fairly only 61% as often as Caucasian
              </div>
            </div>
          </div>
        </FadeIn>

        {/* ── Step 4: Metric failures ── */}
        <FadeIn show={step('metrics')}>
          <div style={{ marginBottom: 16 }}>
            {metrics.slice(0, metricIdx).map((m, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '7px 12px', borderRadius: 8, marginBottom: 4,
                background: C.s3, border: `0.5px solid ${C.border}`,
                animation: 'pgSlideIn 0.35s ease-out',
              }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted }}>{m.name}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.text }}>{m.value}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint }}>{m.threshold}</span>
                  <span style={{
                    fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600,
                    padding: '2px 6px', borderRadius: 99,
                    background: C.redBg, color: C.red, letterSpacing: 1,
                  }}>FAIL</span>
                </div>
              </div>
            ))}
          </div>
        </FadeIn>

        {/* ── Step 5: Proxy variable ── */}
        <FadeIn show={step('proxy')}>
          <div style={{
            padding: '14px 18px', borderRadius: 12, marginBottom: 16,
            background: `rgba(255,184,48,0.08)`, border: `0.5px solid ${C.amber}44`,
          }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.5, color: C.amber, marginBottom: 8 }}>
              PROXY VARIABLE DETECTED
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
                padding: '4px 10px', borderRadius: 6,
                background: C.s4, color: C.amber, border: `0.5px solid ${C.amber}44`,
              }}>decile_score</span>
              <span style={{ color: C.hint, fontSize: 11 }}>predicts</span>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
                padding: '4px 10px', borderRadius: 6,
                background: C.s4, color: C.red, border: `0.5px solid ${C.red}44`,
              }}>race</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted }}>with 83% accuracy</span>
            </div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
              Using <code style={{ color: C.text, fontFamily: 'var(--mono)' }}>decile_score</code> in a model is
              mathematically equivalent to using race directly.
            </div>
          </div>
        </FadeIn>

        {/* ── Step 6: Applying fix ── */}
        <FadeIn show={step('fixing')}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
            padding: '10px 14px', borderRadius: 8,
            background: C.s3, border: `0.5px solid ${C.border}`,
          }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              border: `2px solid ${C.border}`,
              borderTopColor: step('improved') ? C.green : C.blue,
              animation: step('improved') ? 'none' : 'pgSpin 0.7s linear infinite',
              flexShrink: 0,
            }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: step('improved') ? C.green : C.muted, letterSpacing: 0.5 }}>
              {step('improved') ? '✓ FIX APPLIED — REMOVE decile_score' : 'APPLYING FIX — REMOVE decile_score…'}
            </span>
          </div>
        </FadeIn>

        {/* ── Step 7: DIR improvement ── */}
        <FadeIn show={step('improved')}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>Disparate Impact Ratio</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.red, textDecoration: 'line-through' }}>0.61</span>
                <span style={{ color: C.hint, fontSize: 10 }}>→</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.green, fontWeight: 700 }}>0.72</span>
              </div>
            </div>
            <div style={{ position: 'relative', height: 10, background: C.s4, borderRadius: 5 }}>
              {/* Threshold line */}
              <div style={{
                position: 'absolute', left: '80%', top: -3, bottom: -3,
                width: 1, background: C.amber, opacity: 0.6,
              }} />
              <AnimatedBar from={61} to={72} active={step('improved')} color={C.green} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint }}>threshold: 0.80 →</span>
            </div>
          </div>
        </FadeIn>

        {/* ── Step 8: Impact counter — the emotional peak ── */}
        <FadeIn show={step('impact')}>
          <div style={{
            padding: '18px 20px', borderRadius: 14, marginBottom: 16,
            background: `rgba(61,220,132,0.06)`,
            border: `0.5px solid ${C.green}44`,
            textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 2, color: C.green, marginBottom: 8 }}>
              REAL PEOPLE. REAL IMPACT.
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8 }}>
              <span style={{
                fontFamily: 'var(--syne, sans-serif)', fontSize: 48, fontWeight: 900,
                color: C.green, lineHeight: 1,
              }}>
                <Counter target={347} active={step('impact')} />
              </span>
              <span style={{ fontSize: 16, color: C.muted }}>people / year</span>
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
              would receive a fair outcome instead of an unfair one
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginTop: 4 }}>
              That's 1 person every 26 hours. Not a statistic — a person.
            </div>
          </div>
        </FadeIn>

        {/* ── Step 9: CTA ── */}
        <FadeIn show={step('cta')}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => onDemoComplete(buildMockAuditResponse())}
              style={{
                flex: 1, padding: '12px 0',
                background: C.blue, color: '#fff',
                border: 'none', borderRadius: 10,
                fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', letterSpacing: 0.5,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              See full audit report →
            </button>
            <button
              onClick={onDismiss}
              style={{
                padding: '12px 18px',
                background: 'none', color: C.muted,
                border: `0.5px solid ${C.border}`, borderRadius: 10,
                fontFamily: 'var(--mono)', fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Try my data
            </button>
          </div>
        </FadeIn>

        <style>{`
          @keyframes pgPulse    { 0%{transform:scale(1.15);opacity:.7} 100%{transform:scale(1);opacity:1} }
          @keyframes pgSlideIn  { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
          @keyframes pgSpin     { to{transform:rotate(360deg)} }
        `}</style>
      </div>
    </div>
  );
}
