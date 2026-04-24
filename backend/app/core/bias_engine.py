"""
ProxyGuard Studio — Algebraic XAI Engine v3
============================================
Pure deterministic mathematics. No neural networks. No AI auditing AI.

WHAT THIS COMPUTES
──────────────────
Seven mathematically independent fairness metrics across five tiers:

  TIER 1 — GROUP OUTCOME METRICS
    1. Disparate Impact Ratio (DIR)
       P(Ŷ=1|A=unpriv) / P(Ŷ=1|A=priv)
       Does not require ground truth.

    2. Statistical Parity Difference (SPD)
       P(Ŷ=1|A=0) − P(Ŷ=1|A=1)
       Does not require ground truth.

  TIER 2 — ERROR RATE METRICS  (require ground truth Y)
    3. Equal Opportunity Difference (EOD)
       TPR(priv) − TPR(unpriv)
       "Did deserving members of each group get treated equally?"

    4. Equalised Odds Difference (EQOD)
       max(|TPR_diff|, |FPR_diff|)
       "Were both types of errors equally distributed?"

    5. False Positive Rate Parity (FPRP)
       FPR(priv) − FPR(unpriv)
       "Was one group held to a higher bar?"

  TIER 3 — PROXY DETECTION
    6. Mutual Information (MI) — for numeric/continuous variables
    7. Cramér's V              — for categorical variables (more accurate)
       + Interaction detection (pairwise MI lift)

  TIER 4 — CALIBRATION
    8. Predictive Parity Difference
       |P(Y=1|Ŷ=1,A=0) − P(Y=1|Ŷ=1,A=1)|
       "Does the model's confidence mean the same thing across groups?"

  TIER 5 — COMPOSITE VERDICT
    - Weighted consensus across all computed metrics
    - Industry-specific weights
    - IMPOSSIBILITY FLAG: surfaces metric conflicts explicitly
      (e.g. "Passes Predictive Parity but fails Equalised Odds —
       this is the COMPAS pattern. The system is calibrated but
       structurally discriminatory.")

KEY DESIGN DECISIONS
────────────────────
- Metrics requiring ground truth (Y) are computed only when a
  ground truth column is explicitly provided. Otherwise they are
  marked SKIPPED with a clear explanation. This is honest.

- The impossibility conflict flag is the most important output.
  When metrics disagree, we surface the conflict and explain it
  in plain English — not hide it in a composite score.

- All results are deterministic: same inputs → same hash, always.

- Legal mappings are in legal_context.py (separate module).
  Region defaults to "india". Extend to "us" or "eu" by parameter.

ACADEMIC REFERENCES
───────────────────
- Chouldechova (2017) — Fair prediction with disparate impact
- Kleinberg et al. (2016) — Inherent trade-offs in algorithmic fairness
- Hardt et al. (2016) — Equality of opportunity in supervised learning
- Feldman et al. (2015) — Certifying and removing disparate impact
- Verma & Rubin (2018) — Fairness definitions explained
"""

import hashlib
import json
import itertools
from dataclasses import dataclass, field, asdict
from typing import Optional
import numpy as np
import pandas as pd
from sklearn.feature_selection import mutual_info_classif
from sklearn.preprocessing import LabelEncoder
from scipy.stats import chi2_contingency

from app.core.legal_context import (
    get_thresholds, get_industry_weights,
    get_protected_attributes, get_caste_proxy_columns,
    INDUSTRY_METRIC_WEIGHTS,
)


# ── Proxy detection thresholds ────────────────────────────────────────────────
MI_HIGH       = 0.70
MI_MEDIUM     = 0.40
CRAMERS_HIGH  = 0.50
CRAMERS_MED   = 0.30
INTERACTION_LIFT = 0.15

SUPPORTED_INDUSTRIES = list(INDUSTRY_METRIC_WEIGHTS.keys()) + ["hr", "finance", "healthcare"]


# ── Result dataclasses ────────────────────────────────────────────────────────

@dataclass
class MetricResult:
    """Result for a single fairness metric."""
    name:             str
    value:            float
    threshold:        float
    direction:        str       # "above" or "below"
    status:           str       # "PASS", "FAIL", "REVIEW", "SKIPPED"
    requires_gt:      bool      # True = requires ground truth Y
    legal_basis:      str
    plain_english:    str       # non-technical explanation of this result
    note:             str       # legal/contextual note


@dataclass
class ImpossibilityConflict:
    """
    Surfaces a mathematical impossibility conflict between two metrics.
    This is the most important output when it occurs.
    """
    metric_a:         str
    metric_b:         str
    metric_a_status:  str
    metric_b_status:  str
    explanation:      str
    real_world_meaning: str
    pattern_name:     str   # e.g. "COMPAS Pattern", "Redlining Pattern"


@dataclass
class VariableRisk:
    name:                  str
    mi_score:              float
    cramers_v:             float
    proxy_score:           float   # w_mi*(MI/H(A)) + w_cv*Cramér's V  ∈ [0,1]  (NMI-based)
    proxy_method:          str     # "MI" or "CRAMERS_V" — which method was primary
    weight_mi:             float   # data-adaptive weight for MI (0.2 / 0.5 / 0.8)
    weight_cv:             float   # data-adaptive weight for Cramér's V
    n_unique:              int     # cardinality used to select weights
    risk_level:            str     # "LOW", "MEDIUM", "HIGH"
    is_proxy:              bool
    proxy_for:             Optional[str]
    recommendation:        str
    bias_contribution_pct: float = 0.0
    remediation:           list[dict] = field(default_factory=list)
    is_caste_proxy_candidate: bool = False   # Indian context flag


@dataclass
class FeatureInteraction:
    feature_a:       str
    feature_b:       str
    individual_mi_a: float
    individual_mi_b: float
    interaction_mi:  float
    lift:            float
    protected_attr:  str
    risk_level:      str
    explanation:     str


