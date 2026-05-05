/**
 * DemoMode — Guided System Walkthrough
 * =====================================
 * A narrator-guided tour of the actual ProxyGuard UI.
 * Shows real screens, real features, real data.
 * Small popup "narrator boxes" explain what's happening at each step —
 * like having a human guide pointing at the screen.
 *
 * KEY FIX: Narrator is now rendered as a fixed overlay OUTSIDE the
 * scrollable content area, so it never overlaps or gets clipped.
 * A soft vignette dims the screen edges to keep focus on the popup.
 */

import { useState, useEffect } from 'react';

interface Props {
  onExit: () => void;
}

const C = {
  bg:      'var(--bg-base)',
  s1:      'var(--bg-surface)',
  s2:      'var(--bg-surface2)',
  s3:      'var(--bg-surface3)',
  border:  'var(--border)',
  border2: 'var(--border2)',
  text:    'var(--text-primary)',
  muted:   'var(--text-secondary)',
  hint:    'var(--text-hint)',
  green:   'var(--sage)',
  greenBg: 'var(--sage-bg)',
  red:     'var(--wine)',
  redBg:   'var(--wine-bg)',
  amber:   'var(--amber)',
  amberBg: 'var(--amber-bg)',
  blue:    'var(--navy)',
  blueBg:  'var(--navy-bg)',
  blueBg2: 'var(--navy-bg2)',
  slate:   'var(--slate)',
  slateBg: 'var(--slate-bg)',
};

interface Step {
  id: string;
  title: string;
  body: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  screen: 'problem' | 'upload' | 'config' | 'engine' | 'plain' | 'story' | 'metrics' | 'proxies' | 'proxy-detail' | 'sandbox' | 'remediation' | 'explore' | 'registry' | 'trust';
  nextLabel?: string;
}

const STEPS: Step[] = [
  {
    id: 'problem',
    title: 'The problem ProxyGuard solves',
    body: 'Every day, AI systems make life-changing decisions — loan approvals, job shortlisting, medical referrals, bail recommendations. Most were trained on historical data that was already biased. Without a tool like this, no one inside the organization even knows.',
    position: 'center',
    screen: 'problem',
  },
  {
    id: 'upload',
    title: 'Step 1 — Upload your dataset',
    body: 'Start by dragging and dropping any CSV. ProxyGuard reads the column headers automatically and guesses which columns are protected attributes (race, gender, age) and which is your outcome column. No manual setup.',
    position: 'bottom-right',
    screen: 'upload',
  },
  {
    id: 'config',
    title: 'Tell it your industry',
    body: 'Select Finance, HR, or Healthcare. Each has a different legal fairness threshold. Finance uses the Equal Credit Opportunity Act. HR uses the EEOC 4/5ths Rule. Healthcare uses TPR Parity. ProxyGuard picks the right legal standard automatically.',
    position: 'bottom-right',
    screen: 'config',
  },
  {
    id: 'engine',
    title: 'What happens when you click Run Audit',
    body: 'The bias engine runs 7 independent fairness metrics simultaneously. It also scans every variable for proxy patterns using Mutual Information — finding features that predict protected attributes even when the protected attribute itself is not in the model. This is what most tools miss.',
    position: 'center',
    screen: 'engine',
  },
  {
    id: 'plain',
    title: 'Plain English tab — built for non-experts',
    body: "A bias auditor's job isn't done when they find the bias — it's done when they've communicated it. This tab translates every metric into plain language. A CEO, a judge, or a regulator can read this and understand exactly what's wrong.",
    position: 'bottom-left',
    screen: 'plain',
  },
  {
    id: 'story',
    title: 'Human Impact tab — the emotional layer',
    body: "Numbers don't change minds. Stories do. Gemini translates the audit results into a human story — one person, one decision, what it meant for their life. The numbers come from the math engine. Gemini only writes the words, and it's explicitly constrained to never invent statistics.",
    position: 'bottom-left',
    screen: 'story',
  },
  {
    id: 'metrics',
    title: 'All Metrics tab — the full technical audit',
    body: "Every fairness metric, its value, the legal threshold, and PASS/FAIL status. If two metrics are mathematically impossible to satisfy simultaneously — like Predictive Parity vs Equalised Odds when base rates differ — ProxyGuard flags it as an Impossibility Conflict. That's a finding in itself.",
    position: 'bottom-left',
    screen: 'metrics',
  },
  {
    id: 'proxies',
    title: 'Proxies tab — the most important screen',
    body: "This is where ProxyGuard goes further than any other tool. Discrimination law bans using protected attributes directly. But a model can achieve identical discrimination through proxies — zip code predicts race, surname predicts caste, school name predicts religion. This tab finds them all, ranked by bias contribution.",
    position: 'bottom-left',
    screen: 'proxies',
  },
  {
    id: 'proxy-detail',
    title: 'Click any variable to see the proof',
    body: "Expand a variable and you'll see the Mutual Information score — precisely how much information about the protected attribute is encoded here. A score of 0.83 means knowing someone's decile_score predicts their race with 83% accuracy. The legal flagging threshold is 40%.",
    position: 'bottom-right',
    screen: 'proxy-detail',
  },
  {
    id: 'sandbox',
    title: 'Sandbox tab — experiment before committing',
    body: "Toggle proxy variables on and off to see how your fairness metrics shift in real time. The projection uses calibrated factors from the fairness literature — it's not a guess. Test your fix before applying it to your actual model.",
    position: 'bottom-left',
    screen: 'sandbox',
  },
  {
    id: 'remediation',
    title: 'Fix & Re-audit — the Monday morning answer',
    body: "Here's what you actually do with the findings. A step-by-step remediation plan: REMOVE this variable, BIN that one, REWEIGHT training. After each fix, it shows exactly how many people per year would now receive a fair outcome.",
    position: 'bottom-left',
    screen: 'remediation',
    nextLabel: 'Show me Explore →',
  },
  {
    id: 'explore',
    title: 'Explore — 5 famous biased datasets',
    body: "Don't have your own data? Start here. Five pre-audited real-world datasets — COMPAS (US courts), German Credit, Adult Income, and more. Each is fully audited and graded. Use these to understand what bias actually looks like before auditing your own.",
    position: 'bottom-right',
    screen: 'explore',
  },
  {
    id: 'registry',
    title: 'Public Registry — accountability at scale',
    body: 'Every completed audit can be published here. Each entry gets a cryptographically signed certificate — tamper-proof, hash-verified with Cloud KMS. An organization can prove to regulators or the public that their model was checked before deployment.',
    position: 'bottom-left',
    screen: 'registry',
  },
  {
    id: 'trust',
    title: 'Why you can trust the numbers',
    body: 'Every method is grounded in peer-reviewed research: Feldman et al. (2015) for proxy detection, Chouldechova (2017) for impossibility conflicts, Hardt et al. (2016) for Equalised Odds. The projection engine uses calibrated empirical factors. Gemini is temperature-capped at 0.4 and never touches the math.',
    position: 'center',
    screen: 'trust',
    nextLabel: 'Start auditing →',
  },
];

