# Update 12.1

Vezi [UPDATE-12.1-RO.md](UPDATE-12.1-RO.md) pentru funcțiile noi, instalare și migrare. Effective Rank, detecția smurf și OP.GG sunt păstrate. Nu este necesară o cheie Riot.

# RIFT/OPS V12.0 — Assisted Autopilot

RIFT/OPS V12 este build-ul complet pentru administrarea unei comunități de custom games: Draft 5v5, OP.GG scouting, balancing role-vs-role, Custom Night, Ready Check, Production/OBS, bracket 2–64 echipe, istoric persistent, staff access, recovery și automatizare asistată.

## Ce face automat V12
- sincronizează Draft-ul activ cu Ready Check-ul și Production Queue;
- creează checkpoint-uri/snapshot-uri de siguranță înaintea modificărilor importante;
- arhivează automat Custom Night-ul și turneul când sunt finalizate;
- păstrează Draft-ul și Bracket-ul pe server pentru recovery după refresh;
- construiește un **Decision Center** cu lucrurile care chiar necesită intervenție umană;
- păstrează un **Automation Feed** cu operațiile executate de RIFT/OPS;
- face backup zilnic pentru datele operaționale;
- permite reglarea automatizărilor fără a automatiza câștigătorii, rolurile staff sau pornirea unui meci LIVE.

## Ce rămâne decizie staff
Lineup-ul final, MOVE/SWAP/REMOVE, skill/smurf overrides, rezultatele meciurilor, winner-ul de bracket, promovarea/revocarea staff-ului, LIVE controls și operațiile tehnice sensibile.

## Roluri
- **VISITOR** — experiență publică/read-only pentru zonele administrative; Ready Check și Bug Report rămân disponibile comunității.
- **ADMIN** — Draft, Custom Night, Production, turnee, istoric, registry, automation și administrarea accesului staff.
- **TECHNICIAN** — tot ce are Admin plus diagnostic, logs, backup, cache, maintenance, integritate și revocarea tuturor sesiunilor.

Autorizarea este verificată server-side; ascunderea butoanelor în frontend este doar UX, nu mecanismul de securitate.

## Instalare / upgrade
```powershell
npm install
npm run auth:setup   # doar la instalare nouă sau dacă vrei să regenerezi parolele bootstrap
npm run release:check
npm start
```

Dacă faci upgrade peste o instalare existentă, păstrează folderul `.data` din instalarea ta veche. Nu copia `.data` în Git/ZIP public.

Deschide `http://localhost:3000`.

## Verificări release
- `npm run check` — sintaxă backend + frontend;
- `npm run preflight` — verificări de componente;
- `npm run security:audit` — verifică allowlist-ul rutelor publice și protecțiile de bază;
- `npm run release:check` — rulează toate cele de mai sus.

## Configurare
Copiază `.env.example` ca `.env` doar pe server. OP.GG folosește implicit EUNE. Dacă Riot API este adăugat ulterior, `RIOT_API_KEY` rămâne exclusiv variabilă de mediu server-side.

## V12.0 — Autopilot asistat și Centru de Decizii
- Centru Operațional cu stare Draft / Ready / LIVE / Turneu și următoarea acțiune recomandată.
- Setări Autopilot: protecție automată, Draft → Ready, Draft → Production, auto-arhivare și interval snapshot.
- Automation Feed și audit separat al acțiunilor automate.
- Bracket import direct din numele echipelor Draft-ului și suport 2–64 echipe.
- Recovery prin snapshot-uri manuale și automate.
- Access Manager pentru promovare VISITOR → ADMIN/TECHNICIAN, resetare parolă, schimbare rol și revocare.
- Parole temporare afișate o singură dată; pe disc rămân hash-uri scrypt.
- Patch Notes publice doar în română și fără detalii interne sensibile.
- Security audit inclus în proiect.

---

# RIFT/OPS V7.0 — Tournament & Draft Control

V7.0 adds compact MOVE controls, staff REMOVE with reserve replacement, persistent staff-side history deletion, tournament completion archive, bracket undo, and cleaner tournament controls. Destructive actions remain staff-only where applicable and server-side history removals are audited.

# RIFT/OPS V6.2 — Community Release

V6.2 adds the in-app release history and consolidates the V6.1 hotfix series into the current baseline. The interface now exposes PATCH NOTES from V1 through V6.2 and displays the active Community Build version. No new large gameplay/production system was added in this release; the feature set is intentionally frozen for pre-deploy QA unless a new issue is found.

# V6.1.3 — Bug Inbox workflow hotfix

