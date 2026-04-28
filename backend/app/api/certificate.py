"""
ProxyGuard Studio — Certificate Router
========================================
POST /api/v1/certificate/generate/{audit_id}

Real KMS flow:
  1. Retrieve audit from store
  2. Re-verify SHA-256 hash integrity
  3. Sign with Cloud KMS (or local HMAC for dev)
  4. Store certificate back in audit record
  5. Return certificate

Cloud KMS setup (production):
  gcloud kms keyrings create audit-ring --location=global
  gcloud kms keys create cert-signing \\
    --location=global --keyring=audit-ring \\
    --purpose=asymmetric-signing \\
    --default-algorithm=rsa-sign-pkcs1-2048-sha256
"""

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse


from app.api.audit import get_store
from fastapi import Depends
from app.core.auth import get_current_user
router = APIRouter()

KMS_PROJECT    = os.environ.get("GCP_PROJECT_ID", "")
KMS_LOCATION   = os.environ.get("KMS_LOCATION",   "global")
KMS_KEYRING    = os.environ.get("KMS_KEYRING",    "audit-ring")
KMS_KEY        = os.environ.get("KMS_KEY",        "cert-signing")
KMS_KEY_SECRET = os.environ.get("KMS_HMAC_SECRET", "proxyguard-local-dev-secret")


@router.post("/certificate/generate/{audit_id}")
# LOCAL TESTING: Uncomment user parameter below for production
async def generate_certificate(audit_id: str,
    # user=Depends(get_current_user)
):
    store  = get_store()
    record = store.get(audit_id)
    if not record:
        raise HTTPException(404, "Audit not found.")

    report = record["report"]
    

    # ── Step 1: Verify hash integrity ─────────────────────────────────────────
    report_for_hash = {k: v for k, v in report.items() if k != "audit_hash"}
    canonical       = json.dumps(report_for_hash, sort_keys=True, default=str)
    recomputed      = hashlib.sha256(canonical.encode()).hexdigest()
    hash_verified   = recomputed == report.get("audit_hash", "")

    # ── Step 2: Sign with KMS (or local HMAC) ─────────────────────────────────
    signature, kms_key_id, signing_method = await _sign_hash(
        report.get("audit_hash", recomputed)
    )

    # ── Step 3: Build certificate ──────────────────────────────────────────────
    cert_id = f"PGS-{audit_id[:8].upper()}"

    legal_refs_from_report = record.get("gemini", {}).get("legal_context", [])
    legal_refs = (
        [r["law"] for r in legal_refs_from_report if isinstance(r, dict)]
        if legal_refs_from_report
        else _default_legal_refs(report.get("industry_context", "hr"), report.get("region", "india"))
    )

    certificate = {
        "certificate_id":      cert_id,
        "audit_id":            audit_id,
        "dataset_name":        report.get("dataset_name", "Unknown"),
        "industry_context":    report.get("industry_context", "unknown"),
        "region":              report.get("region", "india"),
        "overall_result":      report.get("overall_risk_level", "UNKNOWN"),
        "overall_grade":       report.get("overall_grade", "F"),
        "overall_dir":         report.get("overall_dir_score", 0),
        "total_flags":         report.get("total_flags", 0),
        "metrics_computed":    report.get("metrics_computed", 0),
        "has_impossibility":   report.get("has_conflict", False),
        "ground_truth_used":   report.get("ground_truth_available", False),
        "audit_hash":          report.get("audit_hash", recomputed),
        "hash_verified":       hash_verified,
        "signature":           signature,
        "kms_key_id":          kms_key_id,
        "signing_method":      signing_method,
        "issued_at":           datetime.now(timezone.utc).isoformat(),
        "signed_by":           f"ProxyGuard Studio / {signing_method}",
        "legal_references":    legal_refs,
        "summary":             _build_summary(report, record.get("gemini", {})),
        "sensitivity_computed": len(record.get("sensitivity_reports", [])) > 0,
        "verify_url":          f"/api/v1/registry/verify/{audit_id}",
    }

    # Store certificate in audit record
    store[audit_id]["certificate"] = certificate

    return JSONResponse(content={"certificate": certificate})


async def _sign_hash(audit_hash: str) -> tuple[str, str, str]:
    """
    Sign the audit hash.
    Tries Cloud KMS first, falls back to HMAC for local dev.
    """
    # Try Cloud KMS if configured
    if KMS_PROJECT and os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        try:
            sig, key_id = await _kms_sign(audit_hash)
            return sig, key_id, "Google Cloud KMS"
        except Exception as e:
            print(f"[KMS] Cloud KMS sign failed: {e}. Using HMAC fallback.")

    # HMAC fallback for local dev
    sig = hmac.new(
        KMS_KEY_SECRET.encode(),
        audit_hash.encode(),
        hashlib.sha256,
    ).hexdigest()

    return sig, "local-hmac-sha256", "Local HMAC-SHA256 (dev)"


async def _kms_sign(audit_hash: str) -> tuple[str, str]:
    """Sign using Google Cloud KMS asymmetric signing key."""
    from google.cloud import kms_v1
    import base64

    client  = kms_v1.KeyManagementServiceClient()
    key_ver = client.crypto_key_version_path(
        KMS_PROJECT, KMS_LOCATION, KMS_KEYRING, KMS_KEY, "1"
    )

    # KMS signs the digest of the hash
    digest = {"sha256": hashlib.sha256(audit_hash.encode()).digest()}
    response = client.asymmetric_sign(
        request={"name": key_ver, "digest": digest}
    )

    sig    = base64.b64encode(response.signature).decode()
    key_id = f"projects/{KMS_PROJECT}/locations/{KMS_LOCATION}/keyRings/{KMS_KEYRING}/cryptoKeys/{KMS_KEY}/cryptoKeyVersions/1"

    return sig, key_id


def _default_legal_refs(industry: str, region: str) -> list[str]:
    india = {
        "hr":               ["Article 15, Constitution of India", "Equal Remuneration Act 1976", "DPDPA 2023"],
        "finance":          ["Article 15, Constitution of India", "RBI Fair Lending Guidelines", "DPDPA 2023"],
        "healthcare":       ["Article 15, Constitution of India", "Clinical Establishments Act 2010"],
        "criminal_justice": ["Article 14, Constitution of India", "Article 21, Constitution of India"],
        "insurance":        ["Article 15, Constitution of India", "IRDAI Guidelines", "DPDPA 2023"],
    }
    return india.get(industry, ["Article 15, Constitution of India", "DPDPA 2023"])


def _build_summary(report: dict, gemini: dict) -> str:
    cro = gemini.get("cro_summary")
    if cro:
        return cro

    verdict  = report.get("overall_risk_level", "UNKNOWN")
    dataset  = report.get("dataset_name", "dataset")
    dir_val  = report.get("overall_dir_score", 0)
    flags    = report.get("total_flags", 0)

    if verdict == "FAIL":
        return (
            f"Dataset '{dataset}' FAILED the fairness audit with DIR of {dir_val:.2f}, "
            f"below the 0.80 legal threshold. {flags} proxy variables detected. "
            f"Remediation required before deployment."
        )
    elif verdict == "REVIEW":
        return f"Dataset '{dataset}' requires review. DIR: {dir_val:.2f}. {flags} flags."
    else:
        return f"Dataset '{dataset}' PASSED. DIR: {dir_val:.2f}. No critical flags."
