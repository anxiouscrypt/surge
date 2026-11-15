// The current public URL: pnpm demo rewrites this file when it has to open a new tunnel.
import { existsSync, readFileSync } from "node:fs";

export function publicUrl(): string {
  const file = process.env.PUBLIC_URL_FILE;
  if (file && existsSync(file)) {
    const v = readFileSync(file, "utf8").trim();
    if (v) return v.replace(/\/$/, "");
  }
  return (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
}
