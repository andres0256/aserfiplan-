import express from "express";
import { randomUUID } from "node:crypto";
import { google } from "googleapis";
import nodemailer from "nodemailer";
import { GoogleGenAI, Type } from "@google/genai";

const {
  WA_TOKEN, WA_PHONE_ID, WA_VERIFY_TOKEN, WA_API_VERSION = "v23.0", BUSINESS_NUMBER = "",
  GEMINI_API_KEY, GEMINI_MODEL = "gemini-3.8-flash",
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
  GMAIL_USER, GMAIL_APP_PASSWORD, OWNER_EMAIL, PORT = 3000,
} = process.env;
const TZ = "America/Bogota";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const oauth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
oauth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
const calendar = google.calendar({ version: "v3", auth: oauth });
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

const systemPrompt = () => `Eres el asistente virtual de Aserfiplan. Aserfiplan ofrece asesoría en tres áreas:
1) Compra de inmuebles: lotes de parcelación urbana, lotes para casas campestres o condominios, lotes para locales comerciales, lotes para urbanización y fincas.
2) Seguros: de vida, accidentes, educativos, empresariales, para vehículos y para viajes internacionales.
3) Organización financiera: crédito de consumo, de vehículo e hipotecario.
Hoy es ${new Date().toLocaleString("es-CO", { timeZone: TZ, dateStyle: "full", timeStyle: "short" })} (zona America/Bogota).
Reglas:
- Responde en español, de forma amable y con mensajes cortos.
- Detecta qué área le interesa a la persona y hazle una o dos preguntas para entender su necesidad.
- Si quiere hablar con un asesor, pide nombre, correo, tema y horario preferido. Consulta la disponibilidad con la herramienta ANTES de proponer horarios, confirma con el cliente y solo entonces agenda la reunión.
- Para ofrecer opciones rápidas, termina tu mensaje con una línea: BOTONES: Opción 1 | Opción 2 | Opción 3 (máximo 3 opciones, de hasta 20 caracteres cada una).
- No inventes precios, tasas, ubicaciones ni datos. Si no sabes algo, di que un asesor lo contactará.`;

const tools = [{
  functionDeclarations: [
    {
      name: "consultar_disponibilidad",
      description: "Devuelve los horarios ocupados del calendario entre dos fechas.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          desde: { type: Type.STRING, description: "ISO 8601 con zona, ej: 2026-10-08T08:00:00-05:00" },
          hasta: { type: Type.STRING, description: "ISO 8601 con zona" },
        },
        required: ["desde", "hasta"],
      },
    },
    {
      name: "agendar_reunion",
      description: "Crea la reunión en Google Calendar con enlace de Meet y avisa al asesor por correo.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          nombre: { type: Type.STRING },
          email: { type: Type.STRING },
          asunto: { type: Type.STRING },
          inicio: { type: Type.STRING, description: "ISO 8601 con zona, ej: 2026-10-08T15:00:00-05:00" },
          duracion_min: { type: Type.NUMBER },
        },
        required: ["nombre", "email", "asunto", "inicio"],
      },
    },
  ],
}];

const herramientas = {
  async consultar_disponibilidad({ desde, hasta }) {
    const r = await calendar.freebusy.query({
      requestBody: { timeMin: desde, timeMax: hasta, timeZone: TZ, items: [{ id: "primary" }] },
    });
    return { ocupado: r.data.calendars.primary.busy };
  },

  async agendar_reunion({ nombre, email, asunto, inicio, duracion_min = 30 }) {
    const fin = new Date(new Date(inicio).getTime() + duracion_min * 60000).toISOString();
    const ev = await calendar.events.insert({
      calendarId: "primary",
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: {
        summary: `${asunto} - ${nombre}`,
        start: { dateTime: inicio, timeZone: TZ },
        end: { dateTime: fin, timeZone: TZ },
        attendees: [{ email }],
        conferenceData: {
          createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
      },
    });
    const meet = ev.data.hangoutLink;
    await mailer.sendMail({
      from: GMAIL_USER,
      to: OWNER_EMAIL,
      subject: `Nueva reunión agendada: ${nombre}`,
      text: `Cliente: ${nombre}\nCorreo: ${email}\nTema: ${asunto}\nInicio: ${inicio}\nMeet: ${meet}`,
    });
    return { ok: true, meet };
  },
};

// Memoria por cliente (se borra si reinicias el servidor)
const memoria = new Map();
const recortar = (h) => {
  const r = h.slice(-30);
  while (r.length && !(r[0].role === "user" && r[0].parts?.[0]?.text)) r.shift();
  return r;
};

// Llama a Gemini y reintenta si Google está saturado (errores temporales 429/500/503)
async function generar(contents) {
  for (let intento = 1; ; intento++) {
    try {
      return await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: { systemInstruction: systemPrompt(), tools },
      });
    } catch (e) {
      const temporal = [429, 500, 503].includes(e.status) || /UNAVAILABLE|high demand/i.test(e.message);
      if (!temporal || intento >= 4) throw e;
      await new Promise((r) => setTimeout(r, intento * 3000));
    }
  }
}

