# Hip-Safe Fitness Tracker PWA with Firebase Sync

A React + Vite progressive web app for tracking workouts, core work, hip recovery, weekly metrics, and progress across devices.

## What is included
- Local autosave in the browser
- Stable versioned storage (`hipsafe-fitness-tracker-v2`)
- Google sign-in with Firebase Auth
- Remote sync to Cloud Firestore
- Firebase Hosting config
- Export backup to JSON
- Import restore from JSON
- Safe reset of local device data
- Offline support via service worker
- Installable PWA manifest

## Sync model
- Local browser storage is always the safety net on each device.
- After Google sign-in, the app loads your remote Firestore copy if one exists.
- If no remote copy exists yet, it uploads your local copy.
- After that, changes autosave locally and sync to Firestore.
- Conflict mode is currently **last saved copy wins**.

## Before first deploy in Firebase Console
1. Enable **Authentication > Google**.
2. Add your hosting domain to **Authentication > Settings > Authorised domains**.
3. Create **Cloud Firestore** in production or test mode.
4. Publish the included `firestore.rules`.

## Local run
```bash
npm install
cp .env.example .env.local
# fill in your Firebase values
npm run dev
```

Preview portal:
```bash
# after npm run dev
open http://localhost:5173/?preview=1
```

## Build
```bash
npm install
npm run build
npm run preview
```

## Firebase deploy
Install the CLI once:
```bash
npm install -g firebase-tools
```

Log in and select the project:
```bash
firebase login
firebase use telosworkout
```

Deploy Firestore rules:
```bash
firebase deploy --only firestore:rules
```

Deploy hosting:
```bash
npm run build
firebase deploy --only hosting
```

## Important note
Firebase web config is now read from local Vite env vars instead of tracked source files. You still control the actual Firebase project, Auth settings, Firestore creation, rules deployment, and hosting deployment.
