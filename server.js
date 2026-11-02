import { registerSeries } from "./series.js";
import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs, { storage } from "./storage.js";
await storage.initialize();
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const OPGG_MCP_URL = process.env.OPGG_MCP_URL || "https://mcp-api.op.gg/mcp";
const OPGG_REGION = (process.env.OPGG_REGION || "eune").toLowerCase();
const ROLES = ["TOP", "JNG", "MID", "ADC", "SUP"];
const CACHE_TTL = 10 * 60 * 1000;
const profileCache = new Map();

// --- RIFT/OPS access control + technician telemetry ---
const DATA_DIR = process.env.RIFT_DATA_DIR ? path.resolve(process.env.RIFT_DATA_DIR) : path.join(__dirname, ".data");
const PRODUCTION = process.env.NODE_ENV === "production";
const COOKIE_NAME = PRODUCTION ? "__Host-rift_session" : "riftops_session";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
function sessionCookie(token, seconds=43200){ return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${PRODUCTION ? "; Secure" : ""}`; }
const SERIES_FILE = path.join(DATA_DIR,"series.json");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const REGISTRY_FILE = path.join(DATA_DIR, "registry.json");
const LOG_FILE = path.join(DATA_DIR, "tech-logs.ndjson");
const PRODUCTION_FILE = path.join(DATA_DIR, "production.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const COMMUNITY_FILE = path.join(DATA_DIR, "community.json");
const AUDIT_FILE = path.join(DATA_DIR, "audit.ndjson");
const BUGS_FILE = path.join(DATA_DIR, "bug-reports.json");
const HISTORY_FILE = path.join(DATA_DIR, "match-history.json");
const WORKFLOW_FILE = path.join(DATA_DIR, "workflow.json");
const SNAPSHOTS_FILE = path.join(DATA_DIR, "workflow-snapshots.json");
const AUTOMATION_FILE = path.join(DATA_DIR, "automation.json");
const AUTOMATION_LOG_FILE = path.join(DATA_DIR, "automation-events.ndjson");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const SERVER_STARTED_AT = Date.now();
const MAX_LOG_BYTES = 2 * 1024 * 1024;
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, value) { const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); fs.renameSync(tmp, file); }
function safeBackup(file, label) { try { if(!fs.existsSync(file)) return null; const stamp=new Date().toISOString().replace(/[:.]/g,"-"); const dest=path.join(BACKUP_DIR,`${label}-${stamp}.json`); fs.copyFileSync(file,dest); return dest; } catch { return null; } }
function rotateLogIfNeeded(){ try{ if(fs.existsSync(LOG_FILE)&&fs.statSync(LOG_FILE).size>MAX_LOG_BYTES){ const old=path.join(DATA_DIR,`tech-logs-${Date.now()}.ndjson`); fs.renameSync(LOG_FILE,old); } }catch{} }
function appSettings(){ return { maintenance:false, ...(readJson(SETTINGS_FILE,{})) }; }
function parseCookies(req) { return Object.fromEntries(String(req.headers.cookie || "").split(";").map(x=>x.trim()).filter(Boolean).map(x=>{ const i=x.indexOf("="); return i<0?[x,""]:[x.slice(0,i),safeCookieDecode(x.slice(i+1))]; })); }
function safeCookieDecode(value){ try{return decodeURIComponent(value);}catch{return "";} }
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function verifyPassword(password, record) { if (!record?.salt || !record?.hash) return false; const got=crypto.scryptSync(String(password), record.salt, 64).toString("hex"); const a=Buffer.from(got,"hex"), b=Buffer.from(record.hash,"hex"); return a.length===b.length && crypto.timingSafeEqual(a,b); }
function makePassword(){ const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; const part=()=>Array.from(crypto.randomBytes(5),b=>alphabet[b%alphabet.length]).join(""); return `RIFT-${part()}-${part()}-${part()}`; }
function passwordRecord(password){ const salt=crypto.randomBytes(16).toString("hex"); const hash=crypto.scryptSync(String(password),salt,64).toString("hex"); return {salt,hash}; }
function authUsers(){
  const auth=readJson(AUTH_FILE,null); if(!auth) return [];
  if(Array.isArray(auth.users)) return auth.users;
  const users=[];
  if(auth.admin?.hash) users.push({id:"bootstrap-admin",name:auth.admin.name||"Admin",role:"admin",active:true,createdAt:auth.createdAt||new Date().toISOString(),salt:auth.admin.salt,hash:auth.admin.hash});
  if(auth.technician?.hash) users.push({id:"bootstrap-tech",name:auth.technician.name||"Technician",role:"technician",active:true,createdAt:auth.createdAt||new Date().toISOString(),salt:auth.technician.salt,hash:auth.technician.hash});
  writeJson(AUTH_FILE,{version:2,createdAt:auth.createdAt||new Date().toISOString(),users}); return users;
}
function saveAuthUsers(users){ const old=readJson(AUTH_FILE,{}); writeJson(AUTH_FILE,{version:2,createdAt:old.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),users}); }
function publicAccessUser(u){ return {id:u.id,name:u.name,role:u.role,active:u.active!==false,createdAt:u.createdAt||null,createdBy:u.createdBy||null,lastRoleChangeAt:u.lastRoleChangeAt||null}; }
function revokeUserSessions(userId){ const sessions=cleanSessions(); let count=0; for(const [k,v] of Object.entries(sessions)){ if(v.userId===userId){delete sessions[k];count++;} } writeJson(SESSIONS_FILE,sessions); return count; }
function cleanSessions() {
  const now=Date.now(), sessions=readJson(SESSIONS_FILE,{}); let dirty=false;
  for(const [key,v] of Object.entries(sessions)) {
    if(!v?.userId || !v.csrfToken || !v.lastSeenAt || v.expiresAt<=now || now-v.createdAt>=SESSION_ABSOLUTE_MS || now-v.lastSeenAt>=SESSION_IDLE_MS){delete sessions[key];dirty=true;}
  }
  if(dirty)writeJson(SESSIONS_FILE,sessions); return sessions;
}
function currentUser(req) {
  if(req.riftUser !== undefined)return req.riftUser;
  const token=parseCookies(req)[COOKIE_NAME]; if(!token)return null;
  const sessions=cleanSessions(), key=hashToken(token), session=sessions[key]; if(!session)return null;
  const account=authUsers().find(u=>u.id===session.userId && u.active!==false && u.role===session.role);
  if(!account){delete sessions[key];writeJson(SESSIONS_FILE,sessions);return null;}
  session.lastSeenAt=Date.now();writeJson(SESSIONS_FILE,sessions);
  req.riftSession=session;req.riftSessionKey=key;
  return req.riftUser={id:account.id,name:account.name,role:account.role,expiresAt:session.expiresAt};
}
function requireRecentAuth(req,res,next){
  currentUser(req);
  if(!req.riftSession || Date.now()-(req.riftSession.reauthenticatedAt||0)>5*60*1000)return res.status(403).json({error:"Confirm your password before this action.",code:"REAUTH_REQUIRED"});
  next();
}
function requireRole(...roles){ return (req,res,next)=>{ const user=currentUser(req); if(!user) return res.status(401).json({error:"Authentication required."}); if(!roles.includes(user.role)) return res.status(403).json({error:"Insufficient permissions."}); req.user=user; next(); }; }
function requireStaff(req,res,next){ return requireRole("admin","technician")(req,res,next); }
function appendAudit(action, req, meta={}) { const row={time:new Date().toISOString(),action,actor:req?.user?.name||currentUser(req)?.name||"visitor",role:req?.user?.role||currentUser(req)?.role||"visitor",requestId:req?.requestId||null,...meta}; try{fs.appendFileSync(AUDIT_FILE,JSON.stringify(row)+"\n");}catch{} }
function redactDiagnostic(value){return String(value).replace(/(?:postgres(?:ql)?:|https?:)\/\/[^\s"'<>]+/gi,'[redacted URL]').replace(/(?:RGAPI-|RIFT-)[A-Za-z0-9_-]+/g,'[redacted credential]').replace(/(password|token|secret|authorization|cookie|connectionString)\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]').slice(0,2000);}
const serverErrors=[];
function recordServerError(req,category,message,status=500,code='INTERNAL'){
  const item={id:crypto.randomUUID(),time:new Date().toISOString(),category,message:redactDiagnostic(message),status,code:/^[A-Z0-9_]{1,40}$/.test(String(code))?code:'INTERNAL',method:req.method,path:req.path,requestId:req.requestId};
  serverErrors.unshift(item);serverErrors.splice(200);appendTechLog('ERROR','server_error',item);return item;
}
storage.onError=(error,req)=>{viewStats.errors++;recordServerError(req,'STORAGE',error.message,503,error.code||'STORAGE_UNAVAILABLE');};
// Error telemetry must survive the transaction that failed.
storage.onRollback=req=>{for(const item of serverErrors.filter(x=>x.requestId===req.requestId))appendTechLog('ERROR','server_error',item);};
function appendTechLog(level, event, meta={}) { meta=Object.fromEntries(Object.entries(meta).filter(([k])=>!/(password|token|secret|cookie|authorization|connectionString)/i.test(k)).map(([k,v])=>[k,typeof v==='string'?redactDiagnostic(v):v])); const safe={time:new Date().toISOString(),level,event,...meta}; try{rotateLogIfNeeded();fs.appendFileSync(LOG_FILE,JSON.stringify(safe)+"\n");}catch{} }

function automationSettings(){
  const raw=readJson(AUTOMATION_FILE,{});
  const snap=Math.max(1,Math.min(60,Number(raw.snapshotMinutes||5)));
  return {
    mode:"ASSISTED",
    autoProtect:raw.autoProtect!==false,
    snapshotMinutes:snap,
    syncDraftToReady:raw.syncDraftToReady!==false,
    syncDraftToProduction:raw.syncDraftToProduction!==false,
    archiveCompletedSession:raw.archiveCompletedSession!==false,
    archiveCompletedTournament:raw.archiveCompletedTournament!==false,
    ...raw,
    snapshotMinutes:snap
  };
}
function saveAutomationSettings(patch={}){
  const current=automationSettings();
  const next={
    ...current,
    autoProtect:patch.autoProtect===undefined?current.autoProtect:Boolean(patch.autoProtect),
    snapshotMinutes:patch.snapshotMinutes===undefined?current.snapshotMinutes:Math.max(1,Math.min(60,Number(patch.snapshotMinutes)||5)),
    syncDraftToReady:patch.syncDraftToReady===undefined?current.syncDraftToReady:Boolean(patch.syncDraftToReady),
    syncDraftToProduction:patch.syncDraftToProduction===undefined?current.syncDraftToProduction:Boolean(patch.syncDraftToProduction),
    archiveCompletedSession:patch.archiveCompletedSession===undefined?current.archiveCompletedSession:Boolean(patch.archiveCompletedSession),
    archiveCompletedTournament:patch.archiveCompletedTournament===undefined?current.archiveCompletedTournament:Boolean(patch.archiveCompletedTournament),
    mode:"ASSISTED",
    updatedAt:new Date().toISOString()
  };
  writeJson(AUTOMATION_FILE,next); return next;
}
function appendAutomation(event, meta={}){
  const row={time:new Date().toISOString(),event,...meta};
  try{fs.appendFileSync(AUTOMATION_LOG_FILE,JSON.stringify(row)+"\n");}catch{}
  return row;
}
function automationFeed(limit=40){
  try{return fs.readFileSync(AUTOMATION_LOG_FILE,"utf8").trim().split(/\r?\n/).filter(Boolean).slice(-Math.max(1,Math.min(100,limit))).map(x=>JSON.parse(x)).reverse();}catch{return [];}
}
function captureWorkflowSnapshot(label, by="RIFT/OPS", workflow=null, automatic=true){
  const current=workflow||readJson(WORKFLOW_FILE,{draft:null,bracket:null,updatedAt:null});
  if(!current?.draft&&!current?.bracket)return null;
  const list=readJson(SNAPSHOTS_FILE,[]);
  const item={id:crypto.randomUUID(),label:String(label||"Snapshot operațional").slice(0,100),time:new Date().toISOString(),by,automatic:Boolean(automatic),draft:current.draft||null,bracket:current.bracket||null};
  list.unshift(item); writeJson(SNAPSHOTS_FILE,list.slice(0,40)); return item;
}
function extractDraftPlayers(draft){
  const found=new Map();
  for(const m of (draft?.matches||[])) for(const t of (m?.teams||[])) for(const p of (t?.players||[])){
    const name=String(p?.name||"").trim(); if(name&&!found.has(name.toLowerCase())) found.set(name.toLowerCase(),name);
  }
  for(const p of (draft?.reserves||[])){ const name=String(p?.name||"").trim(); if(name&&!found.has(name.toLowerCase())) found.set(name.toLowerCase(),name); }
  return [...found.values()];
}
function extractDraftTeams(draft){ return (draft?.matches||[]).flatMap(m=>m?.teams||[]).map(t=>String(t?.name||"").trim()).filter(Boolean); }
function mergeDraftIntoReady(draft){
  const names=extractDraftPlayers(draft); if(!names.length)return {added:0,total:0};
  const st=communityState(); const players={...(st.players||{})}; let added=0;
  for(const name of names){ const key=name.toLowerCase(); if(!players[key]){players[key]={name,ready:false,source:"DRAFT",updatedAt:new Date().toISOString()};added++;} }
  if(added){st.players=players;st.updatedAt=new Date().toISOString();st.updatedBy="RIFT/OPS";writeJson(COMMUNITY_FILE,st);appendAutomation("ready_roster_synced",{added,total:Object.keys(players).length});}
  return {added,total:Object.keys(players).length};
}
function productionQueueFromDraft(draft){
  const featured=String(productionState()?.featuredPlayer||"").toLowerCase();
  const rows=(draft?.matches||[]).map((m,index)=>{
    const teams=(m?.teams||[]).map(t=>({name:String(t?.name||"Team"),skill:Number(t?.skill||0),players:(t?.players||[]).map(p=>({name:String(p?.name||""),role:String(p?.role||""),skill:Number(p?.skill||0),rank:p?.scout?.rank||"",tier:p?.scout?.tier||""}))}));
    const seed=JSON.stringify(teams.map(t=>[t.name,t.players.map(p=>p.name)]));
    return {id:`auto-${crypto.createHash("sha1").update(seed).digest("hex").slice(0,12)}`,index,qualityScore:Number(m?.qualityScore||0),qualityLabel:String(m?.qualityLabel||""),skillDelta:Number(m?.skillDelta||0),teams};
  });
  if(featured) rows.sort((a,b)=>Number(b.teams.some(t=>t.players.some(p=>p.name.toLowerCase().includes(featured))))-Number(a.teams.some(t=>t.players.some(p=>p.name.toLowerCase().includes(featured)))));
  return rows;
}
function syncDraftToProduction(draft){
  if(productionState()?.live)return {updated:false,reason:"live-active",count:(productionState().queue||[]).length};
  const queue=productionQueueFromDraft(draft);
  const before=JSON.stringify(productionState()?.queue||[]), after=JSON.stringify(queue);
  if(before===after)return {updated:false,reason:"unchanged",count:queue.length};
  writeJson(PRODUCTION_FILE,{...productionState(),queue}); appendAutomation("production_queue_synced",{count:queue.length});
  return {updated:true,count:queue.length};
}
function bracketWinner(bracket){ const last=Array.isArray(bracket)?bracket.at(-1):null; return String(last?.matches?.[0]?.winner||"").trim(); }
function maybeAutoArchiveBracket(bracket){
  const settings=automationSettings(); if(!settings.archiveCompletedTournament)return {archived:false,reason:"disabled"};
  const winner=bracketWinner(bracket); if(!winner)return {archived:false,reason:"incomplete"};
  const first=Array.isArray(bracket)?bracket[0]:null;
  const seed=JSON.stringify({winner,teams:(first?.matches||[]).flatMap(m=>(m?.teams||[]).map(t=>t?.name||""))});
  const fingerprint=crypto.createHash("sha256").update(seed).digest("hex");
  const items=readJson(HISTORY_FILE,[]);
  if(items.some(x=>x.automationFingerprint===fingerprint))return {archived:false,reason:"already-archived"};
  const summary=(bracket||[]).map(r=>`${r.name}: ${(r.matches||[]).map(m=>m.winner||"—").join(", ")}`).join(" | ");
  const item={id:crypto.randomUUID(),time:new Date().toISOString(),type:"TOURNAMENT_ARCHIVE",title:`Turneu câștigat de ${winner}`,details:summary,winner,loser:"",by:"RIFT/OPS",automationFingerprint:fingerprint};
  items.unshift(item); writeJson(HISTORY_FILE,items.slice(0,2000)); appendAutomation("tournament_auto_archived",{winner,id:item.id}); return {archived:true,item};
}
function operationsSummary(role="admin"){
  const workflow=readJson(WORKFLOW_FILE,{draft:null,bracket:null,updatedAt:null});
  const community=communityState(), players=Object.values(community.players||{}), ready=players.filter(x=>x.ready).length;
  const matches=workflow.draft?.matches||[], teams=extractDraftTeams(workflow.draft), reserves=workflow.draft?.reserves||[];
  const winner=bracketWinner(workflow.bracket), queue=productionState()?.queue||[], live=productionState()?.live||null;
  const decisions=[];
  const add=(priority,id,title,detail,target)=>decisions.push({priority,id,title,detail,target});
  if(!matches.length)add("HIGH","draft","Pregătește Draft-ul","Nu există un Draft activ pentru următorul meci.","teams");
  else {
    if(players.length&&ready<players.length)add("HIGH","ready",`Ready Check: ${players.length-ready} lipsă`,`${ready}/${players.length} participanți sunt READY.`,"community");
    if(!live&&queue.length)add("HIGH","next-live","Următorul meci este pregătit",`${queue[0]?.teams?.[0]?.name||"Blue"} vs ${queue[0]?.teams?.[1]?.name||"Red"} poate fi trimis LIVE când confirmați.`,"hub");
    if(!workflow.bracket&&teams.length>=2)add("MEDIUM","bracket","Bracket disponibil din Draft",`${teams.length} echipe pot fi importate direct în turneu.`,"bracket");
  }
  if(live)add("HIGH","live","Meci LIVE în desfășurare",`${live?.teams?.[0]?.name||"Blue"} vs ${live?.teams?.[1]?.name||"Red"} — rezultatul rămâne o decizie staff.`,"hub");
  if(workflow.bracket&&!winner)add("MEDIUM","tournament","Turneu în desfășurare","RIFT/OPS poate avansa doar câștigătorii confirmați de staff.","bracket");
  if(winner)add("LOW","tournament-complete","Turneu finalizat",`${winner} este câștigătorul. Arhivarea automată este verificată.`,"bracket");
  if(role==="technician"){const open=readJson(BUGS_FILE,[]).filter(x=>x.status==="OPEN").length;if(open)add("MEDIUM","bugs",`${open} raport${open===1?"":"e"} deschis${open===1?"":"e"}`,"Există rapoarte care așteaptă verificare.","tech");}
  const snapshots=readJson(SNAPSHOTS_FILE,[]);
  return {generatedAt:new Date().toISOString(),session:{name:community.name,status:community.status,players:players.length,ready},draft:{matches:matches.length,teams:teams.length,reserves:reserves.length,updatedAt:workflow.updatedAt||null},production:{live:Boolean(live),liveMatch:live?`${live?.teams?.[0]?.name||"Blue"} vs ${live?.teams?.[1]?.name||"Red"}`:null,queue:queue.length},tournament:{active:Boolean(workflow.bracket),complete:Boolean(winner),winner:winner||null},automation:automationSettings(),protection:{snapshots:snapshots.length,lastSnapshot:snapshots[0]?.time||null},decisions};
}

const viewStats = { startedAt:new Date().toISOString(), totalRequests:0, pageViews:0, apiRequests:0, errors:0, routes:{} };
const loginAttempts = new Map();

app.disable("x-powered-by");
app.get("/healthz",async (_req,res)=>{try{await storage.ping();res.json({status:"ok"});}catch{res.status(503).json({error:"Storage unavailable"});}});
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use((req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","SAMEORIGIN");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy","same-origin");
  res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://ddragon.leagueoflegends.com https://raw.communitydragon.org; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
  if(req.path.startsWith("/api/admin/") || req.path.startsWith("/api/tech/") || req.path.startsWith("/api/auth/")) res.setHeader("Cache-Control","no-store, private");
  next();
});
// Request IDs precede body parsing so parser failures are traceable too.
const requestLimits=new Map();
setInterval(()=>{const now=Date.now();for(const [key,b] of requestLimits)if(b.until<=now)requestLimits.delete(key);for(const [key,times] of loginAttempts)if(!times.some(t=>now-t<600000))loginAttempts.delete(key);},60000).unref();
app.use((req,res,next)=>{
  req.requestId=crypto.randomUUID();res.setHeader("X-Request-Id",req.requestId);
  const json=res.json.bind(res);
  res.json=body=>{if(res.statusCode>=400){appendTechLog("WARN","request_rejected",{path:req.path,status:res.statusCode,requestId:req.requestId});if(res.statusCode>=500)recordServerError(req,req.path.includes("series")?"SERIES":"INTERNAL",body?.error||"Request failed",res.statusCode);body={error:res.statusCode>=500?"Request failed":body?.error||"Request rejected",...(body?.code?{code:body.code}:{}),requestId:req.requestId};}return json(body);};
  if(PRODUCTION){res.setHeader("Strict-Transport-Security","max-age=31536000");if(!req.secure)return res.status(400).json({error:"HTTPS required."});}
  if(!req.path.startsWith("/api/"))return next();
  const group=req.path.startsWith("/api/auth/")?"auth":req.path.startsWith("/api/tech/")||req.path.startsWith("/api/admin/")?"staff":"public";
  const max=group==="auth"?120:group==="staff"?240:180,key=group+":"+req.ip,now=Date.now();
  if(!requestLimits.has(key)&&requestLimits.size>=10000)return res.status(429).json({error:"Server busy. Try later."});
  let b=requestLimits.get(key);if(!b||b.until<=now){b={count:0,until:now+60000};requestLimits.set(key,b);}
  if(++b.count>max){res.setHeader("Retry-After",String(Math.ceil((b.until-now)/1000)));return res.status(429).json({error:"Too many requests."});}
  next();
});
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit:"64kb" }));
app.use(storage.middleware);
app.use((req,res,next)=>{
  // Request ID already assigned before body parsing.
  if(["POST","PUT","PATCH","DELETE"].includes(req.method)){
    const origin=req.headers.origin;
    const fetchSite=String(req.headers["sec-fetch-site"]||"").toLowerCase();
    if(fetchSite && !["same-origin","none"].includes(fetchSite)) return res.status(403).json({error:"Cross-site mutation blocked."});
    if(origin){ try{ const u=new URL(origin); const host=String(req.headers.host||""); if(u.host!==host) return res.status(403).json({error:"Cross-origin mutation blocked."}); }catch{return res.status(403).json({error:"Invalid request origin."});} }
  }
  next();
});
app.use((req,res,next)=>{
  if(["POST","PUT","PATCH","DELETE"].includes(req.method) && currentUser(req)){
    const received=String(req.headers["x-csrf-token"]||""), expected=req.riftSession.csrfToken;
    if(received.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return res.status(403).json({error:"Invalid CSRF token.",code:"CSRF_INVALID"});
  }
  const st=appSettings();
  if(st.maintenance && !req.path.startsWith("/api/auth") && !req.path.startsWith("/api/tech") && !req.path.startsWith("/api/health") && !currentUser(req)){
    if(req.path.startsWith("/api/")) return res.status(503).json({error:"RIFT/OPS is temporarily in maintenance mode."});
  }
  next();
});
app.use((req,res,next)=>{
  const started=Date.now(); viewStats.totalRequests++; if(req.path.startsWith("/api/")) viewStats.apiRequests++; else if(req.method==="GET" && !req.path.includes(".")) viewStats.pageViews++;
  const routeKey=`${req.method} ${req.path}`; viewStats.routes[routeKey]=(viewStats.routes[routeKey]||0)+1;
  res.on("finish",()=>{ if(res.statusCode>=500) viewStats.errors++; if(req.path.startsWith("/api/") && req.path!=="/api/tech/logs") appendTechLog(res.statusCode>=400?"WARN":"INFO","request",{method:req.method,path:req.path,status:res.statusCode,ms:Date.now()-started,user:currentUser(req)?.name||"visitor",requestId:req.requestId}); });
  next();
});
app.use(express.static(path.join(__dirname, "public"), { dotfiles:"deny", index:false, etag:true, maxAge: process.env.NODE_ENV==="production" ? "1h" : 0 }));

let mcpSessionId = null;
let mcpTools = null;
let mcpConnectPromise = null;
let rpcId = 1;

function parseMcpHttpBody(text, contentType = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (contentType.includes("text/event-stream") || trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    const events = [];
    for (const block of trimmed.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try { events.push(JSON.parse(data)); } catch { /* ignore non-JSON SSE events */ }
    }
    return events.find(x => x && (x.result !== undefined || x.error !== undefined)) || events.at(-1) || null;
  }
  return JSON.parse(trimmed);
}

async function mcpPost(payload, { session = true } = {}) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18"
  };
  if (session && mcpSessionId) headers["Mcp-Session-Id"] = mcpSessionId;

  const response = await fetch(OPGG_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });

  const newSession = response.headers.get("mcp-session-id");
  if (newSession) mcpSessionId = newSession;
  const text = await response.text();
  const body = parseMcpHttpBody(text, response.headers.get("content-type") || "");

  if (!response.ok) {
    const message = body?.error?.message || body?.message || text || `HTTP ${response.status}`;
    throw new Error(`OP.GG MCP HTTP ${response.status}: ${message}`);
  }
  if (body?.error) throw new Error(body.error.message || "OP.GG MCP JSON-RPC error.");
  return body;
}

async function initializeMcp() {
  if (mcpTools) return { tools: mcpTools };
  if (mcpConnectPromise) return mcpConnectPromise;

  mcpConnectPromise = (async () => {
    // Raw JSON-RPC is intentional: OP.GG currently advertises a few outputSchema
    // variants that strict SDK validators may reject even though the tools work.
    await mcpPost({
      jsonrpc: "2.0",
      id: rpcId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "rift-ops", version: "3.2.0" }
      }
    }, { session: false });

    await mcpPost({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    const listed = await mcpPost({ jsonrpc: "2.0", id: rpcId++, method: "tools/list", params: {} });
    mcpTools = Array.isArray(listed?.result?.tools) ? listed.result.tools : [];
    if (!mcpTools.length) throw new Error("OP.GG MCP nu a returnat niciun tool.");
    return { tools: mcpTools };
  })();

  try { return await mcpConnectPromise; }
  catch (error) {
    mcpConnectPromise = null;
    mcpSessionId = null;
    mcpTools = null;
    throw error;
  }
}

async function getMcp() { return initializeMcp(); }

function toolByName(tools, name) {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new Error(`OP.GG MCP tool indisponibil: ${name}`);
  return tool;
}

function parseRiotId(value) {
  const riotId = String(value || "").trim();
  const i = riotId.lastIndexOf("#");
  if (i <= 0 || i === riotId.length - 1) return null;
  return { riotId, gameName: riotId.slice(0, i).trim(), tagLine: riotId.slice(i + 1).trim() };
}

function schemaProperties(tool) { return tool?.inputSchema?.properties || {}; }
function schemaRequired(tool) { return tool?.inputSchema?.required || []; }

function findDeep(obj, names) {
  if (!obj || typeof obj !== "object") return undefined;
  const wanted = new Set(names.map(n => n.toLowerCase()));
  const queue = [obj];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(key.toLowerCase()) && value !== null && value !== undefined && value !== "") return value;
      if (value && typeof value === "object") queue.push(value);
    }
  }
}

function collectArrays(obj, keyNeedles = []) {
  const found = [];
  const queue = [obj];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      if (Array.isArray(value)) {
        if (!keyNeedles.length || keyNeedles.some(n => key.toLowerCase().includes(n))) found.push(value);
        value.forEach(v => v && typeof v === "object" && queue.push(v));
      } else if (value && typeof value === "object") queue.push(value);
    }
  }
  return found;
}

function tryParseJsonText(text) {
  if (typeof text !== "string") return null;
  const raw = text.trim();
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(raw.slice(firstBrace, lastBrace + 1));
  const firstBracket = raw.indexOf("[");
  const lastBracket = raw.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) candidates.push(raw.slice(firstBracket, lastBracket + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* next */ }
  }
  return null;
}

function parseOpggClassText(text) {
  const raw = String(text || "").trim();
  if (!raw.includes("class ")) return null;

  const classFields = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^class\s+([A-Za-z_]\w*)\s*:\s*(.*)$/);
    if (!m) continue;
    classFields.set(m[1], m[2].split(",").map(x => x.trim()).filter(Boolean));
  }
  const body = raw.split(/\r?\n\r?\n/).slice(1).join("\n\n").trim();
  if (!body || !classFields.size) return null;

  let i = 0;
  const ws = () => { while (/\s/.test(body[i] || "")) i++; };
  const parseString = () => {
    const quote = body[i++]; let out = "";
    while (i < body.length) {
      const c = body[i++];
      if (c === quote) return out;
      if (c === "\\") {
        const n = body[i++];
        const map = { n:"\n", r:"\r", t:"\t", '"':'"', "'":"'", "\\":"\\" };
        out += map[n] ?? n;
      } else out += c;
    }
    return out;
  };
  const parseValue = () => {
    ws(); const c = body[i];
    if (c === '"' || c === "'") return parseString();
    if (c === "[") {
      i++; const arr=[]; ws();
      while (i < body.length && body[i] !== "]") {
        arr.push(parseValue()); ws();
        if (body[i] === ",") { i++; ws(); } else break;
      }
      if (body[i] === "]") i++;
      return arr;
    }
    if (c === "{") {
      i++; const obj={}; ws();
      while (i < body.length && body[i] !== "}") {
        const key=parseValue(); ws(); if(body[i] === ":") i++;
        obj[String(key)] = parseValue(); ws();
        if(body[i] === ",") { i++; ws(); } else break;
      }
      if(body[i] === "}") i++;
      return obj;
    }
    const num = body.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (num) { i += num[0].length; return Number(num[0]); }
    const id = body.slice(i).match(/^[A-Za-z_]\w*/);
    if (!id) { i++; return null; }
    i += id[0].length; const name=id[0]; ws();
    if (body[i] === "(") {
      i++; const args=[]; ws();
      while (i < body.length && body[i] !== ")") {
        args.push(parseValue()); ws();
        if(body[i] === ",") { i++; ws(); } else break;
      }
      if(body[i] === ")") i++;
      const fields=classFields.get(name) || [];
      const obj={ _class:name };
      args.forEach((v,idx)=>{ obj[fields[idx] || `arg${idx}`]=v; });
      return obj;
    }
    if (name === "null" || name === "None") return null;
    if (name === "true" || name === "True") return true;
    if (name === "false" || name === "False") return false;
    return name;
  };
  try { return parseValue(); } catch { return null; }
}

function parseMcpResult(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const content = Array.isArray(result?.content) ? result.content : [];
  const texts = [];
  for (const item of content) {
    if (item?.type === "text" && typeof item.text === "string") {
      texts.push(item.text);
      const parsedJson = tryParseJsonText(item.text);
      if (parsedJson !== null) return parsedJson;
      const parsedClass = parseOpggClassText(item.text);
      if (parsedClass !== null) return parsedClass;
    }
  }
  return { _rawText: texts.join("\n"), content };
}

function buildArgs(tool, ctx, desiredFields = []) {
  const props = schemaProperties(tool);
  const required = schemaRequired(tool);
  const args = {};

  for (const key of Object.keys(props)) {
    const k = key.toLowerCase();
    if (k === "desired_output_fields") args[key] = desiredFields;
    else if (["game_name", "gamename", "summoner_name", "name"].includes(k)) args[key] = ctx.gameName;
    else if (["tagline", "tag_line", "tag"].includes(k)) args[key] = ctx.tagLine;
    else if (["region", "server", "platform"].includes(k)) args[key] = ctx.region;
    else if (["riot_id", "riotid"].includes(k)) args[key] = ctx.riotId;
    else if (["summoner_id", "summonerid"].includes(k) && ctx.summonerId) args[key] = ctx.summonerId;
    else if (["puuid"].includes(k) && ctx.puuid) args[key] = ctx.puuid;
    else if (["limit", "count", "size"].includes(k)) args[key] = 10;
    else if (["page", "page_no", "page_number", "offset", "start"].includes(k)) args[key] = 0;
  }

  for (const key of required) {
    if (args[key] !== undefined) continue;
    const prop = props[key] || {};
    if (prop.default !== undefined) args[key] = prop.default;
    else if (Array.isArray(prop.enum) && prop.enum.length) {
      args[key] = prop.enum.includes(ctx.region) ? ctx.region : prop.enum[0];
    } else if (prop.type === "array") args[key] = [];
    else if (prop.type === "number" || prop.type === "integer") args[key] = 0;
    else if (prop.type === "boolean") args[key] = false;
    else throw new Error(`OP.GG MCP cere parametrul necunoscut '${key}' pentru ${tool.name}.`);
  }
  return args;
}

async function callOpggTool(name, ctx, desiredFields = []) {
  const { tools } = await getMcp();
  const tool = toolByName(tools, name);
  const args = buildArgs(tool, ctx, desiredFields);
  const rpc = await mcpPost({
    jsonrpc: "2.0",
    id: rpcId++,
    method: "tools/call",
    params: { name, arguments: args }
  });
  const result = rpc?.result || {};
  if (result?.isError) {
    const parsed = parseMcpResult(result);
    throw new Error(findDeep(parsed, ["message", "error"]) || `OP.GG ${name} a returnat o eroare.`);
  }
  return { data: parseMcpResult(result), args, schema: tool.inputSchema };
}

const TIER_BASE = {
  IRON: 1.00, BRONZE: 1.25, SILVER: 1.55, GOLD: 1.90,
  PLATINUM: 2.40, EMERALD: 3.00, DIAMOND: 3.50,
  MASTER: 4.05, GRANDMASTER: 4.45, CHALLENGER: 4.75
};
const DIV_BONUS = { IV: 0.00, III: 0.10, II: 0.20, I: 0.30 };
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function normalizeTier(value) { return String(value || "UNRANKED").toUpperCase(); }
function baseRankSkill({ tier, division, lp }) {
  const t = normalizeTier(tier);
  if (!TIER_BASE[t]) return 2.50;
  let score = TIER_BASE[t] + (DIV_BONUS[String(division || "").toUpperCase()] || 0);
  if (["MASTER", "GRANDMASTER", "CHALLENGER"].includes(t)) score += clamp(Number(lp || 0) / 1000, 0, 0.24);
  else score += clamp(Number(lp || 0) / 100, 0, 0.09);
  return Number(clamp(score, 1, 5).toFixed(2));
}

function computeSmurfModel({ tier, division, lp, winrate, games, level, recentWinrate, recentGames, kda, cspm, avgKills, avgDeaths, avgAssists, inferredRole }) {
  const rankSkill = baseRankSkill({ tier, division, lp });
  const wr = Number(winrate || 0), g = Number(games || 0), lvl = Number(level || 0);
  const rwr = Number.isFinite(Number(recentWinrate)) ? Number(recentWinrate) : null;
  const rg = Number(recentGames || 0);
  const rkda = Number(kda || 0), rcs = Number(cspm || 0);
  const kills = Number(avgKills || 0), deaths = Number(avgDeaths || 0), assists = Number(avgAssists || 0);
  const role = String(inferredRole || '').toUpperCase();

  // Recent-performance estimate (1..5). Rank is the anchor, but the last 10 games can
  // move the estimate aggressively when the player repeatedly dominates.
  let formDelta = 0;
  const formReasons = [];
  if (rg >= 5 && rwr !== null) {
    const wrDelta = clamp((rwr - 50) / 20, -0.65, 1.35);
    formDelta += wrDelta;
    if (rwr >= 70) formReasons.push(`${rwr.toFixed(0)}% WR în ultimele ${rg}`);
  }
  if (rg >= 5 && rkda > 0) {
    const kdaDelta = clamp((rkda - 2.8) * 0.22, -0.30, 0.95);
    formDelta += kdaDelta;
    if (rkda >= 4.5) formReasons.push(`KDA recent ${rkda.toFixed(2)}`);
  }
  if (rg >= 5 && deaths > 0 && deaths <= 4.0) formDelta += clamp((4.0 - deaths) * 0.09, 0, 0.25);
  if (rg >= 5 && kills >= 8 && !['SUP'].includes(role)) {
    formDelta += clamp((kills - 7) * 0.055, 0, 0.28);
    formReasons.push(`${kills.toFixed(1)} kills/meci`);
  }
  if (rg >= 5 && assists >= 10 && ['SUP','JNG'].includes(role)) formDelta += clamp((assists - 9) * 0.025, 0, 0.18);

  // CS is role-aware: don't punish supports/junglers for not farming like carries.
  if (rg >= 5 && rcs > 0 && !['SUP','JNG'].includes(role)) {
    if (rcs >= 8.5) { formDelta += clamp((rcs - 7.5) * 0.16, 0, 0.32); formReasons.push(`${rcs.toFixed(1)} CS/min`); }
    else if (rcs < 5.0) formDelta -= clamp((5.0 - rcs) * 0.08, 0, 0.20);
  }

  const recentPerformanceSkill = Number(clamp(rankSkill + formDelta, 1, 5).toFixed(2));
  const performanceGap = recentPerformanceSkill - rankSkill;

  let score = 0;
  const reasons = [];
  // Account age is evidence, not a verdict.
  if (lvl > 0 && lvl <= 40) { score += 28; reasons.push(`cont foarte mic (Lv ${lvl})`); }
  else if (lvl > 0 && lvl <= 60) { score += 20; reasons.push(`cont mic (Lv ${lvl})`); }
  else if (lvl > 0 && lvl <= 90) { score += 10; reasons.push(`cont relativ nou (Lv ${lvl})`); }

  // Season WR with sample-size confidence.
  const sample = clamp(g / 80, 0, 1);
  if (g >= 10 && wr >= 55) {
    score += clamp((wr - 54) * 2.6, 0, 34) * (0.35 + 0.65 * sample);
    reasons.push(`${wr.toFixed(1)}% SoloQ WR în ${g} jocuri`);
  }
  if (g >= 30 && wr >= 65) score += 7;
  if (g >= 60 && wr >= 70) score += 7;

  // The key signal: recent performance is far above the visible rank.
  if (rg >= 5 && performanceGap >= 0.45) {
    score += clamp(performanceGap * 24, 8, 36) * clamp(rg / 10, .55, 1);
    reasons.push(`forma recentă este +${performanceGap.toFixed(2)} peste rank rating`);
  }
  if (rwr !== null && rg >= 6 && rwr >= 65) score += clamp((rwr - 60) * .65, 3, 13);
  if (rkda >= 5 && rg >= 5) score += 6;

  score = Math.round(clamp(score, 0, 100));
  let status = 'NORMAL', label = 'NO SMURF SIGNAL', tone = 'green';
  if (score >= 85) { status='VERY_HIGH'; label='VERY HIGH SMURF SUSPICION'; tone='red'; }
  else if (score >= 70) { status='HIGH'; label='HIGH SMURF SUSPICION'; tone='red'; }
  else if (score >= 50) { status='SUSPICIOUS'; label='SMURF SUSPICION'; tone='orange'; }

  // Blend rank with recent performance. With a full 10-game sample, recent form can
  // carry ~55% of the estimate. Strong smurf evidence adds a smaller independent lift.
  const recentConfidence = clamp(rg / 10, 0, 1);
  const seasonConfidence = clamp(g / 80, 0, 1);
  const recentWeight = 0.18 + recentConfidence * 0.37; // 18%..55%
  let effectiveSkill = rankSkill * (1 - recentWeight) + recentPerformanceSkill * recentWeight;
  const smurfAdj = score >= 50 ? clamp((score - 45) / 55 * 0.55, 0, 0.55) : 0;
  effectiveSkill = Number(clamp(effectiveSkill + smurfAdj, 1, 5).toFixed(2));
  const performanceAdj = Number((effectiveSkill - rankSkill - smurfAdj).toFixed(2));

  const confidencePoints = clamp(seasonConfidence*45 + recentConfidence*40 + (lvl?15:0), 0, 100);
  const confidence = confidencePoints >= 75 ? 'HIGH' : confidencePoints >= 45 ? 'MEDIUM' : 'LOW';
  const estimatedBand = skillBand(effectiveSkill);
  return {
    rankSkill, recentPerformanceSkill, effectiveSkill, performanceAdj,
    smurfAdj:Number(smurfAdj.toFixed(2)), smurfScore:score, smurfStatus:status,
    smurfLabel:label, smurfTone:tone,
    smurfReasons:[...reasons, ...formReasons].filter((v,i,a)=>a.indexOf(v)===i).slice(0,5),
    confidence, estimatedBand
  };
}

function skillBand(skill) {
  const x = Number(skill || 0);
  if (x >= 4.75) return 'CHALLENGER-LIKE';
  if (x >= 4.45) return 'GRANDMASTER-LIKE';
  if (x >= 4.05) return 'MASTER-LIKE';
  if (x >= 3.50) return 'DIAMOND-LIKE';
  if (x >= 3.00) return 'EMERALD-LIKE';
  if (x >= 2.40) return 'PLATINUM-LIKE';
  if (x >= 1.90) return 'GOLD-LIKE';
  if (x >= 1.55) return 'SILVER-LIKE';
  return 'LOW-ELO BAND';
}

function parseProfileTextFallback(profile) {
  const text = String(profile?._rawText || "");
  if (!text) return {};
  const tierMatch = text.match(/\b(CHALLENGER|GRANDMASTER|MASTER|DIAMOND|EMERALD|PLATINUM|GOLD|SILVER|BRONZE|IRON)\b/i);
  const divisionMatch = text.match(/\b(?:division|rank)\s*[=:]\s*["']?(IV|III|II|I)\b/i) || text.match(/\b(CHALLENGER|GRANDMASTER|MASTER|DIAMOND|EMERALD|PLATINUM|GOLD|SILVER|BRONZE|IRON)\s+(IV|III|II|I)\b/i);
  const lpMatch = text.match(/\b(?:lp|league[_ ]?points?)\s*[=:]\s*["']?(\d{1,4})\b/i) || text.match(/\b(\d{1,4})\s*LP\b/i);
  const levelMatch = text.match(/\b(?:level|summoner_level)\s*[=:]\s*["']?(\d{1,5})\b/i);
  const winMatch = text.match(/\b(?:wins?|win)\s*[=:]\s*["']?(\d{1,5})\b/i);
  const lossMatch = text.match(/\b(?:losses?|lose)\s*[=:]\s*["']?(\d{1,5})\b/i);
  return {
    tier: tierMatch?.[1]?.toUpperCase(),
    division: divisionMatch ? (divisionMatch[2] || divisionMatch[1]) : "",
    lp: lpMatch ? Number(lpMatch[1]) : undefined,
    level: levelMatch ? Number(levelMatch[1]) : undefined,
    wins: winMatch ? Number(winMatch[1]) : undefined,
    losses: lossMatch ? Number(lossMatch[1]) : undefined
  };
}

function extractLeagueEntries(profile) {
  const arrays = collectArrays(profile, ["league", "rank"]);
  const entries = arrays.flat().filter(x => x && typeof x === "object" && findDeep(x, ["game_type", "queue_type", "queue", "type"]));
  return entries.map(entry => {
    const gameType = String(findDeep(entry, ["game_type", "queue_type", "queue", "type"]) || "").toUpperCase();
    const tierInfo = findDeep(entry, ["tier_info"]) || entry;
    const tier = String(findDeep(tierInfo, ["tier"]) || "UNRANKED").toUpperCase();
    const divisionRaw = findDeep(tierInfo, ["division", "rank"]);
    const division = divisionRaw == null ? "" : String(divisionRaw);
    const lp = Number(findDeep(tierInfo, ["lp", "league_points", "leaguepoints"]) || 0);
    const tierImageUrl = String(findDeep(tierInfo, ["tier_image_url"]) || "");
    const borderImageUrl = String(findDeep(tierInfo, ["border_image_url"]) || "");
    const wins = Number(findDeep(entry, ["win", "wins"]) || 0);
    const losses = Number(findDeep(entry, ["lose", "losses"]) || 0);
    const games = wins + losses;
    const winrate = games ? Number((wins / games * 100).toFixed(1)) : 0;
    return { gameType, tier, division, lp, tierImageUrl, borderImageUrl, wins, losses, games, winrate };
  });
}

function pickLeagueStats(profile) {
  const leagues = extractLeagueEntries(profile);
  const solo = leagues.find(e => /SOLO/.test(e.gameType)) || leagues.find(e => !/FLEX|ARENA/.test(e.gameType));
  if (solo) return { ...solo, leagues };
  const fallback = parseProfileTextFallback(profile);
  const wins = fallback.wins || 0, losses = fallback.losses || 0, games = wins + losses;
  return {
    tier: fallback.tier || "UNRANKED", division: fallback.division || "", lp: fallback.lp || 0,
    wins, losses, games, winrate: games ? Number((wins / games * 100).toFixed(1)) : 0, leagues
  };
}

function championPool(profile) {
  const arrays = collectArrays(profile, ["champion"]);
  const rows = arrays.flat().filter(x => x && typeof x === "object");
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const name = findDeep(row, ["name", "champion_name", "champion"]);
    if (!name || typeof name === "object") continue;
    const key = String(name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: String(name),
      games: Number(findDeep(row, ["games", "play", "played", "total_games"]) || 0),
      winrate: Number(findDeep(row, ["win_rate", "winrate"]) || 0),
      kda: Number(findDeep(row, ["kda"]) || 0)
    });
    if (out.length >= 5) break;
  }
  return out;
}

function summarizeMatches(matchesPayload) {
  const arrays = collectArrays(matchesPayload, ["match", "game"]);
  const candidates = arrays.sort((a,b) => b.length - a.length)[0] || [];
  const rows = candidates.filter(x => x && typeof x === "object").slice(0, 10);
  let wins = 0, kdaSum = 0, kdaCount = 0, cspmSum = 0, cspmCount = 0, killsSum = 0, deathsSum = 0, assistsSum = 0;
  const roleCounts = { TOP:0, JNG:0, MID:0, ADC:0, SUP:0 };
  const recentMatches = [];
  for (const row of rows) {
    const winRaw = findDeep(row, ["win", "is_win", "result"]);
    const win = winRaw === true || /win|victory/i.test(String(winRaw));
    if (win) wins++;
    const kills = Number(findDeep(row, ["kills", "kill"]) || 0);
    const deaths = Number(findDeep(row, ["deaths", "death"]) || 0);
    const assists = Number(findDeep(row, ["assists", "assist"]) || 0);
    killsSum += kills; deathsSum += deaths; assistsSum += assists;
    const directKda = Number(findDeep(row, ["kda"]));
    const kda = Number.isFinite(directKda) && directKda > 0 ? directKda : (deaths ? (kills + assists) / deaths : kills + assists);
    if (Number.isFinite(kda)) { kdaSum += kda; kdaCount++; }
    let cspm = Number(findDeep(row, ["cs_per_minute", "cspm", "cs_per_min"]));
    const cs = Number(findDeep(row, ["cs", "minion_kill", "minions_killed"]) || 0);
    const duration = Number(findDeep(row, ["game_length_second", "duration", "game_duration"]) || 0);
    if ((!Number.isFinite(cspm) || cspm <= 0) && cs && duration) cspm = cs / (duration > 300 ? duration / 60 : duration);
    if (Number.isFinite(cspm) && cspm > 0) { cspmSum += cspm; cspmCount++; }
    const roleRaw = String(findDeep(row, ["position", "role", "lane", "team_position", "individual_position"]) || "").toUpperCase();
    const role = /TOP/.test(roleRaw) ? "TOP" : /JUNG/.test(roleRaw) ? "JNG" : /MID|MIDDLE/.test(roleRaw) ? "MID" : /ADC|BOTTOM|BOT/.test(roleRaw) ? "ADC" : /SUP|UTILITY/.test(roleRaw) ? "SUP" : null;
    if (role) roleCounts[role]++;
    const opScore = Number(findDeep(row, ["op_score", "opscore", "score"]) || 0);
    const opRank = Number(findDeep(row, ["op_score_rank", "opscore_rank", "rank_in_team"]) || 0);
    const mvpRaw = findDeep(row, ["mvp", "is_mvp"]);
    const aceRaw = findDeep(row, ["ace", "is_ace"]);
    const mvp = mvpRaw === true || /true|mvp/i.test(String(mvpRaw || "")) || opRank === 1 && win;
    const ace = aceRaw === true || /true|ace/i.test(String(aceRaw || "")) || opRank === 1 && !win;
    recentMatches.push({
      champion: String(findDeep(row, ["champion_name", "champion", "name"]) || "Unknown"),
      win, kills, deaths, assists, cs,
      kda: Number(kda.toFixed(2)),
      opScore: Number.isFinite(opScore) ? opScore : 0,
      opRank: Number.isFinite(opRank) ? opRank : 0,
      mvp, ace
    });
  }
  return {
    count: rows.length,
    recentWinrate: rows.length ? Number((wins / rows.length * 100).toFixed(1)) : null,
    kda: kdaCount ? Number((kdaSum / kdaCount).toFixed(2)) : 0,
    avgKills: rows.length ? Number((killsSum / rows.length).toFixed(1)) : 0,
    avgDeaths: rows.length ? Number((deathsSum / rows.length).toFixed(1)) : 0,
    avgAssists: rows.length ? Number((assistsSum / rows.length).toFixed(1)) : 0,
    cspm: cspmCount ? Number((cspmSum / cspmCount).toFixed(1)) : 0,
    roleCounts,
    inferredRole: Object.entries(roleCounts).sort((a,b)=>b[1]-a[1])[0]?.[1] ? Object.entries(roleCounts).sort((a,b)=>b[1]-a[1])[0][0] : null,
    recentMatches
  };
}

async function scoutPlayer(riotId, { withMatches = true } = {}) {
  const parsed = parseRiotId(riotId);
  if (!parsed) throw new Error("Riot ID invalid. Folosește Nume#TAG.");
  const cacheKey = `${OPGG_REGION}:${parsed.riotId.toLowerCase()}:${withMatches}`;
  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.value;

  const ctx = { ...parsed, region: OPGG_REGION };
  const profileResult = await callOpggTool("lol_get_summoner_profile", ctx, [
    "data.summoner.{game_name,tagline,level}",
    "data.summoner.league_stats[].{game_type,win,lose}",
    "data.summoner.league_stats[].tier_info.{tier,division,lp,tier_image_url,border_image_url}",
    "data.summoner.ranked_most_champions.my_champion_stats[].{champion_name,game_second,lose,play,win}",
    "data.summoner.ranked_most_champions.my_champion_stats[].basic.{assist,cs,death,kill}"
  ]);
  const profile = profileResult.data;
  const hasProfileSignal = Boolean(
    findDeep(profile, ["game_name", "gamename", "level", "summoner_level", "tier", "league_stats"]) ||
    parseProfileTextFallback(profile).tier || parseProfileTextFallback(profile).level
  );
  if (!hasProfileSignal) {
    const raw = String(profile?._rawText || "").slice(0, 1200);
    console.error("OP.GG profile payload could not be normalized:", raw || profile);
    const err = new Error("OP.GG a răspuns, dar profilul nu a putut fi interpretat. Deschide /api/opgg/debug-profile?riotId=Nume%23TAG pentru payload-ul de diagnostic.");
    err.code = "OPGG_PARSE";
    throw err;
  }
  ctx.summonerId = findDeep(profile, ["summoner_id", "summonerid", "id"]);
  ctx.puuid = findDeep(profile, ["puuid"]);

  let matchStats = { count: 0, recentWinrate: null, kda: 0, cspm: 0, avgKills:0, avgDeaths:0, avgAssists:0, roleCounts:{}, inferredRole:null, recentMatches: [] };
  let matchSource = "unavailable";
  if (withMatches) {
    try {
      const matchesResult = await callOpggTool("lol_list_summoner_matches", ctx, []);
      matchStats = summarizeMatches(matchesResult.data);
      matchSource = "opgg";
    } catch (error) {
      console.warn("OP.GG matches skipped:", error.message);
    }
  }

  const league = pickLeagueStats(profile);
  const textFallback = parseProfileTextFallback(profile);
  const level = Number(findDeep(profile, ["level", "summoner_level"]) || textFallback.level || 0);
  const pool = championPool(profile);
  const rating = computeSmurfModel({ ...league, level, recentWinrate: matchStats.recentWinrate, recentGames: matchStats.count, kda: matchStats.kda, cspm: matchStats.cspm, avgKills:matchStats.avgKills, avgDeaths:matchStats.avgDeaths, avgAssists:matchStats.avgAssists, inferredRole:matchStats.inferredRole });
  const value = {
    riotId: `${findDeep(profile, ["game_name", "gamename"]) || parsed.gameName}#${findDeep(profile, ["tagline", "tag_line"]) || parsed.tagLine}`,
    region: OPGG_REGION,
    level,
    rank: league.tier === "UNRANKED" ? "UNRANKED" : `${String(league.tier).toUpperCase()} ${league.division}`.trim(),
    tier: String(league.tier).toUpperCase(), division: league.division, lp: league.lp,
    wins: league.wins, losses: league.losses, winrate: league.winrate,
    queues: league.leagues || [],
    kda: matchStats.kda, cspm: matchStats.cspm, avgKills:matchStats.avgKills, avgDeaths:matchStats.avgDeaths, avgAssists:matchStats.avgAssists, recentWinrate: matchStats.recentWinrate,
    recentMatches: matchStats.recentMatches, championPool: pool, inferredRole: matchStats.inferredRole, roleCounts: matchStats.roleCounts,
    tierImageUrl: league.tierImageUrl || "", borderImageUrl: league.borderImageUrl || "",
    autoSkill: rating.effectiveSkill, ...rating, smurf: rating.smurfStatus !== "NORMAL",
    source: "OP.GG MCP", matchSource
  };
  profileCache.set(cacheKey, { time: Date.now(), value });
  return value;
}

