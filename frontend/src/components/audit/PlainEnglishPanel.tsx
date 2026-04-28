/**
 * PlainEnglishPanel
 * ==================
 * Translates every technical audit finding into plain language
 * understandable by a student, journalist, or non-technical manager.
 *
 * Design principle:
 *   - Lead with the real-world consequence, not the metric name
 *   - Show one concrete example per finding (numbers are relatable)
 *   - Technical terms are shown in small tooltips, not headlines
 *   - Colour = traffic light (red/amber/green), no jargon needed
 */

import { AuditReport, GroupOutcomeResult, VariableRisk, ImpossibilityConflict } from '../../services/api';

interface Props {
  report: AuditReport;
}

const C = {
  red:'#FF4D6D', redBg:'rgba(255,77,109,0.08)', redText:'#FF6B85', redBorder:'rgba(255,77,109,0.3)',
  amber:'#FFB830', amberBg:'rgba(255,184,48,0.08)', amberText:'#FFB830', amberBorder:'rgba(255,184,48,0.3)',
  green:'#3DDC84', greenBg:'rgba(61,220,132,0.08)', greenText:'#3DDC84', greenBorder:'rgba(61,220,132,0.3)',
  blue:'#4D9FFF', blueBg:'rgba(77,159,255,0.08)',
  surface:'#13131A', surface2:'#1C1C26',
  border:'#2A2A3A', text:'#F0F0F8', muted:'#8888AA', hint:'#55556A',
};

function Tag({ text }: { text: string }) {
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '1px 6px', borderRadius: 99, background: '#242432', color: '#55556A', marginLeft: 4, verticalAlign: 'middle' }}>
      {text}
    </span>
  );
}