Technician Bug Inbox now supports **CLOSE**, **IGNORE**, and **REOPEN** directly from each community report. Closing maps to the existing server-side `FIXED` state and all changes remain audit-logged.

# RIFT/OPS V6.1.2 — Fixed Rank Crest Hotfix

- Correct static ranked-emblem asset path.
- FLOOR/OVERRIDE crests use one fixed visual slot.
- Gold and Apex tiers get normalized scaling.
- AUTO/live OP.GG rank stays unchanged.

# RIFT/OPS v6.1 — Community Operations Release

V6 adds Custom Night sessions, ready check, persistent server history, audit trail, community bug reporting, technician bug inbox and pre-deploy checks. Run `npm run preflight` before deployment.

# RIFT/OPS v5.0 — Community Hardened

V5 keeps the v4.4 skill-band draft and effective-rank badges, and adds a production hardening pass: stronger server security headers, mutation origin checks, request IDs, smaller body limits, persistent production state, automatic log rotation, graceful shutdown, global error logging, registry backup before destructive clears, and a Technician Safety Center for Andrei with integrity checks, manual backups, OP.GG cache clear, maintenance mode, log clearing, session revocation and richer health stats.

# RIFT/OPS 3.1 — Custom Quality Edition

League of Legends custom-game production suite for EUNE, powered by OP.GG MCP.

## What changed
- OP.GG profile + recent-match scouting before team generation.
- Rank scale recalibrated: Emerald starts at 3.10, Diamond at 3.50, Master at 4.05.
- Separate **Rank Rating** and **Effective Skill**. Effective Skill is only an internal custom-balancing score; it is not Riot MMR.
- Smurf suspicion uses account level, SoloQ win rate, ranked sample size and recent performance signals.
- Green = no smurf signal, orange = suspicion, red = high/very high suspicion.
- No visible-rank ceiling on the performance adjustment.
- OP.GG rank emblems are shown when `tier_image_url` is available, with a local styled fallback.
- Team generation balances total Effective Skill and role-vs-role deltas.
- Match Quality score (0–100) is shown for each generated draft.
- If an entered Riot ID cannot be scouted, the draft stops instead of silently inventing a rating.
- OP.GG calls are concurrency-limited and cached for 10 minutes.

## Install
```bat
cd C:\Users\tican\rift
npm install
npm run check
npm start
```
Open `http://localhost:3000`.

## EUNE config
Copy `.env.example` to `.env` if needed. Default region is EUNE.

## Notes
The balancing score is designed for your private/custom lobbies. It is not an MMR/ELO calculator and should not be presented as Riot's hidden MMR.


## v3.1 Recent Performance Engine
Team balancing now blends visible rank with the last 10 OP.GG matches. Recent WR, KDA, deaths, role-aware CS/min and kill/assist dominance feed a Recent Performance Rating. Smurf suspicion is driven by the gap between visible rank and recent performance, with sample-size confidence.


## v3.2 — Player Registry
Admin Panel stores per-Riot-ID balancing rules in browser localStorage. AUTO uses OP.GG, FLOOR uses max(Auto, Floor), and OVERRIDE uses the exact manual skill. Alias and admin notes are saved for known players / alt accounts. The final adjusted skill is what the 5v5 balancer uses.

## v3.3 — Multi-match Draft + Smurf Controls
- Smurf status can be changed directly on each Draft player: AUTO / NOT SMURF / SMURF.
- Manual smurf labels are persistent in localStorage and do not silently change the player's skill rating.
- Skill FLOOR / OVERRIDE remains independent and can still be configured in Player Registry.
- Rosters generate one complete 5v5 match per 10 players: 20 = 4 teams, 30 = 6 teams, etc.; incomplete remainder is shown as Waiting / Reserves.
- OP.GG scouting is concurrency-limited to 3 requests and each 10-player match is balanced independently with a bounded exhaustive 5v5 search.
- Server accepts up to 200 players per generation request as a safety guard.

## v3.6 — Production Hub / Broadcast
- Production Hub with LIVE control and match queue.
- `Lobring` is the default featured streamer. His match is prioritized in the queue and his team is displayed on Blue Side when possible; this swaps presentation sides only and does not alter team balance.
- Draft matches can be sent directly to LIVE / OBS.
- LIVE controls: Blue Win, Red Win, Remake, Cancel.
- OBS transparent Browser Sources: `/overlay.html?view=live` and `/overlay.html?view=result`.
- Featured player can be changed from Production Hub.