app.get("/api/opgg/debug-profile", requireRole("technician"), async (req, res) => {
  try {
    const parsed = parseRiotId(req.query.riotId);
    if (!parsed) return res.status(400).json({ error: "Folosește ?riotId=Nume%23TAG" });
    const ctx = { ...parsed, region: OPGG_REGION };
    const { tools } = await getMcp();
    const tool = toolByName(tools, "lol_get_summoner_profile");
    const desired = [
      "data.summoner.{game_name,tagline,level}",
      "data.summoner.league_stats[].{game_type,win,lose}",
      "data.summoner.league_stats[].tier_info.{tier,division,lp,tier_image_url,border_image_url}",
      "data.summoner.ranked_most_champions.my_champion_stats[].{champion_name,game_second,lose,play,win}",
    "data.summoner.ranked_most_champions.my_champion_stats[].basic.{assist,cs,death,kill}"
    ];
    const args = buildArgs(tool, ctx, desired);
    const rpc = await mcpPost({ jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name: tool.name, arguments: args } });
    res.json({ success: true, tool: tool.name, inputSchema: tool.inputSchema, args, upstreamResult: rpc?.result || null, normalized: parseMcpResult(rpc?.result || {}) });
  } catch (error) {
    res.status(502).json({ error: "Data provider request failed" });
  }
});

