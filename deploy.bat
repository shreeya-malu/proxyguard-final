@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: ProxyGuard Studio — Full Deployment Script (Windows)
:: Deploys backend to Cloud Run + frontend to Firebase Hosting
::
:: Prerequisites (install these first):
::   - Google Cloud SDK: https://cloud.google.com/sdk/docs/install
::   - Firebase CLI: npm install -g firebase-tools
::   - Node.js 20+
::   - Python 3.11+
::
:: Run once before first deploy:
::   gcloud auth login
::   gcloud auth application-default login
::   firebase login
:: ============================================================

echo.
echo ================================================
echo  ProxyGuard Studio Deployment
echo ================================================
echo.

:: ── CONFIGURATION — Edit these before running ────────────────
set PROJECT_ID=proxyguard-studio
set REGION=asia-south1
set SERVICE_NAME=proxyguard-backend
set IMAGE_NAME=gcr.io/%PROJECT_ID%/%SERVICE_NAME%
set FIREBASE_PROJECT=proxyguard-studio-7e6e0
:: ─────────────────────────────────────────────────────────────

if "%PROJECT_ID%"=="your-gcp-project-id" (
    echo ERROR: Edit deploy.bat and set your PROJECT_ID first.
    echo        Open deploy.bat and change 'your-gcp-project-id' on line 29.
    pause
    exit /b 1
)

echo Using:
echo   GCP Project:      %PROJECT_ID%
echo   Region:           %REGION%
echo   Service:          %SERVICE_NAME%
echo   Firebase Project: %FIREBASE_PROJECT%
echo.

:: ── STEP 1: Set active GCP project ───────────────────────────
echo [1/8] Setting GCP project...
gcloud config set project %PROJECT_ID%
if errorlevel 1 goto :error

:: ── STEP 2: Enable required APIs ─────────────────────────────
echo.
echo [2/8] Enabling GCP APIs (first time only, takes ~2 min)...
gcloud services enable ^
    run.googleapis.com ^
    cloudbuild.googleapis.com ^
    containerregistry.googleapis.com ^
    cloudkms.googleapis.com ^
    dlp.googleapis.com ^
    secretmanager.googleapis.com ^
    firestore.googleapis.com
if errorlevel 1 goto :error

:: ── STEP 3: Store Gemini API key in Secret Manager ───────────
echo.
echo [3/8] Setting up Gemini API key in Secret Manager...
echo.
echo NOTE: You need your Gemini API key from https://aistudio.google.com/app/apikey
set /p GEMINI_KEY="Paste your Gemini API key (or press Enter to skip): "

if not "%GEMINI_KEY%"=="" (
    :: Check if secret already exists
    gcloud secrets describe gemini-api-key >nul 2>&1
    if errorlevel 1 (
        echo Creating new secret...
        echo %GEMINI_KEY% | gcloud secrets create gemini-api-key --data-file=-
    ) else (
        echo Updating existing secret...
        echo %GEMINI_KEY% | gcloud secrets versions add gemini-api-key --data-file=-
    )
    echo Gemini key stored in Secret Manager.
) else (
    echo Skipping Gemini key. The audit will use deterministic fallback summaries.
)

:: ── STEP 4: Create KMS keyring and key ───────────────────────
echo.
echo [4/8] Setting up Cloud KMS for certificate signing...

gcloud kms keyrings describe audit-ring --location=global >nul 2>&1
if errorlevel 1 (
    echo Creating KMS keyring...
    gcloud kms keyrings create audit-ring --location=global
)

gcloud kms keys describe cert-signing --location=global --keyring=audit-ring >nul 2>&1
if errorlevel 1 (
    echo Creating KMS signing key...
    gcloud kms keys create cert-signing ^
        --location=global ^
        --keyring=audit-ring ^
        --purpose=mac ^
        --default-algorithm=hmac-sha256
)
echo KMS ready.

:: ── STEP 5: Build and push Docker image ──────────────────────
echo.
echo [5/8] Building and pushing Docker image to Container Registry...
echo This takes 3-5 minutes on first build.
cd backend
gcloud builds submit --tag %IMAGE_NAME% .
if errorlevel 1 goto :error
cd ..
echo Image built and pushed: %IMAGE_NAME%

