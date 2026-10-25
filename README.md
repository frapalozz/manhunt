# Manhunt (web + Supabase)

Nascondino all'aperto che si gioca **dal browser**: si apre un link e si gioca, senza store e senza download.
Una squadra si nasconde, l'altra cerca. A intervalli fissi il server mostra ai cercatori la posizione dei nascosti.
Chi viene trovato passa ai cercatori. Vincono i cercatori se trovano tutti, altrimenti i nascosti.

Il server fa da arbitro: nessun telefono deve fare da host e la partita va avanti anche se qualcuno chiude il browser.
Tutto gira sui **piani gratuiti** di Supabase e Netlify, senza carta di credito.

## Come funziona il ping

1. **Avviso:** 45 secondi prima di ogni ping (o a metà intervallo se i ping sono fitti) i nascosti ricevono una notifica: "Ping tra 45 secondi".
2. **Risposta:** il nascosto tocca la notifica, la pagina si apre e invia la posizione. Poi può bloccare il telefono. Se la pagina è già aperta, la posizione parte da sola.
3. **Ping:** all'orario stabilito i cercatori vedono sulla mappa le posizioni ricevute, con distanza e direzione.
4. **Penalità:** chi non risponde appare come "non ha risposto", con l'ultima posizione nota. Oltre il numero di ping saltati scelto dall'host (1, 2, 3, 5 o mai) viene squalificato e passa ai cercatori.

## Cosa c'è nel pacchetto

| File / cartella | A cosa serve |
|---|---|
| `web/` | Il sito da mettere online |
| `supabase/schema.sql` | Database, regole di sicurezza e timer dei ping: si incolla nel SQL Editor |
| `supabase/functions/manhunt/index.ts` | Il server di gioco: si incolla nell'editor delle Edge Functions |
| `keygen.html` | Crea le chiavi per le notifiche: si apre con Chrome o Edge sul PC |
| `dev/` | Sorgenti e test della logica (servono solo se vuoi modificare il gioco) |

---

## Installazione (circa 15 minuti, tutto dal browser)

### 1. Crea il progetto Supabase
1. Vai su supabase.com, registrati e crea un **nuovo progetto** (regione: Central EU / Frankfurt). Annota la password del database.
2. **Authentication → Sign In / Providers**: attiva **Allow anonymous sign-ins** e salva.

### 2. Crea le chiavi
Apri `keygen.html` con Chrome o Edge (doppio clic sul file) e premi **Genera chiavi**. Tieni la pagina aperta: ti servono i tre valori.

### 3. Pubblica il server di gioco (Edge Function)
1. **Edge Functions → Deploy a new function → Via Editor**.
2. Nome della funzione: **`manhunt`** (esattamente così).
3. Cancella il codice di esempio e incolla tutto il contenuto di `supabase/functions/manhunt/index.ts`. Premi **Deploy**.
4. Nelle impostazioni della funzione **disattiva "Verify JWT"** (o "Enforce JWT verification") e salva. Il controllo degli accessi lo fa già il codice.
5. **Edge Functions → Secrets** (Edge Function Secrets) e aggiungi:

| Nome | Valore |
|---|---|
| `TICK_SECRET` | il valore TICK_SECRET di keygen.html |
| `VAPID_PUBLIC_KEY` | il valore VAPID_PUBLIC_KEY |
| `VAPID_PRIVATE_KEY` | il valore VAPID_PRIVATE_KEY |
| `VAPID_SUBJECT` | `mailto:` seguito dalla tua email, es. `mailto:mario@esempio.it` |

### 4. Crea il database
1. Apri `supabase/schema.sql` con il Blocco note e vai in fondo, alla sezione **CONFIGURAZIONE**:
   - sostituisci `ID-PROGETTO` con l'ID del tuo progetto (lo vedi nell'indirizzo del pannello e in Project Settings);
   - sostituisci `CAMBIA-QUESTA-FRASE-SEGRETA` con lo stesso **TICK_SECRET** messo nei segreti.
2. In Supabase apri **SQL Editor → New query**, incolla tutto il file e premi **Run**. Deve finire con "Success".
   Se compare un errore su `pg_cron` o `pg_net`: vai in **Database → Extensions**, attiva **pg_cron** e **pg_net**, poi riesegui.

### 5. Configura il sito
Apri `web/config.js` con il Blocco note e compila:
- `supabaseUrl`: Project Settings → API (Data API) → **Project URL**;
- `supabaseKey`: Project Settings → API Keys → chiave **publishable** (o la vecchia **anon public**). Non usare mai la chiave secret / service_role;
- `vapidPublicKey`: il valore VAPID_PUBLIC_KEY di keygen.html.

