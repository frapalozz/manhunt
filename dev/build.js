// Unisce logica di gioco (testata con dev/game.test.js) e server in un unico file da incollare
// nell'editor delle Edge Functions di Supabase.  Uso: node dev/build.js
const fs = require("fs");
const path = require("path");
const game = fs.readFileSync(path.join(__dirname, "game.js"), "utf8").replace(/module\.exports\s*=\s*\{[\s\S]*?\};\s*$/, "");
const handler = fs.readFileSync(path.join(__dirname, "handler.js"), "utf8");
const out = `// @ts-nocheck
// Manhunt: Edge Function "manhunt" (file generato da dev/build.js: modifica i sorgenti in dev/ e rigenera).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

/* ===================== logica di gioco ===================== */
${game.trim()}

${handler.trim()}
`;
const dest = path.join(__dirname, "..", "supabase", "functions", "manhunt", "index.ts");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log("scritto", path.relative(process.cwd(), dest), out.length, "byte");