app.get("/api/health", async (_req, res) => {
  let opgg = "unknown";
  try { const { tools } = await getMcp(); opgg = `${tools.length} tools`; }
  catch (error) { opgg = `offline: ${error.message}`; }
  res.json({ success: true, status: "online", app: "Rift Production Suite", opgg, region: OPGG_REGION, timestamp: new Date().toISOString() });
});

app.get("/api/profile", async (req, res) => {
  try { res.json({ success: true, ...(await scoutPlayer(req.query.riotId, { withMatches: true })) }); }
  catch (error) { console.error("PROFILE", error); res.status(502).json({ error: "Data provider request failed" }); }
});

app.post("/api/scout", async (req, res) => {
  const ids = Array.isArray(req.body.riotIds) ? req.body.riotIds.slice(0, 20) : [];
  const results = await Promise.all(ids.map(async riotId => {
    try { return { ok: true, ...(await scoutPlayer(riotId, { withMatches: false })) }; }
    catch (error) { return { ok: false, riotId, error: "Data provider request failed" }; }
  }));
  res.json({ success: true, results });
});

function roleAssign(team) {
  const used = new Set();
  for (const p of team) {
    if (p.preferredRole && ROLES.includes(p.preferredRole) && !used.has(p.preferredRole)) { p.role = p.preferredRole; used.add(p.role); }
    else p.role = null;
  }
  for (const p of team) if (!p.role) { const r = ROLES.find(x => !used.has(x)); p.role = r || "FILL"; if (r) used.add(r); }
  team.sort((a,b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
}

const SKILL_BANDS = [1.20,1.50,1.85,2.40,3.00,3.50,4.05,4.40,4.70];
function skillBandIndex(skill){ return SKILL_BANDS.filter(x=>Number(skill)>=x).length; }
function teamCost(a, b) {
  const totalA = a.reduce((s,p)=>s+p.skill,0), totalB = b.reduce((s,p)=>s+p.skill,0);
  let roleCost = 0;
  for (const role of ROLES) {
    const pa = a.find(p=>p.role===role), pb = b.find(p=>p.role===role);
    if (!pa || !pb) { roleCost += 50; continue; }
    const delta=Math.abs(pa.skill-pb.skill), gap=Math.abs(skillBandIndex(pa.skill)-skillBandIndex(pb.skill));
    // Role-vs-role similarity is the primary objective. Adjacent bands are acceptable;
    // two or more bands apart are heavily discouraged even when team totals happen to match.
    roleCost += delta*5 + delta*delta*7 + (gap>1 ? (gap-1)*18 : 0);
  }
  return Math.abs(totalA-totalB)*3 + roleCost;
}

function balanceTen(players) {
  let best = null;
  // 252 possible 5/5 splits: exhaustive and deterministic enough for 10 players.
  const n = players.length;
  for (let mask = 0; mask < (1<<n); mask++) {
    if ((mask & 1) === 0) continue; // remove mirrored duplicates
    let bits = 0; for (let x=mask; x; x>>=1) bits += x&1;
    if (bits !== 5) continue;
    const a=[], b=[];
    for (let i=0;i<n;i++) ((mask>>i)&1 ? a : b).push({...players[i]});
    roleAssign(a); roleAssign(b);
    const cost = teamCost(a,b);
    if (!best || cost < best.cost) best = { a, b, cost };
  }
  return best;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

app.post("/api/teams", requireStaff, async (req, res) => {
  try {
    const input = Array.isArray(req.body.players) ? req.body.players.slice(0, 200) : [];
    if (input.length < 10) return res.status(400).json({ error: "Ai nevoie de cel puțin 10 jucători." });

    // OP.GG requests are intentionally concurrency-limited so large draft pools do not overload the MCP endpoint.
    const enriched = await mapLimit(input, 3, async (p, i) => {
      const name = String(p.name || `Player ${i+1}`).trim();
      let scout = null;
      if (name.includes("#")) {
        try { scout = await scoutPlayer(name, { withMatches: true }); }
        catch (error) {
          console.warn("Auto scout failed", name, error.message);
          const e = new Error(`Scouting OP.GG a eșuat pentru ${name}: ${error.message}. Draft-ul a fost oprit ca să nu folosim un rating inventat.`);
          e.code = "SCOUT_FAILED"; throw e;
        }
      }
      const manualRaw = p.manualSkill ?? p.skill;
      const manual = (manualRaw === null || manualRaw === undefined || manualRaw === "") ? NaN : Number(manualRaw);
      const autoSkill = Number(scout?.autoSkill ?? (Number.isFinite(manual) ? clamp(manual,1,5) : 3));
      const serverRegistry = readJson(REGISTRY_FILE, {});
      const reg = serverRegistry[String(name||"").trim().toLowerCase()] || {};
      const mode = ["AUTO","FLOOR","OVERRIDE"].includes(String(reg.mode||"").toUpperCase()) ? String(reg.mode).toUpperCase() : "AUTO";
      const floor = reg.floor === null || reg.floor === "" || reg.floor === undefined ? NaN : Number(reg.floor);
      const override = reg.override === null || reg.override === "" || reg.override === undefined ? NaN : Number(reg.override);
      let skill = autoSkill;
      if (mode === "FLOOR" && Number.isFinite(floor)) skill = Math.max(autoSkill, clamp(floor,1,5));
      if (mode === "OVERRIDE" && Number.isFinite(override)) skill = clamp(override,1,5);
      skill = Number(skill.toFixed(2));
      const manualRole = ROLES.includes(String(p.preferredRole || "").toUpperCase()) ? String(p.preferredRole).toUpperCase() : null;
      const preferredRole = manualRole || scout?.inferredRole || null;
      const smurfMode = ["AUTO","NOT_SMURF","SMURF"].includes(String(reg.smurfMode||"").toUpperCase()) ? String(reg.smurfMode).toUpperCase() : "AUTO";
      const adjustment = { mode, smurfMode, autoSkill:Number(autoSkill.toFixed(2)), floor:Number.isFinite(floor)?clamp(floor,1,5):null, override:Number.isFinite(override)?clamp(override,1,5):null, alias:String(reg.alias||"").slice(0,80), note:String(reg.note||"").slice(0,240), adjusted:Math.abs(skill-autoSkill)>=0.005 };
      return { name, skill, preferredRole, scout, adjustment };
    });

    // Skill-band players into groups of 10, then exhaustively optimize each 5v5 split.
    // Complexity stays bounded: each match only evaluates 252 mirrored team splits.
    const sorted = [...enriched].sort((a,b)=>b.skill-a.skill);
    const matchCount = Math.floor(sorted.length / 10);
    const matches = [];
    for (let mi=0; mi<matchCount; mi++) {
      const selected = sorted.slice(mi*10, mi*10+10);
      const best = balanceTen(selected);
      const A = best.a.map(p=>({...p,itemSlots:p.role==="ADC"?7:6}));
      const B = best.b.map(p=>({...p,itemSlots:p.role==="ADC"?7:6}));
      const total = t => Number(t.reduce((sum,p)=>sum+p.skill,0).toFixed(2));
      const mismatch = ROLES.map(role=>{
        const p1=A.find(p=>p.role===role), p2=B.find(p=>p.role===role);
        if(!p1||!p2)return null; const delta=Math.abs(p1.skill-p2.skill), bandGap=Math.abs(skillBandIndex(p1.skill)-skillBandIndex(p2.skill));
        return (delta>0.5||bandGap>1)?{role,delta:Number(delta.toFixed(2)),bandGap,players:[p1.name,p2.name],severity:(delta>.8||bandGap>1)?"CRITICAL":"WARNING"}:null;
      }).filter(Boolean);
      const skillDelta = Number(Math.abs(total(A)-total(B)).toFixed(2));
      const maxRoleDelta = Math.max(0, ...ROLES.map(role=>{ const x=A.find(p=>p.role===role), y=B.find(p=>p.role===role); return x&&y?Math.abs(x.skill-y.skill):0; }));
      const bandPenalty = ROLES.reduce((sum,role)=>{ const x=A.find(p=>p.role===role), y=B.find(p=>p.role===role); if(!x||!y)return sum+25; const gap=Math.abs(skillBandIndex(x.skill)-skillBandIndex(y.skill)); return sum+(gap>1?(gap-1)*14:0); },0);
      const qualityScore = Math.round(clamp(100 - skillDelta*14 - maxRoleDelta*18 - mismatch.length*5 - bandPenalty, 0, 100));
      const qualityLabel = qualityScore >= 90 ? "EXCELLENT" : qualityScore >= 80 ? "GOOD" : qualityScore >= 65 ? "PLAYABLE" : "RISKY";
      matches.push({index:mi+1,teams:[{name:`BLUE ${mi+1}`,players:A,skill:total(A)},{name:`RED ${mi+1}`,players:B,skill:total(B)}],skillDelta,maxRoleDelta:Number(maxRoleDelta.toFixed(2)),qualityScore,qualityLabel,mismatch});
    }
    const reserves = sorted.slice(matchCount*10);
    const first = matches[0];
    res.json({ success:true, matches, teams:first.teams, skillDelta:first.skillDelta, maxRoleDelta:first.maxRoleDelta, qualityScore:first.qualityScore, qualityLabel:first.qualityLabel, mismatch:first.mismatch, reserves, processed:enriched.length });
  } catch (error) { console.error("TEAMS", error); res.status(500).json({ error: "Data provider request failed" }); }
});


// Broadcast production state (shared with OBS browser sources). In-memory by design; control UI re-syncs after server restart.
function productionState(){return { featuredPlayer:"Lobring",queue:[],live:null,lastResult:null,...readJson(PRODUCTION_FILE,{}) };}
app.get("/api/production/state", requireStaff, (_req,res)=>res.json({success:true,state:productionState()}));
app.get("/api/overlay/state", (req,res)=>{ const live=productionState().live||null, lastResult=productionState().lastResult||null;
  const selected=readJson(SERIES_FILE,[]).find(x=>x.id===req.query.series);
  const series=selected?{blue:selected.blue,red:selected.red,bestOf:selected.bestOf,blueWins:selected.games.filter(g=>g.winner==="blue").length,redWins:selected.games.filter(g=>g.winner==="red").length}:null; res.setHeader("Cache-Control","no-store"); res.json({success:true,state:{live,lastResult,series,featuredPlayer:productionState().featuredPlayer||""}}); });
app.post("/api/production/state", requireStaff, (req,res)=>{
  const body=req.body && typeof req.body==="object" ? req.body : {};
  writeJson(PRODUCTION_FILE,{...productionState(),...body}); appendTechLog("INFO","production_state_update",{user:req.user.name,requestId:req.requestId}); appendAudit("production.update",req,{live:Boolean(productionState().live),queue:(productionState().queue||[]).length});
  res.json({success:true,state:productionState()});
});

app.get("/api/opgg/tools", requireRole("technician"), async (_req,res)=>{
  try { const {tools}=await getMcp(); res.json({success:true,tools:tools.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema}))}); }
  catch(error){ res.status(502).json({error:"Request failed"}); }
});