### 6. Metti online il sito (Netlify, gratis)
1. Crea un account gratuito su netlify.com.
2. Vai su **app.netlify.com/drop** e trascina la **cartella `web`** nella pagina.
3. Dopo pochi secondi hai l'indirizzo, tipo `https://nome-a-caso.netlify.app`. Puoi cambiarlo in Site configuration → Change site name.

È il link da mandare agli amici. Quando modifichi qualcosa nel sito, trascina di nuovo la cartella in Deploys.

---

## Giocare

Tutti aprono il link nel browser, scrivono il nome e consentono **posizione** e **notifiche**.

- **Android (Chrome):** funziona tutto direttamente dalla scheda del browser.
- **iPhone (Safari):** si gioca dalla scheda di Safari, ma Apple consegna le notifiche dei siti solo se la pagina è stata messa sulla schermata Home (Condividi → "Aggiungi alla schermata Home", iOS 16.4 o successivo). Non è un'app scaricata: è un collegamento al sito.
  - Senza collegamento non arrivano gli avvisi: il nascosto vede il conto alla rovescia e deve riaprire la pagina prima del ping.
  - Chi usa il collegamento deve aprirlo prima di entrare in partita: Safari e il collegamento hanno memorie separate, quindi passando dall'uno all'altro risulti un giocatore nuovo.

**In partita:**
1. Uno tocca **Crea partita** e condivide il codice o il link "Invita amici".
2. L'host sceglie le squadre (o **Mescola**), l'intervallo dei ping, il tempo per nascondersi, la durata e la squalifica.
3. **Inizia la caccia.** I nascosti scappano e possono bloccare il telefono.
4. Per una cattura: il cercatore tocca **Preso!** due volte, oppure il nascosto tocca **Mi hanno preso**.

## Mappa e radar

Durante la partita, in basso a sinistra, puoi scegliere tra due viste:

- **Mappa:** la mappa OpenStreetMap con le tracce dei ping.
- **Radar:** sei al centro e ogni giocatore appare nella sua direzione, con la distanza. I cerchi indicano un quarto del raggio ciascuno, e la scala si adatta da sola al nascosto più lontano. Con **Bussola** il radar ruota con il telefono, così quello che è in alto sul radar è davanti a te. Su iPhone la prima volta compare la richiesta di accesso all'orientamento.

Ogni nascosto è indicato dalle sue **iniziali in un colore suo** (uguale su mappa, radar e lista). Le iniziali sono sempre diverse: se due nomi iniziano con la stessa lettera si usano due lettere, per esempio BR e BE. I cercatori della tua squadra sono in arancione. Un contorno rosso indica un nascosto che non ha risposto all'ultimo ping.

## Limiti del piano gratuito

- **Pausa dopo 7 giorni di inattività**: se nessuno gioca per una settimana, Supabase mette in pausa il progetto. Basta riattivarlo dal pannello (Restore project) prima di giocare.
- **Accesso anonimo**: di default massimo 30 nuovi accessi all'ora dallo stesso indirizzo. Se giocate in tanti sulla stessa rete Wi-Fi, alzalo in Authentication → Rate Limits.
- **Pulizia automatica**: ogni notte vengono cancellate le partite ferme da 2 giorni.

## Problemi comuni

- **"Non riesco a collegarmi al server"**: controlla `supabaseUrl` e `supabaseKey` in `web/config.js` e che l'accesso anonimo sia attivo.
- **"Server non raggiungibile" quando crei una partita**: la Edge Function non si chiama esattamente `manhunt` o non è stata pubblicata.
- **La partita parte ma i ping non arrivano mai**:
  - controlla di aver disattivato "Verify JWT" sulla funzione;
  - controlla che `TICK_SECRET` sia identico nei segreti e in `schema.sql`;
  - controlla che l'ID progetto nell'indirizzo sia giusto.

  Nel SQL Editor puoi lanciare `select status_code, content from net._http_response order by created desc limit 5;`: deve rispondere 200.
- **"Notifiche non collegate"**: `vapidPublicKey` in `config.js` non corrisponde a `VAPID_PUBLIC_KEY` nei segreti. Rigenera le chiavi con keygen.html e aggiornale in entrambi i posti.
- **Su iPhone manca "Attiva notifiche"**: la pagina è aperta da Safari e non dal collegamento sulla Home, oppure iOS è più vecchio della 16.4.
- **Notifiche in ritardo su Android**: Impostazioni → App → Chrome → Batteria → Nessuna restrizione.
- **Errori del server**: Edge Functions → manhunt → Logs.

## Modificare il gioco (facoltativo)

La logica di gioco sta in `dev/game.js` (test: `node dev/game.test.js`), il server in `dev/handler.js`.
Dopo una modifica rigenera il file da incollare con `node dev/build.js` e ripubblica la funzione.