async function responder(tel, texto) {
  const hist = memoria.get(tel) ?? [];
  hist.push({ role: "user", parts: [{ text: texto }] });

  for (let i = 0; i < 6; i++) {
    const res = await generar(hist);
    hist.push(res.candidates[0].content);

    const llamadas = res.functionCalls;
    if (!llamadas?.length) {
      memoria.set(tel, recortar(hist));
      return res.text;
    }
    const partes = [];
    for (const c of llamadas) {
      let out;
      try { out = await herramientas[c.name](c.args); }
      catch (e) { out = { error: e.message }; }
      partes.push({ functionResponse: { name: c.name, response: out } });
    }
    hist.push({ role: "user", parts: partes });
  }
  return "Tuve un problema técnico, un asesor te contactará pronto.";
}

const wa = (body) =>
  fetch(`https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });

async function enviar(to, texto) {
  const m = texto.match(/^BOTONES:\s*(.+)$/m);
  const cuerpo = texto.replace(/^BOTONES:.*$/m, "").trim() || "¿Cómo te puedo ayudar?";
  if (m) {
    const buttons = m[1].split("|").slice(0, 3).map((t, i) => ({
      type: "reply", reply: { id: `b${i}`, title: t.trim().slice(0, 20) },
    }));
    return wa({ to, type: "interactive", interactive: { type: "button", body: { text: cuerpo }, action: { buttons } } });
  }
  return wa({ to, type: "text", text: { body: cuerpo } });
}

const app = express();
app.use(express.json());

app.get("/", (_req, res) => res.send("Bot de Aserfiplan activo"));

// Verificación del webhook (Meta llama a esta ruta una sola vez al configurarlo)
app.get("/webhook", (req, res) =>
  req.query["hub.verify_token"] === WA_VERIFY_TOKEN
    ? res.send(req.query["hub.challenge"])
    : res.sendStatus(403));

const vistos = new Set();
app.post("/webhook", (req, res) => {
  res.sendStatus(200); // responder rápido para que Meta no reintente
  const v = req.body.entry?.[0]?.changes?.[0]?.value;
  const msg = v?.messages?.[0];
  if (!msg || vistos.has(msg.id)) return;
  if (vistos.size > 5000) vistos.clear();
  vistos.add(msg.id);

  // Filtro: solo mensajes dirigidos al número de negocio
  const destino = (v.metadata?.display_phone_number ?? "").replace(/\D/g, "");
  if (destino !== BUSINESS_NUMBER.replace(/\D/g, "")) return;

  const texto = msg.text?.body ?? msg.interactive?.button_reply?.title;
  if (!texto) return;
  responder(msg.from, texto).then((r) => enviar(msg.from, r)).catch(console.error);
});

if (process.argv.includes("--consola")) {
  // Modo de prueba: conversas con el bot en la terminal, sin WhatsApp
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("Modo consola: escribe como si fueras el cliente (Ctrl+C para salir)\n");
  while (true) {
    const t = await rl.question("Tú: ");
    if (!t.trim()) continue;
    try {
      const r = await responder("consola", t);
      console.log(`\nBot: ${r.replace(/^BOTONES:/m, "[Botones]")}\n`);
    } catch (e) {
      console.error("\nError:", e.message, "\n");
    }
  }
} else {
  app.listen(PORT, () => console.log(`Bot de Aserfiplan listo en el puerto ${PORT}`));
}
