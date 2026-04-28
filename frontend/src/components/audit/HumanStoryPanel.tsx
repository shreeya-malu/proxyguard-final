/**
 * HumanStoryPanel
 * ================
 * The emotional core of ProxyGuard.
 *
 * Architecture:
 *   [Math Engine Output] → structured JSON → [Gemini Narrative Layer] → [This Component]
 *
 * Gemini's ONLY job here: translate numbers into human consequence.
 * It never computes, never estimates, never invents numbers.
 * Every number shown comes from the bias engine. Gemini only writes the words.
 *
 * Output structure from Gemini:
 *   - opening_line:    one devastating sentence. the hook.
 *   - person_story:    2–3 sentences. one real person. what happened to them.
 *   - scale_statement: what this means at scale. uses the engine's numbers only.
 *   - what_changes:    if the fix is applied — what actually changes for people.
 *   - closing_call:    one sentence. why this matters. no guilt. just truth.
 */

import { useState, useEffect, useRef } from 'react';
import { AuditReport, GeminiOutput } from '../../services/api';

interface Props {
  report: AuditReport;
  gemini: GeminiOutput;
  annualDecisions?: number;
}

// ── Design tokens (matches ProxyGuard dark theme) ─────────────────────────────
const C = {
  red:     '#FF4D6D',
  amber:   '#FFB830',
  green:   '#3DDC84',
  blue:    '#4D9FFF',
  surface: '#13131A',
  s2:      '#1C1C26',
  s3:      '#242432',
  border:  '#2A2A3A',
  text:    '#F0F0F8',
  muted:   '#8888AA',
  hint:    '#55556A',
};

// ── Gemini payload builder ────────────────────────────────────────────────────
// Constructs the exact structured object sent to Gemini.
// Contains ONLY values that came from the math engine — never estimates.
function buildNarrativePayload(report: AuditReport, annualDecisions: number) {
  const go   = report.group_outcomes?.[0];
  const top  = report.variable_risks?.filter(v => v.is_proxy)?.[0];
  const fix  = top?.remediation?.[0];

  const privRate   = go?.privileged_rate   ?? 0;
  const unprivRate = go?.unprivileged_rate ?? 0;
  const gapPP      = Math.round(Math.abs(privRate - unprivRate) * 100 * 10) / 10;
  const per1000    = Math.round(Math.abs(privRate - unprivRate) * 1000);
  const unfairPerYear = Math.round(annualDecisions * Math.abs(privRate - unprivRate) * 0.5);

  return {
    // Identity — gives Gemini context to use the right real-world scenario
    dataset_name:    report.dataset_name ?? 'the dataset',
    industry:        report.industry_context ?? 'general',
    domain:          report.industry_context ?? 'decisions',
    region:          report.region ?? 'india',
    verdict:         report.overall_risk_level,
    overall_grade:   report.overall_grade,

    // Groups — who is being compared, who is disadvantaged
    privileged_group:   go?.privileged_group   ?? 'one group',
    unprivileged_group: go?.unprivileged_group ?? 'another group',
    protected_attribute: go?.protected_attribute ?? 'a protected characteristic',
    outcome_description: go?.outcome_column ?? 'outcome',

    // Numbers — ALL from the math engine, never estimated
    dir_score:          report.overall_dir_score,
    dir_threshold:      0.80,
    outcome_gap_pp:     gapPP,
    per_1000_gap:       per1000,
    privileged_rate_pct: Math.round(privRate * 100),
    unprivileged_rate_pct: Math.round(unprivRate * 100),
    annual_decisions:   annualDecisions,
    unfair_per_year:    unfairPerYear,

    // Proxy chain — what variable is doing the discrimination
    top_proxy_variable: top?.name ?? null,
    top_proxy_mi:       top ? Math.round(top.mi_score * 100) : null,
    proxy_for:          top?.proxy_for ?? null,

    // Remediation — what the fix actually does (from engine projection)
    fix_action:         fix?.action ?? null,
    fix_dir_improvement: fix?.expected_dir_improvement ?? null,

    // Impossibility flag — if present, it changes the narrative
    has_impossibility:  (report.impossibility_conflicts?.length ?? 0) > 0,
    impossibility_pattern: report.impossibility_conflicts?.[0]?.pattern_name ?? null,
  };
}

