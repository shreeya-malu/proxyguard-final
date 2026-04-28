import { useState } from 'react';
import { PREAUDITED_DATASETS, PreauditedDataset } from '../../services/datasets';

// ── Design tokens ─────────────────────────────────────────
const C = {
  red: '#FF4D6D', redBg: 'rgba(255,77,109,0.1)', redText: '#FF6B85',
  amber: '#FFB830', amberBg: 'rgba(255,184,48,0.1)', amberText: '#FFB830',
  green: '#3DDC84', greenBg: 'rgba(61,220,132,0.1)', greenText: '#3DDC84',
  blue: '#4D9FFF', blueBg: 'rgba(77,159,255,0.1)', blueText: '#7DBFFF',
  surface: '#13131A', surface2: '#1C1C26', surface3: '#242432',
  border: '#2A2A3A', border2: '#363650',
  text: '#F0F0F8', muted: '#8888AA', hint: '#55556A',
};

const GRADE_STYLE: Record<string, { color: string; bg: string }> = {
  A: { color: C.green, bg: C.greenBg },
  B: { color: C.blue,  bg: C.blueBg  },
  C: { color: C.amber, bg: C.amberBg },
  D: { color: '#FF6B35', bg: 'rgba(255,107,53,0.1)' },
  F: { color: C.red,  bg: C.redBg   },
};

const SDG_COLORS: Record<number, string> = {
  3:  '#4C9F38', 4: '#C5192D', 8: '#A21942',
  10: '#DD1367', 11: '#FD9D24', 16: '#00689D',
};

interface Props {
  onAuditDataset?:   (dataset: PreauditedDataset) => void;
  onSimulateDataset?: (dataset: PreauditedDataset) => void;
}

