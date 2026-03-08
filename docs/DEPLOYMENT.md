# Deployment Guide (Production)

## 1) Build once
```bash
npm install
npm --workspace web run build
```

## 2) Firebase Hosting deploy
Prerequisites:
- `firebase login`
- project id: `aquarakshak`

Commands:
```bash
firebase use aquarakshak
npm --workspace web run build
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

Custom domain:
1. Firebase Console -> Hosting -> Add custom domain.
2. Add DNS TXT verification record.
3. Add A/AAAA records Firebase provides.
4. Wait for SSL provisioning.

## 3) Vercel deploy
Prerequisites:
- `npm i -g vercel`
- `vercel login`

Commands:
```bash
vercel
vercel --prod
```

Set env vars in Vercel Project Settings:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Custom domain:
1. Vercel Project -> Settings -> Domains -> Add domain.
2. Create DNS CNAME/A records as instructed by Vercel.
3. Verify SSL is active.

## 4) Post-deploy checks
- Login works for admin and resident roles.
- Monitoring panel shows read/write activity.
- Stale data flag toggles correctly after idle period.
- Guided Demo Mode executes without errors.
- Report download and printable ops sheet work.
