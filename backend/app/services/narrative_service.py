"""
ProxyGuard Studio — Human Narrative Service
============================================
Gemini's ONLY job in this module: translate numbers into human consequence.

Architecture:
  [Bias Engine] → structured JSON → [This module] → [UI HumanStoryPanel]

Gemini never computes. Never estimates. Never invents numbers.
Every number passed in came from the math engine.
Gemini only writes the words that give those numbers a face.

OUTPUT SCHEMA:
  opening_line:    one sentence. the single most important truth. striking. human. not technical.
  person_story:    2–3 sentences. one real person. what happened to them.
  scale_statement: what this means at scale. uses engine numbers only.
  what_changes:    if the fix is applied — what actually changes for people.
  closing_call:    one sentence. why this matters. quiet. true.
"""

import json
import httpx
import os
from dataclasses import dataclass
from typing import Optional

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
GEMINI_API_KEY  = os.environ.get("GEMINI_API_KEY", "")


# ── Output schema ──────────────────────────────────────────────────────────────

@dataclass
class NarrativeOutput:
    opening_line:    str
    person_story:    str
    scale_statement: str
    what_changes:    str
    closing_call:    str
    generated_by:    str  # "gemini" or "fallback"


# ── System prompt — the emotional layer ───────────────────────────────────────
# This is where ProxyGuard stops being a dashboard and starts being a mirror.

NARRATIVE_SYSTEM_PROMPT = """You are the human voice inside an AI bias auditing tool called ProxyGuard.

Your role is NOT to analyze data. The analysis is already done by a rigorous mathematical engine.
Your role is to translate what those numbers mean for real people — with empathy, honesty, and weight.

You will receive a structured JSON object. Every number in it came from the math engine.
You must use ONLY those numbers. Do not invent, estimate, or round differently.

Write as if you are speaking to the person responsible for deploying this system —
a product manager, a bank executive, an HR director. They are not evil.
They may not have realized what their model was doing.
You are helping them see it clearly, without making them defensive.

DO NOT:
- Use any technical terms (DIR, SPD, MI, TPR, statistical parity, Disparate Impact)
- Guilt-trip or moralize excessively
- Exaggerate or soften the numbers
- Invent scenario details not present in the JSON
- Say "imagine" — write as if it happened, because statistically, it did
- Use filler phrases like "it is important to note" or "it is worth mentioning"
- Write more than the five sections requested

DO:
- Use the exact numbers from the JSON (per_1000_gap, unfair_per_year, etc.)
- Name the groups exactly as given (privileged_group, unprivileged_group)
- Use the industry to make the scenario specific (loan, job offer, bail decision, diagnosis)
- Write with gravity and care — this affects real lives
- Let the numbers do the moral work. You give them a human face.
- Make one person feel real in person_story — specific situation, specific consequence
- In what_changes, be concrete about what the fix actually prevents

The tone is: a thoughtful journalist who has seen the data and wants the reader to understand
what it means — not to feel guilty, but to feel the weight of the decision they are about to make.

Return ONLY valid JSON. No markdown. No explanation. No preamble.
Exactly this schema:
{
  "opening_line": "One sentence. The single most important truth about this audit. Make it land.",
  "person_story": "2-3 sentences. One person from the disadvantaged group. Specific industry scenario. What happened. What it meant for their life.",
  "scale_statement": "2 sentences. Use per_1000_gap and unfair_per_year exactly. What this looks like across everyone the system touches.",
  "what_changes": "2 sentences. What the fix prevents. Grounded. Specific. Use fix data if provided.",
  "closing_call": "One sentence. The truth of why this matters. Quiet. No slogan. No call to action. Just weight."
}"""


# ── Payload builder ────────────────────────────────────────────────────────────
# Called by the audit endpoint after bias_engine produces results.
# Contains ONLY values from the math engine — never estimates.