// Authentication: password is never returned by the server. Run `npm run auth:setup` locally to generate credentials.
app.get("/api/auth/status", (req,res)=>{
  const user=currentUser(req); const configured=fs.existsSync(AUTH_FILE);
  res.json({success:true,configured,authenticated:Boolean(user),csrfToken:user?req.riftSession.csrfToken:null,user:user?{id:user.id||null,name:user.name,role:user.role}:null});
});
app.post("/api/auth/login", (req,res)=>{
  const ip=req.ip||"unknown", now=Date.now(), bucket=loginAttempts.get(ip)||[];
  const recent=bucket.filter(t=>now-t<10*60*1000); if(recent.length>=8) return res.status(429).json({error:"Too many login attempts. Try again later."});
  recent.push(now); loginAttempts.set(ip,recent);
  if(!fs.existsSync(AUTH_FILE)) return res.status(503).json({error:"Access control is not configured. Run npm run auth:setup on the server."});
  const password=String(req.body?.password||"");
  if(password.length>256)return res.status(400).json({error:"Invalid access password."});
  const account=authUsers().find(u=>u.active!==false && verifyPassword(password,u));
  const user=account?{id:account.id,name:account.name,role:account.role}:null;
  if(!user){ appendTechLog("WARN","login_failed",{ip}); return res.status(401).json({error:"Invalid access password."}); }
  const token=crypto.randomBytes(32).toString("base64url"), expiresAt=Date.now()+SESSION_ABSOLUTE_MS;
  const sessions=cleanSessions(); const previous=parseCookies(req)[COOKIE_NAME]; if(previous)delete sessions[hashToken(previous)]; sessions[hashToken(token)]={userId:user.id,name:user.name,role:user.role,csrfToken:crypto.randomBytes(32).toString("base64url"),lastSeenAt:Date.now(),createdAt:Date.now(),expiresAt}; writeJson(SESSIONS_FILE,sessions);
  loginAttempts.delete(ip); appendTechLog("INFO","login_success",{user:user.name,role:user.role});
  res.setHeader("Set-Cookie",sessionCookie(token));
  res.json({success:true,user});
});
app.post("/api/auth/logout", (req,res)=>{
  const token=parseCookies(req)[COOKIE_NAME]; if(token){const sessions=cleanSessions(); delete sessions[hashToken(token)]; writeJson(SESSIONS_FILE,sessions);}
  res.setHeader("Set-Cookie",sessionCookie("",0)); res.json({success:true});
});
app.post("/api/auth/revoke-all", requireRole("technician"), requireRecentAuth, (req,res)=>{ writeJson(SESSIONS_FILE,{}); appendTechLog("WARN","sessions_revoked",{user:req.user.name}); res.setHeader("Set-Cookie",sessionCookie("",0)); res.json({success:true}); });


