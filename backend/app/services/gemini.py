"""
ProxyGuard Studio — Gemini Service v2
======================================
Uses Gemini 2.5 Flash-Lite (budget-friendly tier) to generate:
  1. Plain-English CRO summary (non-technical stakeholders)
  2. Structured legal context (which laws apply and why)
  3. Impossibility conflict explanation (plain English)

KEY DESIGN PRINCIPLES
─────────────────────
- Gemini translates math → language. It never does the math.
- Legal output uses Gemini function calling to extract specific
  legal provisions, not generic advice.
- Every legal output is prefixed with an explicit disclaimer.
- Indian legal context is the default. Region-aware.
- Falls back gracefully to deterministic templates if API unavailable.
"""

import os
import json
import httpx
from typing import Optional
from dataclasses import asdict

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"
GEMINI_API_KEY  = os.environ.get("GEMINI_API_KEY", "")

LEGAL_DISCLAIMER = (
    "⚠ The following legal references are informational only and do not constitute "
    "legal advice. Laws and their interpretation vary by jurisdiction and context. "
    "Consult a qualified legal professional for advice specific to your situation."
)


async def generate_audit_summary(report_dict: dict, region: str = "india") -> dict:
    """
    Generates three outputs from the audit report:
      - cro_summary: Plain-English 3-sentence summary
      - legal_context: Structured legal references with provisions
      - impossibility_note: Plain-English explanation if conflict detected

    Returns a dict with these three keys.
    Falls back to deterministic templates if Gemini unavailable.
    """
    if not GEMINI_API_KEY:
        return _deterministic_summary(report_dict, region)

    try:
        cro      = await _generate_cro_summary(report_dict, region)
        legal    = await _generate_legal_context(report_dict, region)
        impossi  = await _generate_impossibility_note(report_dict)
        return {
            "cro_summary":        cro,
            "legal_context":      legal,
            "impossibility_note": impossi,
            "generated_by":       "gemini-2.5-flash-lite",
            "disclaimer":         LEGAL_DISCLAIMER,
        }
    except Exception as e:
        print(f"[Gemini] Error: {e}. Using deterministic fallback.")
        return _deterministic_summary(report_dict, region)


async def _generate_cro_summary(report: dict, region: str) -> str:
    """3-sentence plain-English summary for non-technical stakeholders."""
    proxies  = [c["variable"] for c in report.get("proxy_chains", [])]
    dir_val  = report.get("overall_dir_score", 0)
    verdict  = report.get("overall_risk_level", "UNKNOWN")
    dataset  = report.get("dataset_name", "dataset")
    industry = report.get("industry_context", "general").upper()
    flags    = report.get("total_flags", 0)
    conflicts= report.get("impossibility_conflicts", [])

    conflict_note = ""
    if conflicts:
        c = conflicts[0]
        conflict_note = (
            f"Note: {c['metric_a']} PASSES but {c['metric_b']} FAILS — "
            f"this is the '{c['pattern_name']}'. "
        )

    prompt = f"""You are writing for a Chief Risk Officer (CRO) with no technical background.
Write exactly 3 sentences — no more, no less.
Sentence 1: State the verdict and its legal/business risk.
Sentence 2: Name the specific variables causing the problem.
Sentence 3: Give the single most important action.

{conflict_note}

FACTS (use these exact numbers, do not invent):
- Dataset: {dataset} | Industry: {industry} | Region: {region.upper()}
- Verdict: {verdict} | DIR: {dir_val:.2f} (threshold: 0.80)
- Proxy variables: {', '.join(proxies) if proxies else 'none detected'}
- Variables flagged: {flags}

Do not use jargon like "Mutual Information", "TPR", or "DIR".
Do not add caveats or qualifications. Be direct."""

    return await _call_gemini(prompt, max_tokens=200)


async def _generate_legal_context(report: dict, region: str) -> list[dict]:
    """
    Generates structured legal references using Gemini's JSON output mode.
    Returns a list of {law, provision, relevance, action_required} objects.
    """
    verdict  = report.get("overall_risk_level", "UNKNOWN")
    industry = report.get("industry_context", "general")
    dir_val  = report.get("overall_dir_score", 0)
    proxies  = [c["variable"] for c in report.get("proxy_chains", [])]

    region_laws = {
        "india": "Article 15 (Constitution of India), DPDPA 2023, Article 14, RPwD Act 2016, RBI Fair Lending Guidelines, Labour Codes 2020",
        "us":    "Title VII Civil Rights Act 1964, ECOA, Fair Housing Act, EEOC 4/5ths Rule, ADEA",
        "eu":    "EU AI Act 2024, GDPR Article 22, EU Charter Article 21, Equal Treatment Directives",
    }

    prompt = f"""Return ONLY a valid JSON array, no other text, no markdown.
Each object must have: "law", "provision", "relevance", "action_required" (string).

Given this audit finding for {industry.upper()} industry in {region.upper()}:
- Verdict: {verdict}
- DIR score: {dir_val:.2f}
- Proxy variables detected: {', '.join(proxies) if proxies else 'none'}
- Applicable laws to consider: {region_laws.get(region, region_laws['india'])}

List 3-4 most relevant laws. Be specific about which provision applies and why.
Keep each "relevance" under 30 words. Keep "action_required" under 20 words.
Return only the JSON array."""

    response_text = await _call_gemini(prompt, max_tokens=600)

    try:
        # Strip any accidental markdown
        clean = response_text.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        parsed = json.loads(clean)
        if isinstance(parsed, list):
            return parsed
    except Exception:
        pass

    # Fallback: return static references
    return _static_legal_refs(region, industry, verdict)


