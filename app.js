const APP_VERSION = "1.0.5"; // Cambia questo valore in futuro per far apparire il modale di aggiornamento
const FIREBASE_URL = "https://fidelity-gestionale-default-rtdb.europe-west1.firebasedatabase.app";

let avvisoNuoviMessaggiMostrato = false;
let utenteCorrenteId = null;
let datiUtenteCorrente = null;
let preferenzeUI = { nascondiNome: false, nascondiAvatar: false, nomeCustom: "" };

// ==========================================
// 1. GESTIONE INDEXEDDB (Wrapper Semplificato)
// ==========================================
const dbName = "FidelityAppDB";
const storeName = "appData";

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function setLocalData(key, value) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getLocalData(key) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(tx.error);
    });
}

async function clearLocalData() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ==========================================
// 2. AVVIO DELL'APP
// ==========================================
window.onload = async () => {
    // Controllo Versione App
    const savedVersion = await getLocalData("appVersion");
    if (savedVersion !== APP_VERSION) {
        if (savedVersion !== undefined) { // Non mostrare al primissimo avvio assoluto
            document.getElementById("update-modal").classList.add("active");
        }
        await setLocalData("appVersion", APP_VERSION);
    }

    // Controllo Auto-Login
    const savedUser = await getLocalData("userData");
    if (savedUser && savedUser.id) {
        utenteCorrenteId = savedUser.id;
        datiUtenteCorrente = savedUser.data;
        mostraDashboard(utenteCorrenteId, datiUtenteCorrente);

        // Sincronizza silenziosamente in background con Firebase
        aggiornaDatiInBackground(utenteCorrenteId);
    }
};

function chiudiModaleAggiornamento() {
    document.getElementById("update-modal").classList.remove("active");
}

