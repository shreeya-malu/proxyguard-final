import { useState } from 'react';
import { PREAUDITED_DATASETS, PreauditedDataset } from '../../services/datasets';

const C = {
  red: '#FF4D6D', redBg: 'rgba(255,77,109,0.1)', redText: '#FF6B85',
  amber: '#FFB830', amberBg: 'rgba(255,184,48,0.1)', amberText: '#FFB830',
  green: '#3DDC84', greenBg: 'rgba(61,220,132,0.1)', greenText: '#3DDC84',
  blue: '#4D9FFF', blueBg: 'rgba(77,159,255,0.1)', blueText: '#7DBFFF',
  surface: '#13131A', surface2: '#1C1C26', surface3: '#242432',
  border: '#2A2A3A', border2: '#363650',
  text: '#F0F0F8', muted: '#8888AA', hint: '#55556A',
};

interface SimResult {
  group_a: { name: string; rate: number; is_disadvantaged: boolean };
  group_b: { name: string; rate: number; is_disadvantaged: boolean };
  dir_score: number;
  passes_legal: boolean;
  absolute_gap: number;
  per_1000_gap: number;
  disadvantaged_group: string;
  driving_variables: { name: string; mi_score: number; contribution: number; proxy_for: string | null }[];
  top_fix: { action: string; variable: string; dir_after: number; passes: boolean } | null;
  framing: { headline: string; comparison: string; legal_status: string; real_world: string };
}

function computeSimulation(dataset: PreauditedDataset, dirResult: typeof dataset.disparate_impact[0]): SimResult {
  const per1000 = Math.round(Math.abs(dirResult.privileged_rate - dirResult.unprivileged_rate) * 1000);
  const disadvantaged = dirResult.unprivileged_group;
  const advRate   = dirResult.privileged_rate;
  const disRate   = dirResult.unprivileged_rate;

  const drivingVars = dataset.top_variables
    .filter(v => v.proxy_for === dirResult.protected_attribute)
    .slice(0, 3)
    .map(v => ({ name: v.name, mi_score: v.mi_score, contribution: v.contribution, proxy_for: v.proxy_for }));

  const topFix = dataset.remediation_steps[0]
    ? { action: dataset.remediation_steps[0].action, variable: dataset.remediation_steps[0].variable,
        dir_after: dataset.remediation_steps[0].dir_after, passes: dataset.remediation_steps[0].passes }
    : null;

  return {
    group_a: { name: dirResult.privileged_group,   rate: advRate,  is_disadvantaged: false },
    group_b: { name: dirResult.unprivileged_group, rate: disRate,  is_disadvantaged: true  },
    dir_score: dirResult.dir_score,
    passes_legal: dirResult.passes,
    absolute_gap: Math.round(Math.abs(advRate - disRate) * 1000) / 1000,
    per_1000_gap: per1000,
    disadvantaged_group: disadvantaged,
    driving_variables: drivingVars,
    top_fix: topFix,
    framing: {
      headline: `For every 1,000 people evaluated, ${per1000} more ${dirResult.privileged_group} people receive a positive outcome than ${disadvantaged} people due to proxy variables in the training data.`,
      comparison: `${dirResult.privileged_group}: positive outcome ${(advRate * 100).toFixed(0)}% of the time.\n${disadvantaged}: positive outcome ${(disRate * 100).toFixed(0)}% of the time.\nThat's a ${(Math.abs(advRate - disRate) * 100).toFixed(1)} percentage point gap.`,
      legal_status: dirResult.passes
        ? `Within legal bounds (DIR ${dirResult.dir_score.toFixed(2)} ≥ 0.80), but a gap still exists and should be monitored.`
        : `FAILS the EEOC 4/5ths Rule. DIR of ${dirResult.dir_score.toFixed(2)} means ${disadvantaged} people receive positive outcomes at only ${Math.round(dirResult.dir_score * 100)}% the rate of ${dirResult.privileged_group} people.`,
      real_world: `In a system processing 10,000 decisions per year, this bias results in approximately ${per1000 * 10} fewer positive outcomes for ${disadvantaged} people compared to ${dirResult.privileged_group} people not because of merit, but because of proxy variables in the training data.`,
    },
  };
}

