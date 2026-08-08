import fs from "fs";
import { sendTelegram } from "./telegram.mjs";

const THRESHOLD_MINUTES = 90; // más que suficiente margen sobre el cron de 15 min

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function loadHeartbeat() {
  try {
    return JSON.parse(fs.readFileSync(new URL("./heartbeat.json", import.meta.url), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error("Faltan TELEGRAM_TOKEN / TELEGRAM_CHAT_ID en las variables de entorno");
  }

  const heartbeat = loadHeartbeat();
  const lastRun = heartbeat?.lastRun ? new Date(heartbeat.lastRun).getTime() : null;
  const minutesSince = lastRun ? (Date.now() - lastRun) / 60000 : null;

  if (!lastRun || minutesSince > THRESHOLD_MINUTES) {
    const detail = lastRun
      ? `Última corrida hace ${Math.round(minutesSince)} minutos.`
      : "Nunca se registró una corrida (heartbeat.json ausente).";
    const msg = `⚠️ <b>Alertbot: posible corte</b>\n${detail}\nRevisá la pestaña Actions del repo — puede que el cron esté trabado o deshabilitado.`;
    await sendTelegram(TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, msg);
    console.log("Alerta de watchdog enviada:", detail);
  } else {
    console.log(`Todo OK. Última corrida hace ${minutesSince.toFixed(0)} minutos.`);
  }
}

main().catch((err) => {
  console.error("Fallo el watchdog:", err);
  process.exit(1);
});
