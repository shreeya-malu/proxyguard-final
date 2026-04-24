import { getIdToken } from 'firebase/auth';
import { auth } from './firebase';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1';

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await getIdToken(user, false);
    return { Authorization: `Bearer ${token}` };
  } catch { return {}; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VariableRisk {
  name: string;
  mi_score: number;
  cramers_v: number;
  proxy_score: number;
  proxy_method: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  is_proxy: boolean;
  proxy_for: string | null;
  recommendation: string;
  bias_contribution_pct: number;
  remediation: RemediationAction[];
  is_caste_proxy_candidate: boolean;
}

export interface RemediationAction {
  action: string;
  confidence: number;
  expected_dir_improvement: string;
  reason: string;
}

export interface GroupOutcomeResult {
  protected_attribute: string;
  outcome_column: string;
  privileged_group: string;
  unprivileged_group: string;
  privileged_rate: number;
  unprivileged_rate: number;
  dir_score: number;
  dir_status: string;
  spd_score: number;
  spd_status: string;
  tpr_privileged: number | null;
  tpr_unprivileged: number | null;
  fpr_privileged: number | null;
  fpr_unprivileged: number | null;
  eod_score: number | null;
  eod_status: string | null;
  eqod_score: number | null;
  eqod_status: string | null;
  fprp_score: number | null;
  fprp_status: string | null;
  pred_parity_priv: number | null;
  pred_parity_unpriv: number | null;
  pred_parity_diff: number | null;
  pred_parity_status: string | null;
  industry_metric: string;
  legal_basis: string;
}

export interface MetricResult {
  name: string;
  value: number;
  threshold: number;
  direction: string;
  status: 'PASS' | 'FAIL' | 'REVIEW' | 'SKIPPED' | 'PASS_BOUNDED' | 'FAIL_BOUNDED' | 'INDETERMINATE';
  requires_gt: boolean;
  legal_basis: string;
  plain_english: string;
  note: string;
  assumption_score?: number;
  overall_verdict?: string;
}

export type BoundedVerdict = 'PASS_BOUNDED' | 'FAIL_BOUNDED' | 'INDETERMINATE';
export type OverallVerdict = 'ROBUST_PASS' | 'ROBUST_FAIL' | 'ASSUMPTION_SENSITIVE';

export interface AssumptionLevel {
  name: string;
  label: string;
  assumption_text: string;
  citation: string;
  eod_lower: number;
  eod_upper: number;
  fprp_lower: number;
  fprp_upper: number;
  eod_verdict: BoundedVerdict;
  fprp_verdict: BoundedVerdict;
}

export interface BoundedMetricResult {
  metric_name: string;
  threshold: number;
  levels: AssumptionLevel[];
  assumption_score: number;
  overall_verdict: OverallVerdict;
  plain_english: string;
}

export interface SensitivityReport {
  protected_attribute: string;
  privileged_group: string;
  unprivileged_group: string;
  r_p: number;
  r_u: number;
  metric_results: BoundedMetricResult[];
  overall_assumption_score: number;
  recommendation: string;
  methodology_note: string;
}

export interface ImpossibilityConflict {
  metric_a: string;
  metric_b: string;
  metric_a_status: string;
  metric_b_status: string;
  explanation: string;
  real_world_meaning: string;
  pattern_name: string;
}

export interface FeatureInteraction {
  feature_a: string;
  feature_b: string;
  individual_mi_a: number;
  individual_mi_b: number;
  interaction_mi: number;
  lift: number;
  protected_attr: string;
  risk_level: string;
  explanation: string;
}

export interface DLPFinding {
  info_type: string;
  column: string;
  likelihood: string;
  action: string;
  plain_text: string;
}

export interface DLPResult {
  pii_detected: boolean;
  columns_flagged: string[];
  scan_method: string;
  recommendation: string;
  findings: DLPFinding[];
}

export interface LegalRef {
  law: string;
  provision: string;
  relevance: string;
  action_required: string;
}

export interface GeminiOutput {
  cro_summary: string;
  legal_context: LegalRef[];
  impossibility_note: string | null;
  generated_by: string;
  disclaimer: string;
}

export interface AuditReport {
  dataset_name: string;
  row_count: number;
  column_count: number;
  region: string;
  industry_context: string;
  primary_fairness_metric: string;
  protected_attributes: string[];
  outcome_column: string;
  ground_truth_column: string | null;
  ground_truth_available: boolean;
  group_outcomes: GroupOutcomeResult[];
  variable_risks: VariableRisk[];
  proxy_chains: any[];
  feature_interactions: FeatureInteraction[];
  metric_results: MetricResult[];
  impossibility_conflicts: ImpossibilityConflict[];
  has_conflict: boolean;
  overall_risk_level: 'PASS' | 'REVIEW' | 'FAIL';
  overall_dir_score: number;
  overall_grade: string;
  composite_score: number;
  total_flags: number;
  metrics_computed: number;
  metrics_skipped: number;
  top_bias_contributors: any[];
  remediation_plan: any[];
  legal_references: string[];
  caste_proxy_candidates: string[];
  audit_hash: string;
}

export interface AuditResponse {
  audit_id: string;
  created_at: string;
  report: AuditReport;
  sensitivity_reports: SensitivityReport[];
  dlp_result: DLPResult;
  gemini: GeminiOutput;
}

export interface Certificate {
  certificate_id: string;
  audit_id: string;
  dataset_name: string;
  industry_context: string;
  region: string;
  overall_result: string;
  overall_grade: string;
  overall_dir: number;
  total_flags: number;
  metrics_computed: number;
  has_impossibility: boolean;
  ground_truth_used: boolean;
  audit_hash: string;
  hash_verified: boolean;
  signature: string;
  kms_key_id: string;
  signing_method: string;
  issued_at: string;
  signed_by: string;
  legal_references: string[];
  summary: string;
  sensitivity_computed: boolean;
  verify_url: string;
}

export interface RegistryRecord {
  audit_id: string;
  certificate_id: string;
  dataset_name: string;
  industry: string;
  region: string;
  overall_grade: string;
  overall_dir: number;
  overall_result: string;
  total_flags: number;
  metrics_computed: number;
  row_count: number;
  protected_attributes: string[];
  sdgs: number[];
  hash_verified: boolean;
  kms_key_id: string;
  published_by: string;
  published_at: string;
  audit_hash: string;
  has_impossibility: boolean;
  sensitivity_computed: boolean;
}

export interface AuditConfig {
  file: File;
  protectedAttributes: string;
  outcomeColumn: string;
  industry: string;
  region: string;
  groundTruthColumn?: string;
  orgName?: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function runAudit(config: AuditConfig): Promise<AuditResponse> {
  const form = new FormData();
  form.append('file', config.file);
  form.append('protected_attributes', config.protectedAttributes);
  form.append('outcome_column', config.outcomeColumn);
  form.append('industry', config.industry);
  form.append('region', config.region);
  if (config.groundTruthColumn) form.append('ground_truth_column', config.groundTruthColumn);
  if (config.orgName) form.append('org_name', config.orgName);

  const res = await fetch(`${BASE_URL}/audit/run`, {
    method: 'POST', headers: await authHeaders(), body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `Audit failed: ${res.status}`);
  }
  return res.json();
}

export async function generateCertificate(auditId: string): Promise<{ certificate: Certificate }> {
  const res = await fetch(`${BASE_URL}/certificate/generate/${auditId}`, {
    method: 'POST', headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Certificate generation failed');
  return res.json();
}

export async function publishToRegistry(auditId: string, orgName?: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/registry/publish`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ audit_id: auditId, make_public: true, org_name: orgName }),
  });
  if (!res.ok) throw new Error('Registry publish failed');
  return res.json();
}

export async function getRegistry(limit = 20): Promise<{ audits: RegistryRecord[] }> {
  const res = await fetch(`${BASE_URL}/registry?limit=${limit}`);
  if (!res.ok) throw new Error('Registry fetch failed');
  return res.json();
}

export async function verifyAudit(auditId: string): Promise<{ verified: boolean; record: RegistryRecord }> {
  const res = await fetch(`${BASE_URL}/registry/verify/${auditId}`);
  if (!res.ok) throw new Error('Verification failed');
  return res.json();
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    return res.ok;
  } catch { return false; }
}