export default function SimulatePage() {
  const [step,        setStep]        = useState<1 | 2 | 3>(1);
  const [dataset,     setDataset]     = useState<PreauditedDataset | null>(null);
  const [dirIndex,    setDirIndex]    = useState(0);
  const [result,      setResult]      = useState<SimResult | null>(null);
  const [showFix,     setShowFix]     = useState(false);

  const handleSelectDataset = (ds: PreauditedDataset) => {
    setDataset(ds);
    setDirIndex(0);
    setResult(null);
    setShowFix(false);
    setStep(2);
  };

  const handleRunSim = () => {
    if (!dataset) return;
    const sim = computeSimulation(dataset, dataset.disparate_impact[dirIndex]);
    setResult(sim);
    setStep(3);
  };

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', color: C.hint, marginBottom: 8 }}>
          Outcome Simulator
        </div>
        <h2 style={{ fontFamily: 'var(--syne)', fontSize: 26, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 6 }}>
          What Would Happen to You?
        </h2>
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.65, maxWidth: 600 }}>
          Pick a real dataset. Pick two demographic groups. See the outcome gap exactly how many
          more people from one group receive a positive outcome compared to the other, and why.
          Grounded in real computed data, not speculation.
        </p>
      </div>

      {/* Step 1 — Pick dataset */}
      {step >= 1 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.8px', color: C.hint, marginBottom: 12 }}>
            Step 1: Choose a real-world dataset
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {PREAUDITED_DATASETS.map(ds => {
              const isActive = dataset?.id === ds.id;
              const gradeColors = { A: C.green, B: C.blue, C: C.amber, D: '#FF6B35', F: C.red };
              const gc = gradeColors[ds.overall_grade as keyof typeof gradeColors];
              return (
                <div key={ds.id} onClick={() => handleSelectDataset(ds)} style={{
                  padding: '14px 16px', borderRadius: 12,
                  border: `0.5px solid ${isActive ? gc : C.border}`,
                  background: isActive ? `${gc}0D` : C.surface,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--syne)', fontSize: 20, fontWeight: 800, color: gc }}>{ds.overall_grade}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{ds.name}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>{ds.domain}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>{ds.key_finding}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2 — Pick groups */}
      {step >= 2 && dataset && (
        <div style={{
          marginBottom: 24,
          padding: '20px 24px',
          background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 14,
        }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.8px', color: C.hint, marginBottom: 14 }}>
            Step 2: Choose protected attribute to compare
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            {dataset.disparate_impact.map((d, i) => (
              <button key={d.protected_attribute} onClick={() => setDirIndex(i)} style={{
                padding: '10px 18px', borderRadius: 10,
                border: `0.5px solid ${dirIndex === i ? C.blue : C.border2}`,
                background: dirIndex === i ? C.blueBg : 'none',
                color: dirIndex === i ? C.blueText : C.muted,
                cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 12,
                transition: 'all 0.15s',
              }}>
                {d.protected_attribute}
                <span style={{ marginLeft: 8, fontWeight: 700, color: d.passes ? C.green : C.red }}>
                  {d.dir_score.toFixed(2)}
                </span>
              </button>
            ))}
          </div>

          {/* Group preview */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {[dataset.disparate_impact[dirIndex].privileged_group, dataset.disparate_impact[dirIndex].unprivileged_group].map((grp, gi) => {
              const rate = gi === 0 ? dataset.disparate_impact[dirIndex].privileged_rate : dataset.disparate_impact[dirIndex].unprivileged_rate;
              const isDisadv = gi === 1;
              return (
                <div key={grp} style={{
                  padding: '14px 16px', borderRadius: 10,
                  border: `0.5px solid ${isDisadv ? 'rgba(255,77,109,0.3)' : 'rgba(77,159,255,0.3)'}`,
                  background: isDisadv ? C.redBg : C.blueBg,
                }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: isDisadv ? C.redText : C.blueText, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {isDisadv ? 'Disadvantaged Group' : 'Advantaged Group'}
                  </div>
                  <div style={{ fontFamily: 'var(--syne)', fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{grp}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: isDisadv ? C.red : C.blue }}>
                    {(rate * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>positive outcome rate</div>
                </div>
              );
            })}
          </div>

          <button onClick={handleRunSim} style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none',
            background: C.blue, color: '#fff', fontFamily: 'var(--mono)',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>
            Show Me The Outcome Gap
          </button>
        </div>
      )}

      {/* Step 3 — Results */}
      {step >= 3 && result && dataset && (
        <div style={{ background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>

          {/* Hero stat */}
          <div style={{
            padding: '28px 32px',
            background: `linear-gradient(135deg, ${C.redBg}, transparent)`,
            borderBottom: `0.5px solid ${C.border}`,
          }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12 }}>
              The Outcome Gap {dataset.name}
            </div>
            <div style={{ fontFamily: 'var(--syne)', fontSize: 17, fontWeight: 600, lineHeight: 1.5, marginBottom: 20, maxWidth: 600 }}>
              {result.framing.headline}
            </div>

            {/* Visual comparison */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'center', marginBottom: 20 }}>
              {[result.group_a, result.group_b].map((g, gi) => (
                <>
                  {gi === 1 && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginBottom: 4 }}>GAP</div>
                      <div style={{ fontFamily: 'var(--syne)', fontSize: 24, fontWeight: 800, color: C.red }}>
                        {(result.absolute_gap * 100).toFixed(1)}pp
                      </div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>percentage points</div>
                    </div>
                  )}
                  <div key={g.name} style={{
                    padding: '16px 20px', borderRadius: 12,
                    border: `0.5px solid ${g.is_disadvantaged ? 'rgba(255,77,109,0.4)' : 'rgba(77,159,255,0.4)'}`,
                    background: g.is_disadvantaged ? C.redBg : C.blueBg,
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{g.name}</div>
                    <div style={{ fontFamily: 'var(--syne)', fontSize: 36, fontWeight: 800, color: g.is_disadvantaged ? C.red : C.blue, lineHeight: 1 }}>
                      {(g.rate * 100).toFixed(0)}%
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>positive outcome rate</div>
                    {/* Bar */}
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 10 }}>
                      <div style={{ height: '100%', borderRadius: 2, width: `${g.rate * 100}%`, background: g.is_disadvantaged ? C.red : C.blue }} />
                    </div>
                  </div>
                </>
              ))}
            </div>

            {/* Legal status */}
            <div style={{
              padding: '12px 16px', borderRadius: 10,
              background: result.passes_legal ? C.greenBg : C.redBg,
              border: `0.5px solid ${result.passes_legal ? 'rgba(61,220,132,0.3)' : 'rgba(255,77,109,0.3)'}`,
              fontFamily: 'var(--mono)', fontSize: 12,
              color: result.passes_legal ? C.greenText : C.redText,
            }}>
              {result.framing.legal_status}
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '24px 32px' }}>

            {/* Real-world scale */}
            <div style={{ marginBottom: 24, padding: '16px 20px', background: C.surface2, borderRadius: 12, border: `0.5px solid ${C.border}` }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                At Scale, Real World Impact
              </div>
              <p style={{ fontSize: 14, color: C.text, lineHeight: 1.7, margin: 0 }}>
                {result.framing.real_world}
              </p>
              <div style={{ marginTop: 12, display: 'flex', gap: 20 }}>
                <div>
                  <div style={{ fontFamily: 'var(--syne)', fontSize: 28, fontWeight: 800, color: C.red }}>
                    {result.per_1000_gap}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>fewer positive outcomes<br />per 1,000 decisions</div>
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--syne)', fontSize: 28, fontWeight: 800, color: C.red }}>
                    {result.per_1000_gap * 10}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>per 10,000<br />decisions per year</div>
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--syne)', fontSize: 28, fontWeight: 800, color: C.amber }}>
                    {(result.dir_score * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: 11, color: C.muted }}>the rate of<br />the advantaged group</div>
                </div>
              </div>
            </div>

            {/* Driving variables */}
            {result.driving_variables.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.8px', color: C.hint, marginBottom: 12 }}>
                  Why This Gap Exists: The Proxy Variables
                </div>
                <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
                  These variables are mathematically correlated with the protected attribute.
                  The model uses them as stand-ins which is legally equivalent to using the protected attribute directly.
                </p>
                {result.driving_variables.map(v => (
                  <div key={v.name} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                    marginBottom: 8, background: C.surface2, borderRadius: 10,
                    border: `0.5px solid ${C.border}`, borderLeft: `3px solid ${C.red}`,
                  }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, flex: 1 }}>{v.name}</span>
                    <span style={{ fontSize: 11, color: C.muted, fontFamily: 'var(--mono)' }}>→ {v.proxy_for}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.red }}>MI {v.mi_score.toFixed(3)}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 7px', borderRadius: 4, background: C.redBg, color: C.redText }}>
                      {v.contribution.toFixed(0)}% of bias
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Fix preview */}
            {result.top_fix && (
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.8px', color: C.hint, marginBottom: 12 }}>
                  What Fixes This
                </div>
                <div style={{
                  padding: '16px 20px', borderRadius: 12,
                  border: `0.5px solid rgba(61,220,132,0.3)`,
                  background: 'rgba(61,220,132,0.05)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 8px', borderRadius: 4, background: C.redBg, color: C.redText, fontWeight: 500 }}>
                      {result.top_fix.action}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600 }}>{result.top_fix.variable}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: result.top_fix.passes ? C.green : C.amber }}>
                      DIR → {result.top_fix.dir_after.toFixed(2)} {result.top_fix.passes ? 'PASS' : ''}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: 0 }}>
                    {result.top_fix.passes
                      ? `Removing "${result.top_fix.variable}" alone would bring this dataset to a passing grade the outcome gap would shrink from ${(result.absolute_gap * 100).toFixed(1)}pp to legal compliance.`
                      : `Removing "${result.top_fix.variable}" reduces the gap but further remediation is still needed to reach the 0.80 threshold.`
                    }
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div style={{ padding: '16px 32px', borderTop: `0.5px solid ${C.border}`, background: C.surface2, display: 'flex', gap: 10 }}>
            <button onClick={() => { setStep(1); setDataset(null); setResult(null); }} style={{
              padding: '9px 16px', borderRadius: 8, border: `0.5px solid ${C.border2}`,
              background: 'none', color: C.muted, fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer',
            }}>
              Try Another Dataset
            </button>
            <button onClick={() => setStep(2)} style={{
              padding: '9px 16px', borderRadius: 8, border: `0.5px solid ${C.border2}`,
              background: 'none', color: C.muted, fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer',
            }}>
              Compare Different Groups
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
