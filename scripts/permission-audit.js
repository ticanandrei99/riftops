import fs from "fs";
import path from "path";

const root=process.cwd();
const serverPath=path.join(root,"server.js");
const source=fs.readFileSync(serverPath,"utf8");
const lines=(source+"\n"+fs.readFileSync(path.join(root,"series.js"),"utf8").replaceAll("'",'"')).split(/\r?\n/);
const publicRoutes=new Set([
  "GET /api/health",
  "GET /api/profile",
  "POST /api/scout",
  "GET /api/overlay/state",
  "GET /api/auth/status",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/community/session",
  "POST /api/community/ready",
  "POST /api/community/bug-report"
]);
const routes=[];
for(let i=0;i<lines.length;i++){
  const line=lines[i];
  const m=line.match(/app\.(get|post|put|patch|delete)\("([^\"]+)"\s*,(.*)$/);
  if(!m||!m[2].startsWith("/api/"))continue;
  const method=m[1].toUpperCase(), route=m[2], tail=m[3];
  const key=`${method} ${route}`;
  const protectedRoute=/\brequireStaff\b|\brequireRole\s*\(/.test(tail);
  routes.push({line:i+1,key,protectedRoute,isPublic:publicRoutes.has(key)});
}
let failed=false;
function check(name,ok,detail=""){
  console.log(`${ok?"✓":"✕"} ${name}${detail?` — ${detail}`:""}`);
  if(!ok)failed=true;
}
const unexpectedPublic=routes.filter(r=>!r.isPublic&&!r.protectedRoute);
const accidentalProtected=routes.filter(r=>r.isPublic&&r.protectedRoute);
check("API deny-by-default audit",unexpectedPublic.length===0,unexpectedPublic.length?unexpectedPublic.map(x=>`${x.key}@${x.line}`).join(", "):`${routes.length-publicRoutes.size} protected API declarations checked`);
check("Public API allowlist",accidentalProtected.length===0,accidentalProtected.length?accidentalProtected.map(x=>x.key).join(", "):`${publicRoutes.size} intentionally public routes`);
check("Staff middleware",source.includes('function requireStaff')&&source.includes('requireRole("admin","technician")'));
check("Technician-only controls",source.includes('requireRole("technician")'));
check("Sensitive API no-store",source.includes('Cache-Control","no-store, private'));
check("Mutation origin validation",source.includes('Cross-site mutation blocked.')&&source.includes('Cross-origin mutation blocked.'));
check("HttpOnly session cookie",source.includes('HttpOnly; SameSite=Strict'));
check("Production Secure cookie",source.includes('NODE_ENV==="production"')&&source.includes('; Secure'));
check("Server-side password hashing",source.includes('crypto.scryptSync'));
check("Workflow recovery",source.includes('captureWorkflowSnapshot'));
check("Access-change session revocation",source.includes('revokeUserSessions'));
const gitignorePath=path.join(root,".gitignore");
const gitignore=fs.existsSync(gitignorePath)?fs.readFileSync(gitignorePath,"utf8").split(/\r?\n/).map(x=>x.trim()).filter(Boolean):[];
const ignores=(entry)=>gitignore.some(x=>x===entry||x===entry+"/"||x==="/"+entry||x==="/"+entry+"/");
check("Runtime .data excluded from source/release",ignores(".data"),fs.existsSync(path.join(root,".data"))?"runtime data present locally and correctly ignored":"runtime data directory not present; exclusion configured");
check("Local .env excluded from source/release",ignores(".env"),fs.existsSync(path.join(root,".env"))?"local environment file present and correctly ignored":"local environment file not present; exclusion configured");
const files=['server.js','public/app.js','public/index.html','.env.example','README.md'].filter(f=>fs.existsSync(path.join(root,f)));
const combined=files.map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
check("No Riot key embedded",!(/RGAPI-[A-Za-z0-9_-]{16,}/.test(combined)));

console.log(`\n${failed?"SECURITY AUDIT FAILED":"SECURITY AUDIT PASSED"}`);
if(failed)process.exit(1);
