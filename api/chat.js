// Load .env.local in development
require("dotenv").config({ path: ".env.local" });

const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Invalid messages payload" });
  }

  try {
    // Build history — strip leading assistant messages, Gemini requires user first
    const prior = messages.slice(0, -1);
    const firstUserIdx = prior.findIndex((m) => m.role === "user");
    const trimmed = firstUserIdx === -1 ? [] : prior.slice(firstUserIdx);

    const history = trimmed.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const lastMessage = messages[messages.length - 1];

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
        const is503 = retryErr?.message?.includes("503") || retryErr?.message?.includes("UNAVAILABLE");
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
