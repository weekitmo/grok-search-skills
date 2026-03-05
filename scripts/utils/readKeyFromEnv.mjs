import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// openclaw compatible
export function readKeyFromEnv() {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;

  const configPaths = [
    path.join(os.homedir(), ".clawdbot", "clawdbot.json"),
    path.join(os.homedir(), ".openclaw", "openclaw.json"),
  ];

  for (const p of configPaths) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const j = JSON.parse(raw);
      const key =
        j?.env?.XAI_API_KEY ||
        j?.env?.vars?.XAI_API_KEY ||
        j?.skills?.entries?.["grok-search"]?.apiKey ||
        j?.skills?.entries?.["search-x"]?.apiKey ||
        j?.skills?.entries?.xai?.apiKey ||
        null;
      if (key) return key;
    } catch {
      // Try next config path.
    }
  }

  return null;
}
