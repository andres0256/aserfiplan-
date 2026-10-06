// Ayudante para conseguir el GOOGLE_REFRESH_TOKEN sin pasos complicados.
// Uso: npm run google-token   (antes llena GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env)
import http from "node:http";
import { google } from "googleapis";

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("Falta GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en el archivo .env");
  process.exit(1);
}

const PUERTO = 3001;
const REDIRECT = `http://localhost:${PUERTO}/oauth2callback`;
const oauth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT);
const url = oauth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/calendar"],
});

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PUERTO}`);
  if (u.pathname !== "/oauth2callback") return res.end();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  try {
    const { tokens } = await oauth.getToken(u.searchParams.get("code"));
    if (!tokens.refresh_token) throw new Error("Google no devolvió un refresh token. Vuelve a ejecutar el comando.");
    res.end("<h2>Listo. Ya puedes cerrar esta pestaña y volver a la terminal.</h2>");
    console.log("\nCopia esta línea en tu archivo .env:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (e) {
    res.end(`<h2>Error: ${e.message}</h2>`);
    console.error("Error:", e.message);
  }
  servidor.close(() => process.exit(0));
});

servidor.listen(PUERTO, () => {
  console.log("Abre este enlace en tu navegador y autoriza con la cuenta del calendario:\n");
  console.log(url + "\n");
});