export default function ExplorePage({ onAuditDataset, onSimulateDataset }: Props) {
  const [selected,   setSelected]   = useState<PreauditedDataset | null>(null);
  const [activeTab,  setActiveTab]  = useState<'overview' | 'variables' | 'interactions' | 'remediation'>('overview');
  const [filterSDG,  setFilterSDG]  = useState<number | null>(null);

  const filtered = filterSDG
    ? PREAUDITED_DATASETS.filter(d => d.sdgs.includes(filterSDG))
    : PREAUDITED_DATASETS;

  const allSDGs = [...new Set(PREAUDITED_DATASETS.flatMap(d => d.sdgs))].sort();

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', color: C.hint, marginBottom: 8 }}>
          Dataset Library
        </div>
        <h2 style={{ fontFamily: 'var(--syne)', fontSize: 26, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 6 }}>
          Explore Famous Biased Datasets
        </h2>
        <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.65, maxWidth: 600 }}>
          Five real-world datasets with documented, published bias already audited
          and graded. No upload needed. See exactly how bias manifests in systems
          that affected millions of real people.
        </p>
      </div>

      {/* SDG filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilterSDG(null)}
          style={{
            fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 12px',
            borderRadius: 99, border: `0.5px solid ${filterSDG === null ? C.blue : C.border2}`,
            background: filterSDG === null ? C.blueBg : 'transparent',
            color: filterSDG === null ? C.blueText : C.muted, cursor: 'pointer',
          }}
        >
          All datasets
        </button>
        {allSDGs.map(sdg => (
          <button key={sdg} onClick={() => setFilterSDG(filterSDG === sdg ? null : sdg)} style={{
            fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 12px',
            borderRadius: 99, border: `0.5px solid ${filterSDG === sdg ? SDG_COLORS[sdg] : C.border2}`,
            background: filterSDG === sdg ? `${SDG_COLORS[sdg]}22` : 'transparent',
            color: filterSDG === sdg ? SDG_COLORS[sdg] : C.muted, cursor: 'pointer',
          }}>
            SDG {sdg}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '340px 1fr' : 'repeat(auto-fill,minmax(300px,1fr))', gap: 16 }}>

        {/* Dataset cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(ds => {
            const gs = GRADE_STYLE[ds.overall_grade];
            const isSelected = selected?.id === ds.id;
            return (
              <div
                key={ds.id}
                onClick={() => { setSelected(isSelected ? null : ds); setActiveTab('overview'); }}
                style={{
                  background: C.surface, border: `0.5px solid ${isSelected ? C.blue : C.border}`,
                  borderRadius: 14, padding: '16px 18px', cursor: 'pointer',
                  transition: 'all 0.15s',
                  boxShadow: isSelected ? `0 0 0 1px ${C.blue}` : 'none',
                }}
                onMouseEnter={e => !isSelected && ((e.currentTarget as HTMLElement).style.borderColor = C.border2)}
                onMouseLeave={e => !isSelected && ((e.currentTarget as HTMLElement).style.borderColor = C.border)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10,
                    background: gs.bg, color: gs.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--syne)', fontSize: 22, fontWeight: 800, flexShrink: 0,
                  }}>
                    {ds.overall_grade}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, lineHeight: 1.3 }}>
                      {ds.name}
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>
                      {ds.domain} · {ds.year} · {ds.rows.toLocaleString()} rows
                    </div>
                  </div>
                </div>

                <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, marginBottom: 10 }}>
                  {ds.key_finding}
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: gs.color, fontWeight: 500 }}>
                    DIR {ds.overall_dir.toFixed(2)}
                  </span>
                  <span style={{ color: C.hint, fontSize: 10 }}>·</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: ds.total_flags > 0 ? C.amber : C.green }}>
                    {ds.total_flags} flag{ds.total_flags !== 1 ? 's' : ''}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    {ds.sdgs.map(s => (
                      <span key={s} style={{
                        fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 6px',
                        borderRadius: 99, background: `${SDG_COLORS[s]}22`, color: SDG_COLORS[s],
                      }}>
                        SDG {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
            {/* Detail header */}
            <div style={{
              padding: '20px 24px',
              background: `linear-gradient(135deg, ${GRADE_STYLE[selected.overall_grade].bg}, transparent)`,
              borderBottom: `0.5px solid ${C.border}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                <div style={{
                  width: 60, height: 60, borderRadius: 14,
                  background: GRADE_STYLE[selected.overall_grade].bg,
                  color: GRADE_STYLE[selected.overall_grade].color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--syne)', fontSize: 30, fontWeight: 800,
                }}>
                  {selected.overall_grade}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--syne)', fontSize: 18, fontWeight: 800, marginBottom: 3 }}>
                    {selected.name}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.hint }}>
                    {selected.source} · {selected.rows.toLocaleString()} rows · {selected.columns} columns
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {onSimulateDataset && (
                    <button onClick={() => onSimulateDataset(selected)} style={{
                      padding: '8px 14px', borderRadius: 8, border: 'none',
                      background: C.blueBg, color: C.blueText,
                      fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                    }}>
                      Simulate
                    </button>
                  )}
                  <button onClick={() => setSelected(null)} style={{
                    padding: '8px 14px', borderRadius: 8,
                    border: `0.5px solid ${C.border2}`, background: 'none',
                    color: C.muted, fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
                  }}>
                    Close
                  </button>
                </div>
              </div>

              {/* Real-world harm callout */}
              <div style={{
                padding: '12px 14px', background: 'rgba(255,77,109,0.06)',
                border: `0.5px solid rgba(255,77,109,0.2)`, borderRadius: 10,
              }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.redText, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 5 }}>
                  Real-World Harm
                </div>
                <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: 0 }}>
                  {selected.real_world_harm}
                </p>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: `0.5px solid ${C.border}`, padding: '0 24px' }}>
              {(['overview','variables','interactions','remediation'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer',
                  fontFamily: 'var(--mono)', fontSize: 11,
                  color: activeTab === tab ? C.text : C.muted,
                  borderBottom: `2px solid ${activeTab === tab ? C.blue : 'transparent'}`,
                  marginBottom: -1, textTransform: 'capitalize',
                }}>
                  {tab.replace('-', ' ')}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ padding: '20px 24px', maxHeight: '60vh', overflowY: 'auto' }}>

              {/* Overview */}
              {activeTab === 'overview' && (
                <div>
                  {/* DIR per group */}
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.8px', color: C.hint, marginBottom: 12 }}>
                    Disparate Impact Per Protected Attribute
                  </div>
                  {selected.disparate_impact.map(d => (
                    <div key={d.protected_attribute} style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500 }}>{d.protected_attribute}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: d.passes ? C.green : C.red }}>
                          {d.dir_score.toFixed(2)} {d.passes ? '✓' : '✗'}
                        </span>
                      </div>
                      {/* Visual bar */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: C.hint, fontFamily: 'var(--mono)', marginBottom: 3 }}>{d.privileged_group}</div>
                          <div style={{ height: 6, background: C.surface3, borderRadius: 3 }}>
                            <div style={{ height: '100%', borderRadius: 3, width: `${d.privileged_rate * 100}%`, background: C.blue }} />
                          </div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.blueText, marginTop: 2 }}>{(d.privileged_rate * 100).toFixed(0)}%</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: C.hint, fontFamily: 'var(--mono)', marginBottom: 3 }}>{d.unprivileged_group}</div>
                          <div style={{ height: 6, background: C.surface3, borderRadius: 3 }}>
                            <div style={{ height: '100%', borderRadius: 3, width: `${d.unprivileged_rate * 100}%`, background: d.passes ? C.green : C.red }} />
                          </div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: d.passes ? C.greenText : C.redText, marginTop: 2 }}>{(d.unprivileged_rate * 100).toFixed(0)}%</div>
                        </div>
                      </div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '6px 10px', background: d.passes ? C.greenBg : C.redBg, borderRadius: 6, color: d.passes ? C.greenText : C.redText }}>
                        {d.unprivileged_group} receives positive outcome at {(d.dir_score * 100).toFixed(0)}% the rate of {d.privileged_group}
                        {!d.passes && ' FAILS EEOC 4/5ths Rule'}
                      </div>
                    </div>
                  ))}

                  {/* Gemini summary */}
                  <div style={{ marginTop: 20, padding: '14px 16px', background: C.surface2, borderRadius: 10, border: `0.5px solid ${C.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.blue, display: 'inline-block' }} />
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Gemini Summary</span>
                    </div>
                    <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, margin: 0 }}>{selected.gemini_summary}</p>
                  </div>

                  {/* Source */}
                  <div style={{ marginTop: 16, fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>
                    Source: {selected.source} · <a href={selected.source_url} target="_blank" rel="noreferrer" style={{ color: C.blueText }}>View dataset</a>
                  </div>
                </div>
              )}

              {/* Variables */}
              {activeTab === 'variables' && (
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.8px', color: C.hint, marginBottom: 14 }}>
                    Variable Risk Bias Attribution
                  </div>
                  {selected.top_variables.map(v => {
                    const rColor = v.risk_level === 'HIGH' ? C.red : v.risk_level === 'MEDIUM' ? C.amber : C.hint;
                    return (
                      <div key={v.name} style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: rColor, flexShrink: 0 }} />
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, flex: 1 }}>{v.name}</span>
                          {v.proxy_for && <span style={{ fontSize: 10, color: C.hint, fontFamily: 'var(--mono)' }}>→ {v.proxy_for}</span>}
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: rColor }}>{v.mi_score.toFixed(3)}</span>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 7px', borderRadius: 4, background: `${rColor}22`, color: rColor }}>{v.risk_level}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 4, background: C.surface3, borderRadius: 2 }}>
                            <div style={{ height: '100%', borderRadius: 2, width: `${v.contribution}%`, background: rColor }} />
                          </div>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, width: 36, textAlign: 'right' }}>{v.contribution.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Interactions */}
              {activeTab === 'interactions' && (
                <div>
                  <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
                    These pairs of variables together create more bias than either alone.
                    This "interaction bias" survives individual variable screening.
                  </p>
                  {selected.interactions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 20px', color: C.green, fontFamily: 'var(--mono)', fontSize: 13 }}>
                      No interaction biases detected
                    </div>
                  ) : selected.interactions.map((ix, i) => (
                    <div key={i} style={{ marginBottom: 14, padding: '12px 14px', background: C.surface2, borderRadius: 10, borderLeft: `3px solid #A855F7` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 9px', borderRadius: 4, background: 'rgba(168,85,247,0.15)', color: '#C084FC' }}>{ix.feature_a}</span>
                        <span style={{ color: C.hint, fontSize: 11 }}>×</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 9px', borderRadius: 4, background: 'rgba(168,85,247,0.15)', color: '#C084FC' }}>{ix.feature_b}</span>
                        <span style={{ color: C.hint }}></span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 9px', borderRadius: 4, background: C.amberBg, color: C.amberText }}>{ix.protected}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, color: C.red }}>+{ix.lift.toFixed(2)} lift</span>
                      </div>
                      <div style={{ fontSize: 12, color: C.muted }}>
                        Combined bias lift of +{ix.lift.toFixed(2)} above the strongest individual variable.
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Remediation */}
              {activeTab === 'remediation' && (
                <div>
                  <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
                    Follow these steps to bring the dataset to a passing grade (DIR ≥ 0.80).
                  </p>
                  {selected.remediation_steps.map(step => (
                    <div key={step.step} style={{
                      display: 'flex', gap: 12, marginBottom: 10,
                      padding: '12px 14px',
                      border: `0.5px solid ${step.passes ? 'rgba(61,220,132,0.3)' : C.border}`,
                      borderRadius: 10,
                      background: step.passes ? 'rgba(61,220,132,0.05)' : C.surface2,
                    }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                        background: C.text, color: C.surface,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500,
                      }}>
                        {step.step}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{
                            fontFamily: 'var(--mono)', fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 500,
                            background: step.action === 'REMOVE' ? C.redBg : step.action === 'BIN' ? C.amberBg : C.blueBg,
                            color: step.action === 'REMOVE' ? C.redText : step.action === 'BIN' ? C.amberText : C.blueText,
                          }}>{step.action}</span>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500 }}>{step.variable}</span>
                          <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: step.passes ? C.green : C.amber }}>
                            DIR : {step.dir_after.toFixed(2)} {step.passes ? 'PASS' : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