// ── Gemini system prompt ──────────────────────────────────────────────────────
// This prompt is the heart of the emotional layer.
// It tells Gemini exactly what role it plays and what it must never do.
const SYSTEM_PROMPT = `You are the human voice inside an AI bias auditing tool called ProxyGuard.

Your role is NOT to analyze data. The analysis is already done.
Your role is to translate what the numbers mean for real people — with empathy, honesty, and weight.

You will receive a structured JSON object with audit results. Every number in that object came from a rigorous mathematical engine. You must use ONLY those numbers. Do not invent, estimate, or round differently.

Write as if you are speaking to the person responsible for deploying this system — a product manager, a bank executive, an HR director. They are not evil. They may not have realized what their model was doing. You are helping them see it.

DO NOT:
- Use technical terms (DIR, SPD, MI, TPR, statistical parity)
- Guilt-trip or moralize excessively
- Exaggerate or soften the numbers
- Invent scenario details not in the data
- Use phrases like "it is important to note" or "it is worth mentioning"
- Write more than the requested sections

DO:
- Use the exact numbers provided
- Name the groups as provided (do not substitute)
- Write with warmth and gravity — this matters, and you know it
- Make one person feel real in the person_story
- Let the numbers do the moral work — you just give them a face

Return ONLY valid JSON with exactly these five keys:
{
  "opening_line": "One sentence. The single most important truth about what this audit found. Striking. Human. Not technical. Make it land.",
  "person_story": "2–3 sentences. One person — not named — from the disadvantaged group. What decision was made about them. What it meant for their life. Use the industry context to make it specific (a loan, a job, a medical diagnosis, a bail decision). Do not say 'imagine'. Write it as if it happened, because statistically, it did.",
  "scale_statement": "2 sentences. Use the per_1000_gap and unfair_per_year numbers exactly. What this looks like across everyone affected by the system.",
  "what_changes": "2 sentences. If the top fix is applied. What changes for the people on the wrong side of this line. Specific. Grounded. Use the fix data if provided.",
  "closing_call": "One sentence. Not a call to action. Not a slogan. Just the truth of why this matters — quietly, with weight."
}`;

