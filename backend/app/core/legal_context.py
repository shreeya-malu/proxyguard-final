"""
ProxyGuard Studio — Legal Context Module
==========================================
Maps fairness metrics to the legal frameworks of specific regions.

Design principle: Legal context is separate from math. The engine computes
the same numbers everywhere. What changes per region is:
  - Which protected attributes are legally recognised
  - Which thresholds have legal weight
  - Which laws are cited in the audit report
  - Whether a numeric threshold exists in law or we apply international standard

Currently supported regions:
  - india  (default)
  - us
  - eu

Adding a new region: add an entry to LEGAL_CONTEXTS and PROTECTED_ATTRIBUTES.
"""

from dataclasses import dataclass, field


# ── Metric thresholds ─────────────────────────────────────────────────────────
# These are the internationally recognised thresholds from the fairness
# literature and regulatory guidance. Where a country has its own numeric
# threshold, that takes precedence. Where it doesn't, we apply the
# international standard and document the legal gap.

@dataclass
class MetricThreshold:
    metric:           str
    threshold:        float
    direction:        str    # "above" (pass if value >= threshold)
                             # "below" (pass if |value| <= threshold)
    legal_basis:      str    # the law or standard that sets this threshold
    has_numeric_law:  bool   # True = actual law with number. False = literature standard
    note:             str    # plain-English note shown in audit report


THRESHOLDS_INDIA = {
    "dir": MetricThreshold(
        metric="disparate_impact_ratio",
        threshold=0.80,
        direction="above",
        legal_basis="Article 15, Constitution of India + International Standard (EEOC 4/5ths Rule)",
        has_numeric_law=False,
        note="India has no numeric DIR threshold in statute. We apply the international 0.80 standard. "
             "Under Article 15, systematic outcome disparity by protected attribute is unconstitutional. "
             "The DPDPA 2023 requires lawful and fair processing of personal data.",
    ),
    "spd": MetricThreshold(
        metric="statistical_parity_difference",
        threshold=0.05,
        direction="below",
        legal_basis="Article 15, Constitution of India + AIF360 Literature Standard",
        has_numeric_law=False,
        note="Absolute outcome gap threshold. |SPD| > 0.05 indicates systematic disparity "
             "inconsistent with Article 15 non-discrimination principles.",
    ),
    "eod": MetricThreshold(
        metric="equal_opportunity_difference",
        threshold=0.10,
        direction="below",
        legal_basis="Article 14 (equality before law) + Article 15, Constitution of India",
        has_numeric_law=False,
        note="Requires ground truth labels. |EOD| > 0.10 means deserving members of the "
             "unprivileged group are being denied at a significantly higher rate. "
             "This is a direct Article 14 violation pattern.",
    ),
    "eqod": MetricThreshold(
        metric="equalised_odds_difference",
        threshold=0.10,
        direction="below",
        legal_basis="Article 14, Article 15 + RPwD Act 2016 (for disability context)",
        has_numeric_law=False,
        note="Requires ground truth labels. Captures both false positive and false negative "
             "parity. The COMPAS finding that prompted global algorithmic accountability "
             "reform was an EQOD violation.",
    ),
    "fprp": MetricThreshold(
        metric="false_positive_rate_parity",
        threshold=0.10,
        direction="below",
        legal_basis="DPDPA 2023 Section 4 + RBI Fair Lending Guidelines + Article 15",
        has_numeric_law=False,
        note="Requires ground truth labels. |FPRP| > 0.10 in credit/insurance means "
             "one group faces a systematically higher bar for approval. "
             "Relevant under RBI guidelines on non-discriminatory lending.",
    ),
    "predictive_parity_diff": MetricThreshold(
        metric="predictive_parity_difference",
        threshold=0.05,
        direction="below",
        legal_basis="NITI Aayog Responsible AI Principles 2021",
        has_numeric_law=False,
        note="Requires ground truth labels. A system can pass this while failing EOD — "
             "this is the mathematically proven Impossibility Theorem (Chouldechova 2017). "
             "When conflict detected, we flag it explicitly.",
    ),
    "cramers_v": MetricThreshold(
        metric="cramers_v_proxy",
        threshold=0.30,
        direction="below",
        legal_basis="Article 15, Constitution of India",
        has_numeric_law=False,
        note="Cramér's V > 0.30 between a feature and a protected attribute indicates "
             "the feature functions as a proxy for that attribute. "
             "Using it in a model is legally equivalent to using the protected attribute directly.",
    ),
}