## v3.7 — OP.GG-inspired match readability
- Recent Form redesigned with clear Victory/Defeat treatment.
- KDA receives performance-tier coloring.
- MVP / ACE badges are shown when OP.GG match data exposes them (with first-in-team fallback when rank data is available).
- OP Score / team rank are displayed when present in the OP.GG payload.
- Tournament and result winner/loser colors were aligned with the same broadcast language.
- Styling is RIFT/OPS original and OP.GG-inspired rather than a pixel-for-pixel copy.


## v3.8 — Role-safe Admin Swap
- Admin MOVE/SWAP now swaps draft slots as well as players.
- Every 5v5 team is guaranteed to retain one TOP, one JNG, one MID, one ADC and one SUP after manual swaps.
- Example: swapping a JNG with a TOP makes the incoming player occupy TOP on the destination team and the other player occupy JNG on the opposite team.
- Role deltas and match quality are recalculated immediately after the swap.

## v3.9 Player Intel
- Ranked Solo/Duo and Flex now render as visual cards with their own rank emblems.
- Champion Pool now uses Data Dragon champion portraits instead of a text-only list.
- Champion cards show ranked games and win rate when OP.GG exposes them. Mastery points are explicitly marked unavailable rather than fabricated because the current OP.GG profile payload does not expose Riot mastery points.
- Player Intel includes an inline Admin Player Control for skill mode, floor, override, smurf label, alias, preferred role and admin notes. OP.GG rank/LP remain read-only live data.

## v4.0 — Admin Security + Tehnician AI

RIFT/OPS now starts visitors in read-only VISITOR mode. Staff access is password-based and verified only on the Node server.

### First setup (important)

Run this once on the machine/server that hosts RIFT/OPS:

```bash
npm run auth:setup
```

The command generates two random passwords and prints them **only in that terminal**:

- `ADMIN · Lobring` — Admin Panel, Player Registry, smurf/skill overrides and live production controls.
- `TEHNICIAN AI · Andrei` — everything Admin can do, plus diagnostics, logs, traffic/view counters, OP.GG status and session revocation.

Copy the Admin password and send it privately to Lobring. Keep the Technician password for Andrei. The passwords themselves are never stored in plaintext: `.data/auth.json` contains salted scrypt hashes. `.data/` is ignored by Git.

A successful login creates an HttpOnly, SameSite=Strict session cookie valid for 30 days. In production (`NODE_ENV=production`) it is also marked Secure. Running `npm run auth:setup` again creates new passwords and invalidates all existing sessions.

### Visitor mode

Without a staff password the site remains usable as a visitor, but Admin Panel and Tehnician AI are hidden. Server-side protected endpoints reject unauthorized writes with HTTP 401/403. Draft balancing reads manual overrides from the server registry rather than trusting values sent by the browser.

### Tehnician AI — Andrei

The DEV panel shows Node uptime/memory, OP.GG MCP state/tool count, total requests, page views, API requests, server errors, active sessions and recent request/security logs. `REVOKE ALL SESSIONS` invalidates every Admin/Technician login immediately.

Logs and registry data live under `.data/` and are not included in source control.

## v4.1 — Skill Band Draft
- Draft-ul este afișat simetric TOP vs TOP / JNG vs JNG / MID vs MID / ADC vs ADC / SUP vs SUP.
- Balancing-ul penalizează puternic matchup-urile cu mai mult de un skill band diferență; role-vs-role are prioritate față de simpla egalizare a totalului.
- Admin și Tehnician AI pot seta AUTO / FLOOR / OVERRIDE, skill band și valoarea exactă direct din Draft Output.
- Badge-urile de smurf sunt compacte pentru a păstra rândurile perfect aliniate.


## v4.2 Draft UI polish
- Staff skill controls use a readable two-row responsive layout.
- Removed horizontal overflow / clipped gold control fragments.
- Larger inputs and spacing for Admin and Tehnician AI while preserving role-vs-role symmetry.


## v4.3
- Draft skill editor: editing band/value automatically switches to OVERRIDE, so APPLY changes the effective skill immediately.
- APPLY feedback: SAVING / SAVED / RETRY.
- Cleaner severity pills for GOOD / SLIGHT / HIGH / CRITICAL.
- Skill editor button is fully contained; no overflow at narrow desktop widths.


## v4.4 — Effective Rank Badge Sync
- Draft rank badge now follows the effective skill when ADMIN/TECH uses FLOOR or OVERRIDE.
- Effective tier also derives a display division (IV → I) for Iron through Diamond/Emerald based on the exact 1–5 skill value.
- Master/Grandmaster/Challenger display without a division.
- The original OP.GG LIVE rank remains visible under the admin-adjusted rank so staff can distinguish real rank from custom balancing rank.
- Returning to AUTO restores the normal OP.GG badge/rank presentation.