function Section({ icon, title, color, borderColor, bg, children }: {
  icon: string; title: string; color: string; borderColor: string; bg: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16, border: `0.5px solid ${borderColor}`, borderRadius: 12, overflow: 'hidden', background: bg }}>
      <div style={{ padding: '12px 18px', borderBottom: `0.5px solid ${borderColor}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color }}>{title}</span>
      </div>
      <div style={{ padding: '14px 18px' }}>{children}</div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
      <span style={{ color: C.muted, flexShrink: 0, marginTop: 2 }}>•</span>
      <p style={{ fontSize: 13, color: C.text, lineHeight: 1.65, margin: 0 }}>{children}</p>
    </div>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '12px 16px', background: C.surface2, borderRadius: 10, border: `0.5px solid ${C.border}` }}>
      <div style={{ fontFamily: 'var(--syne)', fontSize: 26, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>{label}</div>
    </div>
  );
}

// ── What failed, in plain words ────────────────────────────────────────────────
function VerdictBlock({ report }: { report: AuditReport }) {
  const verdict = report.overall_risk_level;
  const dir     = report.overall_dir_score;
  const go      = report.group_outcomes[0];

  if (!go) return null;

  const pct     = (dir * 100).toFixed(0);
  const gap     = ((1 - dir) * 100).toFixed(0);
  const per1000 = Math.round((go.privileged_rate - go.unprivileged_rate) * 1000);

  if (verdict === 'PASS') {
    return (
      <Section icon="" title="This dataset passes fairness checks" color={C.green} borderColor={C.greenBorder} bg={C.greenBg}>
        <Bullet>
          The two groups being compared get similar outcomes. For every 1,000 decisions,
          the gap between groups is small enough to meet international fairness standards.
        </Bullet>
        <Bullet>
          This does not mean the dataset is perfect it means the most important
          fairness checks did not find strong evidence of discrimination.
          Continue monitoring once the model is deployed.
        </Bullet>
      </Section>
    );
  }

  if (verdict === 'REVIEW') {
    return (
      <Section icon="" title="This dataset has issues worth fixing" color={C.amber} borderColor={C.amberBorder} bg={C.amberBg}>
        <Bullet>
          Some variables in this dataset are connected to protected characteristics
          (like race, caste, or gender) in ways that could make a trained model unfair.
        </Bullet>
        <Bullet>
          The overall numbers are borderline not a clear failure, but not safe to ignore.
          Applying the fixes recommended in the Fix Plan tab would make this dataset
          significantly safer to use.
        </Bullet>
      </Section>
    );
  }

  // FAIL
  return (
    <Section icon="" title="This dataset is not safe to train a model on" color={C.red} borderColor={C.redBorder} bg={C.redBg}>
      <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, marginBottom: 16 }}>
        <strong>In plain terms:</strong> if you train an AI model on this data right now, the model
        will likely treat {go.unprivileged_group} people unfairly not because you programmed it to,
        but because the historical patterns in this data already contain that unfairness.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        <Stat value={`${pct}%`} label={`${go.unprivileged_group} gets a positive outcome for every 100% that ${go.privileged_group} gets`} color={C.red} />
        <Stat value={`${per1000}`} label={`extra people per 1,000 decisions who are harmed just because of their group`} color={C.amber} />
        <Stat value={`${gap}%`} label="gap that must be closed to meet the international legal fairness standard"  color={C.red} />
      </div>
      <Bullet>
        Imagine 1,000 loan applications. If {go.privileged_group} applicants get approved at {(go.privileged_rate * 100).toFixed(0)}%,
        then {go.unprivileged_group} applicants with the exact same financial profiles are getting approved
        at only {(go.unprivileged_rate * 100).toFixed(0)}%  a difference of {per1000} people per 1,000
        who are rejected for no legitimate reason.
      </Bullet>
      <Bullet>
        The international standard (EEOC 4/5ths Rule, used in the US, India, and EU guidance) says
        the disadvantaged group must receive positive outcomes at least 80% as often as the privileged group.
        This dataset gives them only {pct}%.
      </Bullet>
    </Section>
  );
}

// ── Proxy variables in plain words ────────────────────────────────────────────
function ProxyBlock({ risks, region }: { risks: VariableRisk[]; region: string }) {
  const flagged = risks.filter(v => v.risk_level !== 'LOW');
  if (!flagged.length) return null;

  const high   = flagged.filter(v => v.risk_level === 'HIGH');
  const medium = flagged.filter(v => v.risk_level === 'MEDIUM');

  const proxyExamples: Record<string, string> = {
    zip_code:      "People's zip codes in India reveal a lot about their caste and religion — areas were historically segregated. A model using zip codes is essentially using caste.",
    pincode:       "Pincodes reveal caste and religious community patterns due to historical residential segregation in India.",
    commute_time:  "People who commute longer typically live in less affluent areas, which correlate with caste and class.",
    surname:       "In India, surnames encode caste information with very high accuracy. Using surname is almost the same as using caste directly.",
    occupation:    "Historically, certain occupations were restricted to certain castes. Occupation still carries caste information in Indian datasets.",
    neighborhood:  "Neighbourhood is a proxy for caste and religion in Indian cities due to decades of residential segregation.",
    marital_status:"Marital status patterns differ significantly by gender and community.",
    relationship:  "Relationship status (e.g. 'husband', 'wife', 'unmarried') directly encodes gender information.",
    university_name:"Some universities in India have historically served specific communities. University name can encode caste.",
    priors_count:  "Prior arrest counts reflect over-policing in certain communities, not actual criminality differences.",
    decile_score:  "Risk scores often embed the same biases present in the data they were trained on.",
  };

  return (
    <Section icon="" title={`${flagged.length} variables are secretly connected to protected characteristics`} color={C.amber} borderColor={C.amberBorder} bg={C.amberBg}>
      <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, marginBottom: 14 }}>
        <strong style={{ color: C.text }}>What is a proxy variable?</strong> A proxy variable is a column
        that looks neutral but is actually mathematically linked to a protected characteristic
        (like caste, religion, or gender). Including it in a model is legally equivalent to
        using the protected characteristic directly even if you never include that column.
        <Tag text="technical: Mutual Information + Cramér's V" />
      </p>
      {high.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.redText, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Remove these immediately
          </div>
          {high.map(v => (
            <div key={v.name} style={{ marginBottom: 10, padding: '10px 14px', background: 'rgba(255,77,109,0.06)', borderRadius: 8, border: `0.5px solid rgba(255,77,109,0.2)` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: C.red }}>{v.name}</span>
                <span style={{ fontSize: 11, color: C.muted }}>→ acts as a stand-in for <strong style={{ color: C.text }}>{v.proxy_for}</strong></span>
                {v.is_caste_proxy_candidate && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, padding: '1px 6px', borderRadius: 99, background: 'rgba(255,77,109,0.15)', color: C.redText }}>caste proxy (India)</span>}
              </div>
              <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, margin: 0 }}>
                {proxyExamples[v.name.toLowerCase()] ??
                  `"${v.name}" is statistically associated with "${v.proxy_for}" in this dataset. A model trained with this column will effectively encode information about "${v.proxy_for}".`}
              </p>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>Proxy Index: {v.proxy_score.toFixed(3)}</span>
                <Tag text={`MI=${v.mi_score.toFixed(3)}`} />
                <Tag text={`V=${v.cramers_v.toFixed(3)}`} />
                {v.n_unique !== undefined && (
                  <Tag text={`weights: MI×${v.weight_mi} V×${v.weight_cv} (${v.n_unique <= 10 ? 'categorical' : v.n_unique <= 30 ? 'ordinal' : 'continuous'})`} />
                )}
              </div>
              <p style={{ fontSize: 10, color: C.hint, margin: '4px 0 0 0', lineHeight: 1.5, background: 'rgba(255,184,48,0.05)', padding: '6px 8px', borderRadius: 6 }}>
                <strong style={{ color: C.amberText }}>What this means in plain English:</strong> Imagine two students both get the same exam score, but the system predicts one will succeed and the other won't and that split follows group lines. That's what a high Proxy Index detects: the variable is <em>behaving like</em> a group label, even if it doesn't say so.<br />
                <span style={{ color: C.hint }}>This is about pattern-matching, not proof of intent. Just because two things move together doesn't mean one causes the other a classic example: ice cream sales and drowning rates both rise in summer, but ice cream doesn't cause drowning. What matters here is that the <em>pattern exists</em>, which is enough to cause unfair outcomes in a model even without any intent.</span>
              </p>
            </div>
          ))}
        </div>
      )}
      {medium.length > 0 && (
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.amberText, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Review these carefully
          </div>
          {medium.map(v => (
            <div key={v.name} style={{ marginBottom: 8, padding: '10px 14px', background: 'rgba(255,184,48,0.06)', borderRadius: 8, border: `0.5px solid rgba(255,184,48,0.2)` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: C.amber }}>{v.name}</span>
                <span style={{ fontSize: 11, color: C.muted }}>→ moderately linked to <strong style={{ color: C.text }}>{v.proxy_for}</strong></span>
              </div>
              <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, margin: 0 }}>
                {proxyExamples[v.name.toLowerCase()] ??
                  `"${v.name}" has a moderate statistical connection to "${v.proxy_for}". Consider whether it's truly measuring what you intend, or whether it's a shortcut to a protected characteristic.`}
              </p>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Impossibility in plain words ───────────────────────────────────────────────
function ImpossibilityBlock({ conflicts }: { conflicts: ImpossibilityConflict[] }) {
  if (!conflicts.length) return null;
  const c = conflicts[0];
  return (
    <Section icon="" title="Two fairness checks give conflicting results, this is normal and important" color="#A855F7" borderColor="rgba(168,85,247,0.3)" bg="rgba(168,85,247,0.06)">
      <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, marginBottom: 12 }}>
        <strong>What happened:</strong> One fairness check says the model is fair ({c.metric_a} ✓).
        Another says it is not ({c.metric_b}). Both are mathematically correct at the same time.
        This is not a bug — it is a fundamental mathematical property of algorithmic fairness.
        <Tag text="Chouldechova (2017) impossibility theorem" />
      </p>
      <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 12 }}>
        <strong style={{ color: C.text }}>Real-world meaning:</strong> {c.real_world_meaning}
      </p>
      <div style={{ padding: '10px 14px', background: C.surface2, borderRadius: 8, border: `0.5px solid ${C.border}` }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#A855F7', marginBottom: 4 }}>WHY DOES THIS HAPPEN?</div>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, margin: 0 }}>
          When two groups have different historical outcome rates (because of past discrimination or
          over-policing), it becomes mathematically impossible for an algorithm to be simultaneously
          accurate for both groups on all measures of fairness. You have to choose which type of
          fairness to prioritise — and that choice has real consequences for which group gets hurt.
          This is why algorithmic fairness requires human judgment, not just mathematics.
        </p>
      </div>
    </Section>
  );
}

// ── What to do next ────────────────────────────────────────────────────────────
function WhatToDoBlock({ report }: { report: AuditReport }) {
  const plan  = report.remediation_plan;
  const flags = report.total_flags;
  if (!plan.length && flags === 0) return null;

  return (
    <Section icon="" title="What you can do, step by step" color={C.blue} borderColor="rgba(77,159,255,0.3)" bg={C.blueBg}>
      <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, marginBottom: 14 }}>
        These steps are ordered by impact — doing step 1 first will fix the most bias.
        Each step shows the projected improvement to the fairness score.
      </p>
      {plan.slice(0, 4).map(step => (
        <div key={step.step} style={{ display: 'flex', gap: 12, marginBottom: 12, padding: '12px 14px', background: step.passes_after ? 'rgba(61,220,132,0.06)' : C.surface2, borderRadius: 10, border: `0.5px solid ${step.passes_after ? 'rgba(61,220,132,0.3)' : C.border}` }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: C.text, color: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
            {step.step}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                {step.action === 'REMOVE'   && `Remove the column "${step.variable}"`}
                {step.action === 'BIN'      && `Simplify the column "${step.variable}" into categories`}
                {step.action === 'REWEIGHT' && `Rebalance the training data for "${step.variable}"`}
                {step.action === 'MONITOR'  && `Monitor "${step.variable}" after deployment`}
              </span>
              <Tag text={step.action} />
              {step.passes_after && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.green }}>passes threshold after this step</span>}
            </div>
            <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, margin: 0 }}>{step.reason}</p>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: C.hint, marginTop: 5 }}>
              Fairness score after this step: {step.projected_dir_after.toFixed(2)} (target: ≥ 0.80)
            </div>
          </div>
        </div>
      ))}
      {plan.length > 4 && (
        <p style={{ fontSize: 12, color: C.hint, margin: 0 }}>+ {plan.length - 4} more steps in the Fix Plan tab.</p>
      )}
    </Section>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────
export default function PlainEnglishPanel({ report }: Props) {
  return (
    <div>
      {/* Opening explainer */}
      <div style={{ marginBottom: 20, padding: '14px 18px', background: C.surface, border: `0.5px solid ${C.border}`, borderRadius: 12 }}>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7 }}>
          <strong style={{ color: C.text }}>What is this?</strong> ProxyGuard ran {report.metrics_computed} independent
          mathematical tests on your dataset to check for hidden discrimination. This panel explains what it found
          in plain language. Use the other tabs (All Metrics, Proxies, Sensitivity, Legal) for the technical details.
          The grade <strong style={{ color: C.text, fontFamily: 'var(--mono)' }}>{report.overall_grade}</strong> reflects
          how the dataset performs across all tests combined.
        </div>
      </div>

      <VerdictBlock report={report} />
      <ProxyBlock risks={report.variable_risks} region={report.region} />
      <ImpossibilityBlock conflicts={report.impossibility_conflicts} />
      <WhatToDoBlock report={report} />

      {/* Footer */}
      <div style={{ padding: '12px 16px', background: C.surface2, borderRadius: 10, border: `0.5px solid ${C.border}` }}>
        <p style={{ fontSize: 11, color: C.hint, lineHeight: 1.6, margin: 0 }}>
          <strong style={{ color: C.muted }}>Important:</strong> Passing this audit does not guarantee a model trained on this dataset
          will be fair — it means no strong evidence of discrimination was found at the dataset level.
          Monitor your deployed model continuously for fairness drift.
          Legal references are informational only and do not constitute legal advice.
        </p>
      </div>
    </div>
  );
}
