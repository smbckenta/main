import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.goto("http://localhost:3199/", { waitUntil: "networkidle" });
const banner = await p.locator(".error, .badge").allTextContents();
console.log("バナー:", banner.filter((t) => t.includes("AI")).join(" / ") || "(なし)");
await p.screenshot({ path: "/tmp/claude-0/-home-user-main/249d090c-67db-5524-9406-778165f2d22f/scratchpad/banner.png" });
await b.close();