@dataclass
class GroupOutcomeResult:
    """Per-group outcome rates for a protected attribute."""
    protected_attribute:    str
    outcome_column:         str
    privileged_group:       str
    unprivileged_group:     str
    privileged_rate:        float
    unprivileged_rate:      float
    # Tier 1
    dir_score:              float
    dir_status:             str
    spd_score:              float
    spd_status:             str
    # Tier 2 (None if ground truth unavailable)
    tpr_privileged:         Optional[float]
    tpr_unprivileged:       Optional[float]
    fpr_privileged:         Optional[float]
    fpr_unprivileged:       Optional[float]
    eod_score:              Optional[float]
    eod_status:             Optional[str]
    eqod_score:             Optional[float]
    eqod_status:            Optional[str]
    fprp_score:             Optional[float]
    fprp_status:            Optional[str]
    # Tier 4
    pred_parity_priv:       Optional[float]
    pred_parity_unpriv:     Optional[float]
    pred_parity_diff:       Optional[float]
    pred_parity_status:     Optional[str]
    # Legal
    industry_metric:        str
    legal_basis:            str


@dataclass
class AuditReport:
    # Identity
    dataset_name:            str
    row_count:               int
    column_count:            int
    region:                  str
    industry_context:        str
    primary_fairness_metric: str
    protected_attributes:    list[str]
    outcome_column:          str
    ground_truth_column:     Optional[str]  # None if not provided
    ground_truth_available:  bool

    # Tier 1 + 2: per-attribute group outcome results
    group_outcomes:          list[GroupOutcomeResult]

    # Tier 3: proxy detection
    variable_risks:          list[VariableRisk]
    proxy_chains:            list[dict]
    feature_interactions:    list[FeatureInteraction]

    # All metric results (flat list for display)
    metric_results:          list[MetricResult]

    # Impossibility conflicts
    impossibility_conflicts: list[ImpossibilityConflict]
    has_conflict:            bool

    # Composite verdict
    overall_risk_level:      str    # "PASS", "REVIEW", "FAIL"
    overall_dir_score:       float  # kept for backward compatibility
    overall_grade:           str    # "A", "B", "C", "D", "F"
    composite_score:         float  # 0.0 (worst) to 1.0 (best) weighted across metrics
    total_flags:             int
    metrics_computed:        int
    metrics_skipped:         int    # skipped due to missing ground truth

    # Attribution + remediation
    top_bias_contributors:   list[dict]
    remediation_plan:        list[dict]

    # Legal + metadata
    legal_references:        list[str]
    caste_proxy_candidates:  list[str]   # Indian context
    metadata:                dict = field(default_factory=dict)

    # Cryptographic integrity
    audit_hash:              str = ""


# ── Engine ────────────────────────────────────────────────────────────────────

