"""
ProxyGuard Studio — Google Cloud DLP Service
=============================================
Scans uploaded CSV content for sensitive/PII data before auditing.
Uses Google Cloud Data Loss Prevention API.

Why this matters:
  Developers often upload datasets containing real PII (names, Aadhaar numbers,
  phone numbers, financial identifiers) not realising the risk.
  ProxyGuard scans for these before processing and flags them.
  This is a Google-exclusive capability that no existing fairness tool has.

Free tier: DLP API has a free tier of 1 unit/month.
For a hackathon demo this is sufficient.

Fallback: If DLP is not configured (no credentials), we run a fast
deterministic heuristic scan using regex patterns. This always works,
even without GCP credentials.
"""

import os
import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class DLPFinding:
    info_type:   str       # e.g. "AADHAAR_INDIVIDUAL_IDENTIFICATION_NUMBER"
    column:      str       # column where finding was detected
    likelihood:  str       # "LIKELY", "POSSIBLE", "VERY_LIKELY"
    count:       int       # approximate number of values flagged
    action:      str       # what to do: "REMOVE", "PSEUDONYMIZE", "REVIEW"
    plain_text:  str       # non-technical description


@dataclass
class DLPScanResult:
    findings:         list[DLPFinding]
    pii_detected:     bool
    safe_to_audit:    bool      # True even with PII — just flagged
    scan_method:      str       # "cloud_dlp" or "heuristic"
    columns_flagged:  list[str]
    recommendation:   str


# ── Heuristic patterns for fallback ──────────────────────────────────────────

HEURISTIC_PATTERNS = {
    "AADHAAR_NUMBER": {
        "pattern": r"\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b",
        "action": "REMOVE",
        "plain_text": "Aadhaar number detected. Remove before sharing dataset. "
                      "Storing Aadhaar data without UIDAI compliance is illegal under "
                      "the Aadhaar (Targeted Delivery) Act 2016.",
    },
    "PAN_NUMBER": {
        "pattern": r"\b[A-Z]{5}[0-9]{4}[A-Z]\b",
        "action": "REMOVE",
        "plain_text": "PAN card number detected. Remove before sharing dataset.",
    },
    "PHONE_NUMBER_IN": {
        "pattern": r"\b[6-9]\d{9}\b",
        "action": "PSEUDONYMIZE",
        "plain_text": "Indian mobile number pattern detected. "
                      "Consider replacing with anonymised IDs before training.",
    },
    "EMAIL_ADDRESS": {
        "pattern": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
        "action": "PSEUDONYMIZE",
        "plain_text": "Email addresses detected. Replace with anonymised IDs. "
                      "Email is a direct identifier under DPDPA 2023.",
    },
    "CREDIT_CARD_NUMBER": {
        "pattern": r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b",
        "action": "REMOVE",
        "plain_text": "Credit card numbers detected. Remove immediately. "
                      "This data must not appear in any ML training dataset.",
    },
    "PERSON_NAME": {
        # Common Indian name patterns — detected by column name, not content
        "column_keywords": ["name", "first_name", "last_name", "full_name", "fname", "lname"],
        "action": "PSEUDONYMIZE",
        "plain_text": "Name column detected. Names are direct personal identifiers "
                      "under DPDPA 2023. Replace with anonymised IDs before training.",
    },
}

# Column name patterns that suggest sensitive data
SENSITIVE_COLUMN_PATTERNS = [
    ("address", "STREET_ADDRESS", "PSEUDONYMIZE",
     "Address column detected. Geographic identifiers can be proxies for caste/religion in Indian datasets."),
    ("pincode", "POSTAL_CODE", "REVIEW",
     "Pincode detected. Pincodes are strong proxies for caste and religion in Indian datasets under Article 15."),
    ("pin_code", "POSTAL_CODE", "REVIEW",
     "Pincode detected. Strong proxy for protected attributes in Indian context."),
    ("aadhaar", "AADHAAR_NUMBER", "REMOVE",
     "Aadhaar column detected. Remove before any processing."),
    ("pan", "PAN_NUMBER", "REMOVE",
     "PAN column detected. Remove before any processing."),
    ("caste", "CASTE", "REVIEW",
     "Direct caste column detected. This is a protected attribute under Article 15. "
     "Use as protected_attribute in audit, do not use as training feature."),
    ("religion", "RELIGION", "REVIEW",
     "Direct religion column detected. Protected attribute under Article 15. "
     "Use as protected_attribute in audit, do not use as training feature."),
    ("surname", "SURNAME_CASTE_PROXY", "REVIEW",
     "Surname column detected. In Indian datasets, surnames strongly encode caste. "
     "Flag as caste proxy candidate."),
    ("family_name", "SURNAME_CASTE_PROXY", "REVIEW",
     "Family name column detected. Strong caste proxy in Indian context."),
]


