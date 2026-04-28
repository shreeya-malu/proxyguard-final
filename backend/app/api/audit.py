"""
ProxyGuard Studio — Audit Router v3
=====================================
POST /api/v1/audit/run
  1. DLP scan for PII
  2. Run multi-checkpoint bias engine
  3. Run sensitivity analysis (if no ground truth)
  4. Generate Gemini summaries
  5. Store result

GET  /api/v1/audit/{id}
GET  /api/v1/audit
"""

import io
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional
from dataclasses import asdict

import pandas as pd
from fastapi import APIRouter, Body, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.bias_engine   import BiasAuditEngine, report_to_dict
from app.core.sensitivity   import run_sensitivity_analysis
from app.services.gemini    import generate_audit_summary
from app.services.dlp       import scan_for_pii

from fastapi import Depends
from app.core.auth import get_current_user

router   = APIRouter()
_engine  = BiasAuditEngine()
_store:  dict[str, dict] = {}    # in-memory; Firestore in production


def _apply_bounded_scores(report_dict: dict, sensitivity_reports: list, weights: dict) -> dict:
    """
    Replace SKIPPED metric contributions with their assumption scores
    from the sensitivity reports, giving a more accurate composite grade.
    """
    score_lookup: dict[tuple, float] = {}
    for sr in sensitivity_reports:
        attr = sr.get("protected_attribute", "")
        for mr in sr.get("metric_results", []):
            score_lookup[(attr, mr["metric_name"])] = mr["assumption_score"]

    metric_key_map = {
        "DIR": "dir", "SPD": "spd", "EOD": "eod",
        "EQOD": "eqod", "FPRP": "fprp", "Predictive Parity": "predictive_parity_diff",
    }
    total_weight = 0.0
    weighted_sum = 0.0

    for m in report_dict.get("metric_results", []):
        base_name = m["name"].split(" (")[0]
        attr = m["name"].split("(")[-1].rstrip(")") if "(" in m["name"] else ""
        w = weights.get(metric_key_map.get(base_name, ""), 0.0)
        if w == 0.0:
            continue
        status = m.get("status", "SKIPPED")
        if status == "SKIPPED":
            s = score_lookup.get((attr, base_name))
            if s is None:
                continue
        else:
            s = {"PASS": 1.0, "REVIEW": 0.5, "FAIL": 0.0}.get(status)
            if s is None:
                continue
        weighted_sum += w * s
        total_weight  += w

    if total_weight == 0:
        return report_dict

    score = round(weighted_sum / total_weight, 4)
    if score >= 0.95:   grade = "A"
    elif score >= 0.85: grade = "B"
    elif score >= 0.70: grade = "C"
    elif score >= 0.50: grade = "D"
    else:               grade = "F"

    report_dict["composite_score"] = score
    report_dict["overall_grade"]   = grade
    return report_dict


