# AquaRakshak Web MVP (SDG 6)

Single web-based prototype for hackathon submission with accurate, data-backed outputs.

## What this includes
- React web app for both Resident and Admin roles
- Firebase backend (Auth, Firestore, Storage, Functions)
- Digital twin IoT simulator (no hardware)
- Risk scoring for contamination, leakage, shortage
- Incident lifecycle: detect -> report -> assign -> resolve
- Jupyter notebook for threshold calibration and accuracy reporting

## Folders
- `web/` - Unified web frontend
- `backend/functions/` - Cloud Functions and risk engine
- `scripts/` - Seeder and simulator trigger scripts
- `analysis/` - Jupyter notebook for calibration and evaluation

## Fast Setup
1. Create a Firebase project and enable Auth, Firestore, Storage, and Functions.
2. Copy env examples.
   - `backend/functions/.env.example` -> `backend/functions/.env`
   - `web/.env.example` -> `web/.env`
3. Install dependencies.
   - Root: `npm install` (PowerShell fallback: `npm.cmd install`)
   - Functions: `cd backend/functions && npm install`
   - Web: `cd ../../web && npm install`
4. Deploy backend.
   - `cd ../backend/functions && npm run deploy`
5. Run web app.
   - `cd ../../web && npm run dev`
   - PowerShell fallback: `npm.cmd run dev`

## Verify the web app runs
1. Build check: `cd web && npm run build` (or `npm.cmd run build` in restricted PowerShell).
2. Dev server: `npm run dev`.
3. Open the printed localhost URL.

If Firebase env variables are missing, the UI still boots with placeholder config and logs a warning in the browser console. Authentication and Firestore actions require valid `web/.env` values.

## Demo Flow
1. Admin clicks `Trigger Demo Incident`.
2. Alert appears in incident queue.
3. Resident submits report.
4. Admin assigns and resolves with note/proof.
5. Metrics update in dashboard.

## Accuracy Evidence
Use `analysis/calibration_and_accuracy.ipynb` with your dataset CSV to:
- tune thresholds
- output confusion matrix + precision/recall
- export a judge-ready summary table

## Monitoring Panel
Admin -> Evidence now includes live app health:
- read/write operation counters
- read/write error counters
- average write latency (ms)
- stale data detection (5-minute threshold)

## Deployment
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Firebase Hosting + Vercel production steps and custom domain setup.

Live Demo (Firebase): https://aquarakshak.web.app
Live Demo (Vercel): https://aquarakshak.vercel.app