def scan_for_pii(
    df_sample_str: str,        # first 10KB of CSV as string
    column_names: list[str],
    project_id: Optional[str] = None,
) -> DLPScanResult:
    """
    Scans CSV content for PII and sensitive data.

    Tries Cloud DLP first; falls back to heuristic scan if unavailable.

    Parameters
    ----------
    df_sample_str : First 10KB of the CSV (enough for pattern detection)
    column_names  : List of column headers
    project_id    : GCP project ID (optional — needed for Cloud DLP)
    """
    # Try Cloud DLP if credentials available
    if project_id and os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        try:
            return _cloud_dlp_scan(df_sample_str, column_names, project_id)
        except Exception as e:
            print(f"[DLP] Cloud DLP unavailable ({e}), falling back to heuristic scan")

    # Heuristic fallback — always works
    return _heuristic_scan(df_sample_str, column_names)


def _heuristic_scan(content: str, column_names: list[str]) -> DLPScanResult:
    """Fast regex + column-name heuristic scan. No external API needed."""
    findings = []
    columns_flagged = set()
    lower_cols = [c.lower() for c in column_names]

    # ── Content-based pattern matching ────────────────────────────────────────
    for info_type, config in HEURISTIC_PATTERNS.items():
        if "column_keywords" in config:
            # Column-name based detection
            for kw in config["column_keywords"]:
                for i, lc in enumerate(lower_cols):
                    if kw in lc:
                        col = column_names[i]
                        findings.append(DLPFinding(
                            info_type=info_type,
                            column=col,
                            likelihood="LIKELY",
                            count=-1,   # unknown
                            action=config["action"],
                            plain_text=config["plain_text"],
                        ))
                        columns_flagged.add(col)
        elif "pattern" in config:
            matches = re.findall(config["pattern"], content)
            if matches:
                # Try to identify which column — look for the match in context
                findings.append(DLPFinding(
                    info_type=info_type,
                    column="unknown",
                    likelihood="LIKELY" if len(matches) > 3 else "POSSIBLE",
                    count=len(matches),
                    action=config["action"],
                    plain_text=config["plain_text"],
                ))

    # ── Column-name sensitive data detection ──────────────────────────────────
    for col_pattern, info_type, action, plain_text in SENSITIVE_COLUMN_PATTERNS:
        for i, lc in enumerate(lower_cols):
            if col_pattern in lc and column_names[i] not in columns_flagged:
                col = column_names[i]
                findings.append(DLPFinding(
                    info_type=info_type,
                    column=col,
                    likelihood="LIKELY",
                    count=-1,
                    action=action,
                    plain_text=plain_text,
                ))
                columns_flagged.add(col)

    pii_found = len(findings) > 0
    critical  = any(f.action == "REMOVE" for f in findings)

    recommendation = (
        "Critical PII detected. Remove flagged columns before training or sharing this dataset. "
        "Proceeding with audit on remaining columns."
        if critical else
        "Sensitive columns detected. Review flagged columns before deployment. "
        "Audit will proceed — flagged columns are noted in the report."
        if pii_found else
        "No sensitive data patterns detected in column names or content sample."
    )

    return DLPScanResult(
        findings=findings,
        pii_detected=pii_found,
        safe_to_audit=True,     # We always allow auditing — we just flag findings
        scan_method="heuristic",
        columns_flagged=list(columns_flagged),
        recommendation=recommendation,
    )


def _cloud_dlp_scan(content: str, column_names: list[str], project_id: str) -> DLPScanResult:
    """
    Cloud DLP scan using Google Cloud API.
    Only called when GOOGLE_APPLICATION_CREDENTIALS is set.
    """
    from google.cloud import dlp_v2

    dlp    = dlp_v2.DlpServiceClient()
    parent = f"projects/{project_id}"

    # Indian + international info types
    info_types = [
        {"name": "AADHAAR_INDIVIDUAL_IDENTIFICATION_NUMBER"},
        {"name": "INDIA_PAN_INDIVIDUAL"},
        {"name": "PHONE_NUMBER"},
        {"name": "EMAIL_ADDRESS"},
        {"name": "CREDIT_CARD_NUMBER"},
        {"name": "PERSON_NAME"},
        {"name": "STREET_ADDRESS"},
        {"name": "DATE_OF_BIRTH"},
    ]

    inspect_config = {
        "info_types":       info_types,
        "min_likelihood":   dlp_v2.Likelihood.POSSIBLE,
        "include_quote":    False,
        "limits":           {"max_findings_per_request": 100},
    }

    item = {"value": content[:10000]}

    response = dlp.inspect_content(
        request={"parent": parent, "inspect_config": inspect_config, "item": item}
    )

    findings = []
    columns_flagged = set()

    for finding in response.result.findings:
        info_type = finding.info_type.name
        action    = "REMOVE" if "AADHAAR" in info_type or "CREDIT_CARD" in info_type else "PSEUDONYMIZE"

        findings.append(DLPFinding(
            info_type=info_type,
            column="detected_in_content",
            likelihood=dlp_v2.Likelihood(finding.likelihood).name,
            count=1,
            action=action,
            plain_text=f"{info_type.replace('_', ' ').title()} detected in dataset.",
        ))

    return DLPScanResult(
        findings=findings,
        pii_detected=len(findings) > 0,
        safe_to_audit=True,
        scan_method="cloud_dlp",
        columns_flagged=list(columns_flagged),
        recommendation="Cloud DLP scan complete. Review flagged findings before deployment.",
    )
