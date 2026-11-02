import fs,{storage} from "../storage.js";
await storage.initialize();
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,"..");
const data=process.env.RIFT_DATA_DIR?path.resolve(process.env.RIFT_DATA_DIR):path.join(root,".data"); fs.mkdirSync(data,{recursive:true});
function password(){ const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; const part=()=>Array.from(crypto.randomBytes(5),b=>alphabet[b%alphabet.length]).join(""); return `RIFT-${part()}-${part()}-${part()}`; }
function record(name,role,pw){ const salt=crypto.randomBytes(16).toString("hex"); const hash=crypto.scryptSync(pw,salt,64).toString("hex"); return {id:crypto.randomUUID(),name,role,active:true,createdAt:new Date().toISOString(),createdBy:"auth:setup",salt,hash}; }
await storage.transaction(async()=>{
const admin=password(), tech=password();
fs.writeFileSync(path.join(data,"auth.json"),JSON.stringify({version:2,createdAt:new Date().toISOString(),users:[record("Admin","admin",admin),record("Technician","technician",tech)]},null,2));
fs.writeFileSync(path.join(data,"sessions.json"),"{}\n");
console.log("\nRIFT/OPS ACCESS SETUP\n---------------------");
console.log(`ADMIN:      ${admin}`);
console.log(`TECHNICIAN: ${tech}`);
console.log("\nParolele apar doar aici, in terminal. Pastreaza-le intr-un manager de parole.");
console.log("Conturi staff suplimentare se pot crea ulterior din Administrare > Acces staff.");
console.log("Rularea din nou a comenzii reseteaza conturile bootstrap si toate sesiunile.\n");

});
await storage.close();