// ── Shared tab bar ────────────────────────────────────────────────────────────
function TabBar({ activeId }: { activeId: string }) {
  const tabs = [
    { id: 'plain', label: 'Plain English' },
    { id: 'story', label: 'Human Impact' },
    { id: 'metrics', label: 'All Metrics' },
    { id: 'proxies', label: 'Proxies' },
    { id: 'sandbox', label: 'Sandbox' },
    { id: 'remediation', label: 'Fix & Re-audit' },
  ];
  return (
    <div style={{ display: 'flex', borderBottom: `0.5px solid ${C.border}`, overflowX: 'auto', flexShrink: 0 }}>
      {tabs.map(t => (
        <div key={t.id} style={{
          fontFamily: 'var(--mono)', fontSize: 11, padding: '8px 14px', whiteSpace: 'nowrap',
          borderBottom: `2px solid ${t.id === activeId ? C.blue : 'transparent'}`,
          color: t.id === activeId ? C.text : C.hint, cursor: 'default',
        }}>
          {t.label}
        </div>
      ))}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ screen }: { screen: string }) {
  const surfaceMap: Record<string, string> = {
    explore: 'explore', registry: 'registry',
  };
  const active = surfaceMap[screen] ?? 'audit';
  const nav = [
    { id: 'audit', label: 'Audit', icon: '◈' },
    { id: 'explore', label: 'Explore', icon: '⊞' },
    { id: 'simulate', label: 'Simulate', icon: '⟳' },
    { id: 'registry', label: 'Registry', icon: '≡' },
  ];
  return (
    <div style={{ width: 200, flexShrink: 0, background: C.s1, borderRight: `0.5px solid ${C.border}`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 16px 14px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 6, background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: C.bg, boxShadow: `0 0 16px ${C.blue}44` }}>PG</div>
        <div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: C.text }}>ProxyGuard</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: C.hint, letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 1 }}>Studio</div>
        </div>
      </div>
      <div style={{ padding: '10px 14px', borderBottom: `0.5px solid ${C.border}`, display: 'flex', gap: 4 }}>
        {[{ label: 'SDG 10', color: C.red }, { label: 'SDG 16', color: C.slate }].map(s => (
          <span key={s.label} style={{ fontFamily: 'var(--mono)', fontSize: 8.5, padding: '2px 7px', borderRadius: 3, border: `0.5px solid ${s.color}44`, color: s.color, background: `${s.color}0D` }}>{s.label}</span>
        ))}
      </div>
      <nav style={{ padding: '10px 8px', flex: 1 }}>
        {nav.map(item => {
          const isActive = active === item.id;
          return (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', borderRadius: 4, marginBottom: 1,
              background: isActive ? C.blueBg2 : 'transparent',
              color: isActive ? C.blue : C.muted,
              fontFamily: 'var(--mono)', fontSize: 11, position: 'relative',
            }}>
              {isActive && <div style={{ position: 'absolute', left: 0, top: '20%', bottom: '20%', width: 2, borderRadius: 2, background: C.blue, boxShadow: `0 0 8px ${C.blue}` }} />}
              <span style={{ fontSize: 12, opacity: isActive ? 1 : 0.5 }}>{item.icon}</span>
              <span>{item.label}</span>
            </div>
          );
        })}
      </nav>
      <div style={{ padding: '8px 14px', borderTop: `0.5px solid ${C.border}`, fontFamily: 'var(--mono)', fontSize: 8.5, color: C.hint }}>v3.0 · 7 metrics · India context</div>
    </div>
  );
}

// ── Screens ───────────────────────────────────────────────────────────────────

