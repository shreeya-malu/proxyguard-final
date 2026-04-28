import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import audit, certificate, registry, health
from app.api.narrative_endpoint import router as narrative_router

import os, json, tempfile

creds_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
if creds_json:
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="w")
    tmp.write(creds_json)
    tmp.close()
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tmp.name

app = FastAPI(
    title="ProxyGuard Studio API",
    description="Multi-checkpoint deterministic AI fairness auditing engine",
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "https://YOUR_PROJECT_ID.web.app",
        "https://YOUR_PROJECT_ID.firebaseapp.com",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(health.router,      prefix="/api/v1", tags=["health"])
app.include_router(audit.router,       prefix="/api/v1", tags=["audit"])
app.include_router(certificate.router, prefix="/api/v1", tags=["certificate"])
app.include_router(registry.router,    prefix="/api/v1", tags=["registry"])
app.include_router(narrative_router)

@app.get("/")
def root():
    return {"service": "ProxyGuard Studio", "version": "3.0.0", "status": "running"}

@app.get("/api/v1/health")
def health():
    return {"status": "ok"}