// ==========================================
// 3. LOGIN & FIREBASE
// ==========================================
async function eseguiLogin() {
    const phoneInput = document.getElementById("login-phone").value.trim();
    const passInput = document.getElementById("login-password").value.trim();
    const rememberMe = document.getElementById("remember-me").checked;

    if (!phoneInput || !passInput) return mostraErrore("Inserisci Telefono e Password");

    const url = `${FIREBASE_URL}/clienti.json?orderBy="dati_anagrafici/telefono"&equalTo=${phoneInput}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data || Object.keys(data).length === 0) return mostraErrore("Nessun utente trovato");

        const numeroScheda = Object.keys(data)[0];
        const userData = data[numeroScheda];
        const passwordDB = userData.password || "default";

        if (passInput !== passwordDB) return mostraErrore("Password errata!");

        utenteCorrenteId = numeroScheda;
        datiUtenteCorrente = userData;
        document.getElementById("login-error").style.display = "none";

        // Se l'utente vuole restare loggato, salviamo in IndexedDB
        if (rememberMe) {
            await setLocalData("userData", { id: utenteCorrenteId, data: userData });
        }

        if (passwordDB === "default") {
            document.getElementById("password-modal").classList.add("active");
        }

        mostraDashboard(numeroScheda, userData);

    } catch (error) {
        mostraErrore("Errore di connessione al server");
    }
}

function mostraErrore(msg) {
    const errorMsg = document.getElementById("login-error");
    errorMsg.innerText = msg;
    errorMsg.style.display = "block";
}

async function aggiornaDatiInBackground(schedaId) {
    try {
        const response = await fetch(`${FIREBASE_URL}/clienti/${schedaId}.json`);
        const userData = await response.json();
        if (userData) {
            datiUtenteCorrente = userData;
            await setLocalData("userData", { id: schedaId, data: userData });
            mostraDashboard(schedaId, userData); // Aggiorna la UI con i nuovi dati
        }
    } catch (e) { console.log("Offline: uso i dati locali."); }
}

// ==========================================
// 4. GESTIONE UI (Dashboard e Impostazioni)
// ==========================================
function cambiaSchermata(idDaMostrare) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(idDaMostrare).classList.add('active');
}

function mostraDashboard(numeroScheda, data) {
    cambiaSchermata('dashboard-screen');
    // --- APPLICAZIONE PREFERENZE UI ---
    const nameEl = document.getElementById("user-name");
    const avatarEl = document.querySelector(".user-icon");

    if (preferenzeUI.nascondiAvatar) avatarEl.classList.add("hidden");
    else avatarEl.classList.remove("hidden");

    if (preferenzeUI.nascondiNome) {
        nameEl.innerText = "";
    } else if (preferenzeUI.nomeCustom.trim() !== "") {
        nameEl.innerText = preferenzeUI.nomeCustom;
    } else {
        nameEl.innerText = data.dati_anagrafici.nome_completo;
    }
    // ----------------------------------

    // --- CONTROLLO SOGLIA BONUS (Multipli di 100) ---
    controllaSogliaBonus(data.fidelity.punti || 0);
    // ------------------------------------------------

    const punti = data.fidelity.punti || 0;
    document.getElementById("user-punti").innerText = punti;

    // --- CALCOLO DEGLI ULTIMI PUNTI CARICATI ---
    let ultimiPunti = "0";
    if (data.messaggi && Object.keys(data.messaggi).length > 0) {
        // Prende tutti i messaggi e li ordina dal più recente al più vecchio
        const msgArray = Object.values(data.messaggi);
        msgArray.sort((a, b) => b.timestamp - a.timestamp);

        // Estrae i punti caricati dal primissimo messaggio della lista (il più recente)
        ultimiPunti = msgArray[0].punti_caricati || "0";
    }

    // Formatta il numero sostituendo l'eventuale punto (es. 29.50) con la virgola (29,50)
    document.getElementById("user-bonus").innerText = String(ultimiPunti).replace(".", ",");
    // -------------------------------------------

    const scaglioni = Math.floor(punti / 100);
    const valoreBonus = scaglioni * 10;
    document.getElementById("user-euro").innerText = valoreBonus >= 10 ? `€ ${valoreBonus},00` : `€ 0,00`;

    let dataOp = data.fidelity.ultima_operazione;
    if (dataOp) {
        const parti = dataOp.split("-");
        if (parti.length === 3) dataOp = `${parti[2]}/${parti[1]}/${parti[0]}`;
    }
    document.getElementById("user-data").innerText = dataOp || "Mai";

    document.getElementById("user-scheda").innerText = numeroScheda;
    JsBarcode("#barcode", numeroScheda, { format: "CODE128", lineColor: "#000", width: 2, height: 60, displayValue: false });
}

function apriImpostazioni() { cambiaSchermata('settings-screen'); }
function chiudiImpostazioni() { cambiaSchermata('dashboard-screen'); }

// ==========================================
// 5. CAMBIO PASSWORD E LOGOUT
// ==========================================
async function eseguiLogout() {
    await clearLocalData(); // Cancella IndexedDB
    utenteCorrenteId = null;
    datiUtenteCorrente = null;
    document.getElementById("login-phone").value = "";
    document.getElementById("login-password").value = "";
    cambiaSchermata('login-screen');
}

async function salvaNuovaPasswordPrimoAccesso() {
    const nuovaPass = document.getElementById("first-new-password").value.trim();
    if (nuovaPass.length < 6) return mostraAvviso("Attenzione", "La password deve avere almeno 6 caratteri.", "error"); // <--- MODIFICATO
    await aggiornaPasswordSuFirebase(nuovaPass);
    document.getElementById("password-modal").classList.remove("active");
    mostraAvviso("Successo", "Password impostata correttamente.", "success"); // <--- AGGIUNTO
}

async function cambiaPasswordImpostazioni() {
    const oldPwd = document.getElementById("old-pwd").value;
    const newPwd = document.getElementById("new-pwd").value.trim();

    const passwordAttuale = datiUtenteCorrente.password || "default";

    if (oldPwd !== passwordAttuale) return mostraAvviso("Errore", "La vecchia password è errata!", "error"); // <--- MODIFICATO
    if (newPwd.length < 6) return mostraAvviso("Attenzione", "La nuova password deve avere almeno 6 caratteri.", "error"); // <--- MODIFICATO

    const success = await aggiornaPasswordSuFirebase(newPwd);
    if (success) {
        mostraAvviso("Ottimo!", "Password aggiornata con successo!", "success"); // <--- MODIFICATO
        document.getElementById("old-pwd").value = "";
        document.getElementById("new-pwd").value = "";
        chiudiImpostazioni();
    }
}

async function aggiornaPasswordSuFirebase(nuovaPassword) {
    try {
        await fetch(`${FIREBASE_URL}/clienti/${utenteCorrenteId}.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: nuovaPassword })
        });
        datiUtenteCorrente.password = nuovaPassword;
        await setLocalData("userData", { id: utenteCorrenteId, data: datiUtenteCorrente });
        return true;
    } catch (err) {
        mostraAvviso("Errore di rete", "Impossibile contattare il server. Riprova più tardi.", "error"); // <--- MODIFICATO
        return false;
    }
}

    // ==========================================
    // 6. GESTIONE MODALI DI AVVISO (Sostituisce gli alert)
    // ==========================================
    function mostraAvviso(titolo, messaggio, tipo = "info") {
        const modal = document.getElementById("alert-modal");
        const titleEl = document.getElementById("alert-title");
        const messageEl = document.getElementById("alert-message");

        titleEl.innerText = titolo;
        messageEl.innerText = messaggio;

        // Reset classi colore titolo
        titleEl.className = "";
        if (tipo === "error") titleEl.classList.add("modal-title-error");
        else if (tipo === "success") titleEl.classList.add("modal-title-success");
        else titleEl.classList.add("modal-title-info");

        modal.classList.add("active");
    }

    function chiudiModaleAvviso() {
        document.getElementById("alert-modal").classList.remove("active");
    }

    // ==========================================
    // 7. NAVIGAZIONE INFERIORE E MESSAGGI
    // ==========================================
    async function cambiaSchermataNav(idDaMostrare, navElement) {
        cambiaSchermata(idDaMostrare);

        // Aggiorna l'icona attiva
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        if (navElement) navElement.classList.add('active');

        // Logica specifica per la schermata Messaggi
        if (idDaMostrare === 'messages-screen') {

            // Salviamo IL NUMERO di messaggi totali come "già letti"
            let totaleAttuali = 0;
            if (datiUtenteCorrente && datiUtenteCorrente.messaggi) {
                totaleAttuali = Object.keys(datiUtenteCorrente.messaggi).length;
            }
            await setLocalData("messaggiLetti", totaleAttuali);

            // Nascondiamo immediatamente la bolla rossa
            document.getElementById("msg-badge").classList.add("hidden");

            // Renderizziamo la lista dei messaggi
            renderMessaggi();
        }

        // --- NOVITÀ: Logica specifica per la schermata Impostazioni ---
        if (idDaMostrare === 'settings-screen') {
            document.getElementById("setting-hide-name").checked = preferenzeUI.nascondiNome;
            document.getElementById("setting-hide-avatar").checked = preferenzeUI.nascondiAvatar;
            document.getElementById("setting-custom-name").value = preferenzeUI.nomeCustom;
        }
        // --------------------------------------------------------------
    }

    // Modifica la funzione mostraDashboard per mostrare la bottom nav
    const mostraDashboardOriginale = mostraDashboard;
    mostraDashboard = function (numeroScheda, data) {
        mostraDashboardOriginale(numeroScheda, data);
        document.getElementById("bottom-nav").classList.remove("hidden");

        // Calcoliamo e mostriamo il badge notifiche
        aggiornaBadgeMessaggi();
    }

    let modalitaSelezione = false;

    function renderMessaggi() {
        const container = document.getElementById("messages-container");
        container.innerHTML = ""; // Pulisci

        // I messaggi sono salvati in datiUtenteCorrente.messaggi
        const messaggi = datiUtenteCorrente.messaggi;

        if (!messaggi || Object.keys(messaggi).length === 0) {
            container.innerHTML = `<div class="empty-messages text-center"><p>Nessun messaggio presente.</p></div>`;
            return;
        }

        // Convertiamo l'oggetto in array e ordiniamo dal più recente al più vecchio
        const msgArray = Object.keys(messaggi).map(key => ({ id: key, ...messaggi[key] }));
        msgArray.sort((a, b) => b.timestamp - a.timestamp);

        msgArray.forEach(msg => {
            const bubble = document.createElement('div');
            bubble.className = "msg-bubble";
            bubble.innerHTML = `
                <input type="checkbox" class="msg-checkbox" value="${msg.id}">
                <div class="msg-content">
                    <div class="msg-header">CHEMARIA FIDELITY</div>
                    <div class="msg-title">Ciao, ${datiUtenteCorrente.dati_anagrafici.nome_completo}<br>Card N: ${utenteCorrenteId}</div>
                    <div class="msg-divider"></div>
                    <div class="msg-row"><span>Saldo Iniziale:</span> <span>${msg.saldo_iniziale}</span></div>
                    <div class="msg-row"><span>Punti Caricati:</span> <span style="color: #4caf50">+${msg.punti_caricati}</span></div>
                    <div class="msg-row"><span>Punti Scaricati:</span> <span style="color: var(--danger)">-${msg.punti_scaricati}</span></div>
                    <div class="msg-row"><strong>Saldo Punti:</strong> <strong>${msg.saldo_punti}</strong></div>
                    <div class="msg-row"><span>Bonus:</span> <span>€ ${msg.bonus}</span></div>
                    <div class="msg-divider"></div>
                    <div class="msg-footer">${msg.data} • ${msg.ora}</div>
                </div>
            `;
            container.appendChild(bubble);
        });
    }

    function attivaSelezioneMessaggi() {
        const container = document.getElementById("messages-container");
        const btnSelect = document.getElementById("btn-select-msg");
        const btnDelete = document.getElementById("btn-delete-msg");

        modalitaSelezione = !modalitaSelezione;

        if (modalitaSelezione) {
            container.classList.add("selection-mode");
            btnSelect.innerText = "Annulla";
            btnDelete.classList.remove("hidden");
        } else {
            container.classList.remove("selection-mode");
            btnSelect.innerText = "Seleziona";
            btnDelete.classList.add("hidden");
            // Deseleziona tutto
            document.querySelectorAll('.msg-checkbox').forEach(cb => cb.checked = false);
        }
    }

    async function eliminaMessaggiSelezionati() {
        const checkboxes = document.querySelectorAll('.msg-checkbox:checked');
        if (checkboxes.length === 0) return mostraAvviso("Attenzione", "Seleziona almeno un messaggio da eliminare.", "error");

        const cancellazioni = [];
        checkboxes.forEach(cb => {
            const msgId = cb.value;
            const url = `${FIREBASE_URL}/clienti/${utenteCorrenteId}/messaggi/${msgId}.json`;
            cancellazioni.push(fetch(url, { method: "DELETE" }));

            // Rimuoviamo il messaggio dalla memoria dell'app
            delete datiUtenteCorrente.messaggi[msgId];
        });

        try {
            await Promise.all(cancellazioni);
            await setLocalData("userData", { id: utenteCorrenteId, data: datiUtenteCorrente }); // Aggiorna DB locale

            // --- BILANCIAMENTO DEL CONTATORE ---
            let messaggiGiaLetti = await getLocalData("messaggiLetti");
            if (messaggiGiaLetti !== undefined) {
                // Sottraiamo i messaggi eliminati dal totale di quelli già letti
                messaggiGiaLetti = Math.max(0, messaggiGiaLetti - checkboxes.length);
                await setLocalData("messaggiLetti", messaggiGiaLetti);
            }
            // -----------------------------------

            mostraAvviso("Fatto", `${checkboxes.length} messaggi eliminati.`, "success");
            attivaSelezioneMessaggi(); // Esci dalla modalità selezione
            renderMessaggi(); // Ricarica la lista visiva
            aggiornaBadgeMessaggi(); // Ricalcola il badge

        } catch (e) {
            mostraAvviso("Errore", "Impossibile eliminare i messaggi.", "error");
        }
    }

    async function aggiornaBadgeMessaggi() {
        if (!datiUtenteCorrente || !datiUtenteCorrente.messaggi) {
            document.getElementById("msg-badge").classList.add("hidden");
            return;
        }

        let messaggiGiaLetti = await getLocalData("messaggiLetti");
        if (messaggiGiaLetti === undefined) messaggiGiaLetti = 0;

        const totaleMessaggiAttuali = Object.keys(datiUtenteCorrente.messaggi).length;
        let messaggiNuovi = totaleMessaggiAttuali - messaggiGiaLetti;

        const badge = document.getElementById("msg-badge");
        if (messaggiNuovi > 0) {
            badge.innerText = messaggiNuovi;
            badge.classList.remove("hidden");

            // --- NOVITÀ: MOSTRA IL MODALE ALL'AVVIO ---
            // Se ci sono messaggi nuovi e non abbiamo ancora mostrato l'avviso...
            if (!avvisoNuoviMessaggiMostrato) {
                document.getElementById("new-messages-count").innerText = messaggiNuovi;
                document.getElementById("new-messages-modal").classList.add("active");
                avvisoNuoviMessaggiMostrato = true; // Così non riappare finché non chiude l'app
            }
            // ------------------------------------------

        } else {
            badge.classList.add("hidden");
        }
    }

    // Funzioni per gestire i tasti del nuovo modale
    function chiudiModaleNuoviMessaggi() {
        document.getElementById("new-messages-modal").classList.remove("active");
    }

    function vaiAMessaggiDaModale() {
        chiudiModaleNuoviMessaggi(); // Chiude il modale

        // Trova il tasto "Messaggi" nella barra inferiore e simula il click
        const navItems = document.querySelectorAll('.nav-item');
        cambiaSchermataNav('messages-screen', navItems[1]);
    }

