# RIFT/OPS 12.1

Effective Rank, detecția smurf, override-urile și integrarea OP.GG originale au fost păstrate. Nu este necesară o cheie Riot. Nu s-a adăugat integrare Riot API.

## Nou: Match Series

- Staff: deschide Match Series din bara laterală.
- Creează BO1, BO3 sau BO5; poți importa primele două echipe din Draft.
- Confirmă BLUE WIN sau RED WIN după fiecare joc. Seria se încheie la majoritatea necesară.
- Anulează ultimul rezultat pentru a corecta o greșeală. Seria poate fi reluată.
- Reviziile împiedică dublarea scorului când doi organizatori confirmă simultan.
- Scorurile se păstrează pe server în .data/series.json și intră în backup-urile operaționale.
- LINK OBS copiază un Browser Source cu scorul actualizat automat.
- EXPORT CSV descarcă lista seriilor. Datele din export sunt protejate împotriva formulelor injectate în numele echipelor.
- Seriile sunt independente de bracket: rezultatele nu avansează automat turneul.

## Securitate

Administrarea conturilor staff aparține acum Technician-ului și cere reconfirmarea parolei. Mutațiile autentificate folosesc CSRF. Sesiunile expiră după 30 minute de inactivitate / maximum 12 ore, iar login-ul înlocuiește sesiunea curentă. Cookie-ul de producție folosește prefixul __Host-, Secure și HttpOnly. Există limitare de cereri și verificare HTTPS pentru modul production.

## Instalare nouă

1. Instalează Node.js 20 sau mai nou.
2. Dezarhivează într-un folder nou, deschide terminalul în acel folder și rulează npm ci.
3. Copiază .env.example în .env și păstrează NODE_ENV=development pentru localhost.
4. Rulează npm run auth:setup o singură dată; salvează parolele afișate într-un manager de parole.
5. Rulează npm start și deschide http://localhost:3000.

## Actualizare instalare existentă

Oprește aplicația și fă o copie de siguranță a întregului folder, inclusiv .data. Copiază fișierele noi peste aplicație, păstrând .data și .env existente. Rulează npm ci, apoi npm start. Nu rula auth:setup dacă vrei să păstrezi conturile existente. Sesiunile vechi sunt invalidate; autentifică-te din nou. Datele browserului se păstrează doar dacă folosești aceeași origine (adresă + port).

Arhiva livrată exclude .data, .env, node_modules și datele de test. Arhiva originală nu a fost modificată.

## Verificare

npm run release:check verifică sintaxa, preflight, auditul static și testele HTTP pentru serii, CSRF, permisiuni, logout, resetarea parolelor, expirare și persistență după restart. Nu verifică disponibilitatea sau corectitudinea datelor OP.GG. Funcțiile Effective Rank și smurf sunt estimări proprii existente, nu rezultate oficiale Riot.