function ScreenProblem() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '60px 40px', textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: 20, marginBottom: 44, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { icon: '🏦', domain: 'Finance',    decision: 'Loan approved?',       bias: 'Race proxied by zip code',          color: C.red },
          { icon: '💼', domain: 'HR / Hiring', decision: 'Interview shortlist?', bias: 'Caste proxied by surname',          color: C.amber },
          { icon: '🏥', domain: 'Healthcare', decision: 'Referral approved?',   bias: 'Gender proxied by diagnosis history', color: C.slate },
        ].map((item, i) => (
          <div key={i} style={{ background: C.s1, border: `0.5px solid ${C.border2}`, borderRadius: 14, padding: '24px 22px', width: 192, animation: `pgFU 0.4s ease ${i * 0.12}s both` }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>{item.icon}</div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>{item.domain}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted, marginBottom: 14 }}>{item.decision}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '4px 8px', borderRadius: 4, background: `${item.color}12`, color: item.color, border: `0.5px solid ${item.color}33`, lineHeight: 1.5 }}>⚠ {item.bias}</div>
          </div>
        ))}
      </div>
      <div style={{ maxWidth: 520 }}>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 26, color: C.text, lineHeight: 1.35, marginBottom: 14 }}>
          If a model learned from <em style={{ fontStyle: 'italic', color: C.red }}>unfair history</em>,<br />it will repeat that history at scale, invisibly.
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.muted, letterSpacing: 0.3 }}>ProxyGuard finds it before the model goes live.</div>
      </div>
    </div>
  );
}

function ScreenUpload({ showIndustry }: { showIndustry?: boolean }) {
  return (
    <div style={{ padding: '32px 36px', maxWidth: 600, margin: '0 auto' }}>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 26, color: C.text, marginBottom: 8, lineHeight: 1.2 }}>Audit your dataset<br /><em style={{ fontStyle: 'italic', color: C.blue }}>before</em> you train.</div>
      <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: C.muted, marginBottom: 24, lineHeight: 1.65 }}>Upload a CSV. ProxyGuard reads the column headers automatically.</div>

      {/* Dropzone */}
      <div style={{
        border: `1.5px dashed ${showIndustry ? C.border2 : C.blue}`, borderRadius: 12, padding: '38px 32px', textAlign: 'center',
        background: showIndustry ? C.s1 : C.blueBg, marginBottom: 20,
        boxShadow: showIndustry ? 'none' : `0 0 0 3px ${C.blueBg2}`,
      }}>
        {showIndustry ? (
          <>
            <div style={{ fontSize: 20, marginBottom: 8 }}>✅</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.green }}>compas-scores-two-years.csv</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginTop: 4 }}>7,214 rows · 53 columns detected</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 26, marginBottom: 10 }}>📂</div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 14, color: C.muted, marginBottom: 6 }}>Drop your CSV here, or click to browse</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>CSV · up to 50 MB · headers auto-detected</div>
          </>
        )}
      </div>

      {/* Industry selector */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: C.muted, marginBottom: 10 }}>Industry context</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[
            { icon: '🏦', label: 'Finance',    metric: 'FPR Parity',   law: 'ECOA' },
            { icon: '💼', label: 'HR / Hiring', metric: 'Dem. Parity', law: 'EEOC' },
            { icon: '🏥', label: 'Healthcare', metric: 'TPR Parity',   law: 'CRA' },
          ].map((ind, i) => (
            <div key={i} style={{
              padding: '13px 10px', borderRadius: 8, textAlign: 'center',
              border: `0.5px solid ${showIndustry && i === 0 ? C.blue : C.border}`,
              background: showIndustry && i === 0 ? C.blueBg2 : C.s1,
              boxShadow: showIndustry && i === 0 ? `0 0 0 2px ${C.blueBg2}` : 'none',
            }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{ind.icon}</div>
              <div style={{ fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 600, color: C.text }}>{ind.label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.muted, marginTop: 2 }}>{ind.metric}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: C.hint }}>{ind.law}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: 12, background: C.blue, color: C.bg, borderRadius: 8, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', opacity: showIndustry ? 1 : 0.35 }}>
        Run Audit
      </div>
    </div>
  );
}

function ScreenEngine() {
  const items = [
    { name: 'Disparate Impact Ratio',      abbr: 'DIR', basis: 'EEOC 4/5ths Rule',  special: false },
    { name: 'Statistical Parity Difference', abbr: 'SPD', basis: 'AIF360 Standard',   special: false },
    { name: 'Equal Opportunity Difference', abbr: 'EOD', basis: 'Hardt et al. 2016', special: false },
    { name: 'Equalised Odds Difference',   abbr: 'EqO', basis: 'Article 14',         special: false },
    { name: 'FPR Parity',                  abbr: 'FPR', basis: 'ECOA / Fair Housing', special: false },
    { name: 'Predictive Parity',           abbr: 'PP',  basis: 'Chouldechova 2017',  special: false },
    { name: 'Proxy Variable Scan (MI)',    abbr: 'MI',  basis: 'Feldman et al. 2015', special: true },
  ];
  return (
    <div style={{ padding: '36px 40px', maxWidth: 600, margin: '0 auto' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.5, color: C.hint, marginBottom: 20, textTransform: 'uppercase' }}>7 metrics computed in parallel</div>
      {items.map((m, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
          borderRadius: 8, marginBottom: 6, animation: `pgFU 0.25s ease ${i * 0.06}s both`,
          background: m.special ? `${C.amber}0A` : C.s1,
          border: `0.5px solid ${m.special ? C.amber + '33' : C.border}`,
        }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: C.bg, fontWeight: 700, flexShrink: 0 }}>✓</div>
          <span style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500, flex: 1, color: C.text }}>{m.name}</span>
          {m.special && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.amber, background: `${C.amber}18`, padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap' }}>UNIQUE TO PROXYGUARD</span>}
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, whiteSpace: 'nowrap' }}>{m.basis}</span>
        </div>
      ))}
      <div style={{ marginTop: 18, padding: '12px 16px', borderRadius: 10, background: C.s2, border: `0.5px solid ${C.border2}` }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted, lineHeight: 1.75 }}>
          Results are graded A–F. If two metrics are mathematically incompatible (Predictive Parity + Equalised Odds with unequal base rates), the conflict is flagged — that itself is a finding.
        </div>
      </div>
    </div>
  );
}

