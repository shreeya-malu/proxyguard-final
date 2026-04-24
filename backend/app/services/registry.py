"""
ProxyGuard Studio — Registry Service
======================================
Writes completed, KMS-signed audits to Firestore public ledger.
Anyone can read. Only authenticated users can write.

Firestore rules (paste into Firebase Console → Firestore → Rules):

  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /audits/{auditId} {
        allow read:  if true;
        allow write: if request.auth != null;
      }
    }
  }
"""

import os
import hashlib
from datetime import datetime, timezone
from typing import Optional

_firestore_client = None
_USE_MOCK         = False
_MOCK_REGISTRY: list[dict] = []


def _get_db():
    global _firestore_client, _USE_MOCK
    if _USE_MOCK:
        return None
    if _firestore_client:
        return _firestore_client
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
        if not firebase_admin._apps:
            pid = os.environ.get("FIREBASE_PROJECT_ID")
            firebase_admin.initialize_app(options={"projectId": pid} if pid else {})
        _firestore_client = firestore.client()
        return _firestore_client
    except Exception as e:
        print(f"[Registry] Firestore unavailable: {e}. Using in-memory mock.")
        _USE_MOCK = True
        return None


def dir_to_grade(d: float) -> str:
    if d >= 0.95: return "A"
    if d >= 0.85: return "B"
    if d >= 0.80: return "C"
    if d >= 0.70: return "D"
    return "F"


def publish_audit(
    audit_id:       str,
    certificate_id: str,
    report:         dict,
    certificate:    dict,
    user_uid:       Optional[str] = None,
    org_name:       Optional[str] = None,
    make_public:    bool = True,
) -> dict:
    """Write a completed, signed audit to the public registry."""
    sdg_map = {
        "finance":          [8, 10],
        "healthcare":       [3, 10],
        "hr":               [8, 10],
        "criminal_justice": [10, 16],
        "insurance":        [8, 10],
    }

    record = {
        "audit_id":             audit_id,
        "certificate_id":       certificate_id,
        "dataset_name":         report.get("dataset_name", "Unknown"),
        "industry":             report.get("industry_context", "unknown"),
        "region":               report.get("region", "india"),
        "overall_grade":        dir_to_grade(report.get("overall_dir_score", 0)),
        "overall_dir":          report.get("overall_dir_score", 0),
        "overall_result":       report.get("overall_risk_level", "UNKNOWN"),
        "overall_grade_letter": report.get("overall_grade", "F"),
        "composite_score":      report.get("composite_score", 0),
        "total_flags":          report.get("total_flags", 0),
        "metrics_computed":     report.get("metrics_computed", 0),
        "row_count":            report.get("row_count", 0),
        "protected_attributes": report.get("protected_attributes", []),
        "outcome_column":       report.get("outcome_column", ""),
        "audit_hash":           report.get("audit_hash", ""),
        "hash_verified":        certificate.get("hash_verified", False),
        "kms_key_id":           certificate.get("kms_key_id", "local-sha256"),
        "sdgs":                 sdg_map.get(report.get("industry_context", "hr"), [10]),
        "sensitivity_computed": report.get("sensitivity_report") is not None,
        "has_impossibility":    report.get("has_conflict", False),
        "is_public":            make_public,
        "published_by":         org_name or user_uid or "anonymous",
        "published_at":         datetime.now(timezone.utc).isoformat(),
    }

    db = _get_db()
    if db is not None:
        try:
            db.collection("audits").document(audit_id).set(record)
            print(f"[Registry] Published {audit_id} to Firestore")
        except Exception as e:
            print(f"[Registry] Firestore write failed: {e}")
            _MOCK_REGISTRY.append(record)
    else:
        _MOCK_REGISTRY.append(record)

    return record


def get_registry(limit: int = 20) -> list[dict]:
    """Get public audit records, newest first."""
    db = _get_db()
    if db is not None:
        try:
            docs = (
                db.collection("audits")
                  .where("is_public", "==", True)
                  .order_by("published_at", direction="DESCENDING")
                  .limit(limit)
                  .stream()
            )
            return [d.to_dict() for d in docs]
        except Exception as e:
            print(f"[Registry] Read failed: {e}")

    public = [r for r in _MOCK_REGISTRY if r.get("is_public", True)]
    return sorted(public, key=lambda r: r.get("published_at", ""), reverse=True)[:limit]


def verify_audit(audit_id: str) -> Optional[dict]:
    """Public verification — no auth required."""
    db = _get_db()
    if db is not None:
        try:
            doc = db.collection("audits").document(audit_id).get()
            if doc.exists:
                return doc.to_dict()
        except Exception:
            pass
    return next((r for r in _MOCK_REGISTRY if r["audit_id"] == audit_id), None)