// ==========================================
// 8. NUOVE FUNZIONI: PREFERENZE, SVUOTA MESSAGGI, BONUS
// ==========================================

// --- CARICAMENTO PREFERENZE ALL'AVVIO ---
// Aggiungiamo un listener aggiuntivo al window.onload per caricare le preferenze
const originalOnload = window.onload;
window.onload = async () => {
    const savedPrefs = await getLocalData("preferenzeUI");
    if (savedPrefs) preferenzeUI = savedPrefs;
    if (originalOnload) originalOnload();
};

// --- IMPOSTAZIONI UI ---
function apriImpostazioni() {
    cambiaSchermata('settings-screen');
    // Compila i campi con le preferenze attuali
    document.getElementById("setting-hide-name").checked = preferenzeUI.nascondiNome;
    document.getElementById("setting-hide-avatar").checked = preferenzeUI.nascondiAvatar;
    document.getElementById("setting-custom-name").value = preferenzeUI.nomeCustom;
}

async function salvaImpostazioniUI() {
    preferenzeUI.nascondiNome = document.getElementById("setting-hide-name").checked;
    preferenzeUI.nascondiAvatar = document.getElementById("setting-hide-avatar").checked;
    preferenzeUI.nomeCustom = document.getElementById("setting-custom-name").value.trim();

    await setLocalData("preferenzeUI", preferenzeUI);

    // Riapplica le modifiche alla dashboard in tempo reale
    if (datiUtenteCorrente) mostraDashboard(utenteCorrenteId, datiUtenteCorrente);

    mostraAvviso("Salvato", "Le tue preferenze sono state aggiornate.", "success");
}