function ScreenPlain() {
  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TabBar activeId="plain" />
      <div style={{ marginTop: 22, flex: 1, overflowY: 'auto' }}>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 20, color: C.text, marginBottom: 18, lineHeight: 1.35 }}>
          This model treats African-American defendants <span style={{ color: C.red }}>unfairly</span> compared to Caucasian defendants.
        </div>
        {[
          { metric: 'Disparate Impact Ratio', value: '0.61', status: 'FAIL', color: C.red, text: 'African-American defendants receive a favourable outcome only 61% as often as Caucasian defendants with the same risk profile. The legal minimum is 80%.' },
          { metric: 'Statistical Parity', value: '−0.15', status: 'FAIL', color: C.red, text: 'A 15 percentage point gap exists in outcome rates between groups. This cannot be explained by differences in input features.' },
          { metric: 'Equal Opportunity', value: '0.18', status: 'FAIL', color: C.red, text: 'Deserving defendants from the disadvantaged group are denied at a significantly higher rate — held to a higher bar with no justification.' },
          { metric: 'Predictive Parity', value: '0.012', status: 'PASS', color: C.green, text: 'When the model predicts high risk, that prediction is equally accurate across groups. This PASS conflicts with the Equalised Odds FAIL — an impossibility.' },
        ].map((m, i) => (
          <div key={i} style={{ padding: '13px 16px', borderRadius: 10, marginBottom: 8, background: `${m.color}07`, border: `0.5px solid ${m.color}2A`, animation: `pgFU 0.3s ease ${i * 0.09}s both` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted }}>{m.metric}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: m.color }}>{m.value}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 6px', borderRadius: 3, background: `${m.color}18`, color: m.color }}>{m.status}</span>
              </div>
            </div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: C.muted, lineHeight: 1.65 }}>{m.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScreenStory() {
  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TabBar activeId="story" />
      <div style={{ marginTop: 22, flex: 1, overflowY: 'auto' }}>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 18, color: C.text, marginBottom: 22, lineHeight: 1.55, fontStyle: 'italic', paddingLeft: 14, borderLeft: `2px solid ${C.blue}` }}>
          "This model does not treat African-American defendants equally and right now, nobody in the organisation knows."
        </div>
        <div style={{ padding: '16px 18px', background: C.s2, borderRadius: 12, border: `0.5px solid ${C.border2}`, marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.5, color: C.hint, marginBottom: 8, textTransform: 'uppercase' }}>What happened</div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 13.5, color: C.muted, lineHeight: 1.8, paddingLeft: 12, borderLeft: `2px solid ${C.red}` }}>
            A Black defendant was flagged as high-risk by the algorithm. He was held in custody while awaiting trial. A White defendant with an identical criminal history was scored low-risk and released. Both were later found not guilty.
          </div>
        </div>
        <div style={{ padding: '14px 18px', background: C.s2, borderRadius: 12, border: `0.5px solid ${C.border2}`, marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.5, color: C.hint, marginBottom: 8, textTransform: 'uppercase' }}>At scale — 10,000 decisions/year</div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: C.muted, lineHeight: 1.7 }}>
            For every 1,000 people evaluated, <strong style={{ color: C.text }}>190 more Caucasian defendants</strong> receive a positive outcome than African-American defendants. Across 10,000 annual decisions, that is <strong style={{ color: C.red }}>1,900 people</strong> treated unfairly not because of their merit, but because of a pattern baked into historical data.
          </div>
        </div>
        <div style={{ padding: '18px 20px', borderRadius: 14, background: `${C.green}07`, border: `0.5px solid ${C.green}33`, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 2, color: C.green, marginBottom: 6, textTransform: 'uppercase' }}>If the fix is applied</div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 42, fontWeight: 800, color: C.green, lineHeight: 1 }}>347</div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: C.muted, marginTop: 6 }}>people per year receive a fair outcome that's 1 person every 26 hours</div>
        </div>
      </div>
    </div>
  );
}

function ScreenMetrics() {
  const rows = [
    { name: 'Disparate Impact Ratio',      value: '0.610',  threshold: '≥ 0.80',   status: 'FAIL', basis: 'EEOC 4/5ths' },
    { name: 'Statistical Parity Diff',     value: '−0.150', threshold: '|·| ≤ 0.05', status: 'FAIL', basis: 'AIF360' },
    { name: 'Equal Opportunity Diff',      value: '0.182',  threshold: '≤ 0.10',   status: 'FAIL', basis: 'Hardt 2016' },
    { name: 'Equalised Odds Diff',         value: '0.201',  threshold: '≤ 0.10',   status: 'FAIL', basis: 'Article 14' },
    { name: 'FPR Parity',                  value: '0.220',  threshold: '≤ 0.10',   status: 'FAIL', basis: 'ECOA' },
    { name: 'Predictive Parity',           value: '0.012',  threshold: '≤ 0.05',   status: 'PASS', basis: 'Chouldechova' },
    { name: 'Proxy Variable Score (top)',  value: '0.831',  threshold: '< 0.40',   status: 'FAIL', basis: 'Feldman 2015', highlight: true },
  ];
  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TabBar activeId="metrics" />
      <div style={{ marginTop: 16, flex: 1, overflowY: 'auto' }}>
        {rows.map((m, i) => {
          const color = m.status === 'PASS' ? C.green : C.red;
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderRadius: 8, marginBottom: 4,
              background: (m as any).highlight ? `${C.amber}0A` : C.s1,
              border: `0.5px solid ${(m as any).highlight ? C.amber + '33' : C.border}`,
              animation: `pgFU 0.22s ease ${i * 0.05}s both`,
            }}>
              <span style={{ fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 500, flex: 1, color: C.text }}>{m.name}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint }}>{m.basis}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: C.text, minWidth: 46, textAlign: 'right' }}>{m.value}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, minWidth: 72, textAlign: 'right' }}>{m.threshold}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 7px', borderRadius: 3, background: `${color}18`, color, minWidth: 34, textAlign: 'center' }}>{m.status}</span>
            </div>
          );
        })}
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: `${C.amber}0A`, border: `0.5px solid ${C.amber}2A` }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.amber }}>IMPOSSIBILITY CONFLICT: </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted }}>Predictive Parity PASSES while Equalised Odds FAILS. Chouldechova (2017) proves these cannot both hold when base rates differ. This is a structural finding.</span>
        </div>
      </div>
    </div>
  );
}