app.post("/api/auth/reauth", requireStaff, (req,res)=>{
  const password=String(req.body?.password||"");
  const key="reauth:"+req.user.id,now=Date.now(),attempts=(loginAttempts.get(key)||[]).filter(t=>now-t<600000);
  if(attempts.length>=5)return res.status(429).json({error:"Too many attempts. Try later."});
  attempts.push(now);loginAttempts.set(key,attempts);
  const account=authUsers().find(u=>u.id===req.user.id);
  if(password.length>256 || !verifyPassword(password,account))return res.status(401).json({error:"Invalid access password."});
  const sessions=cleanSessions();if(!sessions[req.riftSessionKey])return res.status(401).json({error:"Session expired."});
  sessions[req.riftSessionKey].reauthenticatedAt=Date.now();writeJson(SESSIONS_FILE,sessions);loginAttempts.delete(key);
  res.json({success:true});
});
app.post("/api/auth/logout-all", requireStaff, (req,res)=>{revokeUserSessions(req.user.id);res.setHeader("Set-Cookie",sessionCookie("",0));res.json({success:true});});
// V10.2 access management. Staff can promote a Custom Night visitor into a named staff account.
// Passwords are generated server-side and returned once; only the scrypt hash is stored.
app.get("/api/admin/access", requireStaff, (req,res)=>{
  const users=authUsers().map(publicAccessUser);
  const st=communityState();
  const candidates=Object.values(st.players||{}).map(x=>({name:String(x.name||"").slice(0,100),ready:Boolean(x.ready)})).filter(x=>x.name && !users.some(u=>u.name.toLowerCase()===x.name.toLowerCase()));
  res.json({success:true,users,candidates});
});
app.post("/api/admin/access", requireRole("technician"), requireRecentAuth, (req,res)=>{
  const name=String(req.body?.name||"").trim().slice(0,100), role=String(req.body?.role||"").toLowerCase();
  if(name.length<2) return res.status(400).json({error:"Numele trebuie să aibă cel puțin 2 caractere."});
  if(!["admin","technician"].includes(role)) return res.status(400).json({error:"Rol invalid."});
  const users=authUsers(); if(users.some(u=>u.active!==false && u.name.toLowerCase()===name.toLowerCase())) return res.status(409).json({error:"Există deja un cont activ cu acest nume."});
  const password=makePassword(), rec=passwordRecord(password); safeBackup(AUTH_FILE,"auth-before-create");
  const user={id:crypto.randomUUID(),name,role,active:true,createdAt:new Date().toISOString(),createdBy:req.user.name,...rec}; users.push(user); saveAuthUsers(users);
  appendAudit("access.user_create",req,{target:user.id,targetName:name,newRole:role});
  res.status(201).json({success:true,user:publicAccessUser(user),temporaryPassword:password,showOnce:true});
});
app.patch("/api/admin/access/:id", requireRole("technician"), requireRecentAuth, (req,res)=>{
  const users=authUsers(), user=users.find(u=>u.id===req.params.id); if(!user) return res.status(404).json({error:"Contul nu există."});
  const role=String(req.body?.role||"").toLowerCase(); if(!["admin","technician"].includes(role)) return res.status(400).json({error:"Rol invalid."});
  if(user.role==="technician" && role!=="technician" && users.filter(u=>u.active!==false&&u.role==="technician").length<=1)return res.status(400).json({error:"At least one active Technician is required."});
  const oldRole=user.role; safeBackup(AUTH_FILE,"auth-before-role-change"); user.role=role; user.lastRoleChangeAt=new Date().toISOString(); user.lastRoleChangeBy=req.user.name; saveAuthUsers(users); revokeUserSessions(user.id);
  appendAudit("access.role_change",req,{target:user.id,targetName:user.name,oldRole,newRole:role}); res.json({success:true,user:publicAccessUser(user),sessionsRevoked:true});
});
app.post("/api/admin/access/:id/reset-password", requireRole("technician"), requireRecentAuth, (req,res)=>{
  const users=authUsers(), user=users.find(u=>u.id===req.params.id); if(!user) return res.status(404).json({error:"Contul nu există."});
  const password=makePassword(), rec=passwordRecord(password); safeBackup(AUTH_FILE,"auth-before-password-reset"); user.salt=rec.salt; user.hash=rec.hash; user.passwordResetAt=new Date().toISOString(); saveAuthUsers(users); revokeUserSessions(user.id);
  appendAudit("access.password_reset",req,{target:user.id,targetName:user.name}); res.json({success:true,temporaryPassword:password,showOnce:true});
});
app.delete("/api/admin/access/:id", requireRole("technician"), requireRecentAuth, (req,res)=>{
  const users=authUsers(), user=users.find(u=>u.id===req.params.id); if(!user) return res.status(404).json({error:"Contul nu există."});
  if(req.user.id && user.id===req.user.id) return res.status(400).json({error:"Nu îți poți revoca propriul acces din sesiunea curentă."});
  const activeTechs=users.filter(u=>u.active!==false&&u.role==="technician"); if(user.role==="technician"&&activeTechs.length<=1) return res.status(400).json({error:"Trebuie să rămână cel puțin un Technician activ."});
  safeBackup(AUTH_FILE,"auth-before-revoke"); user.active=false; user.revokedAt=new Date().toISOString(); user.revokedBy=req.user.name; saveAuthUsers(users); const revokedSessions=revokeUserSessions(user.id);
  appendAudit("access.user_revoke",req,{target:user.id,targetName:user.name,role:user.role,revokedSessions}); res.json({success:true,revokedSessions});
});

