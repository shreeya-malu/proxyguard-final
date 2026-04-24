from fastapi import APIRouter
router = APIRouter()

@router.get("/health")
def health():
    return {"status": "healthy", "service": "ProxyGuard Studio", "version": "3.0.0"}