function ScreenProxies({ expanded }: { expanded?: boolean }) {
  const vars = [
    { name: 'decile_score', mi: 0.831, risk: 'HIGH',   proxy: 'race',  contrib: 58, expand: expanded },
    { name: 'priors_count', mi: 0.412, risk: 'HIGH',   proxy: 'race',  contrib: 24, expand: false },
    { name: 'age',          mi: 0.288, risk: 'MEDIUM', proxy: null,     contrib: 11, expand: false },
    { name: 'c_charge_degree', mi: 0.104, risk: 'LOW', proxy: null,     contrib: 7,  expand: false },
  ];
  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TabBar activeId="proxies" />
      <div style={{ marginTop: 16, flex: 1, overflowY: 'auto' }}>
        {vars.map((v, i) => {
          const color = v.risk === 'HIGH' ? C.red : v.risk === 'MEDIUM' ? C.amber : C.hint;
          return (
            <div key={i} style={{ borderRadius: 10, marginBottom: 8, overflow: 'hidden', border: `0.5px solid ${v.expand ? C.amber : C.border}`, animation: `pgFU 0.28s ease ${i * 0.07}s both` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: v.expand ? `${C.amber}07` : C.s1 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500, flex: 1, color: C.text }}>{v.name}</span>
                {v.proxy && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint }}>→ {v.proxy}</span>}
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted }}>MI {v.mi.toFixed(3)}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 7px', borderRadius: 3, background: `${color}18`, color }}>{v.risk}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint }}>{v.contrib}%</span>
              </div>
              {v.expand && (
                <div style={{ padding: '14px 18px', background: C.s2, borderTop: `0.5px solid ${C.border}` }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1, color: C.amber, marginBottom: 8, textTransform: 'uppercase' }}>How we know this is a proxy</div>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: C.muted, lineHeight: 1.65, marginBottom: 10 }}>
                    Knowing <strong style={{ color: C.text }}>decile_score</strong> predicts <strong style={{ color: C.text }}>race</strong> with <strong style={{ color: C.amber }}>83%</strong> mutual information accuracy nearly as good as knowing race directly. The legal flagging threshold is 40%.
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '8px 12px', borderRadius: 6, background: C.s3, color: C.muted, marginBottom: 10 }}>
                    I(decile_score ; race) = 0.831 nats &nbsp;·&nbsp; Threshold: 0.40 &nbsp;·&nbsp; Contributes 58% of total bias
                  </div>
                  <div style={{ padding: '10px 12px', borderRadius: 6, background: `${C.green}08`, border: `0.5px solid ${C.green}2A` }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.green }}>RECOMMENDED FIX: </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted }}>REMOVE decile_score: projected DIR +0.11; passes legal threshold</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScreenSandbox() {
  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TabBar activeId="sandbox" />
      <div style={{ marginTop: 18, flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignContent: 'start' }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.5, color: C.hint, marginBottom: 12, textTransform: 'uppercase' }}>Toggle interventions</div>
          {[
            { name: 'decile_score', action: 'REMOVE',  on: true  },
            { name: 'priors_count', action: 'BIN',     on: false },
            { name: 'age',          action: 'MONITOR', on: false },
          ].map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, marginBottom: 6, background: v.on ? C.blueBg : C.s1, border: `0.5px solid ${v.on ? C.blue : C.border}` }}>
              <div style={{ width: 20, height: 11, borderRadius: 11, background: v.on ? C.green : C.s3, position: 'relative', flexShrink: 0 }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#fff', position: 'absolute', top: 1, left: v.on ? 10 : 1, transition: 'left 0.2s' }} />
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, flex: 1, color: C.text }}>{v.name}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint, padding: '1px 6px', borderRadius: 3, background: C.s3 }}>{v.action}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.5, color: C.hint, marginBottom: 12, textTransform: 'uppercase' }}>Projected outcome</div>
          {[
            { label: 'DIR score', before: '0.61', after: '0.72' },
            { label: 'SPD', before: '−0.150', after: '−0.092' },
            { label: 'Grade', before: 'F', after: 'D' },
          ].map((m, i) => (
            <div key={i} style={{ padding: '10px 13px', borderRadius: 8, marginBottom: 6, background: C.s1, border: `0.5px solid ${C.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.muted }}>{m.label}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.red, textDecoration: 'line-through' }}>{m.before}</span>
                  <span style={{ color: C.hint, fontSize: 10 }}>→</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.amber, fontWeight: 700 }}>{m.after}</span>
                </div>
              </div>
            </div>
          ))}
          <div style={{ padding: '10px 13px', borderRadius: 8, background: `${C.green}08`, border: `0.5px solid ${C.green}2A`, marginTop: 6 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.green, marginBottom: 2 }}>PROJECTED IMPACT</div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: C.muted }}>127 more people/year receive a fair outcome</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenRemediation() {
  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TabBar activeId="remediation" />
      <div style={{ marginTop: 18, flex: 1, overflowY: 'auto' }}>
        {[
          { step: 1, var: 'decile_score', action: 'REMOVE', before: 0.61, after: 0.72, people: 127, color: C.red,   impl: 'Drop column "decile_score" from training data entirely. Verify no downstream feature reconstructs it.' },
          { step: 2, var: 'priors_count', action: 'BIN into 4 equal-frequency bins', before: 0.72, after: 0.77, people: 84,  color: C.amber, impl: 'pandas.qcut(df["priors_count"], q=4, labels=False) — replaces continuous values with bin indices.' },
        ].map((s, i) => (
          <div key={i} style={{ borderRadius: 12, marginBottom: 10, overflow: 'hidden', border: `0.5px solid ${C.border2}`, animation: `pgFU 0.3s ease ${i * 0.1}s both` }}>
            <div style={{ padding: '12px 16px', background: C.s1, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: C.blueBg2, border: `0.5px solid ${C.blue}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: C.blue, flexShrink: 0 }}>{s.step}</div>
              <div style={{ flex: 1 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: s.color, marginRight: 8 }}>{s.action}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.text }}>{s.var}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.red }}>{s.before.toFixed(2)}</span>
                <span style={{ color: C.hint, fontSize: 10 }}>→</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.green, fontWeight: 700 }}>{s.after.toFixed(2)}</span>
              </div>
            </div>
            <div style={{ padding: '10px 16px', background: C.s2, borderTop: `0.5px solid ${C.border}` }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted, marginBottom: 4 }}>{s.impl}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.green }}>+{s.people} people/year receive a fair outcome after this fix</div>
            </div>
          </div>
        ))}
        <div style={{ padding: '18px 20px', borderRadius: 14, background: `${C.green}07`, border: `0.5px solid ${C.green}33`, textAlign: 'center', marginTop: 4 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 2, color: C.green, marginBottom: 6, textTransform: 'uppercase' }}>Combined both fixes applied</div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 40, fontWeight: 800, color: C.green, lineHeight: 1 }}>347</div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: C.muted, marginTop: 4 }}>people per year that's 1 person every 26 hours</div>
        </div>
      </div>
    </div>
  );
}