// --- MODALE DI CONFERMA GENERICO ---
function chiudiModaleConferma() {
    document.getElementById("confirm-modal").classList.remove("active");
}

function chiediConfermaEliminaTutti() {
    if (!datiUtenteCorrente.messaggi || Object.keys(datiUtenteCorrente.messaggi).length === 0) {
        return mostraAvviso("Info", "Non ci sono messaggi da eliminare.");
    }

    document.getElementById("confirm-message").innerText = "Sei sicuro di voler svuotare tutta la cronologia dei movimenti? Questa azione è irreversibile.";
    document.getElementById("btn-confirm-action").onclick = eseguiEliminazioneTotale;
    document.getElementById("confirm-modal").classList.add("active");
}

// --- ELIMINAZIONE TOTALE MESSAGGI ---
async function eseguiEliminazioneTotale() {
    chiudiModaleConferma();

    // Invece di cancellarli uno a uno, inviamo una singola richiesta DELETE all'intera cartella "messaggi"
    const url = `${FIREBASE_URL}/clienti/${utenteCorrenteId}/messaggi.json`;

    try {
        await fetch(url, { method: "DELETE" });

        // Pulizia locale
        datiUtenteCorrente.messaggi = {};
        await setLocalData("userData", { id: utenteCorrenteId, data: datiUtenteCorrente });
        await setLocalData("messaggiLetti", 0); // Resettiamo anche il contatore letti

        renderMessaggi();
        aggiornaBadgeMessaggi();
        mostraAvviso("Fatto", "Tutti i messaggi sono stati eliminati.", "success");

    } catch (e) {
        mostraAvviso("Errore", "Impossibile svuotare i messaggi.", "error");
    }
}