## V6.1.1 — Gold emblem visual hotfix
- Fixed the effective GOLD rank emblem rendering much smaller than the other rank emblems.
- The fix is tier-specific, so Diamond/Master/Grandmaster/Challenger and other correctly sized emblems are unchanged.
- Layout dimensions remain unchanged; only the visible Gold artwork is scaled inside its existing badge slot.


## V7.0 — Admin Workflow & Team Identity

V7.0 skips a feature-heavy V6.4 and focuses on reducing admin work during Custom Nights.

- Staff can name every generated team directly in the draft; those names flow into Production, history and the Tournament Bracket input.
- MOVE is compact; SWAP HERE only appears while a move is active. Secondary destructive actions live under the `•••` player menu.
- REMOVE FROM MATCH keeps the match 5v5 and selects the closest reserve, preferring the same role.
- MOVE/SWAP and reserve replacement have a one-step UNDO.
- Tournament setup automatically reuses current draft team names when available.
- Bulk history-clear buttons were removed to reduce accidental destructive actions; staff can remove individual records deliberately.
- Team generation and all draft mutations are staff-only in both the UI and backend. Visitor remains read-only for administrative operations.
- Existing Technician-only diagnostics and safety controls remain Technician-only.


## V7 automation
- Active draft and bracket are restored automatically from browser state.
- Staff history is synchronized from persistent server history after authentication.
- Completed tournament brackets are automatically archived.
- Draft/team-name edits persist automatically.
- Server performs a daily safety backup of operational JSON data.
- Riot integration readiness is server-side only. Set `RIOT_API_KEY` in the host environment; never put the key in frontend code. Tournament integration remains disabled unless `RIOT_TOURNAMENT_ENABLED=1`.


## V7.0.2
- Tournament Bracket supports 2–64 teams with automatic BYEs and dynamic rounds (Round of 64/32/16, quarters, semis, final).
- Added staff-only Clear Ready Check and Delete Session controls with audit logging and a safety backup before session reset.

## V7.1 security / access-control hardening
- Production Hub is staff-only in the UI and its full state API now requires Admin/Technician authentication.
- OBS uses a separate read-only overlay endpoint containing only broadcast state required by the overlay.
- Visitor cannot navigate to Hub/Admin/Technician views; unauthorized API calls are still denied server-side.
- Staff identity badges expose only the role (ADMIN / TECHNICIAN), not the staff member name.
- Added CSP, cross-site mutation checks, no-store headers for sensitive APIs, and denied dotfile serving.
- Important: browser DevTools cannot be reliably disabled. Public HTML/CSS/JS and public data can always be inspected/copied by a visitor. Security therefore does not depend on hiding client code; secrets, privileged data and authorization remain server-side.


## V10.0 — Operations Automation

V10 mută starea activă a Draft-ului și Bracket-ului și pe server pentru staff, cu sincronizare automată și snapshot-uri de recuperare. Include validare înainte de LIVE, urmărire vizuală a unei echipe în bracket, recovery center și simplificări ale fluxului administrativ. Controalele administrative rămân protejate server-side pe roluri.

## V10.2 — Automatizare + acces staff

- Starea operațională primește automat snapshot-uri de siguranță înaintea modificărilor periodice, astfel încât Adminul nu trebuie să salveze manual fiecare etapă.
- Când un Custom Night trece în `COMPLETE`, sesiunea este arhivată automat în istoricul persistent.
- În **Administrare → Acces staff**, Admin/Technician poate selecta un participant din Custom Night sau introduce un nume și îi poate acorda rol `ADMIN` sau `TECHNICIAN`.
- Pentru conturile noi, serverul generează o parolă temporară care este afișată o singură dată; pe disc rămâne doar hash-ul scrypt.
- Rolurile pot fi schimbate, parolele regenerate și accesul revocat. Schimbarea rolului, resetarea parolei și revocarea invalidează automat sesiunile acelui cont.
- Nu este permisă revocarea propriului cont din sesiunea curentă și sistemul nu permite eliminarea ultimului Technician activ.
- Modificările de acces sunt înregistrate în Audit Log și fișierul de autentificare primește backup înaintea operațiilor sensibile.

Pentru instalări vechi, formatul de autentificare V1 este migrat automat la noul registru de conturi la prima utilizare. Nu este obligatoriu să regenerezi parolele existente doar pentru upgrade.


## V12.0.1 — Audit hotfix
`security:audit` acceptă acum existența normală a folderului `.data` și a fișierului `.env` pe o instalare locală. Verificarea confirmă în schimb că ambele sunt excluse prin `.gitignore`, astfel încât datele runtime și secretele locale să nu fie incluse în source/release.