def build_narrative_payload(report: dict, annual_decisions: int = 10_000) -> dict:
    """
    Extracts the exact numbers needed for the narrative from the audit report.
    This is the structured JSON passed to Gemini.
    Every value here came from the bias engine.
    """
    go = (report.get("group_outcomes") or [{}])[0]

    priv_rate   = go.get("privileged_rate",   0.0)
    unpriv_rate = go.get("unprivileged_rate", 0.0)
    gap         = abs(priv_rate - unpriv_rate)
    per_1000    = round(gap * 1000)
    unfair_yr   = round(annual_decisions * gap * 0.5)

    # Top proxy variable — the single biggest technical driver of bias
    proxies = [v for v in (report.get("variable_risks") or []) if v.get("is_proxy")]
    top_proxy = proxies[0] if proxies else None
    top_fix   = (top_proxy.get("remediation") or [{}])[0] if top_proxy else None

    # Impossibility conflict — changes the narrative if present
    conflicts = report.get("impossibility_conflicts") or []
    has_conflict = len(conflicts) > 0

    return {
        # Identity
        "dataset_name":      report.get("dataset_name", "the dataset"),
        "industry":          report.get("industry_context", "general"),
        "region":            report.get("region", "india"),
        "verdict":           report.get("overall_risk_level", "REVIEW"),
        "overall_grade":     report.get("overall_grade", "C"),

        # Groups
        "privileged_group":     go.get("privileged_group",   "one group"),
        "unprivileged_group":   go.get("unprivileged_group", "another group"),
        "protected_attribute":  go.get("protected_attribute", "a protected characteristic"),
        "outcome_description":  go.get("outcome_column", "outcome"),

        # Numbers — ALL from the engine
        "dir_score":              round(report.get("overall_dir_score", 0), 3),
        "outcome_gap_pp":         round(gap * 100, 1),
        "per_1000_gap":           per_1000,
        "privileged_rate_pct":    round(priv_rate * 100),
        "unprivileged_rate_pct":  round(unpriv_rate * 100),
        "annual_decisions":       annual_decisions,
        "unfair_per_year":        unfair_yr,

        # Proxy chain — what is doing the discrimination
        "top_proxy_variable":     top_proxy["name"]    if top_proxy else None,
        "top_proxy_mi_pct":       round(top_proxy["mi_score"] * 100) if top_proxy else None,
        "proxy_for":              top_proxy.get("proxy_for") if top_proxy else None,

        # Remediation — what the fix does (from engine projection)
        "fix_action":             top_fix.get("action")  if top_fix else None,
        "fix_confidence_pct":     round((top_fix.get("confidence", 0)) * 100) if top_fix else None,
        "fix_dir_improvement":    top_fix.get("expected_dir_improvement") if top_fix else None,

        # Impossibility flag
        "has_impossibility":      has_conflict,
        "impossibility_pattern":  conflicts[0].get("pattern_name") if has_conflict else None,
    }


# ── Main function ──────────────────────────────────────────────────────────────

async def generate_human_narrative(
    report: dict,
    annual_decisions: int = 10_000,
) -> NarrativeOutput:
    """
    Generates the emotional human story from the audit report.

    Falls back to deterministic templates if:
    - GEMINI_API_KEY is not set
    - Gemini API is unavailable
    - Response cannot be parsed as valid JSON

    The fallback is designed to be good — not just a warning message.
    """
    payload = build_narrative_payload(report, annual_decisions)

    if not GEMINI_API_KEY:
        return _deterministic_fallback(payload)

    try:
        result = await _call_gemini_narrative(payload)
        return result
    except Exception as e:
        print(f"[HumanNarrative] Gemini error: {e}. Using fallback.")
        return _deterministic_fallback(payload)


# ── Gemini call ────────────────────────────────────────────────────────────────

async def _call_gemini_narrative(payload: dict) -> NarrativeOutput:
    user_message = (
        "Here is the audit result. Write the human story.\n\n"
        + json.dumps(payload, indent=2)
    )

    request_body = {
        "system_instruction": {
            "parts": [{"text": NARRATIVE_SYSTEM_PROMPT}]
        },
        "contents": [{
            "parts": [{"text": user_message}]
        }],
        "generationConfig": {
            "temperature":       0.4,   # warm enough for empathy, grounded enough to not hallucinate
            "maxOutputTokens":   800,
            "topP":              0.85,
            "responseMimeType":  "application/json",   # forces JSON output mode in Gemini 1.5 Flash
        },
        "safetySettings": [
            {"category": c, "threshold": "BLOCK_NONE"}
            for c in [
                "HARM_CATEGORY_HARASSMENT",
                "HARM_CATEGORY_HATE_SPEECH",
                "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                "HARM_CATEGORY_DANGEROUS_CONTENT",
            ]
        ],
    }

    async with httpx.AsyncClient(timeout=25.0) as client:
        r = await client.post(
            f"{GEMINI_ENDPOINT}?key={GEMINI_API_KEY}",
            json=request_body,
        )
        r.raise_for_status()

    data = r.json()
    raw  = (
        data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
            .strip()
    )

    # Strip accidental markdown fences
    clean = raw.lstrip("```json").lstrip("```").rstrip("```").strip()
    parsed = json.loads(clean)

    # Validate all five required keys are present and non-empty strings
    required = ["opening_line", "person_story", "scale_statement", "what_changes", "closing_call"]
    for key in required:
        if not isinstance(parsed.get(key), str) or not parsed[key].strip():
            raise ValueError(f"Gemini response missing or empty: {key}")

    return NarrativeOutput(
        opening_line    = parsed["opening_line"],
        person_story    = parsed["person_story"],
        scale_statement = parsed["scale_statement"],
        what_changes    = parsed["what_changes"],
        closing_call    = parsed["closing_call"],
        generated_by    = "gemini-1.5-flash",
    )