# US thresholds — DIR has actual legal weight via EEOC Uniform Guidelines 1978
THRESHOLDS_US = {
    "dir": MetricThreshold(
        metric="disparate_impact_ratio",
        threshold=0.80,
        direction="above",
        legal_basis="EEOC Uniform Guidelines on Employee Selection Procedures (1978) — 4/5ths Rule",
        has_numeric_law=True,
        note="The 0.80 threshold is codified in EEOC regulations. Failure is actionable "
             "under Title VII (employment), ECOA (credit), and Fair Housing Act (housing).",
    ),
    "spd": MetricThreshold(
        metric="statistical_parity_difference",
        threshold=0.05, direction="below",
        legal_basis="EEOC Uniform Guidelines + AIF360 Standard",
        has_numeric_law=False, note="Literature standard.",
    ),
    "eod": MetricThreshold(
        metric="equal_opportunity_difference",
        threshold=0.10, direction="below",
        legal_basis="Title VII + ECOA + Fair Housing Act",
        has_numeric_law=False, note="Requires ground truth labels.",
    ),
    "eqod": MetricThreshold(
        metric="equalised_odds_difference",
        threshold=0.10, direction="below",
        legal_basis="Title VII + CFPB Fair Lending Guidelines",
        has_numeric_law=False, note="Requires ground truth labels.",
    ),
    "fprp": MetricThreshold(
        metric="false_positive_rate_parity",
        threshold=0.10, direction="below",
        legal_basis="ECOA + CFPB Supervision Manual",
        has_numeric_law=False, note="Requires ground truth labels.",
    ),
    "predictive_parity_diff": MetricThreshold(
        metric="predictive_parity_difference",
        threshold=0.05, direction="below",
        legal_basis="CFPB Model Risk Guidance",
        has_numeric_law=False, note="Requires ground truth labels.",
    ),
    "cramers_v": MetricThreshold(
        metric="cramers_v_proxy",
        threshold=0.30, direction="below",
        legal_basis="Title VII + ECOA — proxy discrimination doctrine",
        has_numeric_law=False, note="Proxy discrimination is recognised in US case law.",
    ),
}

# EU thresholds — GDPR + EU AI Act 2024
THRESHOLDS_EU = {
    "dir": MetricThreshold(
        metric="disparate_impact_ratio",
        threshold=0.80, direction="above",
        legal_basis="EU AI Act 2024 Article 10 + GDPR Article 22",
        has_numeric_law=False,
        note="The EU AI Act mandates fairness testing for high-risk AI systems. "
             "No numeric DIR threshold is specified; 0.80 is applied per international standard.",
    ),
    "spd": MetricThreshold(
        metric="statistical_parity_difference",
        threshold=0.05, direction="below",
        legal_basis="EU AI Act 2024 + European Commission Ethics Guidelines for AI",
        has_numeric_law=False, note="Literature standard.",
    ),
    "eod": MetricThreshold(
        metric="equal_opportunity_difference",
        threshold=0.10, direction="below",
        legal_basis="EU AI Act 2024 Article 10 + EU Charter Article 21",
        has_numeric_law=False, note="Requires ground truth labels.",
    ),
    "eqod": MetricThreshold(
        metric="equalised_odds_difference",
        threshold=0.10, direction="below",
        legal_basis="EU AI Act 2024 + GDPR Recital 71",
        has_numeric_law=False, note="Requires ground truth labels.",
    ),
    "fprp": MetricThreshold(
        metric="false_positive_rate_parity",
        threshold=0.10, direction="below",
        legal_basis="EU AI Act 2024 + GDPR Article 22",
        has_numeric_law=False, note="Requires ground truth labels.",
    ),
    "predictive_parity_diff": MetricThreshold(
        metric="predictive_parity_difference",
        threshold=0.05, direction="below",
        legal_basis="EU AI Act 2024 Conformity Assessment",
        has_numeric_law=False, note="Requires ground truth labels.",
    ),
    "cramers_v": MetricThreshold(
        metric="cramers_v_proxy",
        threshold=0.30, direction="below",
        legal_basis="GDPR Article 22 + EU AI Act indirect discrimination doctrine",
        has_numeric_law=False, note="Indirect discrimination via proxy variables.",
    ),
}

