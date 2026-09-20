# NOUR AI - NCC Level 10 Exam Coach & Simulator

NOUR AI is a state-of-the-art, AI-powered exam coaching platform designed specifically for the **NCC Level 10 Promotion Exam**. Built with a premium, responsive glassmorphism UI, NOUR acts as a strict, highly analytical coach that tests users on complex telecommunications frameworks including the NCA 2003 Act, Spectrum Management, QoS limits, and the TIRMS Architecture.

## 🌟 Key Features

- **Live Voice Coaching (Premium):** Fully hands-free voice interaction. Speak naturally to NOUR, and the AI will auto-detect silence, transcribe your speech, generate an analytical response, and speak back to you in real-time with a hyper-realistic "Onyx" voice.
- **Dynamic Visuals:** A sleek pulsing orb visualizer that dynamically changes states (Listening, Thinking, Speaking) based on the AI's current processing phase.
- **Mock Exam Simulator:** A strict, timed 30-minute / 20-question Mock Examination mode that disables the chat and grades the user based strictly on the NCC curriculum.
- **Massive Context Memory:** Powered by Moonshot AI, NOUR boasts a massive context window (up to 1-Million tokens) allowing it to ingest and remember entire regulatory textbooks without hallucinating.
- **Session History:** Automatically saves and categorizes your study sessions so you can pick up exactly where you left off.
- **Dark/Light Mode:** Beautiful, responsive UI that automatically adapts to your preferred theme.

## 🏗️ Architecture & Tech Stack

- **Frontend:** Next.js (App Router), React, Tailwind CSS, Lucide Icons
- **Backend/API:** Next.js Serverless Routes
- **Database:** Turso (LibSQL) & Prisma ORM
- **Core Intelligence (The Brain):** Moonshot AI (`kimi-k3` / `moonshot-v1-128k`)
- **Speech-to-Text (The Ears):** OpenAI Whisper API
- **Text-to-Speech (The Voice):** OpenAI TTS API

## 🚀 Getting Started

### 1. Clone the Repository
```bash
git clone https://github.com/Musterferh/NOUR_AI.git
cd NOUR_AI
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Rename `.env.example` to `.env.local` and add your API keys:
```env
# Moonshot AI (Core Intelligence)
KIMI_API_KEY=your_moonshot_api_key_here
KIMI_MODEL=kimi-k3 # or moonshot-v1-128k

# OpenAI (Voice / Audio)
OPENAI_API_KEY=your_openai_api_key_here

# Turso Database (Session History)
DATABASE_URL=your_turso_db_url_here
TURSO_AUTH_TOKEN=your_turso_auth_token_here
```

### 4. Setup the Database
Push the Prisma schema to your Turso database:
```bash
npx prisma generate
npx prisma db push
```

### 5. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser to start studying with NOUR.

## 📝 License
Proprietary - Created for Musterferh.