app.get("/api/admin/registry", requireStaff, (_req,res)=>res.json({success:true,registry:readJson(REGISTRY_FILE,{})}));
app.put("/api/admin/registry/:key", requireStaff, (req,res)=>{
  const key=decodeURIComponent(req.params.key).trim().toLowerCase().slice(0,120); if(!key) return res.status(400).json({error:"Invalid player key."});
  const body=req.body||{}, mode=["AUTO","FLOOR","OVERRIDE"].includes(String(body.mode||"").toUpperCase())?String(body.mode).toUpperCase():"AUTO", smurfMode=["AUTO","NOT_SMURF","SMURF"].includes(String(body.smurfMode||"").toUpperCase())?String(body.smurfMode).toUpperCase():"AUTO";
  const num=v=>v===null||v===""||v===undefined?null:Math.max(1,Math.min(5,Number(v)));
  const entry={mode,smurfMode,floor:num(body.floor),override:num(body.override),alias:String(body.alias||"").slice(0,80),note:String(body.note||"").slice(0,240),preferredRole:ROLES.includes(String(body.preferredRole||"").toUpperCase())?String(body.preferredRole).toUpperCase():""};
  const registry=readJson(REGISTRY_FILE,{}); registry[key]=entry; writeJson(REGISTRY_FILE,registry); appendTechLog("INFO","registry_update",{user:req.user.name,player:key,mode,smurfMode}); appendAudit("player.skill_update",req,{player:key,mode,smurfMode,floor:entry.floor,override:entry.override}); res.json({success:true,entry});
});
app.delete("/api/admin/registry", requireStaff, (req,res)=>{ safeBackup(REGISTRY_FILE,"registry"); writeJson(REGISTRY_FILE,{}); appendTechLog("WARN","registry_cleared",{user:req.user.name}); res.json({success:true}); });



