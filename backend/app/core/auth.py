# backend/app/core/auth.py
import firebase_admin
from firebase_admin import auth, credentials
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer

cred = credentials.ApplicationDefault()
firebase_admin.initialize_app(cred)
bearer = HTTPBearer(auto_error=False)

async def get_current_user(token=Depends(bearer)):
    if not token:
        raise HTTPException(status_code=401, detail="Missing auth token")
    try:
        return auth.verify_id_token(token.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")