@router.post("/audit/run")
async def run_audit(
    file:                 Annotated[UploadFile, File()],
    protected_attributes: Annotated[str, Form()],
    outcome_column:       Annotated[str, Form()],
    industry:             Annotated[str, Form()],
    region:               Annotated[str, Form()] = "india",
    ground_truth_column:  Annotated[Optional[str], Form()] = None,
    org_name:             Annotated[Optional[str], Form()] = None,
    # LOCAL TESTING: Uncomment below for production
    # user=Depends(get_current_user),
):
    """
    Full audit pipeline:
      DLP → Bias Engine → Sensitivity Analysis → Gemini → Store
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only CSV files are supported.")

    contents = await file.read()

    # ── 1. DLP scan ────────────────────────────────────────────────────────────
    sample_str = contents[:10240].decode("utf-8", errors="ignore")

    try:
        df = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(400, f"Failed to parse CSV: {e}")

    dlp_result = scan_for_pii(
        df_sample_str=sample_str,
        column_names=list(df.columns),
        project_id=None,   # set to GCP project ID in production
    )

    # ── 2. Validate columns ────────────────────────────────────────────────────
    protected_list = [c.strip() for c in protected_attributes.split(",") if c.strip()]
    outcome        = outcome_column.strip()
    gt_col         = ground_truth_column.strip() if ground_truth_column else None

    missing = [c for c in protected_list + [outcome] if c not in df.columns]
    if missing:
        raise HTTPException(422,
            f"Columns not found: {missing}. Available: {list(df.columns)}")

    if gt_col and gt_col not in df.columns:
        gt_col = None   # silently drop if not found

    if len(df) < 10:
        raise HTTPException(400, "Dataset must have at least 10 rows.")

    # ── 3. Run bias engine ─────────────────────────────────────────────────────
    try:
        report = _engine.run_audit(
            df=df,
            dataset_name=file.filename,
            protected_attributes=protected_list,
            outcome_column=outcome,
            industry=industry,
            region=region,
            ground_truth_column=gt_col,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(500, f"Audit engine error: {e}")

    report_dict = report_to_dict(report)

    # ── 4. Sensitivity analysis (when no ground truth) ─────────────────────────
    # IMPORTANT: We build the cleaned df by applying ALL label encoders from
    # the engine AND then converting to numeric — guaranteeing 0/1 binary outcome.
    # This avoids the silent-failure bug where re-encoding leaves string columns.
    sensitivity_reports = []
    if not report.ground_truth_available:
        from app.core.legal_context import get_thresholds
        thresholds = get_thresholds(region)

        for go in report.group_outcomes:
            sens = run_sensitivity_analysis(
                r_p=go.privileged_rate,
                r_u=go.unprivileged_rate,
                protected_attribute=go.protected_attribute,
                privileged_group=go.privileged_group,
                unprivileged_group=go.unprivileged_group,
                thresholds=thresholds,
            )
            sensitivity_reports.append(asdict(sens))

    # ── 4b. Corrected composite score using assumption scores ──────────────────
    if sensitivity_reports:
        from app.core.legal_context import get_industry_weights
        weights = get_industry_weights(industry)
        report_dict = _apply_bounded_scores(report_dict, sensitivity_reports, weights)

    # ── 5. Gemini summaries ────────────────────────────────────────────────────
    gemini_output = await generate_audit_summary(report_dict, region)

    # ── 6. Store ───────────────────────────────────────────────────────────────
    audit_id = str(uuid.uuid4())
    record   = {
        "audit_id":            audit_id,
        "created_at":          datetime.now(timezone.utc).isoformat(),
        "report":              report_dict,
        "sensitivity_reports": sensitivity_reports,
        "dlp_result":          {
            "pii_detected":    dlp_result.pii_detected,
            "columns_flagged": dlp_result.columns_flagged,
            "scan_method":     dlp_result.scan_method,
            "recommendation":  dlp_result.recommendation,
            "findings":        [
                {"info_type": f.info_type, "column": f.column,
                 "likelihood": f.likelihood, "action": f.action,
                 "plain_text": f.plain_text}
                for f in dlp_result.findings
            ],
        },
        "gemini":    gemini_output,
        "org_name":  org_name,
    }
    _store[audit_id] = record

    return JSONResponse(content={
        "audit_id":            audit_id,
        "created_at":          record["created_at"],
        "report":              report_dict,
        "sensitivity_reports": sensitivity_reports,
        "dlp_result":          record["dlp_result"],
        "gemini":              gemini_output,
    })


@router.get("/audit/{audit_id}")
def get_audit(audit_id: str):
    r = _store.get(audit_id)
    if not r:
        raise HTTPException(404, "Audit not found.")
    return JSONResponse(content=r)


@router.get("/audit")
def list_audits():
    return JSONResponse(content={"audits": [
        {"audit_id": k, "created_at": v["created_at"],
         "dataset": v["report"]["dataset_name"],
         "grade":   v["report"].get("overall_grade", "?")}
        for k, v in _store.items()
    ]})


# Expose store for certificate and registry routers
def get_store() -> dict:
    return _store

class RemediationChange(BaseModel):
    type: str
    variable: Optional[str] = None
    attribute: Optional[str] = None
    privileged_group: Optional[str] = None
    unprivileged_group: Optional[str] = None
    description: str
    implementation_note: str

class RemediationReportRequest(BaseModel):
    changes: list[RemediationChange]
    projected_dir: float
    projected_grade: str
    sandbox_threshold: float

@router.post('/audit/{audit_id}/remediation-report')
def create_remediation_report(audit_id: str, request: RemediationReportRequest = Body(...)):
    record = _store.get(audit_id)
    if not record:
        raise HTTPException(404, 'Audit not found.')

    report = record['report']
    original = {
        'grade': report.get('overall_grade', 'UNKNOWN'),
        'dir': report.get('overall_dir_score', 0.0),
        'date': record.get('created_at', ''),
        'dataset_name': report.get('dataset_name', 'Unknown'),
        'audit_hash': report.get('audit_hash', ''),
    }

    checklist = []
    for change in request.changes:
        if change.type == 'REMOVE_VARIABLE' and change.variable:
            checklist.append(f'Drop column "{change.variable}" from your dataset before re-training.')
        else:
            checklist.append(change.implementation_note)

    instructions = (
        'After implementing these changes, upload the modified dataset to ProxyGuard for a confirmed audit. '
        'This remediation plan is a projection only and does not replace a real re-audit.'
    )

    response = {
        'original_audit': original,
        'changes': [change.dict() for change in request.changes],
        'projected': {
            'dir': request.projected_dir,
            'grade': request.projected_grade,
            'threshold': request.sandbox_threshold,
        },
        'implementation_checklist': checklist,
        'instructions': instructions,
        'disclaimer': (
            'Projected outcomes are estimates based on the sandbox input. Actual fairness results '
            'can only be confirmed by re-running the full audit on the updated dataset.'
        ),
    }

    return JSONResponse(content=response)
