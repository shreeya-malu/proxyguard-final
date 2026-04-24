"""ProxyGuard Studio — Registry Router"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from app.services.registry import publish_audit, get_registry, verify_audit
from app.api.audit import get_store

router = APIRouter()

class PublishRequest(BaseModel):
    audit_id:    str
    make_public: bool = True
    user_uid:    Optional[str] = None
    org_name:    Optional[str] = None

@router.post("/registry/publish")
def publish(req: PublishRequest):
    store  = get_store()
    record = store.get(req.audit_id)
    if not record:
        raise HTTPException(404, "Audit not found.")
    cert = record.get("certificate")
    if not cert:
        raise HTTPException(422, "Generate a certificate before publishing.")

    result = publish_audit(
        audit_id=req.audit_id,
        certificate_id=cert["certificate_id"],
        report=record["report"],
        certificate=cert,
        user_uid=req.user_uid,
        org_name=req.org_name,
        make_public=req.make_public,
    )
    return JSONResponse(content={"published": True, "record": result})

@router.get("/registry")
def list_registry(limit: int = 20):
    return JSONResponse(content={"audits": get_registry(limit=min(limit, 50))})

@router.get("/registry/verify/{audit_id}")
def verify(audit_id: str):
    r = verify_audit(audit_id)
    if not r:
        raise HTTPException(404, f"Audit '{audit_id}' not found in registry.")
    return JSONResponse(content={"verified": True, "record": r})