THRESHOLDS_BY_REGION = {
    "india": THRESHOLDS_INDIA,
    "us":    THRESHOLDS_US,
    "eu":    THRESHOLDS_EU,
}


# ── Protected attributes ──────────────────────────────────────────────────────

PROTECTED_ATTRIBUTES_INDIA = {
    "caste": {
        "legal_basis": "Article 15, Constitution of India",
        "note": "Covers Scheduled Castes (SC), Scheduled Tribes (ST), Other Backward Classes (OBC). "
                "Rarely appears directly in datasets — commonly encoded via surname, "
                "pincode, educational institution, or language. Proxy detection is critical.",
        "common_proxies": ["surname", "last_name", "family_name", "pincode", "pin_code",
                           "village", "district", "university_name", "college_name", "language"],
    },
    "religion": {
        "legal_basis": "Article 15, Constitution of India",
        "note": "Covers Hindu, Muslim, Christian, Sikh, Jain, Buddhist, and other religious identities. "
                "May be encoded in name, language, region, or institution.",
        "common_proxies": ["name", "first_name", "language", "region", "state"],
    },
    "sex": {
        "legal_basis": "Article 15, Constitution of India",
        "note": "Gender-based discrimination is unconstitutional. "
                "May be proxied through occupation history, working hours, marital status.",
        "common_proxies": ["occupation", "marital_status", "working_hours", "employment_gap"],
    },
    "race": {
        "legal_basis": "Article 15, Constitution of India",
        "note": "Racial discrimination is unconstitutional.",
        "common_proxies": ["region", "state", "language", "name"],
    },
    "place_of_birth": {
        "legal_basis": "Article 15(1)(e), Constitution of India",
        "note": "Discrimination on the basis of place of birth is explicitly prohibited.",
        "common_proxies": ["state", "region", "district", "pincode", "language"],
    },
    "disability": {
        "legal_basis": "Rights of Persons with Disabilities Act 2016 (RPwD Act)",
        "note": "Covers physical, mental, intellectual, and sensory disabilities.",
        "common_proxies": ["medical_history", "health_score", "absence_rate"],
    },
    "language": {
        "legal_basis": "Article 29, Article 30, Constitution of India",
        "note": "Linguistic minority protection. Language may be a proxy for region, caste, or religion.",
        "common_proxies": ["name", "region", "state", "script"],
    },
    "age": {
        "legal_basis": "Recognised in employment context under Labour Codes 2020",
        "note": "Age discrimination in employment is increasingly recognised under Indian labour law.",
        "common_proxies": ["years_experience", "graduation_year", "dob", "date_of_birth"],
    },
}

PROTECTED_ATTRIBUTES_US = {
    "race":           {"legal_basis": "Title VII Civil Rights Act 1964, ECOA, FHA"},
    "sex":            {"legal_basis": "Title VII Civil Rights Act 1964"},
    "age":            {"legal_basis": "Age Discrimination in Employment Act 1967"},
    "disability":     {"legal_basis": "Americans with Disabilities Act 1990"},
    "national_origin":{"legal_basis": "Title VII Civil Rights Act 1964"},
    "religion":       {"legal_basis": "Title VII Civil Rights Act 1964"},
    "color":          {"legal_basis": "Title VII Civil Rights Act 1964"},
}

