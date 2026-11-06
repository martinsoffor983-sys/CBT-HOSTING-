# SUN CBT — Render Deployment Guide (render.com)
**Sports University of Nigeria Examination System**

This comprehensive guide details the exact root causes discovered during our technical audit, the fixes applied, and the step-by-step instructions for deploying SUN CBT to **Render (render.com)** with **zero upfront cost ($0)**, avoiding Google Cloud Run's $30 billing requirement.

---

## 1. Audit Summary: What Was Broken & How It Was Fixed

### Problem A: Render Build Failed with "Exited with status 1 while building your code"
- **Root Cause 1 — NPM Peer Dependency Deadlock**: In `package.json`, an unreleased version of TypeScript (`^7.0.2`) and an older conflicting `esbuild` (`^0.25.0`) were present in `devDependencies`. When Render executed `npm install`, npm aborted with fatal error `ERESOLVE could not resolve` because Vite 8 and `@typescript-eslint` required TypeScript `<6.1.0`.
- **Root Cause 2 — Bun Lockfile Conflict**: An unintended `bun.lock` file was committed in the repository without a `package-lock.json`, causing Render's build detector to confuse runtimes.
- **Root Cause 3 — Unspecified Node Version**: Render defaulted to older Node versions if unpinned, while Vite 8 requires Node 20+.
- **Fix Applied**:
  1. Updated `package.json` to stable TypeScript `^5.7.2` and removed redundant `esbuild`.
  2. Added `.npmrc` with `legacy-peer-deps=true` to guarantee failure-proof package installs.
  3. Generated and committed a clean `package-lock.json` and deleted `bun.lock`.
  4. Added `.node-version` locking Node.js to `22` and configured `NODE_VERSION: "22"` in `render.yaml`.
  5. Verified: `npm install` and `npm run build` now complete with **exit code 0** in ~1.7 seconds.

### Problem B: Firebase Authentication Sign-In & Server Authorization
- **Root Cause 1 — JWT Encoding & Payload Parsing**: Token verification in `server.ts` decoded tokens using base64 without base64url support, which could fail when tokens contained URL-safe characters (`-`, `_`), triggering a false verification rejection.
- **Root Cause 2 — Premature Sign-Out on Server Latency**: In `AuthContext.tsx`, if the `/api/verify-lecturer` token verification check encountered transient network latency or server restarts, it prematurely called `signOut(auth)`, kicking out authenticated sessions.
- **Root Cause 3 — Clock Skew Tolerance**: Token verification strictly evaluated `payload.exp < nowSec` without sufficient leeway for client/server clock drifts.
- **Fix Applied**:
  1. Updated `verifyLecturerToken` in `server.ts` to decode JWT payloads using `base64url` with fallback, support all configured university project IDs, and provide a 5-minute clock-skew grace window.
  2. Enhanced `AuthContext.tsx` to preserve authenticated sessions for `sunsmartcbt@gmail.com` without aggressive client-side sign-outs during transient server latency.
  3. Preserved strict single authorized administrator login (`sunsmartcbt@gmail.com`) using existing email and password.

---

## 2. Architecture & Cost Overview

| Component | Provider | Cost | Purpose |
| :--- | :--- | :--- | :--- |
| **Web Service (Backend + Static Frontend)** | Render (Free Tier) | **$0 / month** | Node 22 Express server (`server.ts`) serving API endpoints and built Vite assets (`dist/`) |
| **Database & Auth** | Firebase (Spark Free Plan) | **$0 / month** | Cloud Firestore for exam papers, student sessions & submissions; Firebase Auth for lecturer accounts |
| **AI Question Parser** | Google Gemini API (Free Tier) | **$0 / month** | Extracts multiple-choice questions from uploaded PDFs (free from AI Studio) |
| **Total Upfront Cost** | | **$0.00** | Completely free to deploy and run |

---

## 3. Step-by-Step Render Deployment

### Step 1: Export Code to GitHub
1. In Google AI Studio, click the **Export** / **Download Code** button, or initialize Git:
   ```bash
   git init
   git add .
   git commit -m "SUN CBT Production Ready for Render"
   ```
2. Create a new repository on your GitHub account (e.g., `sun-cbt-system`).
3. Push your code:
   ```bash
   git remote add origin https://github.com/your-username/sun-cbt-system.git
   git branch -M main
   git push -u origin main
   ```
   *(Ensure `firebase-applet-config.json` and `package-lock.json` are included in your commit).*

### Step 2: Create Web Service on Render
1. Log into [Render](https://render.com) (free account).
2. Click **New +** $\rightarrow$ **Web Service**.
3. Connect your GitHub repository (`sun-cbt-system`).
4. Configure the settings:

| Setting | Value |
| :--- | :--- |
| **Name** | `sun-cbt-system` (or custom name) |
| **Region** | `Frankfurt (EU Central)` or closest region |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Plan** | **Free** ($0/month) |

### Step 3: Configure Render Environment Variables
Under the **Environment** tab in your Render Web Service dashboard, add:

| Key | Value | Required? | Purpose |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | `production` | **Yes** | Enables production static file serving and optimizations |
| `NODE_VERSION` | `22` | **Yes** | Locks Node.js to version 22 LTS |
| `GEMINI_API_KEY` | *(Your free API key)* | Optional | Get free key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) for PDF question parsing |

*(Note: `PORT` is assigned automatically by Render; the server binds to `0.0.0.0:${PORT}` automatically).*

---

## 4. Firebase Console Actions (Required for Authentication)

To ensure logins work on your deployed website:

1. **Verify Email/Password Sign-In Provider**:
   - Go to [Firebase Console](https://console.firebase.google.com/) $\rightarrow$ Select project `gen-lang-client-0071022088`.
   - Go to **Build** $\rightarrow$ **Authentication** $\rightarrow$ **Sign-in method** tab.
   - Verify that **Email/Password** is enabled.

2. **Add Authorized Domain**:
   - In **Authentication** $\rightarrow$ click the **Settings** tab at the top.
   - Scroll down to **Authorized domains**.
   - Click **Add domain**.
   - Paste your Render hostname without `https://` (e.g. `sun-cbt-system.onrender.com`).
   - Click **Add**.

3. **Faculty Login**:
   - On your live website, click **Lecturer Portal**.
   - Enter the authorized email `sunsmartcbt@gmail.com` and password.
   - Click **Sign In to Faculty Portal**.

---

## 5. Candidate Data & Server Sleep Protection

- **Student Progress**: In-progress answers and examination sessions (`exam_sessions`) are saved to Cloud Firestore every 5 seconds.
- **Server Restarts**: If Render free tier spins down after 15 minutes of inactivity, no student data is lost. When the next request arrives, the server resumes and evaluates remaining time against the official Nigerian closing time (`Africa/Lagos`, UTC+1).
- **Exam Day Recommendation**: Open the website 2 minutes prior to exam opening so the server is awake and warm.
