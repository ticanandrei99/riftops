# RIFT/OPS 12.2 — Neon Postgres

Proiect: royal-moon-70169863. Branch: production. Serviciu: Postgres. Autentificarea RIFT/OPS existentă, Effective Rank, detecția smurf și OP.GG sunt păstrate.

## Ce s-a schimbat

Serverul Express folosește node-postgres (pg), un pool de maximum 5 conexiuni și verificarea certificatului TLS. DATABASE_URL este folosit pentru traficul aplicației; DATABASE_URL_UNPOOLED pentru schema SQL. Variabilele sunt citite din mediul serverului, apoi .env și .env.local fără suprascrierea mediului existent.

Datele existente sunt păstrate ca documente în tabela rift_documents, cu namespace și cheie unice. Această etapă păstrează structurile JSON și toate funcțiile existente; nu este încă o schemă relațională normalizată. Conturile, sesiunile, registry-ul, comunitatea, workflow-ul, seriile, backup-urile și logurile folosesc același strat Postgres.

Fiecare cerere API citește starea într-o tranzacție. Un advisory lock pe namespace serializează operațiile, inclusiv între două instanțe. Răspunsul este trimis după commit; erorile de stocare nu sunt prezentate ca salvări reușite. Această implementare este destinată unei comunități mici: încărcarea tuturor documentelor și serializarea cererilor limitează debitul, iar o cerere OP.GG lentă poate întârzia celelalte cereri. Pentru trafic mare trebuie separate tabelele, sesiunile și tranzacțiile operaționale.

Schema este versionată în migrations/001-document-store.sql și este aditivă. Importul inițial al celor 10 documente locale a fost executat o singură dată. Datele locale originale nu au fost șterse. db:import refuză să suprascrie un namespace deja populat. Fără DATABASE_URL se poate lucra local în modul JSON; în production variabila este obligatorie.

## Verificări

- npm run build — verificarea sintaxei pentru aplicația JavaScript fără pas de compilare.
- npm run release:check — audit static și testele HTTP locale.
- npm run test:neon — test pe Neon în namespace separat: autentificare, scor, ready check, audit, două servere concurente, restart și logout. Datele testului sunt șterse la final.

## Render

Aplicația nu a fost publicată pe Render. render.yaml este pregătit pentru un Web Service gratuit în Frankfurt. Publică sursele într-un repository privat fără .env.local/.env/.neon/.data/node_modules, apoi creează un Blueprint în Render.

Completează DATABASE_URL și DATABASE_URL_UNPOOLED în Environment, copiind valorile din fișierul local generat de Neon. Nu le pune în public/app.js, Git sau mesaje. Pentru configurare manuală: Build Command = npm ci && npm run build, Start Command = npm start, NODE_ENV = production, TRUST_PROXY = 1. Selectează Node 24.

Render Free poate intra în repaus. Datele rămân în Neon. Limitarea login-urilor și cache-ul OP.GG sunt încă în memoria instanței; pentru lansare publică la scară mai mare sunt necesare limite distribuite. Backup-urile aplicației sunt în aceeași bază de date; pentru recuperare după ștergerea întregului proiect este necesar și un export independent.

## Probleme întâlnite

Instalarea globală npm a fost blocată de permisiunile Windows; s-a folosit CLI Neon 8.16.0 deja descărcat prin npx. neon init a legat proiectul, a creat neon.ts și a extras variabilele, dar a raportat eșec la instalarea pluginului Codex. Skill-urile locale existente au fost suficiente. neon deploy a reușit: branch-ul corespundea deja politicii Postgres. Acest deploy configurează Neon; nu publică serverul Express pe Render.