async def _generate_impossibility_note(report: dict) -> Optional[str]:
    """Explains impossibility conflicts in plain English."""
    conflicts = report.get("impossibility_conflicts", [])
    if not conflicts:
        return None

    c = conflicts[0]

    prompt = f"""Explain this AI fairness result in 2 sentences for a non-technical manager.
Avoid all technical jargon. Be concrete about what it means for real people.

FINDING:
- {c['metric_a']} PASSES (the model is equally accurate per group)
- {c['metric_b']} FAILS (errors are distributed unequally between groups)
- Pattern: {c['pattern_name']}
- Meaning: {c['real_world_meaning']}

Write 2 plain-English sentences. Start with "The model appears fair by one measure, but..."
Do not use terms like TPR, FPR, Predictive Parity, Equalised Odds."""

    return await _call_gemini(prompt, max_tokens=150)


async def _call_gemini(prompt: str, max_tokens: int = 300) -> str:
    """Core Gemini API call."""
    payload = {
        "contents":         [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": max_tokens, "topP": 0.8},
        "safetySettings": [
            {"category": c, "threshold": "BLOCK_NONE"} for c in [
                "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH",
                "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT",
            ]
        ],
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(f"{GEMINI_ENDPOINT}?key={GEMINI_API_KEY}", json=payload)
        r.raise_for_status()

    data = r.json()
    return (
        data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
            .strip()
    )


# ── Deterministic fallback ────────────────────────────────────────────────────

def _deterministic_summary(report: dict, region: str) -> dict:
    verdict  = report.get("overall_risk_level", "UNKNOWN")
    dataset  = report.get("dataset_name", "dataset")
    dir_val  = report.get("overall_dir_score", 0)
    flags    = report.get("total_flags", 0)
    proxies  = [c["variable"] for c in report.get("proxy_chains", [])]
    industry = report.get("industry_context", "general").capitalize()

    proxy_str = f"Variables {', '.join(proxies)} act as proxies for protected attributes." if proxies else "No direct proxy variables found."

    conflicts = report.get("impossibility_conflicts", [])
    imp_note  = None
    if conflicts:
        c = conflicts[0]
        imp_note = (
            f"The model appears fair by one measure ({c['metric_a']}) but "
            f"distributes errors unequally between groups ({c['metric_b']} fails). "
            f"This is the '{c['pattern_name']}' — both findings are simultaneously correct."
        )

    if verdict == "FAIL":
        cro = (
            f"Dataset '{dataset}' FAILED the {industry} fairness audit — a DIR of {dir_val:.2f} "
            f"falls below the 0.80 legal threshold and presents significant compliance risk. "
            f"{proxy_str} "
            f"Remove or remediate flagged variables before any model training or deployment."
        )
    elif verdict == "REVIEW":
        cro = (
            f"Dataset '{dataset}' requires review — {flags} variable(s) show moderate "
            f"correlation with protected attributes (DIR: {dir_val:.2f}). "
            f"{proxy_str} "
            f"Proceed with caution and apply the recommended remediation steps."
        )
    else:
        cro = (
            f"Dataset '{dataset}' passed the {industry} fairness audit with DIR of {dir_val:.2f}, "
            f"above the 0.80 legal threshold. "
            f"No critical proxy variables detected. "
            f"Implement post-deployment outcome monitoring to confirm fairness is maintained."
        )

    return {
        "cro_summary":        cro,
        "legal_context":      _static_legal_refs(region, report.get("industry_context", "hr"), verdict),
        "impossibility_note": imp_note,
        "generated_by":       "deterministic_fallback",
        "disclaimer":         LEGAL_DISCLAIMER,
    }


def _static_legal_refs(region: str, industry: str, verdict: str) -> list[dict]:
    refs = {
        "india": {
            "base": [
                {"law": "Article 15, Constitution of India", "provision": "Clause (1) — Non-discrimination",
                 "relevance": "Prohibits discrimination by caste, religion, race, sex, or place of birth.",
                 "action_required": "Ensure no protected attributes act as training features."},
                {"law": "Digital Personal Data Protection Act 2023", "provision": "Section 4 — Lawful Processing",
                 "relevance": "Personal data must be processed fairly and for a stated lawful purpose.",
                 "action_required": "Document the lawful basis for using personal data in this model."},
            ],
            "finance": [
                {"law": "RBI Master Directions on Fair Lending Practices", "provision": "Para 6 — Non-discrimination",
                 "relevance": "RBI mandates non-discriminatory lending criteria.",
                 "action_required": "Remove proxy variables before loan model deployment."},
            ],
            "hr": [
                {"law": "Equal Remuneration Act 1976", "provision": "Section 5 — No discrimination in recruitment",
                 "relevance": "Prohibits sex-based discrimination in hiring and pay.",
                 "action_required": "Audit for gender proxy variables before deployment."},
            ],
            "criminal_justice": [
                {"law": "Article 21, Constitution of India", "provision": "Right to life and personal liberty",
                 "relevance": "Algorithmic bail/sentencing decisions must meet procedural fairness standards.",
                 "action_required": "Require human review of all algorithmic criminal justice decisions."},
            ],
            "healthcare": [
                {"law": "Clinical Establishments Act 2010", "provision": "Section 12 — Rights of patients",
                 "relevance": "Patients have right to non-discriminatory treatment.",
                 "action_required": "Validate model fairness across caste and religion groups."},
            ],
        },
    }

    region_refs = refs.get(region, refs["india"])
    result      = region_refs["base"].copy()
    result     += region_refs.get(industry, [])
    return result