PROTECTED_ATTRIBUTES_EU = {
    "race":            {"legal_basis": "EU Charter Article 21, GDPR Special Category"},
    "ethnic_origin":   {"legal_basis": "EU Charter Article 21, GDPR Special Category"},
    "sex":             {"legal_basis": "EU Charter Article 21"},
    "religion":        {"legal_basis": "EU Charter Article 21, GDPR Special Category"},
    "disability":      {"legal_basis": "EU Charter Article 26, UN CRPD"},
    "age":             {"legal_basis": "EU Charter Article 21"},
    "sexual_orientation":{"legal_basis": "EU Charter Article 21, GDPR Special Category"},
    "political_opinion":{"legal_basis": "GDPR Special Category"},
}

PROTECTED_ATTRIBUTES_BY_REGION = {
    "india": PROTECTED_ATTRIBUTES_INDIA,
    "us":    PROTECTED_ATTRIBUTES_US,
    "eu":    PROTECTED_ATTRIBUTES_EU,
}


# ── Industry-specific metric weights ─────────────────────────────────────────
# The primary metric changes based on industry. These weights determine
# which metrics drive the overall verdict most strongly.
# All weights must sum to 1.0.

INDUSTRY_METRIC_WEIGHTS = {
    "finance": {
        "primary_metric": "false_positive_rate_parity",
        "rationale": "In credit/lending, wrongly denying qualified applicants (FPR disparity) "
                     "is the primary harm. Equal Opportunity also matters.",
        "weights": {"dir": 0.20, "spd": 0.15, "eod": 0.20, "eqod": 0.20, "fprp": 0.25},
    },
    "healthcare": {
        "primary_metric": "equal_opportunity_difference",
        "rationale": "In healthcare, missing deserving diagnoses (TPR disparity) is the "
                     "primary harm — a missed cancer diagnosis has irreversible consequences.",
        "weights": {"dir": 0.15, "spd": 0.10, "eod": 0.35, "eqod": 0.25, "fprp": 0.15},
    },
    "hr": {
        "primary_metric": "demographic_parity",
        "rationale": "In hiring, overall outcome parity is the primary legal standard "
                     "under employment discrimination law.",
        "weights": {"dir": 0.30, "spd": 0.25, "eod": 0.20, "eqod": 0.15, "fprp": 0.10},
    },
    "criminal_justice": {
        "primary_metric": "equalised_odds",
        "rationale": "In criminal justice, both false positives (wrongly flagging innocent people) "
                     "and false negatives (missing actual risk) have severe consequences. "
                     "This is the COMPAS case.",
        "weights": {"dir": 0.20, "spd": 0.15, "eod": 0.25, "eqod": 0.30, "fprp": 0.10},
    },
    "insurance": {
        "primary_metric": "false_positive_rate_parity",
        "rationale": "In insurance pricing/denial, FPR parity ensures one group is not "
                     "systematically overcharged or denied based on protected characteristics.",
        "weights": {"dir": 0.20, "spd": 0.15, "eod": 0.20, "eqod": 0.20, "fprp": 0.25},
    },
}

# Default weights when industry is unknown
DEFAULT_METRIC_WEIGHTS = {
    "dir": 0.25, "spd": 0.20, "eod": 0.20, "eqod": 0.20, "fprp": 0.15
}


def get_thresholds(region: str) -> dict:
    region = region.lower()
    return THRESHOLDS_BY_REGION.get(region, THRESHOLDS_INDIA)


def get_protected_attributes(region: str) -> dict:
    region = region.lower()
    return PROTECTED_ATTRIBUTES_BY_REGION.get(region, PROTECTED_ATTRIBUTES_INDIA)


def get_industry_weights(industry: str) -> dict:
    industry = industry.lower()
    config = INDUSTRY_METRIC_WEIGHTS.get(industry)
    if config:
        return config["weights"]
    return DEFAULT_METRIC_WEIGHTS


def get_caste_proxy_columns(column_names: list[str]) -> list[str]:
    """
    Identifies columns that are likely caste proxies in Indian datasets.
    These should always be flagged for review in Indian context audits,
    even before MI computation.
    """
    known_proxies = PROTECTED_ATTRIBUTES_INDIA["caste"]["common_proxies"]
    lower_cols    = [c.lower() for c in column_names]
    return [
        column_names[i]
        for i, lc in enumerate(lower_cols)
        if any(proxy in lc for proxy in known_proxies)
    ]
