// Load .env.local in development
require("dotenv").config({ path: ".env.local" });

const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ── Rate limiting store (in-memory, resets on cold start) ─────────────────
// For persistent limits across instances, swap this for Upstash Redis.
const ipStore = new Map(); // ip → { count, windowStart, dailyCount, dayStart }

const RATE_LIMIT = {
  windowMs:    60 * 1000,   // 1 minute window
  maxPerWindow: 10,          // max requests per window
  dailyMax:    100,          // max requests per day per IP
};

function getRateLimitEntry(ip) {
  const now = Date.now();
  let entry = ipStore.get(ip);

  if (!entry) {
    entry = { count: 0, windowStart: now, dailyCount: 0, dayStart: now };
    ipStore.set(ip, entry);
  }

  // Reset 1-min window
  if (now - entry.windowStart > RATE_LIMIT.windowMs) {
    entry.count = 0;
    entry.windowStart = now;
  }

  // Reset daily window
  if (now - entry.dayStart > 24 * 60 * 60 * 1000) {
    entry.dailyCount = 0;
    entry.dayStart = now;
  }

  return entry;
}

function checkRateLimit(ip) {
  const entry = getRateLimitEntry(ip);

  if (entry.dailyCount >= RATE_LIMIT.dailyMax) {
    return { limited: true, reason: "Daily limit reached. Please try again tomorrow." };
  }

  if (entry.count >= RATE_LIMIT.maxPerWindow) {
    const retryAfter = Math.ceil((RATE_LIMIT.windowMs - (Date.now() - entry.windowStart)) / 1000);
    return { limited: true, reason: `Too many requests. Please wait ${retryAfter}s.` };
  }

  entry.count++;
  entry.dailyCount++;
  return { limited: false };
}

// Periodically clean up stale IPs to prevent memory leak (every 10 min)
setInterval(() => {
  const cutoff = Date.now() - 25 * 60 * 60 * 1000; // older than 25h
  for (const [ip, entry] of ipStore.entries()) {
    if (entry.dayStart < cutoff) ipStore.delete(ip);
  }
}, 10 * 60 * 1000);

// ── Input sanitization ────────────────────────────────────────────────────
const MAX_MESSAGE_LENGTH = 500;   // chars per message
const MAX_HISTORY_LENGTH = 20;    // max messages in history
const MAX_BODY_BYTES     = 16384; // 16 KB payload cap

function sanitizeText(str) {
  if (typeof str !== "string") return "";
  // Strip null bytes and control characters (except newlines/tabs)
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) return false;
  if (messages.length === 0 || messages.length > MAX_HISTORY_LENGTH) return false;

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") return false;
    if (!["user", "assistant"].includes(msg.role)) return false;
    if (typeof msg.content !== "string") return false;
    if (msg.content.length > MAX_MESSAGE_LENGTH) return false;
  }
  return true;
}

// ── Get real IP (works on Vercel) ─────────────────────────────────────────
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

const SYSTEM_INSTRUCTION = `You are Geanna Ricci P. Pacaña — speak in first person as if you ARE her. You are a graduating IT student and Full-Stack Developer from Cebu City, Philippines (graduating May 2026). You are professional, technical, and friendly.

About you:
- Full name: Geanna Ricci P. Pacaña
- Skills: Java, JavaScript, Python, React.js, Vite, Spring Boot, Node.js, Django, PHP, HTML, CSS
- Key Project: Wildcats CircuitHub — an Equipment Management System for CIT-U's ECE Department, built with Vite/React (frontend) and Spring Boot (backend), using Firebase for auth and real-time data.
- Other Projects: CCS GadgetHub (gadget lending platform with Spring Boot REST APIs, Firebase Auth, RBAC), BIMS (Barangay Information Management System using Python/Django/Java), Pet and Pals (React.js + Spring Boot + MySQL e-commerce app).
- Internship: IT Intern at Knowles Training Institute Singapore (Remote, Jan 2026 – May 2026) — WordPress page creation, layout setup, content writing, and site maintenance.
- Certifications: AWS Academy Cloud Foundations, AWS Academy Cloud Architecting, Huawei HCIA-Storage V4.5, Huawei HCIP-Storage V5.0.
- Interests: Triathlons, gym training, dance, and travel. You train across swimming, cycling, and running — disciplines that reflect your work ethic: consistent, goal-oriented, and resilient under pressure.
- Pets: Three cats named Bibble, Beanie, and Bob — they're her little companions at home.
- Contact: pacanageanna@gmail.com | LinkedIn: geannapacana | GitHub: gyanna081 | Instagram: geannaricci

Tone & rules:
- Always speak as Geanna in first person ("I", "my", "me") — never say "she" or refer to yourself in third person.
- Be warm, confident, and conversational — like you're chatting with a recruiter or fellow dev.
- If the user writes in Tagalog, respond in Taglish (mix of Tagalog and English).
- When asked about discipline, work ethic, or perseverance, draw parallels to your triathlon training.
- Keep answers concise and relevant to your background.
- If asked something outside your background, politely say you can only speak to your own experience.`;

module.exports = async function handler(req, res) {
  // ── Method guard ──────────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Payload size guard ────────────────────────────────────────────────────
  const contentLength = parseInt(req.headers["content-length"] || "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: "Payload too large." });
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const ip = getClientIp(req);
  const { limited, reason } = checkRateLimit(ip);
  if (limited) {
    return res.status(429).json({ error: reason });
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const { messages } = req.body;

  if (!validateMessages(messages)) {
    return res.status(400).json({ error: "Invalid messages payload." });
  }

  // Sanitize all message content
  const cleanMessages = messages.map((m) => ({
    role: m.role,
    content: sanitizeText(m.content),
  }));

  // Reject if last message is empty after sanitization
  const lastMessage = cleanMessages[cleanMessages.length - 1];
  if (!lastMessage.content) {
    return res.status(400).json({ error: "Message content is empty." });
  }

  try {
    // Build history — strip leading assistant messages, Gemini requires user first
    const prior = cleanMessages.slice(0, -1);
    const firstUserIdx = prior.findIndex((m) => m.role === "user");
    const trimmed = firstUserIdx === -1 ? [] : prior.slice(firstUserIdx);

    const history = trimmed.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // Retry up to 3 times on 503 overload
    let response;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const chat = ai.chats.create({
          model: "gemini-2.5-flash",
          config: { systemInstruction: SYSTEM_INSTRUCTION },
          history,
        });
        response = await chat.sendMessage({ message: lastMessage.content });
        break;
      } catch (retryErr) {
        const is503 =
          retryErr?.message?.includes("503") ||
          retryErr?.message?.includes("UNAVAILABLE");
        if (is503 && attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
        } else {
          throw retryErr;
        }
      }
    }

    return res.status(200).json({ reply: response.text });
  } catch (err) {
    console.error("Gemini API error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Failed to get response from AI." });
  }
};