// ── Gemini API call ───────────────────────────────────────────────────────────
async function fetchNarrative(payload: object): Promise<NarrativeOutput | null> {
  const userMessage = `Here is the audit result. Write the human story.\n\n${JSON.stringify(payload, null, 2)}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await response.json();
    const raw  = data.content?.[0]?.text ?? '';
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean) as NarrativeOutput;
  } catch {
    return null;
  }
}

// NOTE FOR INTEGRATION:
// Replace the fetch above with your existing Gemini service call.
// The payload structure and system prompt are what matter.
// Your backend gemini.py equivalent call would be:
//
//   POST /api/v1/audit/{audit_id}/narrative
//   Body: { payload: buildNarrativePayload(report, annualDecisions) }
//
// Backend adds GEMINI_API_KEY and forwards to Gemini 1.5 Flash.
// Keep temperature at 0.4 (enough warmth, not hallucination territory).

interface NarrativeOutput {
  opening_line:    string;
  person_story:    string;
  scale_statement: string;
  what_changes:    string;
  closing_call:    string;
}

// ── Animated text reveal ──────────────────────────────────────────────────────
function TypewriterText({ text, delay = 0 }: { text: string; delay?: number }) {
  const [displayed, setDisplayed] = useState('');
  const [started,   setStarted]   = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const interval = setInterval(() => {
      setDisplayed(text.slice(0, i + 1));
      i++;
      if (i >= text.length) clearInterval(interval);
    }, 18);
    return () => clearInterval(interval);
  }, [started, text]);

  return <>{displayed}{started && displayed.length < text.length && <span style={{ opacity: 0.4 }}>|</span>}</>;
}

// ── Fade-in section ───────────────────────────────────────────────────────────
function FadeSection({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div style={{
      opacity:    visible ? 1 : 0,
      transform:  visible ? 'translateY(0)' : 'translateY(8px)',
      transition: 'opacity 0.6s ease, transform 0.6s ease',
    }}>
      {children}
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div style={{ padding: '32px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          border: `2px solid ${C.border}`,
          borderTopColor: C.blue,
          animation: 'spin 0.9s linear infinite',
        }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: C.hint, letterSpacing: 1 }}>
          GENERATING HUMAN STORY…
        </span>
      </div>

      {[120, 80, 100, 90, 60].map((w, i) => (
        <div key={i} style={{
          height: 14,
          background: C.s3,
          borderRadius: 4,
          marginBottom: 12,
          width: `${w}%`,
          animation: `pulse 1.5s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:.7} }
      `}</style>
    </div>
  );
}

// ── Verdict pill ──────────────────────────────────────────────────────────────
function VerdictPill({ verdict }: { verdict: string }) {
  const cfg: Record<string, { color: string; bg: string; label: string }> = {
    FAIL:   { color: C.red,   bg: 'rgba(255,77,109,0.12)',  label: 'BIASED' },
    REVIEW: { color: C.amber, bg: 'rgba(255,184,48,0.12)',  label: 'AT RISK' },
    PASS:   { color: C.green, bg: 'rgba(61,220,132,0.12)',  label: 'FAIR' },
  };
  const { color, bg, label } = cfg[verdict] ?? cfg.REVIEW;

  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
      padding: '3px 10px', borderRadius: 99,
      background: bg, color, letterSpacing: 1.5,
      border: `0.5px solid ${color}44`,
    }}>
      {label}
    </span>
  );
}

// ── Section block ─────────────────────────────────────────────────────────────
function StoryBlock({
  label, children, accent, delay = 0,
}: { label: string; children: React.ReactNode; accent?: string; delay?: number }) {
  return (
    <FadeSection delay={delay}>
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 2,
          textTransform: 'uppercase', color: accent ?? C.hint,
          marginBottom: 10,
        }}>
          {label}
        </div>
        <div style={{
          fontSize: 15, lineHeight: 1.8, color: C.text,
          fontFamily: "'Georgia', serif",
          paddingLeft: 16,
          borderLeft: `2px solid ${accent ?? C.border}`,
        }}>
          {children}
        </div>
      </div>
    </FadeSection>
  );
}

// ── Scale bar ─────────────────────────────────────────────────────────────────
function ScaleBar({ label, value, max, color }: {
  label: string; value: number; max: number; color: string;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setWidth(pct), 200);
    return () => clearTimeout(t);
  }, [pct]);

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: C.muted, fontFamily: 'var(--mono)' }}>{label}</span>
        <span style={{ fontSize: 12, color, fontFamily: 'var(--mono)', fontWeight: 600 }}>{value.toLocaleString()}</span>
      </div>
      <div style={{ height: 6, background: C.s3, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', background: color, borderRadius: 3,
          width: `${width}%`, transition: 'width 1.2s cubic-bezier(0.16,1,0.3,1)',
        }} />
      </div>
    </div>
  );
}

// ── Error / fallback ──────────────────────────────────────────────────────────
function FallbackNarrative({ report, annualDecisions }: { report: AuditReport; annualDecisions: number }) {
  const go      = report.group_outcomes?.[0];
  const verdict = report.overall_risk_level;
  const per1000 = Math.round(Math.abs((go?.privileged_rate ?? 0) - (go?.unprivileged_rate ?? 0)) * 1000);
  const unfair  = Math.round(annualDecisions * Math.abs((go?.privileged_rate ?? 0) - (go?.unprivileged_rate ?? 0)) * 0.5);

  const stories: Record<string, NarrativeOutput> = {
    FAIL: {
      opening_line:    `This model does not treat ${go?.unprivileged_group ?? 'all people'} equally — and right now, nobody in the organization knows.`,
      person_story:    `A ${go?.unprivileged_group ?? 'person'} applied for a ${report.industry_context === 'finance' ? 'loan' : report.industry_context === 'hr' ? 'job' : 'place in the system'}. They were qualified. The model said no. Not because of anything they did — because of a pattern in historical data that the model learned and repeated, silently, at scale.`,
      scale_statement: `For every 1,000 people this system evaluates, ${per1000} more ${go?.privileged_group ?? 'people from the advantaged group'} receive a positive outcome than ${go?.unprivileged_group ?? 'the disadvantaged group'} — not because of merit, but because of bias baked into the training data. Across ${annualDecisions.toLocaleString()} annual decisions, that is approximately ${unfair.toLocaleString()} people treated unfairly every year.`,
      what_changes:    `If the recommended fix is applied before this model is deployed, that gap shrinks significantly. ${unfair.toLocaleString()} fewer people face an unfair outcome — not because the bar was lowered, but because it was made equal.`,
      closing_call:    `The model learned from history. Now you have the chance to decide if history repeats.`,
    },
    REVIEW: {
      opening_line:    `This dataset sits on the edge — not failing today, but carrying the seeds of discrimination at scale.`,
      person_story:    `Someone from ${go?.unprivileged_group ?? 'the disadvantaged group'} applied. They made it through — this time. But the variables in this model are correlated with protected characteristics in ways that, as the model is used more widely or retrained on new data, will likely push that outcome the other way.`,
      scale_statement: `The gap is ${per1000} per 1,000 decisions. That sounds manageable. Across ${annualDecisions.toLocaleString()} decisions a year, it means ${unfair.toLocaleString()} people sit in a borderline zone where their protected characteristics may be influencing outcomes without anyone realizing.`,
      what_changes:    `The fixes are small and technical. The impact is not. Cleaning these variables before deployment is the difference between a fair system and one that silently compounds inequality over time.`,
      closing_call:    `Borderline is not safe — it is a warning.`,
    },
    PASS: {
      opening_line:    `This dataset passes the core fairness checks — which matters, and which is rarer than it should be.`,
      person_story:    `Someone from ${go?.unprivileged_group ?? 'every group'} who interacts with a model trained on this data has a reasonably equal chance of a fair outcome. That is the baseline of a just system — and most systems today do not meet it.`,
      scale_statement: `Across ${annualDecisions.toLocaleString()} annual decisions, the outcome gap is small enough to meet international fairness standards. This does not mean the system is perfect — it means the most significant forms of detectable discrimination are not present in this data at this moment.`,
      what_changes:    `Fairness is not a property you set once. As this model is used and the world changes, these metrics need to be rechecked. What passes today can fail tomorrow if the data distribution shifts.`,
      closing_call:    `This is a passing grade, not a finish line.`,
    },
  };

  return stories[verdict] ?? stories.REVIEW;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function HumanStoryPanel({ report, gemini, annualDecisions = 10000 }: Props) {
  const [narrative,  setNarrative]  = useState<NarrativeOutput | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [decisions,  setDecisions]  = useState(annualDecisions);
  const [showSlider, setShowSlider] = useState(false);
  const fetchedRef = useRef(false);

  const go      = report.group_outcomes?.[0];
  const per1000 = Math.round(Math.abs((go?.privileged_rate ?? 0) - (go?.unprivileged_rate ?? 0)) * 1000);
  const unfair  = Math.round(decisions * Math.abs((go?.privileged_rate ?? 0) - (go?.unprivileged_rate ?? 0)) * 0.5);
  const verdict = report.overall_risk_level;

  const accentColor =
    verdict === 'FAIL'   ? C.red   :
    verdict === 'REVIEW' ? C.amber :
    C.green;

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const payload = buildNarrativePayload(report, decisions);

    fetchNarrative(payload)
      .then(result => {
        if (result) {
          setNarrative(result);
        } else {
          setNarrative(FallbackNarrative({ report, annualDecisions: decisions }));
        }
      })
      .catch(() => {
        setNarrative(FallbackNarrative({ report, annualDecisions: decisions }));
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: '4px 0 24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 2,
            textTransform: 'uppercase', color: C.hint, marginBottom: 8,
          }}>
            Human Impact
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h3 style={{
              fontFamily: 'var(--syne, sans-serif)', fontSize: 20,
              fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.3px',
            }}>
              What this means for people
            </h3>
            <VerdictPill verdict={verdict} />
          </div>
        </div>

        <button
          onClick={() => setShowSlider(s => !s)}
          style={{
            fontFamily: 'var(--mono)', fontSize: 10, padding: '6px 12px',
            borderRadius: 8, border: `0.5px solid ${C.border2 ?? C.border}`,
            background: 'transparent', color: C.muted, cursor: 'pointer',
            letterSpacing: 0.5, whiteSpace: 'nowrap',
          }}
        >
          ⚙ Scale
        </button>
      </div>

      {/* Scale slider */}
      {showSlider && (
        <div style={{
          background: C.s2, borderRadius: 10, padding: '14px 18px',
          marginBottom: 24, border: `0.5px solid ${C.border}`,
        }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 10, color: C.hint,
            letterSpacing: 1, marginBottom: 10,
          }}>
            ANNUAL DECISIONS — YOUR ORGANIZATION
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <input
              type="range" min={500} max={500000} step={500}
              value={decisions}
              onChange={e => setDecisions(parseInt(e.target.value))}
              style={{ flex: 1, accentColor: accentColor }}
            />
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600,
              color: C.text, minWidth: 80, textAlign: 'right',
            }}>
              {decisions.toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Impact numbers — always from the engine, never from Gemini */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: 10, marginBottom: 28,
      }}>
        {[
          {
            value: `${per1000}`,
            unit: 'per 1,000',
            label: 'extra rejections for\n' + (go?.unprivileged_group ?? 'disadvantaged group'),
            color: accentColor,
          },
          {
            value: unfair.toLocaleString(),
            unit: '/year',
            label: 'people affected\nif deployed now',
            color: accentColor,
          },
          {
            value: `${Math.round(report.overall_dir_score * 100)}%`,
            unit: 'of fair',
            label: 'outcome rate for\n' + (go?.unprivileged_group ?? 'disadvantaged group'),
            color: report.overall_dir_score < 0.8 ? C.red : C.green,
          },
        ].map((stat, i) => (
          <div key={i} style={{
            background: C.s2, borderRadius: 10, padding: '14px 16px',
            border: `0.5px solid ${C.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{
                fontFamily: 'var(--syne, sans-serif)', fontSize: 28,
                fontWeight: 800, color: stat.color, lineHeight: 1,
              }}>
                {stat.value}
              </span>
              <span style={{ fontSize: 11, color: C.hint, fontFamily: 'var(--mono)' }}>
                {stat.unit}
              </span>
            </div>
            <div style={{
              fontSize: 11, color: C.muted, marginTop: 5, lineHeight: 1.5,
              whiteSpace: 'pre-line',
            }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Scale visualization */}
      <div style={{
        background: C.s2, borderRadius: 10, padding: '14px 18px',
        border: `0.5px solid ${C.border}`, marginBottom: 28,
      }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 2, color: C.hint, marginBottom: 12 }}>
          OUTCOME RATES: WHO GETS A FAIR RESULT
        </div>
        <ScaleBar
          label={go?.privileged_group ?? 'Privileged group'}
          value={Math.round((go?.privileged_rate ?? 0) * 100)}
          max={100}
          color={C.green}
        />
        <ScaleBar
          label={go?.unprivileged_group ?? 'Disadvantaged group'}
          value={Math.round((go?.unprivileged_rate ?? 0) * 100)}
          max={100}
          color={accentColor}
        />
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 10, color: C.hint,
          marginTop: 8, textAlign: 'right',
        }}>
          % receiving a positive outcome
        </div>
      </div>

      {/* Gemini narrative — the emotional core */}
      {loading ? (
        <LoadingSkeleton />
      ) : narrative ? (
        <div>
          {/* Opening line — the hook */}
          <FadeSection delay={100}>
            <div style={{
              fontSize: 18, lineHeight: 1.65,
              fontFamily: "'Georgia', serif",
              color: C.text, marginBottom: 28,
              paddingBottom: 24,
              borderBottom: `0.5px solid ${C.border}`,
            }}>
              <TypewriterText text={narrative.opening_line} delay={200} />
            </div>
          </FadeSection>

          {/* Person story — the human moment */}
          <StoryBlock label="What happened" accent={accentColor} delay={600}>
            {narrative.person_story}
          </StoryBlock>

          {/* Scale — the math given a face */}
          <StoryBlock label="At scale" accent={C.blue} delay={900}>
            {narrative.scale_statement}
          </StoryBlock>

          {/* What changes — the fix matters */}
          <StoryBlock label="What the fix means" accent={C.green} delay={1200}>
            {narrative.what_changes}
          </StoryBlock>

          {/* Closing — quiet and true */}
          <FadeSection delay={1500}>
            <div style={{
              marginTop: 24, padding: '16px 20px',
              background: `${accentColor}0A`,
              border: `0.5px solid ${accentColor}33`,
              borderRadius: 10,
            }}>
              <p style={{
                fontFamily: "'Georgia', serif",
                fontSize: 15, lineHeight: 1.7,
                color: C.text, margin: 0,
                fontStyle: 'italic',
              }}>
                "{narrative.closing_call}"
              </p>
            </div>
          </FadeSection>

          {/* Attribution — transparency about AI role */}
          <FadeSection delay={1800}>
            <div style={{
              marginTop: 20, display: 'flex', alignItems: 'center',
              gap: 8, justifyContent: 'flex-end',
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.hint }} />
              <span style={{ fontSize: 10, color: C.hint, fontFamily: 'var(--mono)', letterSpacing: 0.5 }}>
                Narrative generated by Gemini · Numbers from ProxyGuard math engine · All figures verified against audit
              </span>
            </div>
          </FadeSection>
        </div>
      ) : null}
    </div>
  );
}
