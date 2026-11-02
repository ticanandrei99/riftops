// Add the session-bound CSRF token to same-origin mutations.
const nativeFetch=window.fetch.bind(window);let csrfToken=null;
window.fetch=async function(input,options={}){
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  const method=String(options.method||(input instanceof Request?input.method:"GET")).toUpperCase();
  const mutation=url.origin===location.origin && ["POST","PUT","PATCH","DELETE"].includes(method);
  if(mutation && !csrfToken){const r=await nativeFetch('/api/auth/status');const d=await r.json();csrfToken=d.csrfToken;}
  const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
  if(mutation && csrfToken)headers.set('X-CSRF-Token',csrfToken);
  let response=await nativeFetch(input,{...options,headers});
  if(url.pathname==='/api/auth/status' && response.ok)csrfToken=(await response.clone().json()).csrfToken;
  if(url.pathname==='/api/auth/login' || url.pathname==='/api/auth/logout')csrfToken=null;
  if(mutation && response.status===403 && (await response.clone().json()).code==='REAUTH_REQUIRED'){
    const password=await inputDialog('Confirmă parola pentru această acțiune sensibilă:','',true);
    if(password){const r=await window.fetch('/api/auth/reauth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});if(r.ok)response=await nativeFetch(input,{...options,headers});else response=r;}
  }
  return response;
};
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const ROLES = ["TOP","JNG","MID","ADC","SUP"];
const isRiotId = name => String(name).includes("#");
const KEY_PLAYERS = "riftops.players";
const KEY_HISTORY = "riftops.history";
const KEY_SETTINGS = "riftops.settings";
const KEY_REGISTRY = "riftops.registry.v1";
const KEY_PRODUCTION = "riftops.production.v1";
const KEY_DRAFT = "riftops.draft.v7";
const KEY_BRACKET = "riftops.bracket.v7";
let roster = JSON.parse(localStorage.getItem(KEY_PLAYERS) || "[]");
let history = JSON.parse(localStorage.getItem(KEY_HISTORY) || "[]");
let settings = JSON.parse(localStorage.getItem(KEY_SETTINGS) || '{"adc":7,"other":6}');
let registry = {};
let authState = {authenticated:false,user:null};
const canStaff = () => ["admin","technician"].includes(authState.user?.role);
const isTechnician = () => authState.user?.role === "technician";
let currentTeams = JSON.parse(localStorage.getItem(KEY_DRAFT) || "null");
let draftMoveSelection = null;
let draftUndoState = null;
let bracketState = JSON.parse(localStorage.getItem(KEY_BRACKET) || "null");
let bracketArchivedSignature = "";
let ddragonVersion = "";
let championImageByName = {};
let production = JSON.parse(localStorage.getItem(KEY_PRODUCTION) || '{"featuredPlayer":"Lobring","queue":[],"live":null,"lastResult":null}');
let automationState={};
let operationsState=null;
const saveProductionLocal=()=>localStorage.setItem(KEY_PRODUCTION,JSON.stringify(production));
const isFeatured=name=>String(name||"").toLowerCase().includes(String(production.featuredPlayer||"Lobring").toLowerCase());
const saveRoster = () => localStorage.setItem(KEY_PLAYERS, JSON.stringify(roster));
const saveHistory = () => { localStorage.setItem(KEY_HISTORY, JSON.stringify(history)); renderHistory(); renderModuleHistories(); };
async function persistHistoryItem(item){ if(!canStaff())return; try{const r=await fetch('/api/admin/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});if(r.ok){const d=await r.json();item.serverId=d.item?.id||item.serverId;localStorage.setItem(KEY_HISTORY,JSON.stringify(history));}}catch{} }
const registryKey = name => String(name||"").trim().toLowerCase();
async function saveRegistryEntry(name){
  if(!canStaff()) return;
  const key=registryKey(name), entry=registry[key];
  const res=await fetch(`/api/admin/registry/${encodeURIComponent(key)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(entry)});
  if(!res.ok) throw new Error((await res.json()).error||"Registry save failed");
}
async function loadRegistry(){
  if(!canStaff()){registry={};return;}
  const res=await fetch("/api/admin/registry"); if(res.ok) registry=(await res.json()).registry||{};
}
function registryEntry(name){ return registry[registryKey(name)] || {mode:"AUTO",floor:null,override:null,alias:"",note:"",smurfMode:"AUTO"}; }
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parseNames = value => [...new Set(value.split(/[,\n\r]+/).map(x=>x.trim()).filter(Boolean))];

function syncRosterFromInput() {
  const names = parseNames($("#player-input").value);
  const old = new Map(roster.map(p=>[p.name.toLowerCase(),p]));
  roster = names.map(name => old.get(name.toLowerCase()) || {name,skill:3,manualSkill:null,preferredRole:""});
  saveRoster(); $("#roster-count").textContent = `${roster.length} PLAYERS`;
}
function showTab(tab) {
  if(tab==="series"&&!canStaff()) tab="community";
  if(tab==="hub"&&!canStaff()) tab="community";
  if(tab==="admin"&&!canStaff()) tab="community";
  if(tab==="tech"&&!isTechnician()) tab="community";
  if(tab==="bracket"&&currentTeams&&$("#bracket-input")&&!$("#bracket-input").value.trim()){$("#bracket-input").value=(currentTeams.matches||[]).flatMap(m=>m.teams||[]).map(t=>t.name).filter(Boolean).join("\n");}
  $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===`tab-${tab}`));
  const titles={series:"Match Series",hub:"Centru Operațional",teams:"Draft Echipe",arena:"1v1 Arena",bracket:"Turneu",profiles:"Profil Jucător",admin:"Administrare",tech:"Tehnician",community:"Custom Night",history:"Istoric Meciuri"};
  $("#page-title").innerHTML = `${titles[tab]} <span class="muted">/ ${({"series":"BO1 / BO3 / BO5","hub":"LIVE CONTROL","teams":"5v5","arena":"SHOWDOWN","bracket":"LCS FORMAT","profiles":"SCOUTING","admin":"CONTROL","tech":"DIAGNOSTICS","community":"COMMUNITY","history":"ARCHIVE"})[tab]}</span>`;
}
$("#nav").addEventListener("click",e=>{const b=e.target.closest("[data-tab]");if(b){if(["hub","admin","series"].includes(b.dataset.tab)&&!canStaff())return;if(b.dataset.tab==="tech"&&!isTechnician())return;showTab(b.dataset.tab);}});

function saveMatch(type,title,details,extra={}) {
  history.unshift({id:Date.now()+Math.random(),type,title,details,time:new Date().toLocaleString("ro-RO"),...extra});
  history=history.slice(0,250);saveHistory(); persistHistoryItem(history[0]);
}
function resultHistoryMarkup(items, emptyText){
  if(!items.length) return `<div class="empty-state mini"><div class="empty-icon">◷</div><b>${esc(emptyText)}</b><p>Rezultatele confirmate vor apărea aici.</p></div>`;
  return items.map(h=>`<div class="result-history-row"><div class="result-badge ${h.type==='1V1'?'arena':'tournament'}">${esc(h.type)}</div><div class="result-copy"><b>${h.winner?`WIN · ${esc(h.winner)}`:esc(h.title)}</b>${h.loser?`<span>LOSS · ${esc(h.loser)}</span>`:''}<small>${esc(h.round||'')} ${h.round?'· ':''}${esc(h.time)}${h.details?` · ${esc(h.details)}`:''}</small></div>${canStaff()?`<button class="history-delete" data-delete="${h.id}">REMOVE</button>`:''}</div>`).join('');
}
function renderModuleHistories(){
  const arenaEl=$("#arena-history"), tourEl=$("#tournament-history");
  if(arenaEl) arenaEl.innerHTML=resultHistoryMarkup(history.filter(h=>h.type==='1V1'), 'No 1v1 results yet');
  if(tourEl) tourEl.innerHTML=resultHistoryMarkup(history.filter(h=>h.type==='TOURNAMENT'||h.type==='TOURNAMENT_ARCHIVE'), 'No tournament results yet');
}
async function deleteHistoryId(id){
  const item=history.find(h=>String(h.id)===String(id));
  if(!item)return;
  if(!confirm('Elimini această înregistrare din istoric?'))return;
  history=history.filter(h=>String(h.id)!==String(id)); saveHistory();
  if(canStaff() && item.serverId){ try{await fetch(`/api/admin/history/${encodeURIComponent(item.serverId)}`,{method:'DELETE'});}catch{} }
}
document.addEventListener('click',e=>{const b=e.target.closest('.history-delete');if(b)deleteHistoryId(b.dataset.delete);});
function rankFallback(tier){
  const t=String(tier||"UNRANKED").toUpperCase();
  const glyph={IRON:"I",BRONZE:"B",SILVER:"S",GOLD:"G",PLATINUM:"P",EMERALD:"E",DIAMOND:"D",MASTER:"M",GRANDMASTER:"GM",CHALLENGER:"C"}[t]||"?";
  return `<span class="rank-fallback tier-${esc(t.toLowerCase())}">${glyph}</span>`;
}
function rankBadge(scout, large=false){
  if(!scout) return `<span class="rank-fallback">?</span>`;
  if(scout.tierImageUrl) return `<img class="rank-emblem ${large?'large':''}" src="${esc(scout.tierImageUrl)}" alt="${esc(scout.tier)} rank" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">${rankFallback(scout.tier)}`;
  return rankFallback(scout.tier);
}
function suspicionBadge(scout, playerName){
  if(!scout) return '';
  const manual=String(registryEntry(playerName).smurfMode||'AUTO').toUpperCase();
  if(manual==='NOT_SMURF') return `<span class="smurf-pill green">● CLEAN · ADMIN</span>`;
  if(manual==='SMURF') return `<span class="smurf-pill red">⚠ SMURF · ADMIN</span>`;
  const tone=scout.smurfTone||'green', score=Number(scout.smurfScore||0);
  if(tone==='green') return `<span class="smurf-pill green">● CLEAN</span>`;
  return `<span class="smurf-pill ${tone}">⚠ ${tone==='red'?'HIGH':'WATCH'} · ${score}</span>`;
}
const SKILL_BANDS=[
  {name:'IRON',min:1.00,max:1.19,value:1.10},{name:'BRONZE',min:1.20,max:1.49,value:1.35},
  {name:'SILVER',min:1.50,max:1.84,value:1.67},{name:'GOLD',min:1.85,max:2.39,value:2.12},
  {name:'PLATINUM',min:2.40,max:2.99,value:2.70},{name:'EMERALD',min:3.00,max:3.49,value:3.25},
  {name:'DIAMOND',min:3.50,max:4.04,value:3.77},{name:'MASTER',min:4.05,max:4.39,value:4.22},
  {name:'GRANDMASTER',min:4.40,max:4.69,value:4.55},{name:'CHALLENGER',min:4.70,max:5.00,value:4.85}
];
function skillBand(v){const n=Number(v||0);return SKILL_BANDS.find(x=>n>=x.min&&n<=x.max)||SKILL_BANDS[Math.max(0,Math.min(SKILL_BANDS.length-1,Math.round((n-1)*2)))];}
function effectiveDivision(v){
  const band=skillBand(v);
  if(['MASTER','GRANDMASTER','CHALLENGER'].includes(band.name)) return '';
  const span=Math.max(.01,band.max-band.min), pct=Math.max(0,Math.min(.999,(Number(v)-band.min)/span));
  return ['IV','III','II','I'][Math.min(3,Math.floor(pct*4))];
}
function effectiveRankLabel(v){const band=skillBand(v);const div=effectiveDivision(v);return `${band.name}${div?' '+div:''}`;}
function effectiveRankEmblemUrl(tier){
  const t=String(tier||'').toLowerCase().replace(/[^a-z]/g,'');
  if(!SKILL_BANDS.some(b=>b.name.toLowerCase()===t)) return '';
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${t}.png`;
}
function effectiveRankBadge(p){
  const r=registryEntry(p.name);
  const adjusted=!!p.adjustment?.adjusted || r.mode==='OVERRIDE' || (r.mode==='FLOOR' && Number(p.skill)>Number(p.adjustment?.autoSkill??0)+.004);
  if(!adjusted && p.scout) return rankBadge(p.scout);
  const band=skillBand(p.skill), url=effectiveRankEmblemUrl(band.name);
  const fallback=rankFallback(band.name);
  return `<span class="effective-rank-badge tier-${esc(band.name.toLowerCase())}" title="Effective Skill: ${esc(effectiveRankLabel(p.skill))}">${url?`<img class="rank-emblem effective-emblem" src="${esc(url)}" alt="${esc(band.name)} effective rank" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">`:''}${fallback}<i>ADMIN</i></span>`;
}
function bandGap(a,b){return Math.abs(SKILL_BANDS.indexOf(skillBand(a))-SKILL_BANDS.indexOf(skillBand(b)));}
function matchupTone(delta,gap){if(gap>1||delta>.8)return ['CRITICAL','critical'];if(delta>.5)return ['HIGH','high'];if(delta>.3)return ['SLIGHT','slight'];return ['GOOD','good'];}
function matchupQualityMarkup(label,tone,delta){
  const icon=tone==='critical'?'!':tone==='high'?'▲':tone==='slight'?'•':'✓';
  return `<b class="matchup-quality ${tone}"><span class="mq-icon">${icon}</span><span class="mq-label">${label}</span><span class="mq-sep"></span><span class="mq-delta">Δ ${delta.toFixed(2)}</span></b>`;
}
function staffSkillEditor(p){
  if(!canStaff()) return '';
  const r=registryEntry(p.name), band=skillBand(p.skill);
  return `<div class="draft-skill-editor" data-skill-player="${esc(p.name)}"><label class="draft-skill-field mode"><span>MODE</span><select data-draft-mode aria-label="Skill mode"><option ${r.mode==='AUTO'?'selected':''}>AUTO</option><option ${r.mode==='FLOOR'?'selected':''}>FLOOR</option><option ${r.mode==='OVERRIDE'?'selected':''}>OVERRIDE</option></select></label><label class="draft-skill-field band"><span>SKILL BAND</span><select data-draft-band aria-label="Skill band">${SKILL_BANDS.map(x=>`<option value="${x.name}" ${x.name===band.name?'selected':''}>${x.name}</option>`).join('')}</select></label><label class="draft-skill-field value"><span>SKILL VALUE</span><input data-draft-value type="number" min="1" max="5" step="0.05" value="${Number(p.skill).toFixed(2)}" aria-label="Exact skill"></label><button class="draft-skill-save" data-save-skill>APPLY</button><small class="draft-skill-hint">${r.mode==='AUTO'?'Editing band/value switches to OVERRIDE.':'Saved to Player Registry.'}</small></div>`;
}
function matchupPlayer(p, side, matchIndex, teamIndex, playerIndex){
  const sc=p.scout, manual=String(registryEntry(p.name).smurfMode||'AUTO').toUpperCase();
  const selected=draftMoveSelection&&draftMoveSelection.matchIndex===matchIndex&&draftMoveSelection.teamIndex===teamIndex&&draftMoveSelection.playerIndex===playerIndex;
  const canSwap=draftMoveSelection&&draftMoveSelection.matchIndex===matchIndex&&draftMoveSelection.teamIndex!==teamIndex;
  const moveLabel=selected?'CANCEL':canSwap?'SWAP HERE':'MOVE';
  const reg=registryEntry(p.name), isAdjusted=!!p.adjustment?.adjusted || reg.mode==='OVERRIDE' || (reg.mode==='FLOOR' && Number(p.skill)>Number(p.adjustment?.autoSkill??0)+.004);
  const liveRank=sc?`${esc(sc.rank)} · ${sc.lp} LP · ${Number(sc.winrate||0).toFixed(1)}% WR`:'Manual player';
  const rankLine=isAdjusted?`<small class="effective-rank-line">${esc(effectiveRankLabel(p.skill))} · ${esc(reg.mode)} <span>• OP.GG: ${liveRank}</span></small>`:`<small>${liveRank}</small>`;
  return `<div class="matchup-player ${side} ${selected?'move-selected':''} ${canSwap?'swap-target':''}"><div class="matchup-identity">${effectiveRankBadge(p)}<div class="matchup-copy"><b>${esc(p.name)}${isFeatured(p.name)?` <em>★ STREAMER</em>`:''}</b>${rankLine}</div><strong>${Number(p.skill).toFixed(2)}</strong></div><div class="matchup-meta">${suspicionBadge(sc,p.name)}<span class="skill-band-label">${effectiveRankLabel(p.skill)}${isAdjusted?' · ADMIN':''}</span></div>${staffSkillEditor(p)}${canStaff()?`<div class="matchup-actions"><span class="smurf-controls" data-player="${esc(p.name)}"><button class="${manual==='AUTO'?'active':''}" data-smurf="AUTO">AUTO</button><button class="${manual==='NOT_SMURF'?'active safe':''}" data-smurf="NOT_SMURF">CLEAN</button><button class="${manual==='SMURF'?'active danger':''}" data-smurf="SMURF">SMURF</button></span><button class="draft-move-btn ${selected?'cancel':''} ${canSwap?'swap':''}" data-move="${matchIndex}:${teamIndex}:${playerIndex}">${moveLabel}</button><details class="player-more"><summary title="More player actions">•••</summary><div><button data-remove-player="${matchIndex}:${teamIndex}:${playerIndex}">REMOVE FROM MATCH</button></div></details></div>`:''}</div>`;
}
function matchupBoard(m, matchIndex){
  const rows=ROLES.map(role=>{
    const ai=m.teams[0].players.findIndex(p=>p.role===role), bi=m.teams[1].players.findIndex(p=>p.role===role);
    const a=m.teams[0].players[ai], b=m.teams[1].players[bi]; if(!a||!b)return '';
    const delta=Math.abs(Number(a.skill)-Number(b.skill)), gap=bandGap(a.skill,b.skill), [label,tone]=matchupTone(delta,gap);
    return `<div class="role-matchup"><div class="role-matchup-head"><span>${role}</span>${matchupQualityMarkup(label,tone,delta)}</div><div class="role-matchup-grid">${matchupPlayer(a,'left',matchIndex,0,ai)}<div class="versus">VS</div>${matchupPlayer(b,'right',matchIndex,1,bi)}</div></div>`;
  }).join('');
  return `<div class="matchup-board"><div class="matchup-team-head"><b>${canStaff()?`<input class="team-name-input" data-team-name="${matchIndex}:0" maxlength="32" value="${esc(m.teams[0].name)}" aria-label="Blue team name">`:esc(m.teams[0].name)} <small>· ${Number(m.teams[0].skill).toFixed(2)} PTS</small></b><span>ROLE-BY-ROLE MATCHUPS</span><b>${canStaff()?`<input class="team-name-input" data-team-name="${matchIndex}:1" maxlength="32" value="${esc(m.teams[1].name)}" aria-label="Red team name">`:esc(m.teams[1].name)} <small>· ${Number(m.teams[1].skill).toFixed(2)} PTS</small></b></div>${rows}</div>`;
}
function saveDraftState(){ if(currentTeams) localStorage.setItem(KEY_DRAFT,JSON.stringify(currentTeams)); else localStorage.removeItem(KEY_DRAFT); queueWorkflowSync(); }
function saveBracketState(){ if(bracketState) localStorage.setItem(KEY_BRACKET,JSON.stringify(bracketState)); else localStorage.removeItem(KEY_BRACKET); queueWorkflowSync(); }
let workflowSyncTimer=null;
function queueWorkflowSync(){
  if(!canStaff())return; clearTimeout(workflowSyncTimer);
  const state=$('#workflow-sync-state'); if(state)state.textContent='Modificări locale · sincronizare…';
  workflowSyncTimer=setTimeout(syncWorkflowServer,500);
}
async function syncWorkflowServer(){
  if(!canStaff())return;
  try{const r=await fetch('/api/admin/workflow',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:currentTeams,bracket:bracketState})});if(!r.ok)throw new Error('sync');const state=$('#workflow-sync-state');if(state)state.textContent='✓ Starea activă este sincronizată.';}catch{const state=$('#workflow-sync-state');if(state)state.textContent='⚠ Sincronizarea nu a reușit. Starea locală este păstrată.';}
}
async function restoreWorkflowServer(){
  if(!canStaff())return;
  try{const r=await fetch('/api/admin/workflow');if(!r.ok)return;const d=await r.json(),w=d.workflow||{};if(w.draft){currentTeams=w.draft;localStorage.setItem(KEY_DRAFT,JSON.stringify(currentTeams));}if(w.bracket){bracketState=w.bracket;localStorage.setItem(KEY_BRACKET,JSON.stringify(bracketState));}}catch{}
}
function validateMatchForLive(m){
  if(!m?.teams||m.teams.length!==2)return 'Meciul nu are două echipe.';
  for(const t of m.teams){if(!Array.isArray(t.players)||t.players.length!==5)return `${t.name||'Echipa'} nu are exact 5 jucători.`;const roles=t.players.map(p=>p.role);if(ROLES.some(r=>roles.filter(x=>x===r).length!==1))return `${t.name||'Echipa'} nu are exact TOP/JNG/MID/ADC/SUP.`;}
  return '';
}
function recalcDraftMatch(m){
  m.teams.forEach(t=>t.skill=t.players.reduce((sum,p)=>sum+Number(p.skill||0),0));
  m.skillDelta=Math.abs(m.teams[0].skill-m.teams[1].skill);
  const roleDeltas=ROLES.map(role=>{
    const a=m.teams[0].players.find(p=>p.role===role), b=m.teams[1].players.find(p=>p.role===role);
    return a&&b?Math.abs(Number(a.skill||0)-Number(b.skill||0)):0;
  });
  m.maxRoleDelta=Math.max(0,...roleDeltas);
  const penalty=m.skillDelta*12+roleDeltas.reduce((sum,d)=>sum+d*d*5,0);
  m.qualityScore=Math.max(0,Math.min(100,Math.round(100-penalty)));
  m.qualityLabel=m.qualityScore>=90?'EXCELLENT':m.qualityScore>=80?'GOOD':m.qualityScore>=65?'FAIR':'ADMIN CUSTOM';
  m.mismatch=ROLES.map((role,i)=>{const a=m.teams[0].players.find(p=>p.role===role),b=m.teams[1].players.find(p=>p.role===role),d=roleDeltas[i];return a&&b&&d>.5?{role,players:[a.name,b.name],delta:d,severity:d>.8?'CRITICAL':'WARNING'}:null}).filter(Boolean);
}

function renderDraft(data){
  const matches=data.matches||[{index:1,teams:data.teams,skillDelta:data.skillDelta,maxRoleDelta:data.maxRoleDelta,qualityScore:data.qualityScore,qualityLabel:data.qualityLabel,mismatch:data.mismatch||[]}];
  // Stream priority: featured player's match first; featured team shown Blue Side. This never changes team composition or skill.
  matches.forEach(m=>{ if(m.teams?.[1]?.players?.some(p=>isFeatured(p.name)) && !m.teams?.[0]?.players?.some(p=>isFeatured(p.name))) m.teams=[m.teams[1],m.teams[0]]; });
  matches.sort((a,b)=>Number(b.teams?.some(t=>t.players?.some(p=>isFeatured(p.name))))-Number(a.teams?.some(t=>t.players?.some(p=>isFeatured(p.name)))));
  data.matches=matches; currentTeams=data; saveDraftState();
  const cards=matches.map((m,i)=>{
    const warnings=m.mismatch?.length?`<div class="mismatch compact"><b>⚠ ROLE MISMATCH</b><br>${m.mismatch.map(x=>`${x.severity||"WARNING"} · ${x.role}: ${esc(x.players[0])} vs ${esc(x.players[1])} — Δ ${Number(x.delta).toFixed(2)}`).join("<br>")}</div>`:`<div class="match-ok">✓ Role deltas within threshold</div>`;
    const featured=m.teams.some(t=>t.players.some(p=>isFeatured(p.name)));
    return `<section class="draft-match ${featured?'featured-match':''}"><div class="match-title"><div><span>MATCH ${String(i+1).padStart(2,'0')} ${featured?'· ★ FEATURED':''}</span><b>${esc(m.qualityLabel||'—')}</b></div><strong>${Number(m.qualityScore||0)}/100</strong><small>Total Δ ${Number(m.skillDelta||0).toFixed(2)} · Max role Δ ${Number(m.maxRoleDelta||0).toFixed(2)}</small></div>${matchupBoard(m,i)}${warnings}${canStaff()?`<button class="btn btn-primary full send-live" data-live-match="${i}">SEND TO LIVE / OBS ↗</button>`:``}</section>`;
  }).join('');
  const reserves=data.reserves?.length?`<div class="reserve-note"><b>WAITING / RESERVES (${data.reserves.length})</b><span>${data.reserves.map(p=>esc(p.name)).join(", ")}</span></div>`:'';
  $("#teams-output").innerHTML=`<div class="draft-summary"><b>${matches.length*2} TEAMS · ${matches.length} MATCH${matches.length===1?'':'ES'}</b><span>${matches.length*10} players drafted${data.reserves?.length?` · ${data.reserves.length} waiting`:''}</span></div>${canStaff()?(draftUndoState?`<div class="draft-undo-bar"><span>${esc(draftUndoState.label)}</span><button data-draft-undo>UNDO</button></div>`:draftMoveSelection?`<div class="draft-admin-hint"><b>MOVE ACTIVE</b> · Alege jucătorul din echipa opusă. RIFT/OPS păstrează automat 5v5.</div>`:`<div class="draft-admin-hint"><b>QUICK ADMIN</b> · MOVE pentru schimb direct. Acțiunile rare sunt în •••.</div>`):``}${cards}${reserves}${canStaff()?`<button class="btn btn-secondary full" id="save-team-match">SAVE ALL MATCHES TO HISTORY</button>`:``}`;
  $("#save-team-match")?.addEventListener("click",()=>{matches.forEach((m,i)=>saveMatch("5V5",`Match ${i+1}: ${m.teams[0].name} vs ${m.teams[1].name}`,m.teams.map(t=>`${t.name}: ${t.players.map(p=>`${p.role} ${p.name} [${Number(p.skill).toFixed(2)}]`).join(", ")}`).join(" | ")));$("#save-team-match").textContent="✓ ALL SAVED";});
}


document.addEventListener('click',e=>{const b=e.target.closest('[data-draft-undo]');if(!b||!canStaff()||!draftUndoState)return;currentTeams=structuredClone(draftUndoState.snapshot);draftUndoState=null;draftMoveSelection=null;saveDraftState();renderDraft(currentTeams);refreshQueueFromDraft();});

// V6.5 staff draft removal: preserve 5v5 and choose the closest reserve when possible.
document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-remove-player]'); if(!btn||!canStaff()||!currentTeams)return;
  const [mi,ti,pi]=btn.dataset.removePlayer.split(':').map(Number), match=currentTeams.matches?.[mi], team=match?.teams?.[ti], player=team?.players?.[pi];
  if(!player)return;
  const reserves=currentTeams.reserves||(currentTeams.reserves=[]);
  if(!reserves.length){alert('Nu există jucători în Waiting / Reserves. Pentru a păstra meciul 5v5, adaugă mai întâi o rezervă.');return;}
  draftUndoState={label:`${player.name} replaced from reserves`,snapshot:structuredClone(currentTeams)};
  const ranked=reserves.map((p,i)=>({p,i,same:String(p.preferredRole||p.role||'').toUpperCase()===String(player.role||'').toUpperCase(),delta:Math.abs(Number(p.skill||0)-Number(player.skill||0))})).sort((a,b)=>Number(b.same)-Number(a.same)||a.delta-b.delta);
  const ri=ranked[0].i, replacement=reserves.splice(ri,1)[0]; replacement.role=player.role;
  team.players[pi]=replacement; reserves.push(player); draftMoveSelection=null; recalcDraftMatch(match); renderDraft(currentTeams); refreshQueueFromDraft();
});

$("#load-demo").addEventListener("click",()=>{
  if(!canStaff())return;
  $("#player-input").value="Faker\nCaps\nJankos\nRekkles\nMikyx\nKeria\nChovy\nShowMaker\nInspired\nHans Sama\nHumanoid\nBwipo";
  syncRosterFromInput();
});
$("#player-input").addEventListener("input",()=>{const n=parseNames($("#player-input").value).length;$("#roster-count").textContent=`${n} PLAYERS`;});
$("#generate-teams").addEventListener("click",async()=>{
  if(!canStaff())return;
  syncRosterFromInput();
  if(roster.length<10){$("#teams-output").innerHTML=`<div class="mismatch">Ai introdus ${roster.length} jucători. Sunt necesari cel puțin 10 pentru un meci 5v5.</div>`;return;}
  const button=$("#generate-teams");button.disabled=true;
  const hasRiotIds=roster.some(p=>String(p.name||"").includes("#"));
  $("#draft-status").textContent=hasRiotIds?"SCOUTING OP.GG...":"GENERATING TEAMS...";
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),45000);
  try{
    const res=await fetch("/api/teams",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({players:roster}),signal:controller.signal});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||"Nu s-au putut genera echipele.");
    renderDraft(data); refreshQueueFromDraft();
    $("#draft-status").textContent=`${(data.matches||[]).length||1} MATCH${((data.matches||[]).length||1)===1?'':'ES'} READY`;
  }catch(e){
    const msg=e?.name==='AbortError'?'Generarea a durat prea mult. Verifică OP.GG/conexiunea și încearcă din nou.':e.message;
    $("#teams-output").innerHTML=`<div class="mismatch">${esc(msg)}</div>`;$("#draft-status").textContent="ERROR";
  } finally { clearTimeout(timeout); button.disabled=false; }
});
$("#teams-output").addEventListener("click",async e=>{
  const liveBtn=e.target.closest("[data-live-match]");
  if(liveBtn){ const matches=currentTeams?.matches||[]; const m=matches[Number(liveBtn.dataset.liveMatch)]; if(m){const issue=validateMatchForLive(m);if(issue){alert('Nu poate fi trimis LIVE: '+issue);return;} setLiveMatch(m,Number(liveBtn.dataset.liveMatch));} return; }
  const skillSave=e.target.closest("[data-save-skill]");
  if(skillSave){
    const box=skillSave.closest('[data-skill-player]'), name=box?.dataset.skillPlayer; if(!name||!canStaff())return;
    let mode=box.querySelector('[data-draft-mode]').value, bandName=box.querySelector('[data-draft-band]').value;
    let value=Number(box.querySelector('[data-draft-value]').value), band=SKILL_BANDS.find(x=>x.name===bandName);
    if(!Number.isFinite(value)) value=band?.value||3; value=Math.max(1,Math.min(5,value));
    const key=registryKey(name), r={...registryEntry(name),mode};
    if(mode==='FLOOR') r.floor=value; if(mode==='OVERRIDE') r.override=value;
    if(mode==='AUTO'){r.floor=null;r.override=null;}
    registry[key]=r;
    try{
      skillSave.disabled=true; skillSave.textContent='SAVING…';
      await saveRegistryEntry(name);
      skillSave.textContent='✓ SAVED';
    }catch(err){console.error(err);skillSave.disabled=false;skillSave.textContent='RETRY';return;}
    const matches=currentTeams?.matches||[];
    for(const m of matches) for(const t of m.teams) for(const p of t.players) if(registryKey(p.name)===key){
      const auto=Number(p.adjustment?.autoSkill??p.scout?.autoSkill??p.skill); let final=auto;
      if(mode==='FLOOR') final=Math.max(auto,value); if(mode==='OVERRIDE') final=value;
      p.skill=Number(final.toFixed(2)); p.adjustment={...(p.adjustment||{}),mode,autoSkill:auto,floor:r.floor??null,override:r.override??null,adjusted:Math.abs(final-auto)>.004};
    }
    matches.forEach(recalcDraftMatch); renderDraft(currentTeams); return;
  }
  const bandSelect=e.target.closest('[data-draft-band]');
  if(bandSelect){
    const box=bandSelect.closest('[data-skill-player]'), band=SKILL_BANDS.find(x=>x.name===bandSelect.value);
    if(box&&band){box.querySelector('[data-draft-value]').value=band.value.toFixed(2);box.querySelector('[data-draft-mode]').value='OVERRIDE';}
  }
  const move=e.target.closest("[data-move]");
  if(move){
    const [matchIndex,teamIndex,playerIndex]=move.dataset.move.split(":").map(Number);
    if(!currentTeams)return;
    const matches=currentTeams.matches||[{teams:currentTeams.teams}];
    if(!draftMoveSelection){ draftMoveSelection={matchIndex,teamIndex,playerIndex}; renderDraft(currentTeams); return; }
    if(draftMoveSelection.matchIndex===matchIndex&&draftMoveSelection.teamIndex===teamIndex&&draftMoveSelection.playerIndex===playerIndex){ draftMoveSelection=null; renderDraft(currentTeams); return; }
    if(draftMoveSelection.matchIndex!==matchIndex||draftMoveSelection.teamIndex===teamIndex){ draftMoveSelection={matchIndex,teamIndex,playerIndex}; renderDraft(currentTeams); return; }
    const m=matches[matchIndex], a=draftMoveSelection, pA=m.teams[a.teamIndex].players[a.playerIndex], pB=m.teams[teamIndex].players[playerIndex];
    // Roles belong to the draft slots, not to the player being moved. When two players
    // are swapped, each takes the other player's slot so every team always keeps
    // exactly one TOP / JNG / MID / ADC / SUP.
    draftUndoState={label:`${pA.name} swapped with ${pB.name}`,snapshot:structuredClone(currentTeams)};
    const roleA=pA.role, roleB=pB.role;
    pB.role=roleA; pA.role=roleB;
    m.teams[a.teamIndex].players[a.playerIndex]=pB; m.teams[teamIndex].players[playerIndex]=pA;
    recalcDraftMatch(m); draftMoveSelection=null; renderDraft(currentTeams); refreshQueueFromDraft(); return;
  }
  const btn=e.target.closest("[data-smurf]"); if(!btn)return;
  const controls=btn.closest(".smurf-controls"); if(!controls)return;
  const name=controls.dataset.player, key=registryKey(name), r={...registryEntry(name)};
  r.smurfMode=btn.dataset.smurf; registry[key]=r; saveRegistryEntry(name).catch(console.error);
  if(currentTeams) renderDraft(currentTeams);
});

// Draft skill controls: editing a band/value means the staff member wants a manual value.
// Switch to OVERRIDE automatically so APPLY always has an immediately visible effect.
$('#teams-output').addEventListener('change',e=>{
  const input=e.target.closest('[data-team-name]');
  if(input&&canStaff()&&currentTeams){const [mi,ti]=input.dataset.teamName.split(':').map(Number),m=currentTeams.matches?.[mi];if(m?.teams?.[ti]){const name=input.value.trim().slice(0,32)||`${ti?'RED':'BLUE'} ${mi+1}`;m.teams[ti].name=name;input.value=name;saveDraftState();refreshQueueFromDraft();}return;}
  const box=e.target.closest('[data-skill-player]'); if(!box||!canStaff())return;
  if(e.target.matches('[data-draft-band]')){
    const band=SKILL_BANDS.find(x=>x.name===e.target.value);
    if(band) box.querySelector('[data-draft-value]').value=band.value.toFixed(2);
    box.querySelector('[data-draft-mode]').value='OVERRIDE';
  }
  if(e.target.matches('[data-draft-value]')) box.querySelector('[data-draft-mode]').value='OVERRIDE';
});

async function loadChampions(){
  try{
    const versions=await fetch("https://ddragon.leagueoflegends.com/api/versions.json").then(r=>r.json());
    const version=versions[0]; ddragonVersion=version;
    const data=await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`).then(r=>r.json());
    const champions=Object.values(data.data).sort((a,b)=>a.name.localeCompare(b.name));
    championImageByName=Object.fromEntries(champions.map(c=>[c.name.toLowerCase(),`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.image.full}`]));
    ["#arena-champ1","#arena-champ2"].forEach(sel=>{$(sel).innerHTML='<option value="">Alege campion</option>'+champions.map(c=>`<option value="${esc(c.name)}" data-image="https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.image.full}">${esc(c.name)}</option>`).join("");});
  }catch(e){console.warn("DataDragon indisponibil; campionii pot fi introduși după reîncărcare.",e);}
}
$("#generate-arena").addEventListener("click",()=>{
  const p1=$("#arena-p1").value.trim(),p2=$("#arena-p2").value.trim();
  if(!p1||!p2){$("#arena-result").innerHTML='<div class="mismatch">Introdu numele ambilor jucători.</div>';return;}
  if(p1.toLowerCase()===p2.toLowerCase()){ $("#arena-result").innerHTML='<div class="mismatch">Alege doi jucători diferiți.</div>';return;}
  const c1=$("#arena-champ1").value||"Random champion",c2=$("#arena-champ2").value||"Random champion";
  $("#arena-result").innerHTML=`<div class="match-result arena-live"><div><span class="section-kicker">BLUE SIDE</span><br><strong>${esc(p1)}</strong><div class="subtle">${esc(c1)}</div>${canStaff()?`<button class="result-win blue-win" data-arena-winner="1">✓ BLUE WINS</button>`:``}</div><div class="arena-decision"><strong>VS</strong><span>SELECT WINNER</span></div><div style="text-align:right"><span class="section-kicker">RED SIDE</span><br><strong>${esc(p2)}</strong><div class="subtle">${esc(c2)}</div>${canStaff()?`<button class="result-win red-win" data-arena-winner="2">RED WINS ✓</button>`:``}</div></div>`;
  $$('[data-arena-winner]', $("#arena-result")).forEach(btn=>btn.addEventListener('click',()=>{
    const blue=btn.dataset.arenaWinner==='1', winner=blue?p1:p2, loser=blue?p2:p1, wc=blue?c1:c2, lc=blue?c2:c1;
    saveMatch('1V1',`${winner} def. ${loser}`,`${wc} vs ${lc}`,{winner,loser,round:'BEST OF 1'});
    $("#arena-result").innerHTML=`<div class="match-result decided"><div><span class="result-label win">WINNER</span><strong>${esc(winner)}</strong><div class="subtle">${esc(wc)}</div></div><div class="decision-score">1 — 0</div><div style="text-align:right"><span class="result-label loss">LOSER</span><strong>${esc(loser)}</strong><div class="subtle">${esc(lc)}</div></div></div><div class="saved-banner">✓ RESULT SAVED TO 1V1 HISTORY</div>`;
  }));
});
$("#clear-arena-history")?.addEventListener('click',()=>{if(!canStaff())return;if(confirm('Ștergi tot istoricul 1v1?')){history=history.filter(h=>h.type!=='1V1');saveHistory();}});

function makeRound(name,pairs){return {name,matches:pairs.map(pair=>({teams:pair.map(team=>({name:team,winner:false})),winner:null}))};}
function bracketComplete(){const last=bracketState?.[bracketState.length-1];return !!last?.matches?.[0]?.winner;}
function archiveBracket(automatic=false){if(!bracketComplete())return;const winner=bracketState.at(-1).matches[0].winner;const id='bracket-'+Date.now();const summary=bracketState.map(r=>r.name+': '+r.matches.map(m=>m.winner||'—').join(', ')).join(' | ');saveMatch('TOURNAMENT_ARCHIVE',`Tournament winner: ${winner}`,summary,{winner,round:'COMPLETED',bracketId:id});}
function nextPowerOfTwo(n){let p=1;while(p<n)p*=2;return p;}
function roundLabel(remaining){if(remaining===2)return 'GRAND FINAL';if(remaining===4)return 'SEMI-FINALS';if(remaining===8)return 'QUARTER-FINALS';if(remaining===16)return 'ROUND OF 16';if(remaining===32)return 'ROUND OF 32';if(remaining===64)return 'ROUND OF 64';return `ROUND OF ${remaining}`;}
function propagateBracketWinner(ri,mi,winner){const next=bracketState?.[ri+1];if(!next)return;const nextMatch=Math.floor(mi/2),slot=mi%2;next.matches[nextMatch].teams[slot]={name:winner,winner:false};}
function resolveBracketByes(){
  if(!bracketState)return;
  let changed=true,guard=0;
  while(changed&&guard++<20){changed=false;
    bracketState.forEach((round,ri)=>round.matches.forEach((m,mi)=>{
      if(m.winner)return;
      const a=m.teams[0]?.name||'TBD',b=m.teams[1]?.name||'TBD';
      const realA=a!=='TBD'&&a!=='BYE',realB=b!=='TBD'&&b!=='BYE';
      if(realA&&b==='BYE'){m.winner=a;m.autoBye=true;propagateBracketWinner(ri,mi,a);changed=true;}
      else if(realB&&a==='BYE'){m.winner=b;m.autoBye=true;propagateBracketWinner(ri,mi,b);changed=true;}
      else if(a==='BYE'&&b==='BYE'){m.winner='BYE';m.autoBye=true;propagateBracketWinner(ri,mi,'BYE');changed=true;}
    }));
  }
}
$('#generate-bracket').addEventListener('click',()=>{
  if(!canStaff())return;
  const names=parseNames($('#bracket-input').value);
  if(names.length<2||names.length>64){$('#bracket-output').innerHTML=`<div class="mismatch">Bracket-ul suportă între 2 și 64 de echipe. Ai introdus ${names.length}.</div>`;return;}
  if(names.some(n=>n.length>64||['BYE','TBD'].includes(n.toUpperCase()))||new Set(names.map(x=>x.toLowerCase())).size!==names.length){$('#bracket-output').innerHTML='<div class="mismatch">Există nume de echipă duplicate. Fiecare echipă trebuie să aibă un nume unic.</div>';return;}
  const size=nextPowerOfTwo(names.length), shuffled=[...names].sort(()=>Math.random()-.5);
  // Spread BYEs through the opening round instead of stacking them at the end.
  const slots=Array(size).fill('BYE');
  const step=size/names.length;
  shuffled.forEach((name,i)=>{let pos=Math.floor(i*step);while(slots[pos]!=='BYE')pos=(pos+1)%size;slots[pos]=name;});
  const rounds=[];
  for(let remaining=size;remaining>=2;remaining/=2){
    if(remaining===size) rounds.push(makeRound(roundLabel(remaining),Array.from({length:remaining/2},(_,i)=>[slots[i*2],slots[i*2+1]])));
    else rounds.push(makeRound(roundLabel(remaining),Array.from({length:remaining/2},()=>['TBD','TBD'])));
  }
  bracketState=rounds;resolveBracketByes();renderBracket();
});
function renderBracket(){
  if(!bracketState)return;
  saveBracketState();
  const teamCount=parseNames($('#bracket-input')?.value||'').length;
  $('#bracket-output').innerHTML=`<div class="bracket-toolbar"><span>${bracketComplete()?'TOURNAMENT COMPLETE':'TOURNAMENT IN PROGRESS'}${teamCount?` · ${teamCount} TEAMS`:''}</span>${bracketComplete()&&canStaff()?'<span class="pill">AUTO-SAVED</span>':''}</div><div class="bracket-columns">${bracketState.map((round,ri)=>`<div class="bracket-round"><div class="round-title">${round.name}</div>${round.matches.map((match,mi)=>`<div class="bracket-match ${match.winner?'resolved':''} ${match.autoBye?'bye-match':''}">${match.teams.map((t,ti)=>{const isBye=t.name==='BYE',isWinner=match.winner===t.name&&!isBye,isLoser=match.winner&&t.name!==match.winner&&t.name!=='TBD'&&!isBye;return `<div class="bracket-team ${isWinner?'winner':''} ${isLoser?'loser':''} ${isBye?'bye':''}"><span>${isWinner?'✓ ':isLoser?'✕ ':''}${esc(t.name)}</span>${canStaff()&&ri===0&&!isBye&&t.name!=='TBD'?`<button data-team-edit="${mi}:${ti}">EDIT</button><button data-team-delete="${mi}:${ti}">DELETE</button>`:''}${canStaff()&&t.name!=='TBD'&&!isBye&&!match.winner?`<button data-win="${ri}:${mi}:${ti}">WIN</button>`:''}${isWinner?'<b class="wl win">WIN</b>':isLoser?'<b class="wl loss">LOSS</b>':isBye?'<b class="wl">BYE</b>':''}</div>`}).join('')}${canStaff()&&match.winner&&!match.autoBye?`<button class="undo-result" data-undo="${ri}:${mi}">UNDO RESULT</button>`:''}</div>`).join('')}</div>`).join('')}</div>`;
  updateOpsSummary();
  $$('[data-win]',$('#bracket-output')).forEach(btn=>btn.addEventListener('click',()=>{
    const [ri,mi,ti]=btn.dataset.win.split(':').map(Number),match=bracketState[ri].matches[mi],winner=match.teams[ti].name;if(winner==='TBD'||winner==='BYE')return;
    const loser=match.teams[1-ti].name;match.winner=winner;match.autoBye=false;propagateBracketWinner(ri,mi,winner);resolveBracketByes();
    saveMatch('TOURNAMENT',`${winner} def. ${loser}`,`${bracketState[ri].name} · Match ${mi+1}`,{winner,loser,round:bracketState[ri].name});renderBracket();
  }));
  $$('[data-undo]',$('#bracket-output')).forEach(btn=>btn.addEventListener('click',()=>{
    const [ri,mi]=btn.dataset.undo.split(':').map(Number),match=bracketState[ri].matches[mi];if(!match.winner)return;const oldWinner=match.winner;match.winner=null;match.autoBye=false;
    // Reset every downstream result that depended on this branch.
    for(let r=ri+1;r<bracketState.length;r++){bracketState[r].matches.forEach(m=>{if(m.teams.some(t=>t.name===oldWinner)||m.winner===oldWinner){m.teams=m.teams.map(t=>t.name===oldWinner?{name:'TBD',winner:false}:t);m.winner=null;m.autoBye=false;}});}
    renderBracket();
  }));
}
$('#clear-tournament-history')?.addEventListener('click',()=>{if(!canStaff())return;if(confirm('Ștergi tot istoricul turneelor?')){history=history.filter(h=>h.type!=='TOURNAMENT'&&h.type!=='TOURNAMENT_ARCHIVE');saveHistory();}});

function championIcon(name){
  const url=championImageByName[String(name||"").toLowerCase()];
  return url?`<img src="${esc(url)}" alt="${esc(name)}">`:`<span class="champion-fallback">${esc(String(name||'?').slice(0,2).toUpperCase())}</span>`;
}
function renderChampionPool(pool){
  if(!Array.isArray(pool)||!pool.length)return "";
  return `<div class="profile-section"><div class="section-kicker">CHAMPION POOL</div><div class="champion-pool-grid">${pool.map(c=>`<article class="champion-card">${championIcon(c.name)}<div class="champion-card-copy"><b>${esc(c.name)}</b><span>${Number(c.games||0)} ranked games</span><small>${Number(c.winrate||0)>0?`${Number(c.winrate).toFixed(1)}% WR`:''}</small></div></article>`).join("")}</div></div>`;
}
function renderRankedQueues(queues){
  if(!Array.isArray(queues)||!queues.length)return "";
  const rows=queues.filter(q=>q && q.tier && q.tier!=="UNRANKED" && !String(q.gameType||"").includes("ARENA"));
  if(!rows.length)return "";
  return `<div class="profile-section"><div class="section-kicker">RANKED QUEUES</div><div class="ranked-queue-grid">${rows.map(q=>`<article class="ranked-queue-card"><div class="queue-emblem">${rankBadge({tier:q.tier,tierImageUrl:q.tierImageUrl},false)}</div><div><span class="queue-label">${String(q.gameType||"").includes("FLEX")?"RANKED FLEX":"RANKED SOLO / DUO"}</span><b>${esc(q.tier)} ${esc(q.division||"")} · ${Number(q.lp||0)} LP</b><small>${Number(q.winrate||0).toFixed(1)}% WR · ${Number(q.wins||0)}W / ${Number(q.losses||0)}L</small></div></article>`).join("")}</div></div>`;
}
function renderProfileAdmin(p){
  const r=registryEntry(p.riotId);
  return `<div class="profile-admin" data-profile-admin="${esc(p.riotId)}"><div><div class="section-kicker">ADMIN PLAYER CONTROL</div><b>Edit balance information</b><small>OP.GG rank/LP remain live data. These controls only change RIFT/OPS balancing and labels.</small></div><div class="profile-admin-grid"><label>SKILL MODE<select data-pfield="mode"><option ${r.mode==='AUTO'?'selected':''}>AUTO</option><option ${r.mode==='FLOOR'?'selected':''}>FLOOR</option><option ${r.mode==='OVERRIDE'?'selected':''}>OVERRIDE</option></select></label><label>SMURF STATUS<select data-pfield="smurfMode"><option value="AUTO" ${r.smurfMode==='AUTO'?'selected':''}>AUTO</option><option value="NOT_SMURF" ${r.smurfMode==='NOT_SMURF'?'selected':''}>NOT SMURF</option><option value="SMURF" ${r.smurfMode==='SMURF'?'selected':''}>SMURF</option></select></label><label>SKILL FLOOR<input data-pfield="floor" type="number" min="1" max="5" step="0.05" value="${r.floor??''}" placeholder="4.70"></label><label>OVERRIDE<input data-pfield="override" type="number" min="1" max="5" step="0.05" value="${r.override??''}" placeholder="4.80"></label><label>KNOWN PLAYER / ALIAS<input data-pfield="alias" value="${esc(r.alias||'')}" placeholder="Woodye"></label><label>PREFERRED ROLE<select data-pfield="preferredRole"><option value="">AUTO</option>${ROLES.map(x=>`<option ${r.preferredRole===x?'selected':''}>${x}</option>`).join('')}</select></label></div><label>ADMIN NOTE<input data-pfield="note" value="${esc(r.note||'')}" placeholder="Known alt account / caster note"></label><div class="profile-admin-saved">Changes save automatically.</div></div>`;
}
function kdaTone(kda){kda=Number(kda||0);return kda>=5?'kda-god':kda>=4?'kda-great':kda>=3?'kda-good':kda>=2?'kda-ok':'kda-low'}
function renderRecentMatches(matches){
  if(!Array.isArray(matches)||!matches.length)return "";
  return `<div class="opgg-recent"><div class="section-kicker">RECENT FORM</div>${matches.slice(0,10).map(m=>{const kda=Number(m.kda||0);return `<div class="opgg-match ${m.win?'victory':'defeat'}"><div class="opgg-result"><b>${m.win?'VICTORY':'DEFEAT'}</b><span>${m.win?'WIN':'LOSS'}</span></div><div class="opgg-champ"><strong>${esc(m.champion)}</strong>${m.mvp?'<em class="op-badge mvp">MVP</em>':''}${m.ace?'<em class="op-badge ace">ACE</em>':''}</div><div class="opgg-kda"><div><strong>${m.kills}</strong> / <i>${m.deaths}</i> / <strong>${m.assists}</strong></div><span class="${kdaTone(kda)}">${kda.toFixed(2)} KDA</span></div><div class="opgg-extra">${m.cs?`<span><b>${m.cs}</b> CS</span>`:''}${m.opScore?`<span><b>${Number(m.opScore).toFixed(1)}</b> OP SCORE</span>`:''}${m.opRank?`<span>#${m.opRank} TEAM</span>`:''}</div></div>`}).join("")}</div>`;
}
$("#lookup-profile").addEventListener("click",async()=>{
  const id=$("#riot-id").value.trim();if(!id){$("#profile-output").innerHTML='<div class="mismatch">Introdu un Riot ID în formatul Nume#TAG.</div>';return;}
  $("#lookup-profile").disabled=true;$("#lookup-profile").textContent="SCANNING OP.GG...";
  try{
    const res=await fetch(`/api/profile?riotId=${encodeURIComponent(id)}`),p=await res.json();
    if(!res.ok)throw new Error(p.error||"Nu s-a putut încărca profilul OP.GG.");
    const record=p.rank==="UNRANKED"?"UNRANKED":`${p.rank} · ${p.lp} LP · ${p.wins}W/${p.losses}L`;
    $("#profile-output").innerHTML=`<div class="profile-card"><div class="profile-top"><div class="profile-identity">${rankBadge(p,true)}<div><div class="section-kicker">PLAYER PROFILE / ${esc(p.source)}</div><div class="profile-id">${esc(p.riotId)}</div><div class="profile-rank">${esc(record)}</div></div></div><div>${suspicionBadge(p)}</div></div><div class="stat-grid"><div class="stat-box"><span>ACCOUNT LEVEL</span><b>${p.level||"—"}</b></div><div class="stat-box"><span>SOLOQ WIN RATE</span><b>${Number(p.winrate||0).toFixed(1)}%</b></div><div class="stat-box"><span>RANK RATING</span><b>${Number(p.rankSkill||0).toFixed(2)}</b></div><div class="stat-box"><span>RECENT PERF.</span><b>${Number(p.recentPerformanceSkill||p.rankSkill||0).toFixed(2)}</b></div><div class="stat-box"><span>EFFECTIVE SKILL</span><b>${Number(p.effectiveSkill||p.autoSkill||0).toFixed(2)}</b></div></div><div class="notice rating-notice"><b>RIFT BALANCE RATING</b><span>Rank ${Number(p.rankSkill||0).toFixed(2)} · Recent ${Number(p.recentPerformanceSkill||p.rankSkill||0).toFixed(2)} → Effective ${Number(p.effectiveSkill||p.autoSkill||0).toFixed(2)} · ${esc(p.estimatedBand||'')} · confidence ${esc(p.confidence)}. Acesta este un rating intern pentru custom balancing, nu MMR Riot.</span></div>${p.smurfReasons?.length?`<div class="smurf-reasons ${esc(p.smurfTone)}"><b>DETECTION SIGNALS</b><span>${p.smurfReasons.map(esc).join(" · ")}</span></div>`:""}${canStaff()?renderProfileAdmin(p):''}${renderRankedQueues(p.queues)}${renderChampionPool(p.championPool)}${renderRecentMatches(p.recentMatches)}</div>`;
  }catch(e){$("#profile-output").innerHTML=`<div class="mismatch">${esc(e.message)}</div>`;}
  finally{$("#lookup-profile").disabled=false;$("#lookup-profile").textContent="SCAN PROFILE ↗";}
});
document.addEventListener('change',e=>{
  const input=e.target.closest('[data-pfield]'); if(!input)return;
  const card=input.closest('[data-profile-admin]'); if(!card)return;
  const name=card.dataset.profileAdmin,key=registryKey(name),r={...registryEntry(name)};
  let v=input.value; if(['floor','override'].includes(input.dataset.pfield))v=v===''?null:Math.max(1,Math.min(5,Number(v)));
  r[input.dataset.pfield]=v; registry[key]=r; saveRegistryEntry(name).catch(console.error);
  const saved=card.querySelector('.profile-admin-saved'); if(saved){saved.textContent='✓ Saved';setTimeout(()=>saved.textContent='Changes save automatically.',1200);}
});
function renderAdmin(){
  $("#adc-slots").textContent=settings.adc;$("#other-slots").textContent=settings.other;
}
function renderRegistry(){
  const wrap=$("#admin-roster");
  if(!roster.length){wrap.innerHTML='<p class="subtle">Nu există roster. Adaugă jucători în Team Draft mai întâi.</p>';return;}
  wrap.innerHTML=roster.map((p,i)=>{const r=registryEntry(p.name);return `<div class="registry-card" data-reg="${i}"><div class="registry-head"><div><b>${esc(p.name)}</b><small>${r.alias?`Known as: ${esc(r.alias)}`:'Known-player registry'}</small></div><span class="registry-mode">${esc(r.mode)}</span></div><div class="registry-grid"><label>SKILL MODE<select data-field="mode"><option ${r.mode==='AUTO'?'selected':''}>AUTO</option><option ${r.mode==='FLOOR'?'selected':''}>FLOOR</option><option ${r.mode==='OVERRIDE'?'selected':''}>OVERRIDE</option></select></label><label>SMURF LABEL<select data-field="smurfMode"><option value="AUTO" ${String(r.smurfMode||'AUTO')==='AUTO'?'selected':''}>AUTO</option><option value="NOT_SMURF" ${r.smurfMode==='NOT_SMURF'?'selected':''}>NOT SMURF</option><option value="SMURF" ${r.smurfMode==='SMURF'?'selected':''}>SMURF</option></select></label><label>SKILL FLOOR<input data-field="floor" type="number" min="1" max="5" step="0.05" value="${r.floor??''}" placeholder="e.g. 4.70"></label><label>MANUAL OVERRIDE<input data-field="override" type="number" min="1" max="5" step="0.05" value="${r.override??''}" placeholder="e.g. 4.80"></label><label>KNOWN PLAYER / ALIAS<input data-field="alias" value="${esc(r.alias||'')}" placeholder="e.g. Woodye"></label></div><label>ADMIN NOTE<input data-field="note" value="${esc(r.note||'')}" placeholder="e.g. alt account - known Challenger player"></label><div class="registry-help">AUTO = OP.GG only · FLOOR = max(Auto, Floor) · OVERRIDE = exact manual skill.</div></div>`}).join('');
  $$('.registry-card',wrap).forEach(card=>card.addEventListener('change',e=>{const input=e.target.closest('[data-field]');if(!input)return;const p=roster[+card.dataset.reg];const key=registryKey(p.name);const r={...registryEntry(p.name)};let v=input.value;if(['floor','override'].includes(input.dataset.field))v=v===''?null:Math.max(1,Math.min(5,Number(v)));r[input.dataset.field]=v;registry[key]=r;saveRegistryEntry(p.name).catch(console.error);renderRegistry();}));
}
$("#load-admin-roster").addEventListener("click",renderRegistry);
$("#clear-registry").addEventListener("click",()=>{if(confirm("Ștergi toate override-urile și alias-urile salvate?")){fetch("/api/admin/registry",{method:"DELETE"}).then(()=>{registry={};renderRegistry();});}});
$$("[data-step]").forEach(btn=>btn.addEventListener("click",()=>{const k=btn.dataset.step;settings[k]=Math.max(1,Math.min(k==="adc"?7:6,settings[k]+Number(btn.dataset.delta)));renderAdmin();}));
$("#save-settings").addEventListener("click",()=>{localStorage.setItem(KEY_SETTINGS,JSON.stringify(settings));$("#settings-note").textContent="✓ Settings saved locally.";setTimeout(()=>$("#settings-note").textContent="",2600);});
function historyDetailsMarkup(item){
 const details=String(item.details||'');
 if(String(item.type).toUpperCase()!=='5V5')return '<div class="history-meta">'+esc(details)+'</div>';
 const teams=details.split(/\s+\|\s+/).map(part=>{
  const divider=part.indexOf(':');if(divider<1)return null;
  const name=part.slice(0,divider).trim(),players=part.slice(divider+1).trim().split(/,\s*(?=(?:TOP|JNG|MID|ADC|SUP|FILL)\s)/);
  if(!players.length||players.some(p=>! /^(TOP|JNG|MID|ADC|SUP|FILL)\s/.test(p)))return null;
  return {name,players};
 });
 if(teams.length!==2||teams.some(t=>!t))return '<div class="history-meta">'+esc(details)+'</div>';
 return '<div class="history-lineups">'+teams.map((t,i)=>'<section class="history-lineup '+(i?'red':'blue')+'"><b>'+esc(t.name)+'</b><ul>'+t.players.map(p=>'<li>'+esc(p)+'</li>').join('')+'</ul></section>').join('')+'</div>';
}
function renderHistory(){
  const wrap=$("#history-list");
  if(!history.length){wrap.innerHTML='<div class="empty-state"><div class="empty-icon">◷</div><b>Nothing logged yet</b><p>Meciurile generate vor apărea aici.</p></div>';return;}
  wrap.innerHTML=history.map(h=>`<div class="history-row"><div class="history-type">${esc(h.type)}</div><div><div class="history-title">${esc(h.title)}</div><div class="history-meta">${esc(h.time)}</div>${historyDetailsMarkup(h)}</div>${canStaff()?`<button data-delete="${h.id}">REMOVE</button>`:``}</div>`).join("");
  $$("[data-delete]",wrap).forEach(b=>b.addEventListener("click",()=>{history=history.filter(h=>String(h.id)!==b.dataset.delete);saveHistory();}));
}
$("#clear-history")?.addEventListener("click",()=>{if(!canStaff())return;if(confirm("Ștergi tot istoricul local?")){history=[];saveHistory();}});

function serializeMatch(m,index=0){return {id:m._productionId||`m-${Date.now()}-${index}`,index,qualityScore:m.qualityScore,qualityLabel:m.qualityLabel,skillDelta:m.skillDelta,teams:m.teams.map(t=>({name:t.name,skill:t.skill,players:t.players.map(p=>({name:p.name,role:p.role,skill:p.skill,rank:p.scout?.rank||'',tier:p.scout?.tier||''}))}))};}
async function syncProductionServer(){saveProductionLocal();if(!canStaff()){renderHub();return;}try{await fetch('/api/production/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(production)});}catch(e){console.warn('Production sync failed',e);}renderHub();setTimeout(loadOperationsSummary,0);}
function refreshQueueFromDraft(){if(!currentTeams)return; const ms=currentTeams.matches||[]; production.queue=ms.map((m,i)=>serializeMatch(m,i)); production.queue.sort((a,b)=>Number(b.teams.some(t=>t.players.some(p=>isFeatured(p.name))))-Number(a.teams.some(t=>t.players.some(p=>isFeatured(p.name))))); syncProductionServer();}
function setLiveMatch(m,index){production.live=serializeMatch(m,index); production.live.startedAt=new Date().toISOString(); production.queue=(production.queue||[]).filter(q=>q.id!==production.live.id); syncProductionServer(); showTab('hub');}
function renderHub(){
  const live=$('#hub-live-content'), status=$('#live-status'), q=$('#hub-queue'); if(!live||!q)return;
  $('#featured-player').value=production.featuredPlayer||'Lobring';
  if(production.live){const m=production.live, featured=m.teams.some(t=>t.players.some(p=>isFeatured(p.name))); status.textContent='● LIVE'; live.innerHTML=`<div class="live-match-card ${featured?'featured-match':''}"><div class="live-kicker">${featured?'★ LOBRING FEATURED MATCH':'LIVE MATCH'}</div><div class="live-versus"><div><b>${esc(m.teams[0].name)}</b><span>${m.teams[0].players.map(p=>`${esc(p.role)} ${esc(p.name)}${isFeatured(p.name)?' ★':''}`).join('<br>')}</span>${canStaff()?`<button class="btn btn-secondary" data-live-win="0">BLUE WIN</button>`:``}</div><strong>VS</strong><div class="red-side"><b>${esc(m.teams[1].name)}</b><span>${m.teams[1].players.map(p=>`${esc(p.role)} ${esc(p.name)}${isFeatured(p.name)?' ★':''}`).join('<br>')}</span>${canStaff()?`<button class="btn btn-secondary" data-live-win="1">RED WIN</button>`:``}</div></div>${canStaff()?`<div class="live-actions"><button class="btn btn-ghost btn-sm" data-live-action="remake">REMAKE</button><button class="btn btn-ghost btn-sm" data-live-action="cancel">CANCEL LIVE</button></div>`:``}</div>`;} else {status.textContent='NO LIVE MATCH';live.innerHTML='<div class="empty-state mini"><b>No match on air</b><p>Trimite un meci din Draft către LIVE.</p></div>';}
  const queue=production.queue||[]; $('#queue-count').textContent=`${queue.length} MATCHES`; q.innerHTML=queue.length?queue.map((m,i)=>{const feat=m.teams.some(t=>t.players.some(p=>isFeatured(p.name)));return `<div class="queue-row ${feat?'featured-match':''}"><span>${i===0?'UP NEXT':`#${i+1}`}</span><div><b>${feat?'★ ':''}${esc(m.teams[0].name)} vs ${esc(m.teams[1].name)}</b><small>${m.qualityScore||0}/100 · Δ ${Number(m.skillDelta||0).toFixed(2)}</small></div>${canStaff()?`<button class="btn btn-secondary btn-sm" data-queue-live="${i}">SET LIVE</button>`:``}</div>`}).join(''):'<div class="empty-state mini"><b>Queue empty</b><p>Generează un Draft pentru a popula queue-ul.</p></div>';
  updateOpsSummary();
}
function updateOpsSummary(){
  if(!canStaff())return;
  const matches=currentTeams?.matches||[];
  const teams=matches.flatMap(m=>m.teams||[]);
  const players=Object.values(communitySession?.players||{});
  const ready=players.filter(p=>p.ready).length;
  const draftEl=$('#ops-draft-stat'),readyEl=$('#ops-ready-stat'),liveEl=$('#ops-live-stat'),liveDetail=$('#ops-live-detail'),bracketEl=$('#ops-bracket-stat'),nextEl=$('#ops-next-action'),nextBtn=$('#ops-next-btn');
  if(draftEl)draftEl.textContent=teams.length?`${teams.length}`:'—';
  if(readyEl)readyEl.textContent=`${ready}/${players.length}`;
  if(liveEl)liveEl.textContent=production.live?'LIVE':'OFF';
  if(liveDetail)liveDetail.textContent=production.live?`${production.live.teams?.[0]?.name||'Blue'} vs ${production.live.teams?.[1]?.name||'Red'}`:'niciun meci';
  if(bracketEl)bracketEl.textContent=bracketState?(bracketComplete()?'FINAL':'ACTIV'):'—';
  let label='Pregătește draftul',tab='teams';
  if(!matches.length){label='Generează echipele';tab='teams';}
  else if(players.length && ready<players.length){label=`Așteaptă Ready Check · ${players.length-ready} lipsă`;tab='community';}
  else if(!production.live && (production.queue||[]).length){label='Pornește următorul meci';tab='hub';}
  else if(production.live){label='Monitorizează meciul live';tab='hub';}
  else if(bracketState && !bracketComplete()){label='Continuă turneul';tab='bracket';}
  else {label='Pregătește următorul meci';tab='teams';}
  if(nextEl)nextEl.textContent=label;
  if(nextBtn)nextBtn.dataset.jump=tab;
}
document.addEventListener('click',e=>{const jump=e.target.closest('[data-jump]');if(jump&&canStaff()){showTab(jump.dataset.jump);if(jump.dataset.jump==='hub')updateOpsSummary();}});
document.addEventListener('click',e=>{const qw=e.target.closest('[data-queue-live]');if((qw||e.target.closest('[data-live-win]')||e.target.closest('[data-live-action]'))&&!canStaff())return;if(qw){const m=production.queue[Number(qw.dataset.queueLive)];production.live=m;production.live.startedAt=new Date().toISOString();production.queue.splice(Number(qw.dataset.queueLive),1);syncProductionServer();return;}const win=e.target.closest('[data-live-win]');if(win&&production.live){const m=production.live,wi=Number(win.dataset.liveWin),li=wi?0:1;production.lastResult={...m,winner:m.teams[wi].name,loser:m.teams[li].name,finishedAt:new Date().toISOString()};saveMatch('5V5',`${m.teams[wi].name} WIN`,`${m.teams[wi].name} defeated ${m.teams[li].name}`,{winner:m.teams[wi].name,loser:m.teams[li].name});production.live=null;syncProductionServer();return;}const act=e.target.closest('[data-live-action]');if(act&&production.live){if(act.dataset.liveAction==='remake') production.queue.unshift(production.live);production.live=null;syncProductionServer();}});
$('#save-featured')?.addEventListener('click',()=>{if(!canStaff())return;production.featuredPlayer=$('#featured-player').value.trim()||'Lobring';if(currentTeams)renderDraft(currentTeams);refreshQueueFromDraft();syncProductionServer();});

async function refreshAuth(){
  try{const res=await fetch("/api/auth/status");authState=await res.json();}catch{authState={authenticated:false,user:null};}
  const user=authState.user;
  if(!canStaff() && $("#tab-series")?.classList.contains("active")){showTab("community");if(typeof loadSeries==="function")loadSeries();}
  document.body.classList.toggle("staff-mode",canStaff());
  ["#generate-teams","#load-demo","#generate-bracket"].forEach(sel=>{const el=$(sel);if(el)el.hidden=!canStaff();});
  $$(".staff-only").forEach(x=>x.hidden=!canStaff()); $$(".tech-only").forEach(x=>x.hidden=!isTechnician());
  if(!canStaff() && $("#tab-hub")?.classList.contains("active")) showTab("community");
  $("#access-badge").textContent=user?(user.role==="technician"?"TECHNICIAN":"ADMIN"):"VISITOR";
  $("#access-login").hidden=Boolean(user); $("#access-logout").hidden=!user; $("#featured-player").disabled=!canStaff(); $("#save-featured").hidden=!canStaff();
  await restoreWorkflowServer(); await loadRegistry(); await syncPersistentHistory(); if(currentTeams) renderDraft(currentTeams); if(bracketState) renderBracket(); renderHub(); if(canStaff()){ renderAccessManager(); await loadOperationsSummary(); }
}
$("#access-login").addEventListener("click",()=>{$("#auth-modal").hidden=false;$("#auth-password").focus();});
$("#auth-close").addEventListener("click",()=>{$("#auth-modal").hidden=true;});
$("#auth-submit").addEventListener("click",async()=>{const password=$("#auth-password").value;$("#auth-submit").disabled=true;try{const res=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})}),data=await res.json();if(!res.ok)throw new Error(data.error||"Login failed");$("#auth-modal").hidden=true;$("#auth-password").value="";$("#auth-note").textContent="";await refreshAuth();}catch(e){$("#auth-note").textContent=e.message;}finally{$("#auth-submit").disabled=false;}});
$("#auth-password").addEventListener("keydown",e=>{if(e.key==="Enter")$("#auth-submit").click();});
$("#access-logout").addEventListener("click",async()=>{await fetch("/api/auth/logout",{method:"POST"});showTab("community");await refreshAuth();});


async function renderAccessManager(){
  if(!canStaff())return;
  const box=$('#access-users'), dl=$('#access-candidates'); if(!box)return;
  try{
    const r=await fetch('/api/admin/access'), d=await r.json(); if(!r.ok)throw new Error(d.error||'Nu s-a putut încărca accesul.');
    if(dl)dl.innerHTML=(d.candidates||[]).map(x=>`<option value="${esc(x.name)}">${x.ready?'READY':'NOT READY'}</option>`).join('');
    const active=(d.users||[]).filter(x=>x.active!==false);
    $$(".access-create-grid input,.access-create-grid select,.access-create-grid button").forEach(x=>x.disabled=!isTechnician());
    box.innerHTML=active.map(u=>`<div class="access-user-row" data-access-id="${esc(u.id)}"><div><b>${esc(u.name)}</b><small>${u.role==='technician'?'TECHNICIAN':'ADMIN'}${u.id===authState.user?.id?' · SESIUNEA TA':''}</small></div><select class="access-role"><option value="admin" ${u.role==='admin'?'selected':''}>ADMIN</option><option value="technician" ${u.role==='technician'?'selected':''}>TECHNICIAN</option></select><div class="access-user-actions"><button class="btn btn-secondary btn-sm access-save-role">SCHIMBĂ ROL</button><button class="btn btn-ghost btn-sm access-reset-password">PAROLĂ NOUĂ</button><button class="btn btn-danger btn-sm access-revoke" ${u.id===authState.user?.id?'disabled':''}>REVOCA</button></div></div>`).join('')||'<div class="subtle">Nu există conturi staff active.</div>';
    if(!isTechnician())$$("select,button",box).forEach(x=>x.disabled=true);
  }catch(e){box.innerHTML=`<div class="subtle">${esc(e.message)}</div>`;}
}
function showAccessSecret(password){const wrap=$('#access-secret'),val=$('#access-secret-value');if(!wrap||!val)return;val.textContent=password;wrap.hidden=false;}
$('#access-create-user')?.addEventListener('click',async()=>{if(!isTechnician())return;const btn=$('#access-create-user'),name=$('#access-new-name').value.trim(),role=$('#access-new-role').value;if(!name)return;btn.disabled=true;try{const r=await fetch('/api/admin/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,role})}),d=await r.json();if(!r.ok)throw new Error(d.error||'Nu s-a putut acorda accesul.');showAccessSecret(d.temporaryPassword);$('#access-new-name').value='';await renderAccessManager();}catch(e){alert(e.message);}finally{btn.disabled=false;}});
$('#access-copy-secret')?.addEventListener('click',async()=>{const value=$('#access-secret-value')?.textContent||'';if(!value)return;try{await navigator.clipboard.writeText(value);$('#access-copy-secret').textContent='COPIAT ✓';setTimeout(()=>$('#access-copy-secret').textContent='COPIAZĂ',1200);}catch{}});
$('#access-users')?.addEventListener('click',async e=>{if(!canStaff())return;const row=e.target.closest('[data-access-id]');if(!row)return;const id=row.dataset.accessId;try{if(e.target.closest('.access-save-role')){const role=row.querySelector('.access-role').value;if(!confirm(`Schimbi rolul acestui cont în ${role.toUpperCase()}? Sesiunile lui active vor fi închise.`))return;const r=await fetch(`/api/admin/access/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})}),d=await r.json();if(!r.ok)throw new Error(d.error);await renderAccessManager();}else if(e.target.closest('.access-reset-password')){if(!confirm('Generezi o parolă nouă? Parola veche și sesiunile active nu vor mai fi valide.'))return;const r=await fetch(`/api/admin/access/${encodeURIComponent(id)}/reset-password`,{method:'POST'}),d=await r.json();if(!r.ok)throw new Error(d.error);showAccessSecret(d.temporaryPassword);}else if(e.target.closest('.access-revoke')){if(!confirm('Revoci accesul acestui cont?'))return;const r=await fetch(`/api/admin/access/${encodeURIComponent(id)}`,{method:'DELETE'}),d=await r.json();if(!r.ok)throw new Error(d.error);await renderAccessManager();}}catch(err){alert(err.message||'Operația nu a putut fi finalizată.');}});

async function renderTech(){
  if(!isTechnician())return;
  await renderServerErrors();
  const [sr,lr,ir]=await Promise.all([fetch("/api/tech/status"),fetch("/api/tech/logs"),fetch("/api/tech/integrity")]); const st=await sr.json(), lo=await lr.json(), integrity=await ir.json();
  if(!sr.ok) return;
  const v=st.views||{}; $("#tech-stats").innerHTML=[['OP.GG MCP',`${st.opgg.status} · ${st.opgg.tools||0} tools`],['UPTIME',`${Math.floor((st.server.uptimeSeconds||0)/60)} min`],['REQUESTS',v.totalRequests||0],['PAGE VIEWS',v.pageViews||0],['API REQUESTS',v.apiRequests||0],['SERVER ERRORS',v.errors||0],['MEMORY',`${st.server.memoryMB?.rss||0} MB`],['SESSIONS',st.sessions||0],['REGISTRY',st.data?.registry||0],['MAINTENANCE',st.settings?.maintenance?'ON':'OFF']].map(([a,b])=>`<div class="tech-stat"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
  if($('#integrity-badge')){$('#integrity-badge').textContent=integrity.healthy?'✓ DATA HEALTHY':'⚠ DATA ISSUE';$('#integrity-badge').classList.toggle('danger',!integrity.healthy);} if($('#tech-maintenance'))$('#tech-maintenance').textContent=`MAINTENANCE: ${st.settings?.maintenance?'ON':'OFF'}`;
  $("#tech-logs").innerHTML=(lo.logs||[]).map(x=>`<div class="tech-log"><span>${esc(x.time||'')}</span><b class="${esc(x.level||'')}">${esc(x.level||'')}</b><span>${esc(x.event||'')} · ${esc(x.method||'')} ${esc(x.path||'')} ${x.status||''} ${x.ms!=null?`· ${x.ms}ms`:''} ${x.user?`· ${esc(x.user)}`:''}</span></div>`).join('')||'<div class="empty-state mini">No logs yet.</div>';
}
$("#refresh-tech")?.addEventListener("click",renderTech);
async function techAction(url,method="POST",body){ if(!isTechnician())return; const note=$("#tech-action-note"); if(note)note.textContent="WORKING…"; try{const r=await fetch(url,{method,headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw new Error(d.error||"Action failed");if(note)note.textContent="✓ DONE";await renderTech();}catch(e){if(note)note.textContent=`⚠ ${e.message}`;} }
$("#tech-integrity")?.addEventListener("click",renderTech);
$("#tech-backup")?.addEventListener("click",()=>techAction("/api/tech/backup"));
$("#tech-cache")?.addEventListener("click",()=>techAction("/api/tech/cache/clear"));
$("#clear-tech-logs")?.addEventListener("click",()=>{if(confirm("Ștergi logurile tehnice curente?"))techAction("/api/tech/logs","DELETE");});
$("#tech-maintenance")?.addEventListener("click",async()=>{const r=await fetch("/api/tech/status"),s=await r.json();techAction("/api/tech/maintenance","POST",{enabled:!s.settings?.maintenance});});
$("#revoke-sessions")?.addEventListener("click",async()=>{if(!confirm("Revoci toate sesiunile Admin/Tehnician? Vei fi delogat și tu."))return;await fetch("/api/auth/revoke-all",{method:"POST"});showTab("community");await refreshAuth();});
document.addEventListener("click",e=>{const b=e.target.closest('[data-tab="tech"]');if(b&&isTechnician())setTimeout(()=>{renderTech();renderBugs();},0);});


// V6 community session / ready check / bug reporting.
let communitySession={name:'Custom Night',status:'SETUP',players:{}};
async function loadCommunity(){try{const r=await fetch('/api/community/session'),d=await r.json();if(r.ok)communitySession=d.session||communitySession;}catch{} renderCommunity();}
function renderCommunity(){ const n=$('#community-name'); if(!n)return; n.textContent=communitySession.name||'Custom Night'; $('#community-status').textContent=communitySession.status||'SETUP'; $('#session-name').value=communitySession.name||''; $('#session-status').value=communitySession.status||'SETUP'; const ps=Object.values(communitySession.players||{}), ready=ps.filter(x=>x.ready).length; $('#ready-summary').innerHTML=ps.length?`<b>${ready}/${ps.length} READY</b> · ${ps.map(x=>`${esc(x.name)} ${x.ready?'✓':'○'}`).join(' · ')}`:'No ready check yet.'; updateOpsSummary(); }
$('#save-session')?.addEventListener('click',async()=>{if(!canStaff())return;const r=await fetch('/api/community/session',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#session-name').value,status:$('#session-status').value})});const d=await r.json();if(r.ok){communitySession=d.session;renderCommunity();loadOperationsSummary();}});
$('#clear-ready')?.addEventListener('click',async()=>{if(!canStaff()||!confirm('Golești toate răspunsurile din Ready Check?'))return;const r=await fetch('/api/community/ready',{method:'DELETE'});const d=await r.json();if(r.ok){communitySession=d.session;renderCommunity();}});
$('#delete-session')?.addEventListener('click',async()=>{if(!canStaff()||!confirm('Ștergi sesiunea Custom Night curentă și Ready Check-ul ei?'))return;const r=await fetch('/api/community/session',{method:'DELETE'});const d=await r.json();if(r.ok){communitySession=d.session;renderCommunity();}});
async function setReady(ready){const name=$('#ready-name').value.trim(),note=$('#ready-note');if(!name){note.textContent='Introdu numele / Riot ID.';return;}const r=await fetch('/api/community/ready',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,ready})});const d=await r.json();note.textContent=r.ok?(ready?'✓ READY':'○ NOT READY'):(d.error||'Error');await loadCommunity();}
$('#ready-yes')?.addEventListener('click',()=>setReady(true)); $('#ready-no')?.addEventListener('click',()=>setReady(false));
$('#send-bug')?.addEventListener('click',async()=>{const note=$('#bug-note'),message=$('#bug-message').value.trim();const r=await fetch('/api/community/bug-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,page:$('.view.active')?.id||''})});const d=await r.json();note.textContent=r.ok?`✓ Raport trimis · ${d.id.slice(0,8)}`:(d.error||'Error');if(r.ok)$('#bug-message').value='';});
async function renderBugs(){if(!isTechnician())return;try{const r=await fetch('/api/tech/bugs'),d=await r.json();$('#bug-inbox').innerHTML=(d.reports||[]).slice(0,30).map(x=>`<div class="bug-report-row" data-bug-id="${esc(x.id)}"><div class="bug-report-meta"><span>${esc(x.time)}</span><b class="${x.status==='OPEN'?'WARN':'INFO'}">${esc(x.status)}</b></div><div class="bug-report-body">${esc(x.message)} · ${esc(x.page||'')} · ${esc(x.user||'visitor')}</div><div class="bug-report-actions">${x.status==='OPEN'?`<button class="btn btn-secondary btn-sm bug-status" data-status="FIXED">CLOSE</button><button class="btn btn-ghost btn-sm bug-status" data-status="IGNORED">IGNORE</button>`:`<button class="btn btn-ghost btn-sm bug-status" data-status="OPEN">REOPEN</button>`}</div></div>`).join('')||'<div class="subtle">No bug reports.</div>';}catch{}}
$('#refresh-bugs')?.addEventListener('click',renderBugs);
$('#bug-inbox')?.addEventListener('click',async(e)=>{const btn=e.target.closest('.bug-status');if(!btn)return;const row=btn.closest('[data-bug-id]');if(!row)return;btn.disabled=true;try{const r=await fetch(`/api/tech/bugs/${encodeURIComponent(row.dataset.bugId)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:btn.dataset.status})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not update report.');await renderBugs();}catch(err){btn.disabled=false;alert(err.message||'Could not update report.');}});
$('#tech-preflight')?.addEventListener('click',async()=>{if(!isTechnician())return;const box=$('#preflight-results');box.innerHTML='<div class="subtle">Running…</div>';const r=await fetch('/api/tech/preflight'),d=await r.json();box.innerHTML=`<div class="tech-log"><b class="${d.ready?'INFO':'WARN'}">${d.passed}/${d.total} ${d.ready?'PASSED · READY FOR DEPLOY':'PASSED · ACTION REQUIRED'}</b></div>`+(d.checks||[]).map(x=>`<div class="tech-log"><b class="${x.ok?'INFO':'WARN'}">${x.ok?'✓':'✕'}</b><span>${esc(x.name)} · ${esc(x.detail||'')}</span></div>`).join('');});


// Istoric public al actualizărilor.
const patchModal=$('#patch-notes-modal');
$('#patch-notes-open')?.addEventListener('click',()=>{if(patchModal)patchModal.hidden=false;});
$('#patch-notes-close')?.addEventListener('click',()=>{if(patchModal)patchModal.hidden=true;});
patchModal?.addEventListener('click',e=>{if(e.target===patchModal)patchModal.hidden=true;});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&patchModal&&!patchModal.hidden)patchModal.hidden=true;});


function automationEventLabel(event){return ({ready_roster_synced:'Ready Check sincronizat',production_queue_synced:'Production Queue sincronizat',tournament_auto_archived:'Turneu arhivat automat',custom_night_auto_archived:'Custom Night arhivat automat',milestone_snapshot:'Checkpoint creat',autopilot_reconciled:'Autopilot rulat',automation_settings_updated:'Setări automatizare actualizate'})[event]||String(event||'Automatizare').replaceAll('_',' ');}
function renderOperationsSummary(summary,feed=[]){
  operationsState=summary||operationsState; if(!summary)return;
  automationState=summary.automation||automationState;
  const chips=$('#automation-chips'); if(chips)chips.innerHTML=[['PROTECȚIE',automationState.autoProtect],['READY SYNC',automationState.syncDraftToReady],['QUEUE SYNC',automationState.syncDraftToProduction],['AUTO ARCHIVE',automationState.archiveCompletedSession&&automationState.archiveCompletedTournament]].map(([n,on])=>`<span class="automation-chip ${on?'on':'off'}">${on?'✓':'○'} ${n}</span>`).join('');
  const dc=$('#decision-center'), count=$('#decision-count'), rows=summary.decisions||[]; if(count)count.textContent=String(rows.length);
  if(dc)dc.innerHTML=rows.length?rows.map(d=>`<button class="decision-row priority-${String(d.priority||'LOW').toLowerCase()}" data-jump="${esc(d.target||'hub')}"><span>${esc(d.priority||'')}</span><div><b>${esc(d.title)}</b><small>${esc(d.detail||'')}</small></div><strong>DESCHIDE →</strong></button>`).join(''):'<div class="decision-clear"><b>✓ Nicio decizie urgentă</b><small>RIFT/OPS a pregătit ce poate automat. Staff-ul intervine când este nevoie.</small></div>';
  const feedEl=$('#automation-feed'); if(feedEl)feedEl.innerHTML=feed.length?feed.slice(0,12).map(x=>`<div class="automation-event"><span>${new Date(x.time).toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'})}</span><b>${esc(automationEventLabel(x.event))}</b></div>`).join(''):'<div class="subtle">Nicio automatizare înregistrată încă.</div>';
}
async function loadOperationsSummary(){if(!canStaff())return;try{const r=await fetch('/api/admin/operations'),d=await r.json();if(r.ok)renderOperationsSummary(d.summary,d.feed||[]);}catch(e){console.warn('Operations summary failed',e);}}
async function runAutopilot(){if(!canStaff())return;const btn=$('#autopilot-run'),note=$('#autopilot-note');if(btn)btn.disabled=true;if(note)note.textContent='Se sincronizează…';try{const r=await fetch('/api/admin/automation/run',{method:'POST'}),d=await r.json();if(!r.ok)throw new Error(d.error||'Autopilot failed');renderOperationsSummary(d.summary,d.feed||[]);await loadCommunity();try{const pr=await fetch('/api/production/state'),pd=await pr.json();if(pr.ok){production=pd.state||production;renderHub();}}catch{}if(note)note.textContent='✓ Starea repetitivă a fost reconciliată.';}catch(e){if(note)note.textContent='⚠ '+e.message;}finally{if(btn)btn.disabled=false;}}
async function openAutomationSettings(){if(!canStaff())return;try{const r=await fetch('/api/admin/automation'),d=await r.json();if(!r.ok)return;automationState=d.settings||{};$('#auto-protect').checked=automationState.autoProtect!==false;$('#auto-ready').checked=automationState.syncDraftToReady!==false;$('#auto-production').checked=automationState.syncDraftToProduction!==false;$('#auto-archive-session').checked=automationState.archiveCompletedSession!==false;$('#auto-archive-tournament').checked=automationState.archiveCompletedTournament!==false;$('#auto-snapshot-minutes').value=String(automationState.snapshotMinutes||5);$('#automation-modal').hidden=false;}catch{}}
$('#autopilot-run')?.addEventListener('click',runAutopilot);$('#automation-refresh')?.addEventListener('click',loadOperationsSummary);$('#automation-settings-open')?.addEventListener('click',openAutomationSettings);$('#automation-modal-close')?.addEventListener('click',()=>$('#automation-modal').hidden=true);$('#automation-modal')?.addEventListener('click',e=>{if(e.target.id==='automation-modal')e.currentTarget.hidden=true;});
$('#automation-save')?.addEventListener('click',async()=>{if(!canStaff())return;const payload={autoProtect:$('#auto-protect').checked,syncDraftToReady:$('#auto-ready').checked,syncDraftToProduction:$('#auto-production').checked,archiveCompletedSession:$('#auto-archive-session').checked,archiveCompletedTournament:$('#auto-archive-tournament').checked,snapshotMinutes:Number($('#auto-snapshot-minutes').value||5)};const r=await fetch('/api/admin/automation',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json();const note=$('#automation-save-note');if(r.ok){automationState=d.settings;note.textContent='✓ Setări salvate';setTimeout(()=>{$('#automation-modal').hidden=true;loadOperationsSummary();},500);}else note.textContent='⚠ '+(d.error||'Eroare');});
$('#sync-ready-draft')?.addEventListener('click',runAutopilot);
$('#bracket-import-draft')?.addEventListener('click',()=>{if(!canStaff()||!currentTeams)return;const names=(currentTeams.matches||[]).flatMap(m=>m.teams||[]).map(t=>t.name).filter(Boolean);if(!names.length)return;$('#bracket-input').value=[...new Set(names)].join('\n');$('#generate-bracket').click();});

async function init(){
  $("#player-input").value=roster.map(p=>p.name).join("\n");
  $("#roster-count").textContent=`${roster.length} PLAYERS`;
  renderAdmin();renderHistory();renderHub();loadChampions();await refreshAuth();await loadCommunity();
}
init();


// V7 workflow automation: restore interrupted work and merge persistent staff history.
async function syncPersistentHistory(){
  if(!canStaff()) return;
  try{ const r=await fetch('/api/admin/history'); if(!r.ok)return; const d=await r.json(); const server=(d.history||[]).map(x=>({id:'srv-'+x.id,serverId:x.id,type:x.type,title:x.title,details:x.details,winner:x.winner,loser:x.loser,time:new Date(x.time).toLocaleString('ro-RO')})); const localOnly=history.filter(x=>!x.serverId); history=[...server,...localOnly].slice(0,500); saveHistory(); }catch{}
}
async function createWorkflowSnapshot(label='Snapshot manual',button=$('#workflow-snapshot')){
 if(!canStaff())return;
 const old=button?.textContent;if(button){button.disabled=true;button.textContent='SE SALVEAZĂ…';}
 try{
  if(!currentTeams&&!bracketState?.length)throw Error('Construiește mai întâi un Draft sau Bracket.');
  const r=await fetch('/api/admin/workflow/snapshots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label,draft:currentTeams,bracket:bracketState})});
  const d=await r.json();if(!r.ok)throw Error((d.error||'Snapshot-ul nu a putut fi salvat.')+(d.requestId?' · Request ID: '+d.requestId:''));
  if(button)button.textContent='✓ SNAPSHOT SALVAT';
  await openWorkflowSnapshots();
 }catch(e){if(button)button.textContent='⚠ SALVARE EȘUATĂ';alert(e.message||'Snapshot-ul nu a putut fi salvat.');}
 finally{if(button){button.disabled=false;setTimeout(()=>button.textContent=old,2000);}}
}
$('#workflow-snapshot')?.addEventListener('click',e=>createWorkflowSnapshot('Custom Night · '+new Date().toLocaleString('ro-RO'),e.currentTarget));
$('#bracket-snapshot')?.addEventListener('click',e=>createWorkflowSnapshot('Bracket · '+new Date().toLocaleString('ro-RO'),e.currentTarget));
async function openWorkflowSnapshots(){
 if(!canStaff())return;const modal=$('#workflow-modal'),list=$('#workflow-snapshot-list');modal.hidden=false;list.textContent='Se încarcă…';
 try{const r=await fetch('/api/admin/workflow/snapshots'),d=await r.json();if(!r.ok)throw Error((d.error||'Lista snapshot-urilor nu a putut fi încărcată.')+(d.requestId?' · Request ID: '+d.requestId:''));
 const rows=d.snapshots||[];list.innerHTML=rows.length?rows.map(x=>`<div class="snapshot-row"><div><b>${esc(x.label)}</b><small>${new Date(x.time).toLocaleString('ro-RO')} · ${esc(x.by||'staff')}</small></div><div><button class="btn btn-secondary btn-sm" data-snapshot-restore="${esc(x.id)}">RESTORE</button><button class="btn btn-ghost btn-sm" data-snapshot-delete="${esc(x.id)}">REMOVE</button></div></div>`).join(''):'<p class="subtle">Nu există snapshot-uri încă.</p>';
 }catch(e){list.textContent=e.message||'Lista snapshot-urilor nu a putut fi încărcată.';}
}
$('#workflow-snapshots-open')?.addEventListener('click',openWorkflowSnapshots);$('#workflow-modal-close')?.addEventListener('click',()=>$('#workflow-modal').hidden=true);$('#workflow-modal')?.addEventListener('click',e=>{if(e.target.id==='workflow-modal')e.currentTarget.hidden=true;});
document.addEventListener('click',async e=>{const restore=e.target.closest('[data-snapshot-restore]'),del=e.target.closest('[data-snapshot-delete]');if(restore&&canStaff()){if(!confirm('Restaurezi acest snapshot? Starea curentă va fi înlocuită.'))return;const r=await fetch(`/api/admin/workflow/snapshots/${restore.dataset.snapshotRestore}/restore`,{method:'POST'}),d=await r.json();if(r.ok){currentTeams=d.workflow.draft||null;bracketState=d.workflow.bracket||null;saveDraftState();saveBracketState();if(currentTeams)renderDraft(currentTeams);if(bracketState)renderBracket();refreshQueueFromDraft();$('#workflow-modal').hidden=true;showTab('hub');}}if(del&&canStaff()){if(!confirm('Ștergi snapshot-ul?'))return;await fetch(`/api/admin/workflow/snapshots/${del.dataset.snapshotDelete}`,{method:'DELETE'});openWorkflowSnapshots();}});
$('#bracket-follow')?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();$$('.bracket-match').forEach(card=>{if(!q){card.classList.remove('bracket-dim','bracket-focus');return;}const hit=card.textContent.toLowerCase().includes(q);card.classList.toggle('bracket-focus',hit);card.classList.toggle('bracket-dim',!hit);});});
function restoreWorkflow(){ if(currentTeams){ renderDraft(currentTeams); refreshQueueFromDraft(); } if(bracketState) renderBracket(); }
setTimeout(restoreWorkflow,250);

// V10.2 access manager refresh when Administrare opens.
document.addEventListener("click",e=>{const b=e.target.closest('[data-tab="admin"]');if(b&&canStaff())setTimeout(renderAccessManager,0);});

// V12 passive operations refresh. Read-only summary; never executes decisions.
setInterval(()=>{if(canStaff())loadOperationsSummary();},30000);

// Initial slots remain stable; withdrawing a team never rebuilds or reshuffles the bracket.
$('#bracket-output').addEventListener('click',async e=>{
 const edit=e.target.closest('[data-team-edit]'),del=e.target.closest('[data-team-delete]');
 if((!edit&&!del)||!canStaff()||!bracketState)return;
 const [mi,ti]=(edit?.dataset.teamEdit||del.dataset.teamDelete).split(':').map(Number);
 const old=bracketState[0].matches[mi].teams[ti].name;
 if(del){
  if(bracketState.some(r=>r.matches.some(m=>m.winner&&!m.autoBye))){alert('Anulează rezultatele confirmate înainte de a retrage o echipă.');return;}
  if(!confirm('Retragi '+old+'? Slotul devine BYE; celelalte echipe își păstrează poziția.'))return;
  for(const [ri,r] of bracketState.entries())for(const m of r.matches){m.winner=null;m.autoBye=false;if(ri>0)m.teams=m.teams.map(()=>({name:'TBD',winner:false}));}
  bracketState[0].matches[mi].teams[ti]={name:'BYE',winner:false};
 }else{
  const name=(await inputDialog('Numele echipei:',old))?.trim();if(!name||name===old)return;
  const names=bracketState[0].matches.flatMap(m=>m.teams.map(t=>t.name));
  if(name.length>64||['BYE','TBD'].includes(name.toUpperCase())||names.some(n=>n.toLowerCase()===name.toLowerCase())){alert('Folosește un nume unic de maximum 64 de caractere, diferit de BYE/TBD.');return;}
  for(const r of bracketState)for(const m of r.matches){for(const t of m.teams)if(t.name===old)t.name=name;if(m.winner===old)m.winner=name;}
 }
 $('#bracket-input').value=bracketState[0].matches.flatMap(m=>m.teams.map(t=>t.name)).filter(n=>n!=='BYE').join('\n');
 resolveBracketByes();renderBracket();
});
async function renderServerErrors(){
 if(!isTechnician())return;let box=$('#server-error-list');
 if(!box){box=document.createElement('div');box.id='server-error-list';$('#tech-logs').before(box);}
 try{const r=await fetch('/api/tech/errors'),d=await r.json();if(!r.ok)throw Error(d.error);
 box.innerHTML='<h3>Server errors · details</h3>'+((d.errors||[]).map(x=>'<details class="tech-error-details"><summary>'+esc(x.time)+' · '+esc(x.category)+' · '+x.status+' · '+esc(x.method)+' '+esc(x.path)+(x.resolved?' · RESOLVED':'')+'</summary><pre>'+esc(x.message)+'\nCode: '+esc(x.code)+'\nRequest ID: '+esc(x.requestId)+'</pre>'+(x.resolved?'':'<button class="btn btn-ghost" data-error-resolve="'+esc(x.id)+'">MARK RESOLVED</button>')+'</details>').join('')||'<p class="subtle">No server errors recorded.</p>');
 }catch(e){box.textContent=e.message;}
}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-error-resolve]');if(!b||!isTechnician())return;await fetch('/api/tech/errors/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.errorResolve})});await renderServerErrors();});

// Use accessible in-page input; embedded browsers may disable native prompt().
function inputDialog(label,value='',password=false){
 return new Promise(resolve=>{
  const modal=document.createElement('div');modal.className='auth-modal';
  const card=document.createElement('div');card.className='auth-card';card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label',label);
  const title=document.createElement('h3');title.textContent=label;
  const input=document.createElement('input');input.type=password?'password':'text';input.value=value;input.maxLength=password?256:64;input.autocomplete=password?'current-password':'off';input.setAttribute('aria-label',label);
  const save=document.createElement('button');save.className='btn btn-primary full';save.textContent='CONFIRMĂ';
  const cancel=document.createElement('button');cancel.className='btn btn-ghost full';cancel.textContent='ANULEAZĂ';
  const previous=document.activeElement;const finish=result=>{input.value='';modal.remove();previous?.focus();resolve(result)};
  save.addEventListener('click',()=>finish(input.value));cancel.addEventListener('click',()=>finish(null));
  modal.addEventListener('keydown',e=>{if(e.key==='Escape')finish(null);else if(e.key==='Enter'){e.preventDefault();finish(input.value);}else if(e.key==='Tab'){const controls=[input,save,cancel],i=controls.indexOf(document.activeElement);e.preventDefault();controls[(i+(e.shiftKey?2:1))%3].focus();}});
  card.append(title,input,save,cancel);modal.append(card);document.body.append(modal);input.focus();
 });
}
