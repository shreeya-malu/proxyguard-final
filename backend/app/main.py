import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import audit, certificate, registry, health
from app.api.narrative_endpoint import router as narrative_router

app = FastAPI(
    title="ProxyGuard Studio API",
    description="Multi-checkpoint deterministic AI fairness auditing engine",
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Lock to Firebase Hosting URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router,      prefix="/api/v1", tags=["health"])
app.include_router(audit.router,       prefix="/api/v1", tags=["audit"])
app.include_router(certificate.router, prefix="/api/v1", tags=["certificate"])
app.include_router(registry.router,    prefix="/api/v1", tags=["registry"])
app.include_router(narrative_router)

@app.get("/")
def root():
    return {"service": "ProxyGuard Studio", "version": "3.0.0", "status": "running"}
