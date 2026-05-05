# ProxyGuard Studio

**Multi-checkpoint deterministic AI fairness auditing engine — v3.0.0**

ProxyGuard Studio is a full-stack platform for auditing machine learning datasets and model outputs for bias and discrimination. It computes seven mathematically independent fairness metrics, maps results to regional legal frameworks (India, US, EU), scans for PII using Google Cloud DLP, generates tamper-proof audit certificates signed via Cloud KMS, and explains every finding in plain English using Gemini 2.5 Flash-Lite.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup](#frontend-setup)
- [Environment Variables](#environment-variables)
- [Fairness Metrics](#fairness-metrics)
- [Deployment](#deployment)
- [API Reference](#api-reference)

---

## Features

### Core Audit Engine
- **Seven fairness metrics** computed across five tiers: Disparate Impact Ratio (DIR), Statistical Parity Difference (SPD), Equal Opportunity Difference (EOD), Equalised Odds Difference (EQOD), False Positive Rate Parity (FPRP), Predictive Parity Difference, and Proxy Detection via Mutual Information / Cramér's V.
- **Fully deterministic** — same dataset always produces the same hash and results. No neural networks auditing neural networks.
- **Impossibility flag** — surfaces metric conflicts explicitly (e.g. the COMPAS pattern: calibrated but structurally discriminatory) rather than hiding them in a composite score.
- **Sensitivity analysis** — when ground truth labels are absent, assumption-based scores fill in skipped metrics to produce a bounded composite grade.

### Legal Context
- Region-aware thresholds and citations for **India** (Constitution Articles 14/15, DPDPA 2023, RPwD Act), **US** (EEOC 4/5ths Rule, Fair Housing Act, Equal Credit Opportunity Act), and **EU** (GDPR Article 22, EU AI Act).
- Every metric result links to the specific legal provision that sets its threshold.
- Legal output carries an explicit disclaimer that it is informational, not legal advice.

### PII / DLP Scanning
- Uploads are scanned for sensitive data before auditing using **Google Cloud DLP** (falls back to deterministic regex heuristics if GCP credentials are absent).
- Detects Aadhaar numbers, PAN cards, phone numbers, email addresses, financial identifiers, and more.
- Flags columns and recommends actions (REMOVE / PSEUDONYMIZE / REVIEW) without blocking the audit.

### Audit Certificates
- Tamper-proof certificates signed via **Google Cloud KMS** (RSA-PKCS1-2048-SHA256).
- SHA-256 hash integrity is verified at certificate generation time.
- Falls back to local HMAC in development.
- Certificates are downloadable as PDF.

### AI Narrative Layer (Gemini)
- **Plain-English summary** for non-technical stakeholders (CRO/board level).
- **Human story panel** — translates statistical findings into real-world impact narratives.
- **Legal context narrative** generated via Gemini function calling.
- Fully deterministic fallback templates when the Gemini API is unavailable.

### Additional Pages
| Page | Description |
|---|---|
| **Explore** | Browse pre-audited public datasets with interactive metric breakdowns |
| **Simulate** | Explore what-if scenarios: adjust thresholds and see how DIR scores change |
| **Registry** | Public ledger of all published audit certificates with hash verification |
| **Demo Mode** | Full walkthrough without uploading any data |

---

## Architecture

```
┌─────────────────────────────────┐      ┌──────────────────────────────────┐
│         React Frontend          │      │        FastAPI Backend            │
│  (Vite + TypeScript + Firebase) │◄────►│  (Python 3.11, Uvicorn, Cloud Run)│
└─────────────────────────────────┘      └──────────────────────────────────┘
                                                        │
                    ┌───────────────────────────────────┼───────────────────────────┐
                    │                                   │                           │
          ┌─────────▼──────────┐            ┌──────────▼──────────┐    ┌──────────▼──────────┐
          │  Google Cloud DLP  │            │   Google Cloud KMS  │    │  Gemini 2.5 Flash   │
          │   (PII scanning)   │            │  (cert signing)     │    │  (narrative layer)  │
          └────────────────────┘            └─────────────────────┘    └─────────────────────┘
```

The backend is stateless by default (in-memory store). Firestore can be substituted for production persistence.

---

## Tech Stack

**Backend**
- Python 3.11, FastAPI 0.111, Uvicorn
- pandas, NumPy, scikit-learn, SciPy
- Google Cloud DLP, Cloud KMS, Firebase Admin SDK
- Gemini 2.5 Flash-Lite (via REST)

**Frontend**
- React 18, TypeScript 5, Vite
- Firebase (Auth + Hosting)
- jsPDF + jspdf-autotable (certificate PDF export)

**Infrastructure**
- Google Cloud Run (backend)
- Firebase Hosting (frontend)
- Cloud KMS (certificate signing)

---

## Project Structure

```
proxyguard-final-main/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── audit.py              # POST /api/v1/audit/run — main audit pipeline
│   │   │   ├── certificate.py        # POST /api/v1/certificate/generate/{id}
│   │   │   ├── narrative_endpoint.py # Gemini narrative generation
│   │   │   ├── registry.py           # Public audit registry
│   │   │   └── health.py
│   │   ├── core/
│   │   │   ├── bias_engine.py        # Deterministic fairness metric engine
│   │   │   ├── sensitivity.py        # Sensitivity analysis (no ground truth)
│   │   │   ├── legal_context.py      # Region-aware legal thresholds & citations
│   │   │   └── auth.py               # Firebase token verification
│   │   ├── services/
│   │   │   ├── dlp.py                # Google Cloud DLP + heuristic fallback
│   │   │   ├── gemini.py             # Gemini API integration
│   │   │   ├── narrative_service.py  # Human story panel generation
│   │   │   └── registry.py           # Registry persistence helpers
│   │   └── main.py                   # FastAPI app, CORS, router registration
│   ├── Dockerfile
│   ├── cloudrun.yaml
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── audit/                # AuditPage, CertificatePage, HumanStoryPanel, PlainEnglishPanel
│   │   │   ├── auth/                 # LoginPage
│   │   │   ├── explore/              # ExplorePage
│   │   │   ├── registry/             # RegistryPage
│   │   │   ├── simulate/             # SimulatePage
│   │   │   └── upload/               # UploadPage, DemoMode
│   │   ├── services/
│   │   │   ├── api.ts                # Backend API client
│   │   │   ├── AuthContext.tsx        # Firebase auth context
│   │   │   ├── datasets.ts           # Pre-audited demo datasets
│   │   │   ├── firebase.ts
│   │   │   └── pdfGenerator.ts       # Certificate PDF export
│   │   ├── styles/globals.css
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
├── deploy.bat                        # One-command GCP deployment script
└── config.md
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- A Firebase project (for Auth and Hosting)
- A Google Cloud project (for DLP, KMS — optional for local dev)
- A Gemini API key (optional — deterministic fallback is used without it)

### Backend Setup

```bash
cd backend

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create a .env file (see Environment Variables section)
cp .env.example .env

# Start the development server
uvicorn app.main:app --reload --port 8080
```

The API will be available at `http://localhost:8080`. Interactive docs at `http://localhost:8080/docs`.

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```

The frontend will be available at `http://localhost:5173`.

Before starting, update the CORS allowed origins in `backend/app/main.py` if your ports differ, and configure the Firebase project in `frontend/src/services/firebase.ts`.

---

## Environment Variables

Create a `.env` file in the `backend/` directory:

```env
# Gemini (optional — fallback templates used if absent)
GEMINI_API_KEY=your_gemini_api_key

# Google Cloud (optional for local dev — heuristic DLP fallback used if absent)
GCP_PROJECT_ID=your_gcp_project_id
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}

# Cloud KMS (optional — local HMAC used for dev)
KMS_LOCATION=global
KMS_KEYRING=audit-ring
KMS_KEY=cert-signing
KMS_HMAC_SECRET=any_local_dev_secret

# Firebase Admin (optional — auth checks disabled locally)
FIREBASE_PROJECT_ID=your_firebase_project_id
```

---

## Fairness Metrics

| Tier | Metric | Requires Ground Truth | Threshold |
|---|---|---|---|
| 1 | Disparate Impact Ratio (DIR) | No | ≥ 0.80 (EEOC 4/5ths Rule) |
| 1 | Statistical Parity Difference (SPD) | No | \|SPD\| ≤ 0.05 |
| 2 | Equal Opportunity Difference (EOD) | Yes | \|EOD\| ≤ 0.10 |
| 2 | Equalised Odds Difference (EQOD) | Yes | \|EQOD\| ≤ 0.10 |
| 2 | False Positive Rate Parity (FPRP) | Yes | \|FPRP\| ≤ 0.10 |
| 3 | Proxy Detection (MI / Cramér's V) | No | MI < 0.70, V < 0.50 |
| 4 | Predictive Parity Difference | Yes | \|diff\| ≤ 0.05 |

Metrics requiring ground truth are marked `SKIPPED` (not failed) when ground truth is absent. Sensitivity analysis then computes assumption-based bounds to produce a composite grade. Grades run A–F.

**Impossibility detection:** The engine flags when metrics are mathematically in conflict (e.g., a system can satisfy Predictive Parity or Equalised Odds, but not both on an imbalanced dataset). This is surfaced explicitly rather than averaged away.

---

## Deployment

A `deploy.bat` script is included for one-command deployment to GCP Cloud Run + Firebase Hosting.

**Manual steps:**

1. **Backend — Cloud Run**
   ```bash
   # Build and push the Docker image
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/proxyguard-backend ./backend

   # Deploy to Cloud Run
   gcloud run deploy proxyguard-backend \
     --image gcr.io/YOUR_PROJECT_ID/proxyguard-backend \
     --platform managed \
     --region asia-south1 \
     --allow-unauthenticated
   ```

2. **Cloud KMS setup** (production certificate signing)
   ```bash
   gcloud kms keyrings create audit-ring --location=global
   gcloud kms keys create cert-signing \
     --location=global --keyring=audit-ring \
     --purpose=asymmetric-signing \
     --default-algorithm=rsa-sign-pkcs1-2048-sha256
   ```

3. **Frontend — Firebase Hosting**
   ```bash
   cd frontend
   npm run build
   firebase deploy
   ```

4. Update the CORS allowed origins in `backend/app/main.py` with your deployed Firebase Hosting URL.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Health check |
| `POST` | `/api/v1/audit/run` | Run a full fairness audit on a CSV upload |
| `GET` | `/api/v1/audit/{id}` | Retrieve a specific audit result |
| `GET` | `/api/v1/audit` | List all audit results |
| `POST` | `/api/v1/certificate/generate/{audit_id}` | Generate a KMS-signed certificate |
| `GET` | `/api/v1/registry` | List published audit registry records |
| `POST` | `/narrative/generate` | Generate Gemini narrative for an audit |

Full interactive documentation is available at `/docs` when the backend is running.

---

## Academic References

- Chouldechova (2017) — *Fair prediction with disparate impact*
- Kleinberg et al. (2016) — *Inherent trade-offs in algorithmic fairness*
- Hardt et al. (2016) — *Equality of opportunity in supervised learning*
- Feldman et al. (2015) — *Certifying and removing disparate impact*
- Verma & Rubin (2018) — *Fairness definitions explained*