function ScreenExplore() {
  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 22, color: C.text, marginBottom: 6 }}>Explore Famous Biased Datasets</div>
      <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: C.muted, marginBottom: 20 }}>5 real-world datasets already audited and graded. No upload needed.</div>
      {[
        { name: 'COMPAS Recidivism', grade: 'F', domain: 'Criminal Justice', rows: '7,214', color: C.red, sdg: 16 },
        { name: 'German Credit Dataset', grade: 'C', domain: 'Finance', rows: '1,000', color: C.amber, sdg: 10 },
        { name: 'Adult Income (Census)', grade: 'D', domain: 'Finance / Labour', rows: '48,842', color: C.amber, sdg: 10 },
        { name: 'Bank Marketing Dataset', grade: 'B', domain: 'Finance', rows: '45,211', color: C.blue, sdg: 10 },
        { name: 'MEPS Healthcare Survey', grade: 'C', domain: 'Healthcare', rows: '15,830', color: C.amber, sdg: 3 },
      ].map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderRadius: 10, background: C.s1, border: `0.5px solid ${C.border}`, marginBottom: 8, animation: `pgFU 0.28s ease ${i * 0.07}s both` }}>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 20, fontWeight: 800, color: d.color, width: 28, textAlign: 'center' }}>{d.grade}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500, color: C.text }}>{d.name}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginTop: 2 }}>{d.domain} · {d.rows} rows</div>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 7px', borderRadius: 3, border: `0.5px solid ${C.slate}44`, color: C.slate, background: `${C.slate}0D` }}>SDG {d.sdg}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.blue }}>View audit →</div>
        </div>
      ))}
    </div>
  );
}

function ScreenRegistry() {
  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 22, color: C.text, marginBottom: 6 }}>Public Audit Registry</div>
      <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: C.muted, marginBottom: 20 }}>Every audit is cryptographically signed and publicly verifiable.</div>
      {[
        { name: 'COMPAS Recidivism', grade: 'F', cert: 'PGS-A3F2B891', date: '2024-01-15', kms: 'proxyguard/audit-ring/1' },
        { name: 'German Credit Dataset', grade: 'C', cert: 'PGS-8C4D2E17', date: '2024-01-10', kms: 'proxyguard/audit-ring/1' },
      ].map((r, i) => (
        <div key={i} style={{ padding: '14px 16px', borderRadius: 10, background: C.s1, border: `0.5px solid ${C.border}`, marginBottom: 8, animation: `pgFU 0.3s ease ${i * 0.1}s both` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 18, fontWeight: 800, color: C.red, width: 28 }}>{r.grade}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 3 }}>{r.name}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint }}>{r.cert} · {r.date} · {r.kms}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 10, color: C.green }}>
              <span>✓</span><span>KMS VERIFIED</span>
            </div>
          </div>
        </div>
      ))}
      <div style={{ padding: '14px 18px', borderRadius: 10, background: C.s2, border: `0.5px solid ${C.border2}`, marginTop: 8 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.muted, lineHeight: 1.75 }}>
          Each certificate stores: audit hash (SHA-256) · Cloud KMS key ID · dataset fingerprint · model grade · timestamp · protected attributes audited. Cannot be altered without invalidating the signature.
        </div>
      </div>
    </div>
  );
}