// Nascondi il tasto "Svuota" se l'utente entra in modalità selezione singola
const attivaSelezioneOriginale = attivaSelezioneMessaggi;
attivaSelezioneMessaggi = function () {
    attivaSelezioneOriginale();
    const btnSvuota = document.getElementById("btn-delete-all-msg");
    if (modalitaSelezione) btnSvuota.classList.add("hidden");
    else btnSvuota.classList.remove("hidden");
}

// --- CELEBRAZIONE BONUS ---
async function controllaSogliaBonus(puntiAttuali) {
    const scaglioni = Math.floor(puntiAttuali / 100);
    const traguardoAttuale = scaglioni * 100; // Es: 240 punti -> traguardo 200

    if (traguardoAttuale >= 100) {
        // Controlliamo l'ultimo traguardo per cui abbiamo fatto "festa"
        const traguardoCelebrato = await getLocalData("ultimoTraguardoCelebrato") || 0;

        if (traguardoAttuale > traguardoCelebrato) {
            // Mostriamo il super modale!
            const valoreBonus = (traguardoAttuale / 100) * 10;
            document.getElementById("bonus-modal-value").innerText = `€ ${valoreBonus},00`;
            document.getElementById("bonus-modal").classList.add("active");

            // Salviamo che abbiamo celebrato questo traguardo per non annoiare l'utente
            await setLocalData("ultimoTraguardoCelebrato", traguardoAttuale);
        }
    }
}

function chiudiModaleBonus() {
    document.getElementById("bonus-modal").classList.remove("active");
}