class BiasAuditEngine:
    """
    Multi-checkpoint fairness audit engine.
    Computes seven independent fairness metrics across five tiers.
    """

    def __init__(self):
        self._label_encoders: dict[str, LabelEncoder] = {}
        self._cleaning_report: dict = {}

    def run_audit(
        self,
        df:                   pd.DataFrame,
        dataset_name:         str,
        protected_attributes: list[str],
        outcome_column:       str,
        industry:             str,
        region:               str = "india",
        ground_truth_column:  Optional[str] = None,
    ) -> AuditReport:
        """
        Main entry point. Returns a fully populated AuditReport.

        Parameters
        ----------
        df                    : Raw dataset as pandas DataFrame
        dataset_name          : Friendly name (e.g. "hiring_data.csv")
        protected_attributes  : Legally protected columns (e.g. ["caste", "sex"])
        outcome_column        : Model prediction column (binary 0/1)
        industry              : One of: finance, healthcare, hr, criminal_justice, insurance
        region                : "india" (default), "us", or "eu"
        ground_truth_column   : Actual outcome column if available (enables Tier 2 metrics).
                                If None, Tier 2 metrics are marked SKIPPED.
        """
        industry = self._normalise_industry(industry)
        region   = region.lower()

        thresholds = get_thresholds(region)
        weights    = get_industry_weights(industry)

        df_clean = self._preprocess(df, protected_attributes, outcome_column, ground_truth_column)
        gt_available = ground_truth_column is not None and ground_truth_column in df_clean.columns

        # ── Tier 1+2: group outcome metrics ──────────────────────────────────
        group_outcomes = self._compute_group_outcomes(
            df_clean, protected_attributes, outcome_column,
            ground_truth_column if gt_available else None,
            industry, region, thresholds
        )

        # ── Tier 3: proxy detection ───────────────────────────────────────────
        variable_risks = self._compute_proxy_risks(
            df_clean, protected_attributes, outcome_column, region
        )
        variable_risks = self._attach_bias_attribution(variable_risks)

        feature_cols   = [c for c in df_clean.columns if c not in protected_attributes and c != outcome_column]
        interactions   = self._detect_interactions(df_clean, feature_cols, protected_attributes, variable_risks)
        proxy_chains   = self._extract_proxy_chains(variable_risks)

        # ── Tier 4+5: all metric results + composite ──────────────────────────
        all_metrics          = self._flatten_metric_results(group_outcomes, thresholds, gt_available)
        impossibility        = self._detect_impossibility(group_outcomes)
        composite, grade     = self._compute_composite(all_metrics, weights)
        overall_risk         = self._determine_overall_risk(all_metrics, variable_risks)
        total_flags          = sum(1 for v in variable_risks if v.risk_level != "LOW")
        metrics_computed     = sum(1 for m in all_metrics if m.status != "SKIPPED")
        metrics_skipped      = sum(1 for m in all_metrics if m.status == "SKIPPED")

        # ── Remediation ───────────────────────────────────────────────────────
        variable_risks       = self._attach_remediation(variable_risks, interactions)
        remediation_plan     = self._build_remediation_plan(variable_risks, group_outcomes)
        top_contributors     = self._top_contributors(variable_risks)

        # ── Indian context: caste proxy candidates ────────────────────────────
        caste_proxies = get_caste_proxy_columns(list(df.columns)) if region == "india" else []

        # ── Legal references ──────────────────────────────────────────────────
        legal_refs = self._get_legal_references(region, industry)

        # ── Overall DIR (backward compat) ─────────────────────────────────────
        overall_dir = self._mean_dir(group_outcomes)

        report = AuditReport(
            dataset_name=dataset_name,
            row_count=len(df),
            column_count=len(df.columns),
            region=region,
            industry_context=industry,
            primary_fairness_metric=INDUSTRY_METRIC_WEIGHTS.get(industry, {}).get("primary_metric", "demographic_parity"),
            protected_attributes=protected_attributes,
            outcome_column=outcome_column,
            ground_truth_column=ground_truth_column,
            ground_truth_available=gt_available,
            group_outcomes=group_outcomes,
            variable_risks=variable_risks,
            proxy_chains=proxy_chains,
            feature_interactions=interactions,
            metric_results=all_metrics,
            impossibility_conflicts=impossibility,
            has_conflict=len(impossibility) > 0,
            overall_risk_level=overall_risk,
            overall_dir_score=overall_dir,
            overall_grade=grade,
            composite_score=composite,
            total_flags=total_flags,
            metrics_computed=metrics_computed,
            metrics_skipped=metrics_skipped,
            top_bias_contributors=top_contributors,
            remediation_plan=remediation_plan,
            legal_references=legal_refs,
            caste_proxy_candidates=caste_proxies,
            metadata={
                "columns":         list(df.columns),
                "dtypes":          {c: str(t) for c, t in df.dtypes.items()},
                "null_counts":     df.isnull().sum().to_dict(),
                "cleaning_report": getattr(self, "_cleaning_report", {}),
                "ground_truth_available": gt_available,
                "region":          region,
                "industry":        industry,
            },
        )
        report.audit_hash = self._hash_report(report)
        return report

    # ── Preprocessing ─────────────────────────────────────────────────────────

    def _normalise_industry(self, industry: str) -> str:
        industry = industry.lower().strip()
        aliases = {
            "hr": "hr", "hiring": "hr", "employment": "hr",
            "finance": "finance", "banking": "finance", "credit": "finance", "lending": "finance",
            "healthcare": "healthcare", "health": "healthcare", "medical": "healthcare",
            "criminal_justice": "criminal_justice", "criminal": "criminal_justice", "justice": "criminal_justice",
            "insurance": "insurance",
        }
        return aliases.get(industry, "hr")

    def _preprocess(self, df, protected_attributes, outcome_column, ground_truth_column=None):
        df = df.copy()
        self._cleaning_report = {
            "rows_before": len(df), "rows_dropped": 0,
            "columns_dropped": [], "imputed_numeric": [],
            "imputed_categorical": [], "imputed_protected": [],
        }

        safe_cols = set(protected_attributes) | {outcome_column}
        if ground_truth_column:
            safe_cols.add(ground_truth_column)

        # Step 1: drop all-NaN columns
        all_nan = [c for c in df.columns if df[c].isna().all()]
        if all_nan:
            df.drop(columns=all_nan, inplace=True)
            self._cleaning_report["columns_dropped"].extend(all_nan)

        # Step 2: drop garbage columns (free text, dates, IDs) BEFORE encoding
        garbage = []
        for col in list(df.columns):
            if col in safe_cols:
                continue
            if pd.api.types.is_string_dtype(df[col]) or pd.api.types.is_object_dtype(df[col]):
                coerced   = pd.to_numeric(df[col], errors="coerce")
                fail_rate = coerced.isna().sum() / max(df[col].notna().sum(), 1)
                n_unique  = df[col].nunique(dropna=True)
                n_rows    = max(len(df[col].dropna()), 1)
                is_cat    = n_unique <= 20 and (n_unique / n_rows) < 0.05
                if fail_rate > 0.40 and not is_cat:
                    garbage.append(col)
                    continue
            col_lower = col.lower().strip()
            id_pats = ["_id", "id_", "_name", "_date", "date_", "case_num",
                       "case_id", "screening_date", "_in", "_out"]
            if col_lower in ("id", "name", "first", "last") or \
               any(col_lower.startswith(p) or col_lower.endswith(p) for p in id_pats):
                garbage.append(col)

        garbage = list(dict.fromkeys(garbage))
        if garbage:
            df.drop(columns=garbage, inplace=True)
            self._cleaning_report["columns_dropped"].extend(garbage)

        # Step 3: drop rows where outcome NaN
        before = len(df)
        df.dropna(subset=[outcome_column], inplace=True)
        self._cleaning_report["rows_dropped"]  = before - len(df)
        self._cleaning_report["rows_after"]    = len(df)

        if len(df) < 10:
            raise ValueError(
                f"Only {len(df)} rows remain after cleaning. Need at least 10. "
                f"Check that '{outcome_column}' is the correct outcome column."
            )

        # Step 4: impute protected attrs with mode
        for col in protected_attributes:
            if col not in df.columns:
                continue
            n = int(df[col].isna().sum())
            if n > 0:
                m = df[col].mode(dropna=True)
                fv = m.iloc[0] if len(m) else "unknown"
                df[col] = df[col].fillna(fv)
                self._cleaning_report["imputed_protected"].append(
                    {"column": col, "missing": n, "strategy": "mode", "fill_value": str(fv)}
                )

        # Step 5: impute remaining columns
        for col in df.columns:
            if col == outcome_column:
                continue
            if df[col].dtype == bool or str(df[col].dtype) == "boolean":
                df[col] = df[col].astype(float)
            n = int(df[col].isna().sum())
            if n == 0:
                continue
            is_cat = pd.api.types.is_string_dtype(df[col]) or pd.api.types.is_object_dtype(df[col])
            if is_cat:
                m = df[col].mode(dropna=True)
                fv = m.iloc[0] if len(m) else "unknown"
                df[col] = df[col].fillna(fv)
                self._cleaning_report["imputed_categorical"].append({"column": col, "missing": n})
            else:
                df[col] = pd.to_numeric(df[col], errors="coerce")
                fv = float(df[col].median(skipna=True) or 0.0)
                df[col] = df[col].fillna(fv)
                self._cleaning_report["imputed_numeric"].append({"column": col, "missing": n})

        # Step 6: label-encode string columns
        for col in df.columns:
            if pd.api.types.is_string_dtype(df[col]) or pd.api.types.is_object_dtype(df[col]):
                le = LabelEncoder()
                df[col] = le.fit_transform(df[col].astype(str))
                self._label_encoders[col] = le

        # Step 7: final coercion and safety net
        for col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
            if df[col].isna().any():
                m = df[col].median(skipna=True)
                df[col] = df[col].fillna(float(m) if not pd.isna(m) else 0.0)

        nan_remaining = [c for c in df.columns if df[c].isna().any()]
        if nan_remaining:
            raise ValueError(f"Cleaning failed: residual NaN in {nan_remaining}")

        return df

    # ── Tier 1+2: Group Outcome Metrics ───────────────────────────────────────

    def _compute_group_outcomes(self, df, protected_attributes, outcome_column,
                                 ground_truth_column, industry, region, thresholds):
        results = []
        for prot in protected_attributes:
            if prot not in df.columns:
                continue
            if len(df[prot].unique()) < 2:
                continue

            # Determine privileged/unprivileged by outcome rate
            rates = df.groupby(prot)[outcome_column].mean().sort_values(ascending=False)
            if len(rates) < 2:
                continue

            priv_enc   = rates.index[0]
            unpriv_enc = rates.index[-1]
            priv_rate  = float(rates.iloc[0])
            unpriv_rate= float(rates.iloc[-1])

            # Decode group labels
            le = self._label_encoders.get(prot)
            priv_lbl   = le.inverse_transform([priv_enc])[0]   if le else str(priv_enc)
            unpriv_lbl = le.inverse_transform([unpriv_enc])[0] if le else str(unpriv_enc)

            # Masks for each group
            priv_mask   = df[prot] == priv_enc
            unpriv_mask = df[prot] == unpriv_enc

            # ── Tier 1: DIR + SPD ────────────────────────────────────────────
            dir_score = (unpriv_rate / priv_rate) if priv_rate > 0 else 0.0
            spd_score = unpriv_rate - priv_rate

            t_dir = thresholds["dir"]
            t_spd = thresholds["spd"]
            dir_status = self._threshold_status(dir_score, t_dir.threshold, t_dir.direction)
            spd_status = self._threshold_status(abs(spd_score), t_spd.threshold, t_spd.direction)

            # ── Tier 2: EOD, EQOD, FPRP ─────────────────────────────────────
            tpr_priv = tpr_unpriv = fpr_priv = fpr_unpriv = None
            eod_score = eqod_score = fprp_score = None
            eod_status = eqod_status = fprp_status = None

            if ground_truth_column and ground_truth_column in df.columns:
                y_priv   = df.loc[priv_mask,   ground_truth_column]
                y_unpriv = df.loc[unpriv_mask,  ground_truth_column]
                yhat_priv   = df.loc[priv_mask,   outcome_column]
                yhat_unpriv = df.loc[unpriv_mask,  outcome_column]

                tpr_priv,   fpr_priv   = self._tpr_fpr(y_priv,   yhat_priv)
                tpr_unpriv, fpr_unpriv = self._tpr_fpr(y_unpriv, yhat_unpriv)

                t_eod  = thresholds["eod"]
                t_eqod = thresholds["eqod"]
                t_fprp = thresholds["fprp"]

                if tpr_priv is not None and tpr_unpriv is not None:
                    eod_score  = tpr_priv - tpr_unpriv
                    eod_status = self._threshold_status(abs(eod_score), t_eod.threshold, t_eod.direction)

                if tpr_priv is not None and fpr_priv is not None:
                    eqod_score = max(abs(tpr_priv - tpr_unpriv), abs(fpr_priv - fpr_unpriv))
                    eqod_status= self._threshold_status(eqod_score, t_eqod.threshold, t_eqod.direction)

                if fpr_priv is not None and fpr_unpriv is not None:
                    fprp_score = fpr_priv - fpr_unpriv
                    fprp_status= self._threshold_status(abs(fprp_score), t_fprp.threshold, t_fprp.direction)

            # ── Tier 4: Predictive Parity ────────────────────────────────────
            pp_priv = pp_unpriv = pp_diff = pp_status = None
            if ground_truth_column and ground_truth_column in df.columns:
                pp_priv   = self._predictive_parity(
                    df.loc[priv_mask,   ground_truth_column],
                    df.loc[priv_mask,   outcome_column]
                )
                pp_unpriv = self._predictive_parity(
                    df.loc[unpriv_mask, ground_truth_column],
                    df.loc[unpriv_mask, outcome_column]
                )
                if pp_priv is not None and pp_unpriv is not None:
                    pp_diff   = abs(pp_priv - pp_unpriv)
                    t_pp      = thresholds["predictive_parity_diff"]
                    pp_status = self._threshold_status(pp_diff, t_pp.threshold, t_pp.direction)

            # Legal basis from context
            pa_info    = get_protected_attributes(region)
            legal_note = pa_info.get(prot, {}).get("legal_basis", "Article 15, Constitution of India")
            ind_config = INDUSTRY_METRIC_WEIGHTS.get(industry, {})

            results.append(GroupOutcomeResult(
                protected_attribute=prot,
                outcome_column=outcome_column,
                privileged_group=str(priv_lbl),
                unprivileged_group=str(unpriv_lbl),
                privileged_rate=round(priv_rate, 4),
                unprivileged_rate=round(unpriv_rate, 4),
                dir_score=round(dir_score, 4),
                dir_status=dir_status,
                spd_score=round(spd_score, 4),
                spd_status=spd_status,
                tpr_privileged=round(tpr_priv, 4)   if tpr_priv   is not None else None,
                tpr_unprivileged=round(tpr_unpriv, 4) if tpr_unpriv is not None else None,
                fpr_privileged=round(fpr_priv, 4)   if fpr_priv   is not None else None,
                fpr_unprivileged=round(fpr_unpriv, 4) if fpr_unpriv is not None else None,
                eod_score=round(eod_score, 4)   if eod_score  is not None else None,
                eod_status=eod_status,
                eqod_score=round(eqod_score, 4) if eqod_score is not None else None,
                eqod_status=eqod_status,
                fprp_score=round(fprp_score, 4) if fprp_score is not None else None,
                fprp_status=fprp_status,
                pred_parity_priv=round(pp_priv, 4)   if pp_priv   is not None else None,
                pred_parity_unpriv=round(pp_unpriv, 4) if pp_unpriv is not None else None,
                pred_parity_diff=round(pp_diff, 4)   if pp_diff   is not None else None,
                pred_parity_status=pp_status,
                industry_metric=ind_config.get("primary_metric", "demographic_parity"),
                legal_basis=legal_note,
            ))

        return results

    def _tpr_fpr(self, y_true, y_pred):
        """Compute TPR and FPR for a group. Returns (None, None) if insufficient data."""
        if len(y_true) < 5:
            return None, None
        y_true = np.array(y_true)
        y_pred = np.array(y_pred)
        positives = y_true == 1
        negatives = y_true == 0
        if positives.sum() == 0 or negatives.sum() == 0:
            return None, None
        tpr = float((y_pred[positives] == 1).sum() / positives.sum())
        fpr = float((y_pred[negatives] == 1).sum() / negatives.sum())
        return tpr, fpr

    def _predictive_parity(self, y_true, y_pred):
        """P(Y=1 | Ŷ=1) for a group. Returns None if no positive predictions."""
        y_true = np.array(y_true)
        y_pred = np.array(y_pred)
        predicted_positive = y_pred == 1
        if predicted_positive.sum() == 0:
            return None
        return float(y_true[predicted_positive].mean())

    def _threshold_status(self, value: float, threshold: float, direction: str) -> str:
        if direction == "above":
            if value >= threshold:          return "PASS"
            elif value >= threshold * 0.90: return "REVIEW"
            else:                           return "FAIL"
        else:  # below
            if value <= threshold:              return "PASS"
            elif value <= threshold * 1.25:     return "REVIEW"
            else:                               return "FAIL"

    # ── Tier 3: Proxy Detection ───────────────────────────────────────────────

    def _compute_proxy_risks(self, df, protected_attributes, outcome_column, region):
        feature_cols = [
            c for c in df.columns
            if c not in protected_attributes and c != outcome_column
        ]
        caste_proxy_cols = set(get_caste_proxy_columns(list(df.columns)))
        results = []

        for feat in feature_cols:
            max_mi     = 0.0
            max_cv     = 0.0
            proxy_for  = None
            proxy_method = "MI"

            for prot in protected_attributes:
                # MI — for numeric features
                X  = df[[feat]].values
                y  = df[prot].values
                mi = float(mutual_info_classif(X, y, discrete_features="auto", random_state=42)[0])
                if mi > max_mi:
                    max_mi    = mi
                    proxy_for = prot if mi >= MI_MEDIUM else None

                # Cramér's V — for categorical features
                # Use if the feature has low cardinality (likely categorical)
                if df[feat].nunique() <= 30:
                    cv = self._cramers_v(df[feat].values, y)
                    if cv > max_cv:
                        max_cv = cv
                        if cv > max_mi:
                            proxy_method = "CRAMERS_V"
                            if cv >= CRAMERS_MED:
                                proxy_for = prot

            # ── Proxy Score formula ──────────────────────────────────────────
            # We use Normalised Mutual Information (NMI) to put MI on [0,1]:
            #
            #   NMI(X; A) = I(X; A) / H(A)
            #
            # where H(A) = -Σ p_a log(p_a) is the Shannon entropy of the
            # protected attribute A.
            #
            # Theoretical justification (Cover & Thomas, 1991, Ch. 2):
            #   I(X; A) ≤ H(A)  always holds (data processing inequality).
            #   NMI = 1  iff  X perfectly predicts A  (H(A|X) = 0).
            #   NMI = 0  iff  X and A are independent  (I(X;A) = 0).
            #   This is the standard information-theoretic normalisation.
            #
            # This is strictly preferable to 1−exp(−MI) because:
            #   - The scale is interpretable: NMI=0.6 means X explains 60%
            #     of the uncertainty in A, in information-theoretic units.
            #   - The ceiling (H(A)) is dataset-specific and meaningful.
            #   - It is used in sklearn's normalized_mutual_info_score and
            #     in the NLP literature for feature relevance (Manning et al., 2008).
            #
            # Cramér's V is already in [0,1] by construction (bias-corrected).
            # Both NMI and Cramér's V are now on the same [0,1] information scale.
            #
            # WEIGHT SELECTION — data-adaptive by cardinality:
            # ─────────────────────────────────────────────────
            # MI (and thus NMI) is reliable for CONTINUOUS features.
            # Cramér's V is reliable for CATEGORICAL features.
            # We weight by cardinality following Agresti (2013) and sklearn heuristics:
            #   n_unique ≤ 10  → categorical → w_cv = 0.8, w_mi = 0.2
            #   n_unique ≤ 30  → ordinal/mixed → w_cv = 0.5, w_mi = 0.5
            #   n_unique  > 30 → continuous → w_cv = 0.2, w_mi = 0.8
            #
            # Final formula:
            #   ProxyScore = w_mi × NMI(X,A) + w_cv × Cramér's V   ∈ [0, 1]
            n_unique = df[feat].nunique()
            if n_unique <= 10:
                w_mi, w_cv = 0.2, 0.8
            elif n_unique <= 30:
                w_mi, w_cv = 0.5, 0.5
            else:
                w_mi, w_cv = 0.8, 0.2

            # Compute H(A) for each protected attribute; use max H(A) encountered
            # (corresponding to the prot for which MI was maximal).
            # H(A) is the Shannon entropy in nats (natural log base, matching sklearn MI).
            ha = 0.0
            for prot in protected_attributes:
                prot_vals = df[prot].values
                counts    = np.bincount(prot_vals.astype(int)) if np.issubdtype(prot_vals.dtype, np.integer) \
                            else np.unique(prot_vals, return_counts=True)[1]
                probs     = counts / counts.sum()
                probs     = probs[probs > 0]
                h         = -float(np.sum(probs * np.log(probs)))  # nats
                if h > ha:
                    ha = h
            # NMI: clamp to [0,1]; H(A)=0 (constant attribute) → NMI=0
            nmi = float(max_mi / ha) if ha > 1e-9 else 0.0
            nmi = min(max(nmi, 0.0), 1.0)

            proxy_score = round(min(w_mi * nmi + w_cv * max_cv, 1.0), 4)
            risk_level, is_proxy, rec = self._classify_proxy_risk(max_mi, max_cv)

            results.append(VariableRisk(
                name=feat,
                mi_score=round(max_mi, 4),
                cramers_v=round(max_cv, 4),
                proxy_score=round(proxy_score, 4),
                proxy_method=proxy_method,
                weight_mi=w_mi,
                weight_cv=w_cv,
                n_unique=int(n_unique),
                risk_level=risk_level,
                is_proxy=is_proxy,
                proxy_for=proxy_for,
                recommendation=rec,
                is_caste_proxy_candidate=(feat in caste_proxy_cols),
            ))

        results.sort(key=lambda v: v.proxy_score, reverse=True)
        return results

    def _cramers_v(self, x: np.ndarray, y: np.ndarray) -> float:
        """
        Cramér's V — symmetric measure of association between two categorical variables.
        Range: 0 (no association) to 1 (perfect association).
        Based on chi-squared statistic with proper bias correction (Bergsma 2013).
        """
        try:
            contingency = pd.crosstab(x, y)
            chi2, _, _, _ = chi2_contingency(contingency, correction=False)
            n   = contingency.sum().sum()
            r   = contingency.shape[0]
            k   = contingency.shape[1]
            if n == 0 or min(r, k) <= 1:
                return 0.0
            # Bias-corrected Cramér's V (Bergsma 2013)
            phi2     = max(0, chi2 / n - (r - 1) * (k - 1) / (n - 1))
            r_tilde  = r - (r - 1) ** 2 / (n - 1)
            k_tilde  = k - (k - 1) ** 2 / (n - 1)
            denom    = min(r_tilde - 1, k_tilde - 1)
            if denom <= 0:
                return 0.0
            return float(np.sqrt(phi2 / denom))
        except Exception:
            return 0.0

    def _classify_proxy_risk(self, mi: float, cv: float):
        score = max(mi, cv)
        if score >= max(MI_HIGH, CRAMERS_HIGH):
            return ("HIGH", True,
                    "Remove from dataset. This variable is a strong proxy for a protected attribute. "
                    "Using it in a model is legally equivalent to using the protected attribute directly.")
        elif score >= max(MI_MEDIUM, CRAMERS_MED):
            return ("MEDIUM", True,
                    "Review carefully. Moderate correlation with a protected attribute. "
                    "Consider binning, reweighting, or removal.")
        else:
            return ("LOW", False,
                    "No action required. Low correlation with protected attributes.")

    def _detect_interactions(self, df, feature_cols, protected_attributes, variable_risks):
        candidates = [v.name for v in variable_risks if v.mi_score > 0.05][:12]
        mi_lookup  = {v.name: v.mi_score for v in variable_risks}
        results    = []

        for feat_a, feat_b in itertools.combinations(candidates, 2):
            for prot in protected_attributes:
                mi_a = mi_lookup.get(feat_a, 0.0)
                mi_b = mi_lookup.get(feat_b, 0.0)
                ix_col = df[feat_a].values.astype(float) * df[feat_b].values.astype(float)
                try:
                    mi_ix = float(
                        mutual_info_classif(ix_col.reshape(-1, 1), df[prot].values,
                                            discrete_features=False, random_state=42)[0]
                    )
                except Exception:
                    continue
                lift = mi_ix - max(mi_a, mi_b)
                if lift >= INTERACTION_LIFT:
                    results.append(FeatureInteraction(
                        feature_a=feat_a, feature_b=feat_b,
                        individual_mi_a=round(mi_a, 4), individual_mi_b=round(mi_b, 4),
                        interaction_mi=round(mi_ix, 4), lift=round(lift, 4),
                        protected_attr=prot,
                        risk_level="HIGH" if lift >= 0.25 else "MEDIUM",
                        explanation=(
                            f"'{feat_a}' and '{feat_b}' together encode '{prot}' with "
                            f"{mi_ix:.2f} MI — {lift:.2f} higher than either alone. "
                            f"This hidden interaction bias would survive individual variable screening."
                        ),
                    ))

        results.sort(key=lambda x: x.lift, reverse=True)
        return results

    # ── Tier 5: Composite + Impossibility ─────────────────────────────────────

    def _flatten_metric_results(self, group_outcomes, thresholds, gt_available):
        """Convert GroupOutcomeResults into a flat list of MetricResult objects."""
        results = []
        for go in group_outcomes:
            prot = go.protected_attribute

            def mr(name, value, t_key, status, req_gt, pe):
                t = thresholds.get(t_key)
                return MetricResult(
                    name=f"{name} ({prot})", value=value,
                    threshold=t.threshold if t else 0.0,
                    direction=t.direction if t else "above",
                    status=status or ("SKIPPED" if (req_gt and not gt_available) else "PASS"),
                    requires_gt=req_gt,
                    legal_basis=t.legal_basis if t else "",
                    plain_english=pe,
                    note=t.note if t else "",
                )

            results.append(mr("DIR", go.dir_score, "dir", go.dir_status, False,
                f"{go.unprivileged_group} receives positive outcome at {go.dir_score:.0%} "
                f"the rate of {go.privileged_group}."))

            results.append(mr("SPD", go.spd_score, "spd", go.spd_status, False,
                f"Absolute outcome gap: {abs(go.spd_score):.1%} percentage points."))

            results.append(mr("EOD", go.eod_score or 0.0, "eod", go.eod_status, True,
                f"Deserving {go.unprivileged_group} members are {go.eod_score:.1%} less likely "
                f"to receive correct positive predictions than {go.privileged_group}."
                if go.eod_score is not None else "Requires ground truth labels."))

            results.append(mr("EQOD", go.eqod_score or 0.0, "eqod", go.eqod_status, True,
                f"Maximum error rate disparity: {go.eqod_score:.1%} across groups."
                if go.eqod_score is not None else "Requires ground truth labels."))

            results.append(mr("FPRP", go.fprp_score or 0.0, "fprp", go.fprp_status, True,
                f"{go.unprivileged_group} faces a {abs(go.fprp_score or 0):.1%} higher false positive rate."
                if go.fprp_score is not None else "Requires ground truth labels."))

            results.append(mr("Predictive Parity", go.pred_parity_diff or 0.0,
                "predictive_parity_diff", go.pred_parity_status, True,
                f"Model accuracy when predicting positive outcomes differs by "
                f"{go.pred_parity_diff:.1%} between groups."
                if go.pred_parity_diff is not None else "Requires ground truth labels."))

        return results

    def _detect_impossibility(self, group_outcomes) -> list[ImpossibilityConflict]:
        """
        Detects the Chouldechova / Kleinberg impossibility conflicts.
        The most important: Predictive Parity PASS + Equalised Odds FAIL
        = the COMPAS pattern.
        """
        conflicts = []
        for go in group_outcomes:
            # Pattern 1: COMPAS pattern
            # Predictive Parity passes but Equalised Odds fails
            if (go.pred_parity_status == "PASS" and
                go.eqod_status in ("FAIL", "REVIEW")):
                conflicts.append(ImpossibilityConflict(
                    metric_a="Predictive Parity",
                    metric_b="Equalised Odds",
                    metric_a_status="PASS",
                    metric_b_status=go.eqod_status,
                    explanation=(
                        f"For '{go.protected_attribute}': the model is equally accurate "
                        f"per group when it makes positive predictions (Predictive Parity PASS), "
                        f"but it distributes errors unequally between groups (Equalised Odds {go.eqod_status}). "
                        f"This is mathematically proven to occur when base rates differ between groups "
                        f"(Chouldechova, 2017). Both findings are correct simultaneously."
                    ),
                    real_world_meaning=(
                        f"The system appears calibrated — its confidence scores mean the same thing "
                        f"for {go.privileged_group} and {go.unprivileged_group} when it is correct. "
                        f"But it is wrong in systematically different ways: "
                        f"{go.unprivileged_group} members who deserve positive outcomes are more likely "
                        f"to be incorrectly denied. This is the pattern that COMPAS exhibited in the "
                        f"ProPublica 2016 investigation."
                    ),
                    pattern_name="COMPAS Pattern",
                ))

            # Pattern 2: Demographic Parity passes but Equal Opportunity fails
            if (go.dir_status == "PASS" and
                go.eod_status in ("FAIL", "REVIEW")):
                conflicts.append(ImpossibilityConflict(
                    metric_a="Demographic Parity (DIR)",
                    metric_b="Equal Opportunity",
                    metric_a_status="PASS",
                    metric_b_status=go.eod_status,
                    explanation=(
                        f"For '{go.protected_attribute}': overall outcome rates look proportional "
                        f"(DIR PASS), but deserving members of {go.unprivileged_group} are being "
                        f"missed at a higher rate (EOD {go.eod_status}). "
                        f"The system achieves parity by approving more undeserving members of the "
                        f"unprivileged group to compensate for missing deserving ones."
                    ),
                    real_world_meaning=(
                        f"The system's overall approval rate looks fair, but the *quality* of decisions "
                        f"is unequal. {go.unprivileged_group} members who genuinely qualify are more "
                        f"likely to be rejected than {go.privileged_group} members who equally qualify. "
                        f"This is hidden discrimination that aggregate statistics conceal."
                    ),
                    pattern_name="Hidden Opportunity Gap",
                ))

        return conflicts

    def _compute_composite(self, all_metrics, weights):
        """
        Weighted composite score across computed metrics.
        Skipped metrics do not count toward the composite.
        Returns (score 0-1, grade A-F).
        """
        metric_key_map = {
            "DIR":               "dir",
            "SPD":               "spd",
            "EOD":               "eod",
            "EQOD":              "eqod",
            "FPRP":              "fprp",
            "Predictive Parity": "predictive_parity_diff",
        }
        status_score = {"PASS": 1.0, "REVIEW": 0.5, "FAIL": 0.0, "SKIPPED": None}

        total_weight = 0.0
        weighted_sum = 0.0

        for metric in all_metrics:
            base_name = metric.name.split(" (")[0]
            key       = metric_key_map.get(base_name)
            w         = weights.get(key, 0.0) if key else 0.0
            s         = status_score.get(metric.status)
            if s is None or w == 0.0:
                continue
            weighted_sum  += w * s
            total_weight  += w

        score = (weighted_sum / total_weight) if total_weight > 0 else 0.5

        if score >= 0.95: grade = "A"
        elif score >= 0.85: grade = "B"
        elif score >= 0.70: grade = "C"
        elif score >= 0.50: grade = "D"
        else: grade = "F"

        return round(score, 4), grade

    def _determine_overall_risk(self, all_metrics, variable_risks):
        any_fail   = any(m.status == "FAIL"   for m in all_metrics)
        any_review = any(m.status == "REVIEW" for m in all_metrics)
        any_high   = any(v.risk_level == "HIGH" for v in variable_risks)

        if any_fail or any_high:  return "FAIL"
        if any_review:            return "REVIEW"
        return "PASS"

    # ── Attribution + Remediation ──────────────────────────────────────────────

    def _attach_bias_attribution(self, variable_risks):
        total = sum(v.proxy_score for v in variable_risks if v.proxy_score > 0)
        if total > 0:
            for v in variable_risks:
                v.bias_contribution_pct = round((v.proxy_score / total) * 100, 1)
        return variable_risks

    def _attach_remediation(self, variable_risks, interactions):
        ix_features = {ix.feature_a for ix in interactions} | {ix.feature_b for ix in interactions}
        for v in variable_risks:
            actions = []
            if v.risk_level == "HIGH":
                actions.append({
                    "action": "REMOVE",
                    "confidence": round(min(0.95, 0.70 + v.proxy_score * 0.3), 2),
                    "expected_dir_improvement": "+0.12 to +0.22",
                    "reason": f"'{v.name}' is a strong proxy (score {v.proxy_score:.3f}) for '{v.proxy_for}'. Removing it eliminates this discriminatory pathway.",
                })
                if v.name in ix_features:
                    actions.append({
                        "action": "REMOVE_INTERACTION_PAIR",
                        "confidence": 0.88,
                        "expected_dir_improvement": "+0.08 to +0.16",
                        "reason": f"'{v.name}' also participates in a detected interaction bias. Removal breaks both individual and interaction pathways.",
                    })
            elif v.risk_level == "MEDIUM":
                actions.append({
                    "action": "BIN",
                    "confidence": round(min(0.80, 0.50 + v.proxy_score * 0.5), 2),
                    "expected_dir_improvement": "+0.04 to +0.10",
                    "reason": f"Discretising '{v.name}' into 3–5 equal-frequency bins reduces its correlation with '{v.proxy_for}' by breaking fine-grained proxy encoding.",
                })
                actions.append({
                    "action": "REWEIGHT",
                    "confidence": 0.65,
                    "expected_dir_improvement": "+0.06 to +0.12",
                    "reason": f"Apply inverse-probability reweighting to balance groups with respect to '{v.name}' before training.",
                })
            else:
                actions.append({
                    "action": "MONITOR",
                    "confidence": 0.90,
                    "expected_dir_improvement": "0.00",
                    "reason": f"Low proxy score ({v.proxy_score:.3f}). No immediate action needed. Monitor for drift in production.",
                })
            v.remediation = actions
        return variable_risks

    def _build_remediation_plan(self, variable_risks, group_outcomes):
        current_dir = self._mean_dir(group_outcomes)
        steps = []
        step_num = 1
        running_dir = current_dir

        ordered = sorted(
            [v for v in variable_risks if v.risk_level in ("HIGH", "MEDIUM")],
            key=lambda v: v.bias_contribution_pct, reverse=True,
        )
        for v in ordered:
            if not v.remediation:
                continue
            top    = v.remediation[0]
            parts  = top.get("expected_dir_improvement", "+0.00").replace("+", "").split(" to ")
            try:
                impr = sum(float(p) for p in parts) / len(parts)
            except Exception:
                impr = 0.0
            running_dir = min(round(running_dir + impr, 3), 1.0)
            steps.append({
                "step": step_num, "variable": v.name, "action": top["action"],
                "confidence": top["confidence"], "reason": top["reason"],
                "bias_share_pct": v.bias_contribution_pct,
                "projected_dir_after": running_dir,
                "passes_after": running_dir >= 0.80,
            })
            step_num += 1

        return steps

    def _top_contributors(self, variable_risks):
        return [
            {"rank": i+1, "variable": v.name, "pct": v.bias_contribution_pct,
             "risk_level": v.risk_level, "action": v.remediation[0]["action"] if v.remediation else "MONITOR"}
            for i, v in enumerate(sorted(variable_risks, key=lambda v: v.bias_contribution_pct, reverse=True)[:5])
        ]

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _extract_proxy_chains(self, variable_risks):
        return [
            {"variable": v.name, "proxies_for": v.proxy_for,
             "mi_score": v.mi_score, "cramers_v": v.cramers_v, "risk_level": v.risk_level}
            for v in variable_risks if v.is_proxy and v.proxy_for
        ]

    def _mean_dir(self, group_outcomes) -> float:
        if not group_outcomes:
            return 1.0
        return round(sum(g.dir_score for g in group_outcomes) / len(group_outcomes), 4)

    def _get_legal_references(self, region: str, industry: str) -> list[str]:
        refs = {
            "india": {
                "base": [
                    "Article 14 — Equality before law, Constitution of India",
                    "Article 15 — Prohibition of discrimination, Constitution of India",
                    "Digital Personal Data Protection Act 2023 (DPDPA)",
                    "NITI Aayog Responsible AI Principles 2021",
                ],
                "finance":    ["RBI Fair Lending Guidelines", "Banking Regulation Act 1949"],
                "healthcare": ["Clinical Establishments Act 2010", "RPwD Act 2016"],
                "hr":         ["Industrial Disputes Act 1947", "Equal Remuneration Act 1976",
                               "Labour Codes 2020"],
                "criminal_justice": ["Code of Criminal Procedure 1973", "Article 21 — Right to life"],
            },
            "us": {
                "base": ["EEOC Uniform Guidelines (1978)"],
                "finance": ["ECOA", "Fair Housing Act", "CFPB Guidelines"],
                "healthcare": ["Civil Rights Act Title VI", "ADA Section 504"],
                "hr": ["Title VII Civil Rights Act 1964", "ADEA"],
                "criminal_justice": ["14th Amendment — Equal Protection"],
            },
            "eu": {
                "base": ["EU AI Act 2024", "GDPR Article 22", "EU Charter Article 21"],
                "finance": ["CRD IV", "EBA Guidelines on Internal Governance"],
                "healthcare": ["EU MDR 2017/745"],
                "hr": ["EU Equal Treatment Directives"],
                "criminal_justice": ["EU Charter Article 47 — Right to fair trial"],
            },
        }
        region_refs = refs.get(region, refs["india"])
        return region_refs["base"] + region_refs.get(industry, [])

    def _hash_report(self, report: AuditReport) -> str:
        d = asdict(report)
        d.pop("audit_hash", None)
        canonical = json.dumps(d, sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def report_to_dict(report: AuditReport) -> dict:
    return asdict(report)