function ScreenTrust() {
  return (
    <div style={{ padding: '40px', maxWidth: 600, margin: '0 auto' }}>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 24, color: C.text, marginBottom: 24, lineHeight: 1.3 }}>Why you can trust<br />the numbers</div>
      {[
        { label: 'Proxy detection method', ref: 'Feldman et al. (2015)', detail: 'Certifying and removing disparate impact. SIGKDD. The foundational paper for algorithmic proxy discrimination detection. MI threshold of 0.40 is calibrated to this paper.', color: C.blue },
        { label: 'Impossibility conflicts', ref: 'Chouldechova (2017)', detail: 'Fair prediction with disparate impact. Big Data. Mathematically proves that when base rates differ, Predictive Parity and Equalised Odds cannot both hold — ProxyGuard detects and names this.', color: C.amber },
        { label: 'Equalised Odds metric', ref: 'Hardt et al. (2016)', detail: 'Equality of opportunity in supervised learning. NeurIPS. Defines the Equalised Odds and Equal Opportunity metrics used in this audit.', color: C.green },
        { label: 'Gemini is grounded, not free', ref: 'Architecture constraint', detail: 'Temperature 0.4. Receives only structured JSON. Instructed explicitly never to compute or estimate. If uncertain: "cannot be determined from available data". Every number on screen comes from the math engine.', color: C.slate },
      ].map((item, i) => (
        <div key={i} style={{ padding: '14px 16px', borderRadius: 10, marginBottom: 10, background: C.s1, border: `0.5px solid ${C.border}`, borderLeft: `3px solid ${item.color}`, animation: `pgFU 0.28s ease ${i * 0.09}s both` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
            <span style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: C.text }}>{item.label}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: item.color, padding: '2px 7px', borderRadius: 3, background: `${item.color}12`, whiteSpace: 'nowrap', marginLeft: 10 }}>{item.ref}</span>
          </div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: C.muted, lineHeight: 1.65 }}>{item.detail}</div>
        </div>
      ))}
    </div>
  );
}

