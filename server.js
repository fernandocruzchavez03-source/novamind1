import express from "express";
import cors from "cors";
import "dotenv/config";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

// ── BASE DE DATOS ──────────────────────────────────────────────────────────────
const db = new Database(join(__dirname, "novamind.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    title TEXT DEFAULT 'Nueva conversación',
    ts INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    img_url TEXT,
    ts INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (chat_id) REFERENCES chats(id)
  );
  CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    ts INTEGER DEFAULT (unixepoch()),
    UNIQUE(user, key)
  );
`);

// ── MEMORIA ────────────────────────────────────────────────────────────────────
function extractMemory(user, text) {
  const patterns = [
    { regex: /(?:me llamo|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/i, key: "nombre" },
    { regex: /tengo\s+(\d+)\s+años/i, key: "edad" },
    { regex: /(?:vivo en|soy de|estoy en)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:[\s,]+[A-Za-záéíóúñ]+)*)/i, key: "ciudad" },
    { regex: /(?:trabajo (?:como|de)|soy (?:un |una )?)([\wáéíóúñ\s]+?)(?:\.|,|$)/i, key: "ocupacion" },
    { regex: /me gustan?\s+([\wáéíóúñ\s,]+?)(?:\.|,|$)/i, key: "gustos" },
    { regex: /mi (?:correo|email) es\s+([\w@._-]+)/i, key: "email" },
    { regex: /mi (?:número|numero|cel|teléfono|telefono) es\s+([\d\s\-+]+)/i, key: "telefono" },
  ];
  const stmt = db.prepare("INSERT INTO memory (user, key, value) VALUES (?, ?, ?) ON CONFLICT(user, key) DO UPDATE SET value=excluded.value, ts=unixepoch()");
  for (const p of patterns) {
    const m = text.match(p.regex);
    if (m?.[1]) stmt.run(user, p.key, m[1].trim());
  }
}

function buildMemoryPrompt(user) {
  const mem = db.prepare("SELECT key, value FROM memory WHERE user = ? ORDER BY ts DESC").all(user);
  if (mem.length === 0) return "";
  const lines = mem.map(m => `- ${m.key}: ${m.value}`).join("\n");
  return `\n\nDatos que recuerdas de este usuario (úsalos de forma natural cuando sea relevante):\n${lines}`;
}

// ── RUTAS MEMORIA ──────────────────────────────────────────────────────────────
app.get("/memory/:user", (req, res) => {
  try {
    const mem = db.prepare("SELECT key, value, ts FROM memory WHERE user = ? ORDER BY ts DESC").all(req.params.user);
    res.json(mem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/memory/:user/:key", (req, res) => {
  try {
    db.prepare("DELETE FROM memory WHERE user = ? AND key = ?").run(req.params.user, req.params.key);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── RUTAS HISTORIAL ────────────────────────────────────────────────────────────
app.get("/history/:user", (req, res) => {
  try {
    const chats = db.prepare("SELECT * FROM chats WHERE user = ? ORDER BY ts DESC").all(req.params.user);
    res.json(chats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/history/:user/:chatId", (req, res) => {
  try {
    const messages = db.prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY ts ASC").all(req.params.chatId);
    res.json(messages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/history/:user/new", (req, res) => {
  try {
    const { id, title } = req.body;
    db.prepare("INSERT INTO chats (id, user, title) VALUES (?, ?, ?)").run(id, req.params.user, title || "Nueva conversación");
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/history/:user/:chatId/message", (req, res) => {
  try {
    const { role, content, img_url } = req.body;
    db.prepare("INSERT INTO messages (chat_id, role, content, img_url) VALUES (?, ?, ?, ?)").run(req.params.chatId, role, content, img_url || null);
    const count = db.prepare("SELECT COUNT(*) as c FROM messages WHERE chat_id = ? AND role = 'user'").get(req.params.chatId);
    if (count.c === 1 && role === "user") {
      const title = content.length > 36 ? content.slice(0, 36) + "…" : content;
      db.prepare("UPDATE chats SET title = ? WHERE id = ?").run(title, req.params.chatId);
    }
    db.prepare("UPDATE chats SET ts = unixepoch() WHERE id = ?").run(req.params.chatId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/history/:user/:chatId", (req, res) => {
  try {
    db.prepare("DELETE FROM messages WHERE chat_id = ?").run(req.params.chatId);
    db.prepare("DELETE FROM chats WHERE id = ? AND user = ?").run(req.params.chatId, req.params.user);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CHAT IA (GEMINI) ───────────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const { messages, user } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages debe ser un array" });
    }

    // Extraer memoria del último mensaje del usuario
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (user && lastUserMsg) {
      const txt = Array.isArray(lastUserMsg.content)
        ? lastUserMsg.content.find(c => c.type === "text")?.text || ""
        : lastUserMsg.content;
      extractMemory(user, txt);
    }

    // Construir system prompt con memoria
    const memoryPrompt = user ? buildMemoryPrompt(user) : "";
    const systemContent = `Eres NovaMind, una IA útil, clara y directa. Responde siempre en español mexicano. Sé conciso pero completo.${memoryPrompt}`;

    // Formatear mensajes para Gemini
    const formattedMessages = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: Array.isArray(m.content)
        ? m.content.find(c => c.type === "text")?.text || ""
        : m.content
      }]
    }));

    const body = {
      system_instruction: {
        parts: [{ text: systemContent }]
      },
      contents: formattedMessages,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );

    let data;
    try { data = await response.json(); }
    catch { return res.status(500).json({ error: "Respuesta inválida de Gemini" }); }

    if (!response.ok) {
      console.error("Gemini error:", data);
      return res.status(response.status).json({ error: data.error?.message || "Error de Gemini" });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta";
    res.json({ text });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✦ NovaMind servidor listo → http://localhost:${PORT}`);
  console.log(`✦ Base de datos: ${join(__dirname, "novamind.db")}`);
});