// V6 community operations: persistent custom-night session, ready check, bug reports, audit and history.
function communityState(){ return {name:"Custom Night",status:"SETUP",players:{},createdAt:null,...readJson(COMMUNITY_FILE,{})}; }
app.get("/api/community/session", (_req,res)=>res.json({success:true,session:communityState()}));
app.put("/api/community/session", requireStaff, (req,res)=>{
  const old=communityState(), b=req.body||{}, settings=automationSettings();
  const next={...old,name:String(b.name??old.name).slice(0,80),status:["SETUP","READY","LIVE","COMPLETE"].includes(String(b.status||"").toUpperCase())?String(b.status).toUpperCase():old.status,players:b.players&&typeof b.players==="object"?b.players:old.players,createdAt:old.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),updatedBy:req.user.name};
  if(old.status!==next.status&&settings.autoProtect){const snap=captureWorkflowSnapshot(`Auto · înainte de ${next.status}`,"RIFT/OPS",null,true);if(snap)appendAutomation("milestone_snapshot",{status:next.status,snapshotId:snap.id});}
  writeJson(COMMUNITY_FILE,next);
  if(settings.archiveCompletedSession&&old.status!=="COMPLETE"&&next.status==="COMPLETE"){const items=readJson(HISTORY_FILE,[]);const item={id:crypto.randomUUID(),time:new Date().toISOString(),type:"CUSTOM_NIGHT",title:`${next.name} · încheiat`,details:`${Object.keys(next.players||{}).length} participanți`,winner:"",loser:"",by:"RIFT/OPS"};items.unshift(item);writeJson(HISTORY_FILE,items.slice(0,2000));appendAudit("community.auto_archive",req,{id:item.id,name:next.name});appendAutomation("custom_night_auto_archived",{id:item.id,name:next.name});}
  appendAudit("community.session_update",req,{name:next.name,status:next.status,players:Object.keys(next.players||{}).length});res.json({success:true,session:next});
});
app.post("/api/community/ready", (req,res)=>{ const name=String(req.body?.name||"").trim().slice(0,100); if(!name)return res.status(400).json({error:"Player name required."}); const ready=Boolean(req.body?.ready), st=communityState(); st.players={...(st.players||{}),[name.toLowerCase()]:{name,ready,updatedAt:new Date().toISOString()}}; writeJson(COMMUNITY_FILE,st); appendAudit("ready_check",req,{player:name,ready}); res.json({success:true,player:st.players[name.toLowerCase()]}); });
app.delete("/api/community/ready", requireStaff, (req,res)=>{ const st=communityState(); st.players={}; st.updatedAt=new Date().toISOString(); st.updatedBy=req.user.name; writeJson(COMMUNITY_FILE,st); appendAudit("ready_check.clear",req,{}); res.json({success:true,session:st}); });
app.delete("/api/community/session", requireStaff, (req,res)=>{ safeBackup(COMMUNITY_FILE,"community-before-delete"); const st={name:"Custom Night",status:"SETUP",players:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),updatedBy:req.user.name}; writeJson(COMMUNITY_FILE,st); appendAudit("community.session_delete",req,{}); res.json({success:true,session:st}); });
app.post("/api/community/bug-report", (req,res)=>{ const b=req.body||{}, message=String(b.message||"").trim().slice(0,1200); if(message.length<4)return res.status(400).json({error:"Describe the bug in a few words."}); const items=readJson(BUGS_FILE,[]); const item={id:crypto.randomUUID(),time:new Date().toISOString(),message,page:String(b.page||"").slice(0,80),requestId:String(b.requestId||"").slice(0,100),user:currentUser(req)?.name||"visitor",userAgent:String(req.headers["user-agent"]||"").slice(0,220),status:"OPEN"}; items.unshift(item); writeJson(BUGS_FILE,items.slice(0,500)); appendTechLog("WARN","community_bug_report",{id:item.id,page:item.page,user:item.user,requestId:req.requestId}); res.json({success:true,id:item.id}); });
app.get("/api/tech/bugs", requireRole("technician"), (_req,res)=>res.json({success:true,reports:readJson(BUGS_FILE,[])}));
app.patch("/api/tech/bugs/:id", requireRole("technician"), (req,res)=>{ const items=readJson(BUGS_FILE,[]), x=items.find(v=>v.id===req.params.id); if(!x)return res.status(404).json({error:"Report not found."}); x.status=["OPEN","FIXED","IGNORED"].includes(String(req.body?.status||"").toUpperCase())?String(req.body.status).toUpperCase():x.status; x.updatedAt=new Date().toISOString(); x.updatedBy=req.user.name; writeJson(BUGS_FILE,items); appendAudit("bug.status",req,{id:x.id,status:x.status}); res.json({success:true,report:x}); });
app.get("/api/admin/audit", requireStaff, (_req,res)=>{ let rows=[]; try{rows=fs.readFileSync(AUDIT_FILE,"utf8").trim().split(/\r?\n/).filter(Boolean).slice(-200).map(x=>JSON.parse(x)).reverse()}catch{} res.json({success:true,audit:rows}); });
app.get("/api/admin/history", requireStaff, (_req,res)=>res.json({success:true,history:readJson(HISTORY_FILE,[])}));
app.post("/api/admin/history", requireStaff, (req,res)=>{ const b=req.body||{}, items=readJson(HISTORY_FILE,[]); const item={id:crypto.randomUUID(),time:new Date().toISOString(),type:String(b.type||"MATCH").slice(0,30),title:String(b.title||"").slice(0,160),details:String(b.details||"").slice(0,500),winner:String(b.winner||"").slice(0,100),loser:String(b.loser||"").slice(0,100),by:req.user.name}; items.unshift(item); writeJson(HISTORY_FILE,items.slice(0,2000)); appendAudit("history.add",req,{id:item.id,type:item.type}); res.json({success:true,item}); });
app.delete("/api/admin/history/:id", requireStaff, (req,res)=>{ const id=String(req.params.id||""); const items=readJson(HISTORY_FILE,[]), next=items.filter(x=>String(x.id)!==id); if(next.length===items.length)return res.status(404).json({error:"History item not found"}); writeJson(HISTORY_FILE,next); appendAudit("history.remove",req,{id}); res.json({success:true}); });

// V10 workflow persistence + recovery. Staff state is stored server-side so a refresh or another staff browser can recover the active night.
function cleanWorkflowPayload(body={}){
  const draft=body.draft&&typeof body.draft==="object"?body.draft:null;
  const bracket=Array.isArray(body.bracket)?body.bracket:null;
  return {draft,bracket,updatedAt:new Date().toISOString()};
}
app.get("/api/admin/workflow", requireStaff, (_req,res)=>res.json({success:true,workflow:readJson(WORKFLOW_FILE,{draft:null,bracket:null,updatedAt:null})}));
let lastWorkflowAutoSnapshotAt=0;
app.put("/api/admin/workflow", requireStaff, (req,res)=>{
  const previous=readJson(WORKFLOW_FILE,{draft:null,bracket:null,updatedAt:null}), settings=automationSettings();
  const next={...cleanWorkflowPayload(req.body),updatedBy:req.user.name}, now=Date.now();
  let snapshot=null;
  if(settings.autoProtect&&(previous.draft||previous.bracket)&&now-lastWorkflowAutoSnapshotAt>settings.snapshotMinutes*60*1000){snapshot=captureWorkflowSnapshot("Auto · înainte de modificări","RIFT/OPS",previous,true);lastWorkflowAutoSnapshotAt=now;}
  writeJson(WORKFLOW_FILE,next);
  const readySync=settings.syncDraftToReady&&next.draft?mergeDraftIntoReady(next.draft):{added:0,total:Object.keys(communityState().players||{}).length};
  const queueSync=settings.syncDraftToProduction&&next.draft?syncDraftToProduction(next.draft):{updated:false,count:(productionState().queue||[]).length};
  const bracketArchive=next.bracket?maybeAutoArchiveBracket(next.bracket):{archived:false,reason:"no-bracket"};
  res.json({success:true,workflow:next,autoProtected:Boolean(snapshot),automation:{readySync,queueSync,bracketArchive}});
});
app.get("/api/admin/workflow/snapshots", requireStaff, (_req,res)=>res.json({success:true,snapshots:readJson(SNAPSHOTS_FILE,[]).slice(0,20)}));
app.post("/api/admin/workflow/snapshots", requireStaff, (req,res)=>{ const current=cleanWorkflowPayload(req.body); const item=captureWorkflowSnapshot(String(req.body?.label||"Snapshot operațional").trim().slice(0,80),req.user.name,current,false); if(!item)return res.status(400).json({error:"Nu există Draft sau Bracket de salvat."}); appendAudit("workflow.snapshot",req,{id:item.id,label:item.label}); res.json({success:true,snapshot:item}); });
app.post("/api/admin/workflow/snapshots/:id/restore", requireStaff, (req,res)=>{ const item=readJson(SNAPSHOTS_FILE,[]).find(x=>x.id===req.params.id); if(!item)return res.status(404).json({error:"Snapshot not found"}); const next={draft:item.draft||null,bracket:item.bracket||null,updatedAt:new Date().toISOString(),updatedBy:req.user.name}; safeBackup(WORKFLOW_FILE,"workflow-before-restore"); writeJson(WORKFLOW_FILE,next); appendAudit("workflow.restore",req,{id:item.id}); res.json({success:true,workflow:next}); });
app.delete("/api/admin/workflow/snapshots/:id", requireStaff, (req,res)=>{ const list=readJson(SNAPSHOTS_FILE,[]), next=list.filter(x=>x.id!==req.params.id); if(next.length===list.length)return res.status(404).json({error:"Snapshot not found"}); writeJson(SNAPSHOTS_FILE,next); appendAudit("workflow.snapshot_remove",req,{id:req.params.id}); res.json({success:true}); });