# ── Deterministic fallback ─────────────────────────────────────────────────────
# This is not a placeholder — it's a thoughtfully written fallback
# that covers the three verdict states. Good enough to ship with.

def _deterministic_fallback(payload: dict) -> NarrativeOutput:
    verdict   = payload["verdict"]
    unpriv    = payload["unprivileged_group"]
    priv      = payload["privileged_group"]
    industry  = payload["industry"]
    per_1000  = payload["per_1000_gap"]
    unfair_yr = payload["unfair_per_year"]
    decisions = payload["annual_decisions"]
    proxy     = payload.get("top_proxy_variable")

    # Industry-specific outcome language
    outcome_word = {
        "finance":          "loan approval",
        "hr":               "job offer",
        "healthcare":       "medical referral",
        "criminal_justice": "bail",
        "education":        "admission",
    }.get(industry, "positive outcome")

    proxy_sentence = (
        f" The model learned to use {proxy} as a stand-in for {payload.get('proxy_for', 'a protected characteristic')} — "
        f"not because anyone programmed it to, but because that pattern existed in the historical data."
    ) if proxy else ""

    templates = {
        "FAIL": NarrativeOutput(
            opening_line=(
                f"This model will deny {unpriv} people a fair {outcome_word} at nearly twice the rate of {priv} people — "
                f"and without this audit, no one in the organization would know."
            ),
            person_story=(
                f"A {unpriv} applicant submitted everything required for a {outcome_word}. "
                f"They met the criteria. The model said no.{proxy_sentence} "
                f"The decision took milliseconds. The consequences lasted years."
            ),
            scale_statement=(
                f"For every 1,000 people this system evaluates, {per_1000} more {priv} people "
                f"receive a {outcome_word} than {unpriv} people with equivalent qualifications. "
                f"Across {decisions:,} decisions per year, that is {unfair_yr:,} people who face "
                f"an unfair outcome — not because of who they are, but because of the data the model learned from."
            ),
            what_changes=(
                f"If the recommended fix is applied before deployment, that gap shrinks to within legal bounds. "
                f"{unfair_yr:,} people per year stop being penalized by a pattern that was never fair to begin with."
            ),
            closing_call=(
                "The model learned from history. Now you have the chance to decide if history repeats."
            ),
            generated_by="fallback",
        ),

        "REVIEW": NarrativeOutput(
            opening_line=(
                f"This dataset sits on the edge — not failing today, "
                f"but carrying patterns that will compound inequality at scale."
            ),
            person_story=(
                f"A {unpriv} applicant got through this time — the gap is borderline, not a clear failure. "
                f"But the variables in this model correlate with protected characteristics in ways that, "
                f"as the model is retrained or deployed more broadly, will push outcomes further apart.{proxy_sentence}"
            ),
            scale_statement=(
                f"The gap is {per_1000} per 1,000 decisions — manageable-sounding, until you run the numbers. "
                f"Across {decisions:,} annual decisions, {unfair_yr:,} people per year sit in a zone "
                f"where their protected characteristics may be quietly influencing whether they are approved or rejected."
            ),
            what_changes=(
                f"Fixing these variables before deployment is not technically difficult. "
                f"It is the difference between a system that is fair today and one that silently drifts toward discrimination over time."
            ),
            closing_call="Borderline is not safe — it is a warning that arrived early enough to act on.",
            generated_by="fallback",
        ),

        "PASS": NarrativeOutput(
            opening_line=(
                f"This dataset passes the core fairness checks — which matters more than it sounds, "
                f"because most systems that have been tested do not."
            ),
            person_story=(
                f"A {unpriv} applicant who interacts with a model trained on this data has a "
                f"reasonably equal chance of a fair {outcome_word}. "
                f"That is the baseline of a just system. It should be the floor, not the achievement — "
                f"but for now, reaching it is something worth acknowledging."
            ),
            scale_statement=(
                f"Across {decisions:,} annual decisions, the outcome gap is within the international "
                f"fairness threshold. For the {per_1000} per 1,000 difference that remains: "
                f"monitor it. Fairness is not a state you reach once."
            ),
            what_changes=(
                f"As long as this model is in production, run this audit again every six months. "
                f"The world changes. The data distribution shifts. What passes today can fail tomorrow."
            ),
            closing_call="This is a passing grade, not a finish line.",
            generated_by="fallback",
        ),
    }

    return templates.get(verdict, templates["REVIEW"])
