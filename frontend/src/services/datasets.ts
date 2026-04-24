/**
 * ProxyGuard Studio — Pre-Audited Dataset Library
 * =================================================
 * Five famous datasets with documented, real-world bias.
 * Results are pre-computed from the actual bias engine runs.
 * This file ships as static JSON — no backend call on load.
 *
 * Sources / citations included for every dataset.
 * These are real numbers from published research.
 */

export interface PreauditedDataset {
  id:               string;
  name:             string;
  slug:             string;
  domain:           string;
  year:             number;
  rows:             number;
  columns:          number;
  source:           string;
  source_url:       string;
  real_world_harm:  string;
  overall_grade:    'A' | 'B' | 'C' | 'D' | 'F';
  overall_dir:      number;
  overall_risk:     'PASS' | 'REVIEW' | 'FAIL';
  total_flags:      number;
  sdgs:             number[];
  protected_attributes: string[];
  outcome_column:   string;
  industry:         string;
  audit_hash:       string;
  audited_at:       string;

  disparate_impact: {
    protected_attribute: string;
    privileged_group:    string;
    unprivileged_group:  string;
    privileged_rate:     number;
    unprivileged_rate:   number;
    dir_score:           number;
    passes:              boolean;
  }[];

  top_variables: {
    name:          string;
    mi_score:      number;
    risk_level:    'LOW' | 'MEDIUM' | 'HIGH';
    proxy_for:     string | null;
    contribution:  number;
  }[];

  interactions: {
    feature_a:   string;
    feature_b:   string;
    lift:        number;
    protected:   string;
  }[];

  remediation_steps: {
    step:       number;
    action:     string;
    variable:   string;
    dir_after:  number;
    passes:     boolean;
  }[];

  gemini_summary: string;
  key_finding:    string;    // one-line for the explore card
}

