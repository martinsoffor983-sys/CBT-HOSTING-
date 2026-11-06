# Sports University of Nigeria (SUN) CBT Examination System
**Citadel for Champions — Computer-Based Testing Portal**

A secure, high-integrity academic examination management and testing system designed specifically for the Sports University of Nigeria.

---

## Key Features

- **Strict Examination Access Control**: Enforces precise Nigerian opening and closing times (`Africa/Lagos`, UTC+1). No student can start or reopen an examination once the official closing time arrives.
- **Timer Priority & Auto-Submission**: The official examination closing time strictly overrides individual countdown timers. When closing time is reached, all in-progress student answers are automatically submitted.
- **Cheating & Retake Prevention**: Students cannot retake or reopen completed examinations. Questions and options can be randomized across dynamic student batches.
- **Lecturer Management & Security**: Dedicated examiner login (`sunsmartcbt@gmail.com`), real-time examination status, question bank creation with Gemini AI-powered PDF extraction, and live candidate tracking.
- **Result Exporting**: Generates official institutional examination reports in Microsoft Word (`.docx`) and Microsoft Excel (`.xlsx`), formatted with the Sports University of Nigeria crest.
- **Zero Cost Deployment**: Fully configured for external deployment on **Render (render.com)** on the free tier with Firebase Spark and Google Gemini API.

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Run development server (Node Express + Vite)
npm run dev

# 3. Open browser
http://localhost:3000
```

---

## Production Build & Run

```bash
# Build the production frontend assets
npm run build

# Start the production server
npm start
```

---

## Deployment to Render (render.com)

For full step-by-step instructions with screenshot guidance on deploying to Render with $0 upfront cost, see **[RENDER_DEPLOYMENT.md](./RENDER_DEPLOYMENT.md)**.

### Summary of Render Settings
- **Service Type**: Web Service
- **Runtime**: Node
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Plan**: Free ($0/month)
- **Environment Variables**:
  - `NODE_ENV`: `production`
  - `GEMINI_API_KEY`: *(Optional) Get free key at https://aistudio.google.com/app/apikey*