:: ── STEP 6: Deploy to Cloud Run ──────────────────────────────
echo.
echo [6/8] Deploying backend to Cloud Run (%REGION%)...

:: Replace placeholders in cloudrun.yaml
powershell -Command "(Get-Content backend\cloudrun.yaml) -replace 'IMAGE_URL_PLACEHOLDER','%IMAGE_NAME%' -replace 'PROJECT_ID_PLACEHOLDER','%PROJECT_ID%' | Set-Content backend\cloudrun.yaml.tmp"

gcloud run services replace backend\cloudrun.yaml.tmp --region=%REGION%
if errorlevel 1 (
    :: Fallback: deploy without YAML if replace fails
    gcloud run deploy %SERVICE_NAME% ^
        --image=%IMAGE_NAME% ^
        --region=%REGION% ^
        --platform=managed ^
        --allow-unauthenticated ^
        --memory=2Gi ^
        --cpu=2 ^
        --concurrency=10 ^
        --timeout=60 ^
        --set-env-vars="GCP_PROJECT_ID=%PROJECT_ID%,FIREBASE_PROJECT_ID=%FIREBASE_PROJECT%,KMS_LOCATION=global,KMS_KEYRING=audit-ring,KMS_KEY=cert-signing"
    if errorlevel 1 goto :error
)

del backend\cloudrun.yaml.tmp 2>nul

:: Get the backend URL
for /f "tokens=*" %%i in ('gcloud run services describe %SERVICE_NAME% --region=%REGION% --format="value(status.url)"') do set BACKEND_URL=%%i
echo Backend URL: %BACKEND_URL%

:: ── STEP 7: Update frontend with backend URL ─────────────────
echo.
echo [7/8] Building frontend with production backend URL...
cd frontend

:: Write production .env with real backend URL
(
echo VITE_API_URL=%BACKEND_URL%/api/v1
echo VITE_FIREBASE_API_KEY=your-api-key-here
echo VITE_FIREBASE_AUTH_DOMAIN=%FIREBASE_PROJECT%.firebaseapp.com
echo VITE_FIREBASE_PROJECT_ID=%FIREBASE_PROJECT%
echo VITE_FIREBASE_STORAGE_BUCKET=%FIREBASE_PROJECT%.appspot.com
echo VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
echo VITE_FIREBASE_APP_ID=your-app-id
) > .env.production.tmp

echo.
echo IMPORTANT: You must fill in your Firebase config values in .env.production.tmp
echo Get them from: https://console.firebase.google.com ^> Project Settings ^> Your apps
echo.
echo Current .env.production.tmp:
type .env.production.tmp
echo.
set /p CONFIRM="Have you filled in the Firebase config values? (y/N): "
if /i not "%CONFIRM%"=="y" (
    echo Please edit frontend\.env.production.tmp with your Firebase values, then re-run this script from step 7.
    echo Or rename it to .env.production and run: cd frontend ^&^& npm run build ^&^& firebase deploy --only hosting
    pause
    exit /b 0
)

move .env.production.tmp .env.production

:: Build
npm install
if errorlevel 1 goto :error
npm run build
if errorlevel 1 goto :error

:: ── STEP 8: Deploy to Firebase Hosting ───────────────────────
echo.
echo [8/8] Deploying frontend to Firebase Hosting...
firebase use %FIREBASE_PROJECT%
firebase deploy --only hosting
if errorlevel 1 goto :error

cd ..

:: ── Done ─────────────────────────────────────────────────────
echo.
echo ================================================
echo  DEPLOYMENT COMPLETE
echo ================================================
echo.
echo  Backend:  %BACKEND_URL%
echo  Frontend: https://%FIREBASE_PROJECT%.web.app
echo.
echo  Health check:
echo  curl %BACKEND_URL%/api/v1/health
echo.
echo  API docs:
echo  %BACKEND_URL%/docs
echo.
echo ================================================
pause
exit /b 0

:error
echo.
echo ERROR: Deployment step failed. See error above.
echo Common fixes:
echo   - Run 'gcloud auth login' if authentication failed
echo   - Run 'firebase login' if Firebase auth failed
echo   - Check PROJECT_ID is correct at top of this script
pause
exit /b 1