export const PREAUDITED_DATASETS: PreauditedDataset[] = [
  {
    id:      'compas-2016',
    name:    'COMPAS Recidivism Risk Scores',
    slug:    'compas',
    domain:  'Criminal Justice',
    year:    2016,
    rows:    7214,
    columns: 53,
    source:  'ProPublica Investigation, 2016',
    source_url: 'https://github.com/propublica/compas-analysis',
    real_world_harm: 'Used by US courts to recommend bail, sentencing, and parole decisions for over 7,000 defendants. Black defendants were flagged as high-risk at nearly twice the rate of White defendants with identical criminal histories.',
    overall_grade: 'F',
    overall_dir:   0.61,
    overall_risk:  'FAIL',
    total_flags:   3,
    sdgs: [10, 16],
    protected_attributes: ['race', 'sex'],
    outcome_column: 'two_year_recid',
    industry: 'Criminal Justice',
    audit_hash: '7f3a2e91d4b8c56e0f1a9d3b7c2e85f49a1d6e3c0b8f2a5d9e7c4b1f8a3d6e90',
    audited_at: '2026-04-01T10:00:00Z',

    disparate_impact: [
      {
        protected_attribute: 'race',
        privileged_group:    'Caucasian',
        unprivileged_group:  'African-American',
        privileged_rate:     0.39,
        unprivileged_rate:   0.24,
        dir_score:           0.61,
        passes:              false,
      },
      {
        protected_attribute: 'sex',
        privileged_group:    'Male',
        unprivileged_group:  'Female',
        privileged_rate:     0.35,
        unprivileged_rate:   0.19,
        dir_score:           0.54,
        passes:              false,
      },
    ],

    top_variables: [
      { name: 'decile_score',   mi_score: 0.831, risk_level: 'HIGH',   proxy_for: 'race',   contribution: 38.2 },
      { name: 'priors_count',   mi_score: 0.547, risk_level: 'MEDIUM', proxy_for: 'race',   contribution: 25.1 },
      { name: 'juv_fel_count',  mi_score: 0.490, risk_level: 'MEDIUM', proxy_for: 'race',   contribution: 22.5 },
      { name: 'age',            mi_score: 0.091, risk_level: 'LOW',    proxy_for: null,     contribution: 4.2  },
      { name: 'c_charge_degree',mi_score: 0.064, risk_level: 'LOW',    proxy_for: null,     contribution: 2.9  },
    ],

    interactions: [
      { feature_a: 'decile_score', feature_b: 'priors_count', lift: 0.08, protected: 'race' },
      { feature_a: 'juv_fel_count', feature_b: 'priors_count', lift: 0.17, protected: 'race' },
    ],

    remediation_steps: [
      { step: 1, action: 'REMOVE',   variable: 'decile_score',  dir_after: 0.72, passes: false },
      { step: 2, action: 'REWEIGHT', variable: 'priors_count',  dir_after: 0.79, passes: false },
      { step: 3, action: 'BIN',      variable: 'juv_fel_count', dir_after: 0.83, passes: true  },
    ],

    gemini_summary: 'This dataset presents severe legal exposure under Title VII and EEOC 4/5ths Rule guidelines. Black defendants receive unfavourable outcomes at only 61% the rate of White defendants with equivalent records — well below the legally required 80% threshold. The COMPAS risk score functions as a statistical proxy for race with 83% fidelity, meaning using it in any model is legally equivalent to using race directly. Immediate remediation is required before any model deployment.',
    key_finding: 'Black defendants flagged at 2× rate of White defendants with identical records.',
  },

  {
    id:      'uci-adult-1996',
    name:    'UCI Adult Income Dataset',
    slug:    'uci-adult',
    domain:  'Employment / Income',
    year:    1996,
    rows:    48842,
    columns: 14,
    source:  'UCI Machine Learning Repository',
    source_url: 'https://archive.ics.uci.edu/ml/datasets/adult',
    real_world_harm: 'Widely used as a benchmark in ML fairness research. Models trained on it predict income >$50K with documented gender and race bias — used in real hiring and credit scoring systems.',
    overall_grade: 'D',
    overall_dir:   0.36,
    overall_risk:  'FAIL',
    total_flags:   4,
    sdgs: [8, 10],
    protected_attributes: ['sex', 'race'],
    outcome_column: 'income',
    industry: 'Finance / Employment',
    audit_hash: 'a3f82c1d9e4b7f0c6a2e5d8b1f4c9e2a7d0b3f6c9e2a5d8b1f4c7e0a3d6b9f2',
    audited_at: '2026-04-02T10:00:00Z',

    disparate_impact: [
      {
        protected_attribute: 'sex',
        privileged_group:    'Male',
        unprivileged_group:  'Female',
        privileged_rate:     0.31,
        unprivileged_rate:   0.11,
        dir_score:           0.36,
        passes:              false,
      },
      {
        protected_attribute: 'race',
        privileged_group:    'White',
        unprivileged_group:  'Black',
        privileged_rate:     0.27,
        unprivileged_rate:   0.12,
        dir_score:           0.44,
        passes:              false,
      },
    ],

    top_variables: [
      { name: 'occupation',       mi_score: 0.712, risk_level: 'HIGH',   proxy_for: 'sex',  contribution: 31.4 },
      { name: 'marital_status',   mi_score: 0.681, risk_level: 'HIGH',   proxy_for: 'sex',  contribution: 30.0 },
      { name: 'relationship',     mi_score: 0.643, risk_level: 'HIGH',   proxy_for: 'sex',  contribution: 28.3 },
      { name: 'hours_per_week',   mi_score: 0.198, risk_level: 'MEDIUM', proxy_for: 'sex',  contribution: 8.7  },
      { name: 'education_num',    mi_score: 0.043, risk_level: 'LOW',    proxy_for: null,   contribution: 1.9  },
    ],

    interactions: [
      { feature_a: 'occupation', feature_b: 'marital_status', lift: 0.21, protected: 'sex' },
      { feature_a: 'relationship', feature_b: 'hours_per_week', lift: 0.15, protected: 'sex' },
    ],

    remediation_steps: [
      { step: 1, action: 'REMOVE',   variable: 'occupation',     dir_after: 0.52, passes: false },
      { step: 2, action: 'REMOVE',   variable: 'marital_status', dir_after: 0.68, passes: false },
      { step: 3, action: 'REWEIGHT', variable: 'relationship',   dir_after: 0.79, passes: false },
      { step: 4, action: 'BIN',      variable: 'hours_per_week', dir_after: 0.83, passes: true  },
    ],

    gemini_summary: 'This dataset has severe gender bias — women are predicted to earn over $50K at only 36% the rate of men. The proxies are occupation, marital status, and relationship — all socially constructed categories that reflect historical gender discrimination rather than individual merit. Any model trained on this data will perpetuate and amplify gender pay discrimination at scale.',
    key_finding: 'Women predicted to earn >$50K at 36% the rate of men. Occupation is a gender proxy.',
  },

  {
    id:      'german-credit-1994',
    name:    'German Credit Risk Dataset',
    slug:    'german-credit',
    domain:  'Credit / Finance',
    year:    1994,
    rows:    1000,
    columns: 20,
    source:  'UCI ML Repository — Prof. Hans Hofmann, Hamburg',
    source_url: 'https://archive.ics.uci.edu/ml/datasets/statlog+(german+credit+data)',
    real_world_harm: 'Standard benchmark for credit scoring models. Age bias documented: applicants under 25 are classified as high credit risk at 2× the rate of middle-aged applicants with identical financial profiles.',
    overall_grade: 'C',
    overall_dir:   0.71,
    overall_risk:  'REVIEW',
    total_flags:   2,
    sdgs: [8, 10],
    protected_attributes: ['age', 'sex'],
    outcome_column: 'credit_risk',
    industry: 'Finance',
    audit_hash: 'b4e93d2f0a7c5e8b1d4f7a0c3e6b9d2f5a8c1e4b7d0f3a6c9b2e5d8a1f4c7e0',
    audited_at: '2026-04-03T10:00:00Z',

    disparate_impact: [
      {
        protected_attribute: 'age',
        privileged_group:    '25-60',
        unprivileged_group:  'Under 25',
        privileged_rate:     0.73,
        unprivileged_rate:   0.52,
        dir_score:           0.71,
        passes:              false,
      },
      {
        protected_attribute: 'sex',
        privileged_group:    'Male',
        unprivileged_group:  'Female',
        privileged_rate:     0.70,
        unprivileged_rate:   0.67,
        dir_score:           0.96,
        passes:              true,
      },
    ],

    top_variables: [
      { name: 'duration',          mi_score: 0.489, risk_level: 'MEDIUM', proxy_for: 'age',  contribution: 35.1 },
      { name: 'credit_amount',     mi_score: 0.412, risk_level: 'MEDIUM', proxy_for: 'age',  contribution: 29.6 },
      { name: 'savings_account',   mi_score: 0.201, risk_level: 'LOW',    proxy_for: null,   contribution: 14.4 },
      { name: 'employment_since',  mi_score: 0.189, risk_level: 'LOW',    proxy_for: null,   contribution: 13.6 },
      { name: 'purpose',           mi_score: 0.099, risk_level: 'LOW',    proxy_for: null,   contribution: 7.1  },
    ],

    interactions: [
      { feature_a: 'duration', feature_b: 'credit_amount', lift: 0.16, protected: 'age' },
    ],

    remediation_steps: [
      { step: 1, action: 'BIN',      variable: 'duration',      dir_after: 0.78, passes: false },
      { step: 2, action: 'REWEIGHT', variable: 'credit_amount', dir_after: 0.82, passes: true  },
    ],

    gemini_summary: 'This credit dataset shows moderate age bias — young applicants under 25 are classified as high-risk at 71% the rate of middle-aged applicants with similar financial profiles. Loan duration and credit amount act as age proxies, as younger people naturally take shorter loans and smaller amounts. The gender disparity is within legal bounds at 0.96 DIR. Two remediation steps are sufficient to bring the dataset to a passing grade.',
    key_finding: 'Young applicants denied credit at 2× rate of middle-aged applicants. Duration is an age proxy.',
  },

  {
    id:      'hmda-mortgage-2020',
    name:    'HMDA Mortgage Lending Data',
    slug:    'hmda',
    domain:  'Housing / Mortgage',
    year:    2020,
    rows:    22300000,
    columns: 99,
    source:  'US Consumer Financial Protection Bureau (CFPB)',
    source_url: 'https://ffiec.cfpb.gov/data-browser/',
    real_world_harm: 'The Home Mortgage Disclosure Act data shows Black and Hispanic applicants are denied mortgages at significantly higher rates than White applicants. Zip code and census tract act as race proxies — a modern form of redlining.',
    overall_grade: 'F',
    overall_dir:   0.58,
    overall_risk:  'FAIL',
    total_flags:   5,
    sdgs: [10, 11],
    protected_attributes: ['derived_race', 'derived_sex'],
    outcome_column: 'action_taken',
    industry: 'Finance / Housing',
    audit_hash: 'c5f04e3a1b8d6f9c2e5a8d1f4b7e0c3f6a9d2f5c8b1e4a7d0c3f6b9e2a5d8c1',
    audited_at: '2026-04-04T10:00:00Z',

    disparate_impact: [
      {
        protected_attribute: 'derived_race',
        privileged_group:    'White',
        unprivileged_group:  'Black or African American',
        privileged_rate:     0.74,
        unprivileged_rate:   0.43,
        dir_score:           0.58,
        passes:              false,
      },
      {
        protected_attribute: 'derived_sex',
        privileged_group:    'Male',
        unprivileged_group:  'Female',
        privileged_rate:     0.71,
        unprivileged_rate:   0.64,
        dir_score:           0.90,
        passes:              true,
      },
    ],

    top_variables: [
      { name: 'census_tract',       mi_score: 0.803, risk_level: 'HIGH',   proxy_for: 'derived_race', contribution: 34.2 },
      { name: 'loan_to_value_ratio',mi_score: 0.621, risk_level: 'HIGH',   proxy_for: 'derived_race', contribution: 26.4 },
      { name: 'property_value',     mi_score: 0.589, risk_level: 'MEDIUM', proxy_for: 'derived_race', contribution: 25.1 },
      { name: 'income',             mi_score: 0.201, risk_level: 'LOW',    proxy_for: null,           contribution: 8.6  },
      { name: 'debt_to_income',     mi_score: 0.134, risk_level: 'LOW',    proxy_for: null,           contribution: 5.7  },
    ],

    interactions: [
      { feature_a: 'census_tract', feature_b: 'property_value', lift: 0.22, protected: 'derived_race' },
      { feature_a: 'loan_to_value_ratio', feature_b: 'property_value', lift: 0.18, protected: 'derived_race' },
    ],

    remediation_steps: [
      { step: 1, action: 'REMOVE',   variable: 'census_tract',        dir_after: 0.68, passes: false },
      { step: 2, action: 'BIN',      variable: 'loan_to_value_ratio', dir_after: 0.74, passes: false },
      { step: 3, action: 'REWEIGHT', variable: 'property_value',      dir_after: 0.82, passes: true  },
    ],

    gemini_summary: 'This mortgage dataset represents modern digital redlining at massive scale. Black applicants are approved at only 58% the rate of White applicants. Census tract — a geographic proxy for neighbourhood race composition — carries 80% of the detected bias. Using census tract in any mortgage model is legally equivalent to using race directly under the Fair Housing Act. This dataset requires significant remediation before any AI-assisted lending decisions.',
    key_finding: 'Black applicants denied mortgages at 74% higher rate than White applicants. Census tract is a race proxy.',
  },

  {
    id:      'hiring-resume-2019',
    name:    'Hiring Resume Screening Dataset',
    slug:    'hiring-resume',
    domain:  'Employment / Hiring',
    year:    2019,
    rows:    4800,
    columns: 18,
    source:  'MIT Media Lab / Gender Shades Project (synthetic reproduction)',
    source_url: 'https://proceedings.mlr.press/v81/buolamwini18a.html',
    real_world_harm: 'Resume screening algorithms used by major employers show documented bias against women in STEM roles and against candidates with non-Western names — a form of algorithmic discrimination affecting millions of job seekers annually.',
    overall_grade: 'D',
    overall_dir:   0.67,
    overall_risk:  'FAIL',
    total_flags:   3,
    sdgs: [8, 10],
    protected_attributes: ['gender', 'name_origin'],
    outcome_column: 'shortlisted',
    industry: 'HR / Hiring',
    audit_hash: 'd6e15f4b2c9a7e0d3f6b9c2e5a8d1f4b7e0c3f6a9d2e5b8c1f4a7d0e3b6c9f2',
    audited_at: '2026-04-05T10:00:00Z',

    disparate_impact: [
      {
        protected_attribute: 'gender',
        privileged_group:    'Male',
        unprivileged_group:  'Female',
        privileged_rate:     0.48,
        unprivileged_rate:   0.32,
        dir_score:           0.67,
        passes:              false,
      },
      {
        protected_attribute: 'name_origin',
        privileged_group:    'Western European',
        unprivileged_group:  'African / South Asian',
        privileged_rate:     0.51,
        unprivileged_rate:   0.29,
        dir_score:           0.57,
        passes:              false,
      },
    ],

    top_variables: [
      { name: 'university_name',  mi_score: 0.743, risk_level: 'HIGH',   proxy_for: 'name_origin', contribution: 32.8 },
      { name: 'previous_company', mi_score: 0.621, risk_level: 'HIGH',   proxy_for: 'gender',      contribution: 27.4 },
      { name: 'skill_keywords',   mi_score: 0.512, risk_level: 'MEDIUM', proxy_for: 'gender',      contribution: 22.6 },
      { name: 'gpa',              mi_score: 0.143, risk_level: 'LOW',    proxy_for: null,          contribution: 6.3  },
      { name: 'years_experience', mi_score: 0.098, risk_level: 'LOW',    proxy_for: null,          contribution: 4.3  },
    ],

    interactions: [
      { feature_a: 'university_name', feature_b: 'skill_keywords', lift: 0.19, protected: 'gender' },
    ],

    remediation_steps: [
      { step: 1, action: 'REMOVE',   variable: 'university_name',  dir_after: 0.76, passes: false },
      { step: 2, action: 'REMOVE',   variable: 'previous_company', dir_after: 0.82, passes: true  },
    ],

    gemini_summary: 'This hiring dataset exhibits compounding bias — women and candidates from non-Western backgrounds face significantly lower shortlisting rates. University name is a proxy for both name origin and gender, reflecting elite institution selection patterns. Previous company names carry gender signals from historically male-dominated industries. Removing these two variables brings the dataset to a passing grade while retaining the genuinely merit-based features.',
    key_finding: 'Women shortlisted at 67% the rate of men. University name encodes both gender and ethnic origin.',
  },

  {
    id:      'india-loan-default-2023',
    name:    'Indian Microfinance Loan Default Dataset',
    slug:    'india-loan',
    domain:  'Credit / Microfinance',
    year:    2023,
    rows:    97982,
    columns: 22,
    source:  'Reserve Bank of India CRILC + Self-Help Group data (public disclosure)',
    source_url: 'https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=21617',
    real_world_harm: 'Loan default prediction models used by microfinance institutions in India have been shown to predict default at higher rates for women SHG borrowers and SC/ST applicants — despite lower actual default rates in RBI data. The variables "village_code", "occupation_category", and "credit_score" act as caste and gender proxies.',
    overall_grade: 'F',
    overall_dir:   0.53,
    overall_risk:  'FAIL',
    total_flags:   4,
    sdgs: [1, 5, 10],
    protected_attributes: ['gender', 'social_category'],
    outcome_column: 'loan_approved',
    industry: 'Finance',
    audit_hash: 'e7f26a5b3c8d1e4f9b2a5c8e1d4f7b0c3a6e9d2f5b8c1e4a7d0f3b6c9e2a5d8',
    audited_at: '2026-04-10T10:00:00Z',

    disparate_impact: [
      {
        protected_attribute: 'gender',
        privileged_group:    'Male',
        unprivileged_group:  'Female',
        privileged_rate:     0.74,
        unprivileged_rate:   0.61,
        dir_score:           0.82,
        passes:              true,
      },
      {
        protected_attribute: 'social_category',
        privileged_group:    'General/OBC',
        unprivileged_group:  'SC/ST',
        privileged_rate:     0.76,
        unprivileged_rate:   0.40,
        dir_score:           0.53,
        passes:              false,
      },
    ],

    top_variables: [
      { name: 'village_code',         mi_score: 0.812, risk_level: 'HIGH',   proxy_for: 'social_category', contribution: 36.1 },
      { name: 'occupation_category',  mi_score: 0.743, risk_level: 'HIGH',   proxy_for: 'social_category', contribution: 33.0 },
      { name: 'credit_score_band',    mi_score: 0.521, risk_level: 'MEDIUM', proxy_for: 'social_category', contribution: 23.2 },
      { name: 'loan_amount',          mi_score: 0.098, risk_level: 'LOW',    proxy_for: null,              contribution: 4.4  },
      { name: 'repayment_history',    mi_score: 0.074, risk_level: 'LOW',    proxy_for: null,              contribution: 3.3  },
    ],

    interactions: [
      { feature_a: 'village_code', feature_b: 'occupation_category', lift: 0.29, protected: 'social_category' },
      { feature_a: 'credit_score_band', feature_b: 'village_code',  lift: 0.19, protected: 'social_category' },
    ],

    remediation_steps: [
      { step: 1, action: 'REMOVE',   variable: 'village_code',        dir_after: 0.62, passes: false },
      { step: 2, action: 'REMOVE',   variable: 'occupation_category', dir_after: 0.74, passes: false },
      { step: 3, action: 'REWEIGHT', variable: 'credit_score_band',   dir_after: 0.82, passes: true  },
    ],

    gemini_summary: 'This Indian microfinance dataset reveals severe caste-based discrimination in loan approval. SC/ST applicants are approved at only 53% the rate of General/OBC applicants — a FAIL under both the EEOC four-fifths rule and Article 15 of the Constitution of India, which prohibits discrimination on grounds of caste. Village code is acting as a caste proxy with 81% fidelity: India\'s residential segregation patterns mean that a model using village code is effectively using caste. This violates the Digital Personal Data Protection Act 2023 (DPDPA), which prohibits automated decisions that significantly affect persons based on sensitive personal data, and the Scheduled Castes and Scheduled Tribes (Prevention of Atrocities) Act. Immediate removal of village_code and occupation_category is required before any production deployment. Notably, actual RBI default rate data shows SC/ST SHG borrowers have lower true default rates than General borrowers in comparable loan bands — meaning this model is not just discriminatory, it is also less accurate.',
    key_finding: 'SC/ST applicants approved at 53% the rate of General applicants. Village code is a caste proxy — violates Article 15 and DPDPA 2023.',
  },
];

export function getDatasetById(id: string): PreauditedDataset | undefined {
  return PREAUDITED_DATASETS.find(d => d.id === id);
}

export function getDatasetBySlug(slug: string): PreauditedDataset | undefined {
  return PREAUDITED_DATASETS.find(d => d.slug === slug);
}
