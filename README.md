# ⛏️ ReelMiner — AI-Powered Viral Reel Extractor

Extract the **top 5 most viral reel moments** from any YouTube video — powered by Google Gemini AI. 100% free, no server, no backend.

---

## ✨ Features

- 🔗 Paste any YouTube URL
- 📝 Auto-extracts transcript with timestamps
- 🤖 AI identifies the top 5 reel-worthy segments
- 🎯 Scores every reel on **Virality** and **TAM** (audience reach)
- ⚡ Supports 30s, 60s, and 90s reel formats
- ▶️ Preview each reel segment via embedded YouTube player
- 📋 One-click copy for timestamps, scripts, and captions
- 📄 Export full analysis as a Markdown report
- 🕐 Analysis history saved locally in your browser
- 🌙 Beautiful dark-themed UI
- 📱 Fully responsive (works on phone and desktop)
- 💰 **100% FREE** — no server, no hosting costs, no subscriptions

---

## 🚀 Setup Guide (Step by Step — No Coding!)

### Step 1: Get a Free Gemini API Key (2 minutes)

1. Go to **[Google AI Studio](https://aistudio.google.com/apikey)**
2. Sign in with your **Google account**
3. Click **"Create API Key"**
4. Click **"Create API key in new project"**
5. **Copy the API key** (it looks like `AIzaSy...`)
6. Keep this key — you'll paste it into ReelMiner

> ⚠️ The free tier gives you **15 requests per minute** and **1,500 requests per day** — more than enough!

### Step 2: Deploy to GitHub Pages (5 minutes)

1. Go to **[github.com](https://github.com)** and sign up (or log in)
2. Click the **"+"** button (top-right) → **"New repository"**
3. Name it: **`reelminer`**
4. Make sure **"Public"** is selected
5. Click **"Create repository"**
6. On the next page, click **"uploading an existing file"**
7. Drag and drop **all 4 files** from this folder:
   - `index.html`
   - `style.css`
   - `app.js`
   - `README.md`
8. Click **"Commit changes"**
9. Go to **Settings** → **Pages** (in the left sidebar)
10. Under **"Source"**, select **"Deploy from a branch"**
11. Under **"Branch"**, select **`main`** and **`/ (root)`**
12. Click **"Save"**
13. Wait 1-2 minutes, then visit: **`https://YOUR-USERNAME.github.io/reelminer/`**

🎉 **Your app is live!**

### Step 3: Configure ReelMiner

1. Open your deployed site
2. Click the **⚙️ Settings** button (top-right)
3. Paste your **Gemini API key**
4. Click **"Save Key"**
5. The key is stored **only in your browser** — it never leaves your device

---

## 📖 How to Use

1. **Paste a YouTube URL** into the input box
2. **Enter your channel goal** (e.g., "Tech reviews for 18-35 year olds")
3. **Select reel durations** (30s, 60s, 90s — pick one or all)
4. Click **"⛏️ Mine Viral Reels"**
5. Wait 10-30 seconds for AI analysis
6. Browse your **top 5 reel cards** with:
   - 🎬 Embedded video preview of the exact segment
   - 📊 Virality and TAM scores with reasoning
   - 🎣 Ready-made hook for the first 3 seconds
   - 📝 Full reel script
   - 📱 Caption and hashtags ready to post
   - 📣 Suggested call-to-action

### If Auto-Transcript Fails

Some videos don't allow external transcript access. If this happens:
1. Open the YouTube video
2. Click **"…" (More)** below the video
3. Click **"Show transcript"**
4. Copy the transcript text
5. Paste it into ReelMiner's manual input box

---

## 🔒 Privacy & Security

- Your **API key** is stored only in your browser's localStorage
- **No data** is sent to any server except Google's Gemini API
- **No analytics, no tracking, no cookies**
- The app runs **entirely in your browser**

---

## ❓ FAQ

**Q: Is this really free?**
A: Yes! GitHub Pages hosting is free. Google Gemini API has a generous free tier. You pay nothing.

**Q: Can I download the actual video clips?**
A: The app shows YouTube embed previews of each reel segment. For downloading clips, use a free video editor like [CapCut](https://www.capcut.com/) with the timestamps provided.

**Q: What if the AI picks bad segments?**
A: Try being more specific with your channel goal. For example, instead of "tech", try "Budget smartphone reviews for college students in India".

**Q: Does it work with any language?**
A: Yes! Gemini supports 100+ languages. It will extract reels from videos in any language that has captions.

**Q: Can I use this for multiple channels?**
A: Absolutely! Just change the channel goal for each analysis.

---

## 🛠 Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript (no frameworks)
- **AI:** Google Gemini 2.0 Flash (free tier)
- **Hosting:** GitHub Pages (free)
- **Transcript:** YouTube caption extraction via CORS proxy
- **Storage:** Browser localStorage (no database needed)

---

Made with ❤️ — 100% free, forever.