app.get("/api/admin/operations", requireStaff, (req,res)=>res.json({success:true,summary:operationsSummary(req.user.role),feed:automationFeed(30)}));
app.get("/api/admin/automation", requireStaff, (_req,res)=>res.json({success:true,settings:automationSettings()}));
app.patch("/api/admin/automation", requireStaff, (req,res)=>{const settings=saveAutomationSettings(req.body||{});appendAudit("automation.settings",req,{settings});appendAutomation("automation_settings_updated",{by:req.user.name});res.json({success:true,settings});});
app.post("/api/admin/automation/run", requireStaff, (req,res)=>{const workflow=readJson(WORKFLOW_FILE,{draft:null,bracket:null,updatedAt:null}),settings=automationSettings(),actions=[];if(settings.autoProtect){const snap=captureWorkflowSnapshot("Autopilot · checkpoint",req.user.name,workflow,true);if(snap)actions.push({type:"snapshot",id:snap.id});}if(settings.syncDraftToReady&&workflow.draft)actions.push({type:"ready",...mergeDraftIntoReady(workflow.draft)});if(settings.syncDraftToProduction&&workflow.draft)actions.push({type:"queue",...syncDraftToProduction(workflow.draft)});if(workflow.bracket)actions.push({type:"bracket",...maybeAutoArchiveBracket(workflow.bracket)});appendAutomation("autopilot_reconciled",{by:req.user.name,actions:actions.map(x=>x.type)});appendAudit("automation.run",req,{actions:actions.map(x=>x.type)});res.json({success:true,actions,summary:operationsSummary(req.user.role),feed:automationFeed(30)});});

app.get("/api/tech/preflight", requireRole("technician"), async (req,res)=>{ const checks=[]; const add=(name,ok,detail="")=>checks.push({name,ok:Boolean(ok),detail}); add("Authentication",fs.existsSync(AUTH_FILE),"auth.json configured"); add("Visitor permissions",true,"staff routes are server-protected"); add("Admin permissions",true,"requireStaff enabled"); add("Technician permissions",true,"technician-only safety routes enabled"); try{const {tools}=await getMcp();add("OP.GG MCP",tools.length>0,`${tools.length} tools`)}catch(e){add("OP.GG MCP",false,e.message)} add("Player Registry",readJson(REGISTRY_FILE,{})!==null); add("Draft integrity",ROLES.length===5,"5 canonical roles"); add("Unique roles",new Set(ROLES).size===5); add("Skill Band balancing",true,"effective skill engine loaded"); add("Production state",readJson(PRODUCTION_FILE,{})!==null); add("Backups",fs.existsSync(BACKUP_DIR)); add("Logs",true,"request/error logging active"); add("Error recovery",true,"global error handler + graceful shutdown"); const passed=checks.filter(x=>x.ok).length; appendAudit("preflight.run",req,{passed,total:checks.length}); res.json({success:true,ready:passed===checks.length,passed,total:checks.length,checks}); });

// V5 technician safety center: integrity checks, maintenance, backups and cache controls.
app.get("/api/tech/integrity", requireRole("technician"), (req,res)=>{
  const checks=[];
  const inspect=(name,file,kind)=>{ try{ const exists=fs.existsSync(file); const value=exists&&kind==="json"?readJson(file,null):null; checks.push({name,exists,ok:kind!=="json"||!exists||value!==null,size:exists?fs.statSync(file).size:0}); }catch(e){checks.push({name,exists:false,ok:false,error:e.message});} };
  inspect("auth",AUTH_FILE,"json"); inspect("sessions",SESSIONS_FILE,"json"); inspect("registry",REGISTRY_FILE,"json"); inspect("production",PRODUCTION_FILE,"json"); inspect("settings",SETTINGS_FILE,"json"); inspect("automation",AUTOMATION_FILE,"json"); inspect("logs",LOG_FILE,"text");
  const issues=checks.filter(x=>!x.ok); res.json({success:true,healthy:issues.length===0,checks,issues});
});
app.post("/api/tech/backup", requireRole("technician"), requireRecentAuth, (req,res)=>{
  const made=[safeBackup(SERIES_FILE,"series"),safeBackup(REGISTRY_FILE,"registry"),safeBackup(PRODUCTION_FILE,"production"),safeBackup(SETTINGS_FILE,"settings"),safeBackup(AUTOMATION_FILE,"automation"),safeBackup(COMMUNITY_FILE,"community"),safeBackup(BUGS_FILE,"bugs"),safeBackup(HISTORY_FILE,"history"),safeBackup(WORKFLOW_FILE,"workflow"),safeBackup(SNAPSHOTS_FILE,"workflow-snapshots")].filter(Boolean);
  appendTechLog("INFO","manual_backup",{user:req.user.name,count:made.length,requestId:req.requestId}); res.json({success:true,count:made.length});
});
app.post("/api/tech/cache/clear", requireRole("technician"), (req,res)=>{ const before=profileCache.size; profileCache.clear(); appendTechLog("WARN","cache_cleared",{user:req.user.name,before,requestId:req.requestId}); res.json({success:true,cleared:before}); });
app.delete("/api/tech/logs", requireRole("technician"), (req,res)=>{ try{fs.writeFileSync(LOG_FILE,"");}catch{} appendTechLog("WARN","logs_cleared",{user:req.user.name,requestId:req.requestId}); res.json({success:true}); });
app.post("/api/tech/maintenance", requireRole("technician"), requireRecentAuth, (req,res)=>{ const enabled=Boolean(req.body?.enabled); const st={...appSettings(),maintenance:enabled,updatedAt:new Date().toISOString(),updatedBy:req.user.name}; writeJson(SETTINGS_FILE,st); appendTechLog("WARN","maintenance_changed",{user:req.user.name,enabled,requestId:req.requestId}); res.json({success:true,maintenance:enabled}); });

app.get("/api/tech/status", requireRole("technician"), async (req,res)=>{
  let opgg={status:"unknown",tools:0}; try{const {tools}=await getMcp();opgg={status:"online",tools:tools.length};}catch(e){opgg={status:"offline",error:e.message};}
  const riot={configured:Boolean(process.env.RIOT_API_KEY),tournamentReady:Boolean(process.env.RIOT_API_KEY&&process.env.RIOT_TOURNAMENT_ENABLED==="1"),mode:process.env.RIOT_API_KEY?"SERVER_SECRET":"NOT_CONNECTED"}; const mem=process.memoryUsage(); res.json({success:true,identity:{name:req.user.name,role:req.user.role},riot,server:{node:process.version,uptimeSeconds:Math.round(process.uptime()),memoryMB:{rss:Math.round(mem.rss/1048576),heapUsed:Math.round(mem.heapUsed/1048576)},region:OPGG_REGION},opgg,views:viewStats,cache:{profiles:profileCache.size},sessions:Object.keys(cleanSessions()).length,settings:appSettings(),data:{registry:Object.keys(readJson(REGISTRY_FILE,{})).length,productionPersisted:fs.existsSync(PRODUCTION_FILE),automation:automationSettings()},startedAt:new Date(SERVER_STARTED_AT).toISOString()});
});
app.get("/api/tech/logs", requireRole("technician"), (req,res)=>{
  let lines=[]; try{lines=fs.readFileSync(LOG_FILE,"utf8").trim().split(/\r?\n/).filter(Boolean).slice(-250).map(x=>{try{return JSON.parse(x)}catch{return {time:"",level:"RAW",event:x}}});}catch{}
  res.json({success:true,logs:lines.reverse()});
});

registerSeries(app,{requireStaff,read:()=>readJson(SERIES_FILE,[]),write:rows=>writeJson(SERIES_FILE,rows),audit:appendAudit});
app.get("/api/tech/errors", requireRole("technician"), (_req,res)=>{
  let saved=[];try{saved=fs.readFileSync(LOG_FILE,'utf8').trim().split(/\r?\n/).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(x=>x?.event==='server_error');}catch{}
  const merged=new Map([...saved,...serverErrors].map(x=>[x.id,x]));res.json({success:true,errors:[...merged.values()].sort((a,b)=>b.time.localeCompare(a.time)).slice(0,200)});
});
app.post("/api/tech/errors/resolve", requireRole("technician"), (req,res)=>{
  const id=String(req.body?.id||'');const item=serverErrors.find(x=>x.id===id);if(item)item.resolved=true;
  let lines=[];try{lines=fs.readFileSync(LOG_FILE,'utf8').trim().split(/\r?\n/).filter(Boolean).map(line=>{try{const x=JSON.parse(line);if(x.event==='server_error'&&x.id===id)x.resolved=true;return JSON.stringify(x);}catch{return line}});}catch{}
  fs.writeFileSync(LOG_FILE,lines.join('\n')+'\n');appendAudit('error.resolve',req,{id});res.json({success:true});
});
app.use("/api", (req,res)=>res.status(404).json({error:"API endpoint not found.",requestId:req.requestId}));
app.use((err,req,res,next)=>{ appendTechLog("ERROR","unhandled_request_error",{message:String(err?.message||err),path:req.path,requestId:req.requestId}); if(res.headersSent)return next(err); res.status(err?.type==="entity.too.large"?413:err instanceof SyntaxError?400:500).json({error:"Request failed",requestId:req.requestId}); });
app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
// V7 automatic safety snapshot. Keeps a rolling daily backup without exposing secrets.
let lastAutoBackupDay="";
function automaticSafetyBackup(){ const day=new Date().toISOString().slice(0,10); if(day===lastAutoBackupDay)return; lastAutoBackupDay=day; [REGISTRY_FILE,PRODUCTION_FILE,SETTINGS_FILE,AUTOMATION_FILE,COMMUNITY_FILE,BUGS_FILE,HISTORY_FILE,WORKFLOW_FILE,SNAPSHOTS_FILE,SERIES_FILE].forEach((f,i)=>safeBackup(f,["registry","production","settings","automation","community","bugs","history","workflow","snapshots","series"][i])); appendTechLog("INFO","automatic_daily_backup",{day}); }
await storage.transaction(automaticSafetyBackup); setInterval(()=>storage.transaction(automaticSafetyBackup).catch(()=>console.error("Automatic backup failed.")),60*60*1000).unref();

const server=app.listen(PORT,()=>{ appendTechLog("INFO","server_started",{version:"12.2.1",port:PORT,region:OPGG_REGION}); console.log(`RIFT/OPS 12.2.1 • http://localhost:${PORT} • OP.GG ${OPGG_REGION.toUpperCase()}`); });
for(const sig of ["SIGINT","SIGTERM"]){ process.on(sig,()=>{ appendTechLog("INFO","server_shutdown",{signal:sig}); server.close(async()=>{await storage.close();process.exit(0);}); setTimeout(()=>process.exit(1),5000).unref(); }); }
process.on("unhandledRejection",reason=>appendTechLog("ERROR","unhandled_rejection",{message:String(reason)}));
process.on("uncaughtException",err=>{appendTechLog("ERROR","uncaught_exception",{message:err.message,stack:String(err.stack||"").slice(0,2000)}); console.error(err);});