// ── Narrator popup ─────────────────────────────────────────────────────────────
// Rendered as a FIXED overlay at the root of the modal — never inside the
// scrollable content pane, so it can never be clipped or overlapped.
function Narrator({ step, index, total, onNext, onPrev, onExit, containerRef }: {
  step: Step; index: number; total: number;
  onNext: () => void; onPrev: () => void; onExit: () => void;
  containerRef: React.RefObject<HTMLDivElement>;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(false); const t = setTimeout(() => setShow(true), 60); return () => clearTimeout(t); }, [step.id]);

  // Position relative to the modal container (not the viewport)
  const getPos = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      zIndex: 300,
      width: 360,
      maxWidth: 'calc(100% - 32px)',
    };
    const PAD = 16;
    switch (step.position) {
      case 'top-left':     return { ...base, top: PAD, left: PAD };
      case 'top-right':    return { ...base, top: PAD, right: PAD };
      case 'bottom-left':  return { ...base, bottom: PAD, left: PAD };
      case 'bottom-right': return { ...base, bottom: PAD, right: PAD };
      case 'center':       return { ...base, width: 440, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
      default:             return { ...base, bottom: PAD, right: PAD };
    }
  };

  const pos = getPos();
  const isCenter = step.position === 'center';

  return (
    <>
      {/* Soft vignette overlay — dims screen behind the popup without blocking it */}
      {!isCenter && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 250, pointerEvents: 'none',
          background: (() => {
            switch (step.position) {
              case 'bottom-right': return 'radial-gradient(ellipse 65% 55% at 85% 85%, rgba(5,6,10,0) 0%, rgba(5,6,10,0.72) 100%)';
              case 'bottom-left':  return 'radial-gradient(ellipse 65% 55% at 15% 85%, rgba(5,6,10,0) 0%, rgba(5,6,10,0.72) 100%)';
              case 'top-right':    return 'radial-gradient(ellipse 65% 55% at 85% 15%, rgba(5,6,10,0) 0%, rgba(5,6,10,0.72) 100%)';
              case 'top-left':     return 'radial-gradient(ellipse 65% 55% at 15% 15%, rgba(5,6,10,0) 0%, rgba(5,6,10,0.72) 100%)';
              default:             return 'none';
            }
          })(),
        }} />
      )}
      {/* Center backdrop */}
      {isCenter && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 250, pointerEvents: 'none',
          background: 'rgba(5,6,10,0.6)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        }} />
      )}

      {/* Popup card */}
      <div style={{
        ...pos,
        opacity: show ? 1 : 0,
        transition: 'opacity 0.28s ease, transform 0.28s ease',
        transform: `${pos.transform ?? ''} translateY(${show ? 0 : 8}px)`,
      }}>
        <div style={{
          background: 'rgba(19,19,26,0.97)',
          border: `0.5px solid rgba(55,55,80,0.9)`,
          borderRadius: 14,
          boxShadow: '0 8px 40px rgba(0,0,0,0.8), 0 0 0 0.5px rgba(77,159,255,0.08)',
          overflow: 'hidden',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}>
          {/* Top accent line */}
          <div style={{ height: 2, background: `linear-gradient(90deg, transparent 5%, ${C.blue} 50%, transparent 95%)` }} />

          <div style={{ padding: '14px 16px' }}>
            {/* Progress + exit row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                {Array.from({ length: total }).map((_, i) => (
                  <div key={i} style={{
                    height: 3, borderRadius: 2, transition: 'all 0.25s',
                    width: i === index ? 18 : 5,
                    background: i < index ? C.green : i === index ? C.blue : C.border2,
                  }} />
                ))}
              </div>
              <button
                onClick={onExit}
                style={{
                  fontFamily: 'var(--mono)', fontSize: 9, color: C.hint,
                  background: 'rgba(255,255,255,0.04)', border: `0.5px solid ${C.border}`,
                  borderRadius: 4, padding: '3px 9px', cursor: 'pointer',
                  transition: 'all 0.12s', letterSpacing: 0.3,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = C.red; (e.currentTarget as HTMLElement).style.color = C.red; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.color = C.hint; }}
              >
                ✕ exit
              </button>
            </div>

            {/* Step label */}
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 8.5, letterSpacing: 1.2,
              textTransform: 'uppercase', color: C.blue, marginBottom: 6, opacity: 0.8,
            }}>
              {index + 1} of {total} · {step.screen.replace(/-/g, ' ')}
            </div>

            {/* Title */}
            <div style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 9, lineHeight: 1.3 }}>
              {step.title}
            </div>

            {/* Body */}
            <div style={{ fontFamily: 'var(--sans)', fontSize: 12.5, color: C.muted, lineHeight: 1.75 }}>
              {step.body}
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 16px',
            borderTop: `0.5px solid rgba(42,42,58,0.8)`,
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(13,13,18,0.6)',
          }}>
            {index > 0 && (
              <button
                onClick={onPrev}
                style={{
                  fontFamily: 'var(--mono)', fontSize: 10, padding: '6px 12px', borderRadius: 6,
                  background: 'none', border: `0.5px solid ${C.border2}`,
                  color: C.muted, cursor: 'pointer', transition: 'color 0.12s, border-color 0.12s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text; (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.muted; (e.currentTarget as HTMLElement).style.borderColor = C.border2; }}
              >← back</button>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={index === total - 1 ? onExit : onNext}
              style={{
                fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: index === total - 1
                  ? `linear-gradient(135deg, ${C.green}, ${C.green}CC)`
                  : `linear-gradient(135deg, ${C.blue}, ${C.blue}CC)`,
                color: '#fff', transition: 'opacity 0.15s, transform 0.1s',
                boxShadow: index === total - 1 ? `0 0 20px ${C.green}44` : `0 0 16px ${C.blue}44`,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.88'; (e.currentTarget as HTMLElement).style.transform = 'scale(1.02)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
            >
              {step.nextLabel ?? (index === total - 1 ? 'Start auditing →' : 'next →')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DemoMode({ onExit }: Props) {
  const [idx, setIdx] = useState(0);
  const containerRef = { current: null } as React.RefObject<HTMLDivElement>;
  const step = STEPS[idx];
  const noSidebar = step.position === 'center';

  const goNext = () => idx < STEPS.length - 1 ? setIdx(i => i + 1) : onExit();
  const goPrev = () => idx > 0 && setIdx(i => i - 1);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goPrev();
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [idx]);

  const content = (() => {
    switch (step.screen) {
      case 'problem':      return <ScreenProblem />;
      case 'upload':       return <ScreenUpload />;
      case 'config':       return <ScreenUpload showIndustry />;
      case 'engine':       return <ScreenEngine />;
      case 'plain':        return <ScreenPlain />;
      case 'story':        return <ScreenStory />;
      case 'metrics':      return <ScreenMetrics />;
      case 'proxies':      return <ScreenProxies />;
      case 'proxy-detail': return <ScreenProxies expanded />;
      case 'sandbox':      return <ScreenSandbox />;
      case 'remediation':  return <ScreenRemediation />;
      case 'explore':      return <ScreenExplore />;
      case 'registry':     return <ScreenRegistry />;
      case 'trust':        return <ScreenTrust />;
      default:             return null;
    }
  })();

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(5,6,10,0.92)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '93vw', maxWidth: 1040, height: '88vh',
        background: C.bg, borderRadius: 18,
        border: `0.5px solid ${C.border2}`,
        boxShadow: '0 28px 80px rgba(0,0,0,0.85)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        position: 'relative',  // ← narrator is absolute-positioned inside here
      }}>
        {/* Chrome bar */}
        <div style={{ height: 44, flexShrink: 0, background: C.s1, borderBottom: `0.5px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 18px', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['#FF5F57','#FEBC2E','#28C840'].map((c, i) => <div key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: c, opacity: 0.8 }} />)}
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.hint, padding: '3px 14px', borderRadius: 6, background: C.s2, border: `0.5px solid ${C.border}`, letterSpacing: 0.3 }}>
              ProxyGuard Studio — Guided Tour
            </div>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: C.hint }}>← → navigate · Esc exit</div>
        </div>

        {/* App layout — screen content */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          {!noSidebar && <Sidebar screen={step.screen} />}
          {/* Screen content — dimmed slightly to read popup better */}
          <div style={{
            flex: 1, overflowY: 'auto', position: 'relative',
            filter: 'brightness(0.7)',
            transition: 'filter 0.3s ease',
          }}>
            {content}
          </div>

          {/* ★ Narrator lives here — absolute inside the modal, above everything */}
          <Narrator
            step={step}
            index={idx}
            total={STEPS.length}
            onNext={goNext}
            onPrev={goPrev}
            onExit={onExit}
            containerRef={containerRef}
          />
        </div>
      </div>

      <style>{`
        @keyframes pgFU { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
      `}</style>
    </div>
  );
}