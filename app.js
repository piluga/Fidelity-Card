import { firebaseConfig } from './firebase-config.js';
import { creaClient } from './firebase-client.js';
import { numero, messaggi, testo, immagineSicura, ultimiPunti } from './dati.js';
import { preparaFoto } from './foto.js';

const $ = id => document.getElementById(id);
const SESSION_KEY = 'fidelity.auth.v2';
let generazione = 0, profilo = null, timer = null, polling = false, errori = 0;
let ricorda = false, email = '', selezione = false, invio = false, bozza = null;
let prefs = {}, letti = new Set(), nascosti = new Set(), screen = 'login-screen';
let foto = null;
const immaginiAperte = new Set();
function liberaImmagini() { immaginiAperte.forEach(url => URL.revokeObjectURL(url)); immaginiAperte.clear(); }
function leggiLocale(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function salvaLocale(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function rimuoviLocale(key) { try { localStorage.removeItem(key); } catch { /* Prosegue comunque la chiusura della sessione in memoria. */ } }
const api = creaClient(firebaseConfig, { onSession(session) {
    if (ricorda) { try { salvaLocale(SESSION_KEY, { ...session, email }); } catch { ricorda = false; } }
} });
const scope = kind => 'fidelity.v2.' + api.uid + '.' + profilo.scheda + '.' + kind;
function erroreLogin(message = '') { $('login-error').textContent = message; $('login-error').style.display = message ? 'block' : 'none'; }
function avviso(message, title = 'Avviso') { $('alert-title').textContent = title; $('alert-message').textContent = message; $('alert-modal').classList.add('active'); }
function gestisciErrore(error, gen) {
    if (gen !== generazione) return;
    if (error.code === 'SESSIONE' || error.code === 'ASSOCIAZIONE' || error.code === 'PERMESSI') {
        logout(); erroreLogin(error.message);
    } else avviso(error.message || 'Operazione non riuscita. Riprova.');
}
function naviga(id) {
    if (id !== 'login-screen' && !profilo) return;
    screen = id;
    document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.id === id));
    document.querySelectorAll('[data-screen]').forEach(el => el.classList.toggle('active', el.dataset.screen === id));
    $('bottom-nav').classList.toggle('hidden', !profilo);
    if (id === 'messages-screen') { renderMessaggi(); aggiornaBadge(); }
}
function logout() {
    generazione++; api.esci(); clearTimeout(timer); polling = false; invio = false;
    rimuoviLocale(SESSION_KEY); ricorda = false; email = ''; profilo = null; bozza = null;
    prefs = {}; letti = new Set(); nascosti = new Set(); selezione = false;
    foto = null; liberaImmagini(); $('foto-status').classList.add('hidden');
    document.querySelectorAll('.modal').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('input:not([type=checkbox]), textarea').forEach(el => { el.value = ''; el.disabled = false; });
    document.querySelectorAll('button').forEach(el => { el.disabled = false; });
    ['user-name','user-punti','user-euro','user-scheda','user-bonus','user-data'].forEach(id => { $(id).textContent = ''; });
    $('barcode').replaceChildren(); $('messages-container').replaceChildren(); $('msg-badge').classList.add('hidden');
    $('sync-status').textContent = ''; naviga('login-screen');
}
function caricaPreferenze() {
    prefs = leggiLocale(scope('preferenze'), {});
    if (!prefs || typeof prefs !== 'object') prefs = {};
    const read = leggiLocale(scope('letti'), []), hidden = leggiLocale(scope('nascosti'), []);
    letti = new Set(Array.isArray(read) ? read : []); nascosti = new Set(Array.isArray(hidden) ? hidden : []);
    $('setting-hide-name').checked = !!prefs.nascondiNome;
    $('setting-hide-avatar').checked = !!prefs.nascondiAvatar;
    $('setting-custom-name').value = testo(prefs.nomeCustom);
}
function dashboard() {
    $('user-name').textContent = prefs.nascondiNome ? 'La tua Fidelity Card' : testo(prefs.nomeCustom) || testo(profilo.nome) || 'Cliente';
    document.querySelector('.user-icon').classList.toggle('hidden', !!prefs.nascondiAvatar);
    $('user-punti').textContent = (numero(profilo.punti) ?? 0).toLocaleString('it-IT');
    const bonus = numero(profilo.bonus);
    $('user-euro').textContent = bonus === null ? 'Da verificare in negozio' : bonus.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
    $('user-bonus').textContent = ultimiPunti(profilo.messaggi).toLocaleString('it-IT');
    $('user-data').textContent = testo(profilo.dataUltimaOperazione) || '—';
    $('user-scheda').textContent = profilo.scheda;
    try { globalThis.JsBarcode($('barcode'), profilo.scheda, { format: 'CODE128', displayValue: false, width: 2, height: 65, margin: 10 }); }
    catch { $('barcode').replaceChildren(); }
    aggiornaBadge();
}
function aggiornaBadge() {
    if (!profilo) return;
    const all = messaggi(profilo.messaggi).filter(m => !nascosti.has(m.id));
    if (screen === 'messages-screen') {
        all.forEach(m => letti.add(m.id));
        try { salvaLocale(scope('letti'), [...letti]); } catch { /* Lettura valida anche senza memoria locale. */ }
    }
    const n = all.filter(m => m.mittente !== 'cliente' && !letti.has(m.id)).length;
    $('msg-badge').textContent = String(n); $('msg-badge').classList.toggle('hidden', n === 0);
}
function nodo(tag, classe, value) {
    const el = document.createElement(tag); el.className = classe; el.textContent = testo(value); return el;
}
function renderMessaggi() {
    const container = $('messages-container');
    liberaImmagini();
    const selected = new Set([...container.querySelectorAll('input:checked')].map(el => el.value));
    container.replaceChildren(); container.classList.toggle('selection-mode', selezione);
    $('btn-delete-msg').classList.toggle('hidden', !selezione);
    $('btn-select-msg').textContent = selezione ? 'Annulla' : 'Seleziona';
    const all = messaggi(profilo.messaggi).filter(m => !nascosti.has(m.id));
    if (!all.length) container.append(nodo('p', 'empty-messages', 'Nessun messaggio visibile.'));
    for (const m of all) {
        const wrapper = nodo('article','msg-wrapper','');
        const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'msg-checkbox'; check.value = m.id;
        check.checked = selected.has(m.id); check.setAttribute('aria-label','Seleziona messaggio'); wrapper.append(check);
        const bubble = nodo('div', m.tipo === 'chat' ? 'msg-bubble-chat ' + (m.mittente === 'cliente' ? 'cliente' : 'negozio') : 'msg-bubble-chat negozio', '');
        if (m.tipo === 'chat') {
            bubble.append(nodo('p','chat-text',m.testo));
            const url = immagineSicura(m.immagineUrl);
            if (url) {
                const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
                const img = document.createElement('img'); img.src = url; img.alt = 'Immagine allegata'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
                a.append(img); bubble.append(a);
            }
            if (m.immagineStorage) {
                const button = nodo('button','icon-btn-small','Mostra foto');
                button.addEventListener('click', async () => {
                    const gen = generazione; button.disabled = true;
                    try {
                        const blob = await api.leggiFoto(m.immagineStorage);
                        if (gen !== generazione || !button.isConnected) return;
                        const src = URL.createObjectURL(blob); immaginiAperte.add(src);
                        const img = document.createElement('img'); img.src = src; img.alt = 'Foto protetta';
                        button.replaceWith(img);
                    } catch (error) { if (gen === generazione && button.isConnected) { button.disabled = false; avviso(error.message); } }
                });
                bubble.append(button);
            }
        } else {
            bubble.append(nodo('strong','msg-header','Movimento punti'));
            for (const [campo,label] of Object.entries({saldo_iniziale:'Saldo iniziale',punti_caricati:'Punti caricati',punti_scaricati:'Punti utilizzati',saldo_punti:'Saldo punti',bonus:'Bonus'})) {
                if (m[campo] != null) bubble.append(nodo('p','msg-row', label + ': ' + testo(m[campo])));
            }
            if (m.testo) bubble.append(nodo('p','chat-text',m.testo));
        }
        bubble.append(nodo('small','chat-footer',testo(m.data) + ' ' + testo(m.ora)));
        wrapper.append(bubble); container.append(wrapper);
    }
}
function pianifica() { clearTimeout(timer); timer = setTimeout(aggiorna, Math.min(60000, 5000 * 2 ** errori)); }
async function aggiorna() {
    if (!profilo || polling) return;
    if (document.hidden) { pianifica(); return; }
    polling = true; const gen = generazione;
    try {
        const next = await api.profilo();
        if (gen !== generazione) return;
        if (next.scheda !== profilo.scheda) { logout(); erroreLogin('Associazione tessera aggiornata. Accedi nuovamente.'); return; }
        const changed = JSON.stringify(profilo.messaggi) !== JSON.stringify(next.messaggi);
        profilo = next; dashboard(); if (changed && screen === 'messages-screen') renderMessaggi();
        $('sync-status').textContent = ''; errori = 0;
    } catch (error) {
        if (gen !== generazione) return;
        if (['SESSIONE','ASSOCIAZIONE','PERMESSI'].includes(error.code)) { gestisciErrore(error,gen); return; }
        errori++; $('sync-status').textContent = 'Dati non aggiornati: collegamento non disponibile. Nuovo tentativo automatico.';
    } finally { if (gen === generazione) { polling = false; if (profilo) pianifica(); } }
}
async function login(saved) {
    const gen = ++generazione; $('btn-login').disabled = true; erroreLogin();
    try {
        email = saved?.email || $('login-email').value.trim();
        ricorda = saved ? true : $('remember-me').checked;
        if (saved) await api.ripristina(saved);
        else {
            if (!$('login-email').checkValidity() || !email || !$('login-password').value) throw new Error('Inserisci email e password.');
            if (!ricorda) rimuoviLocale(SESSION_KEY);
            await api.accedi(email, $('login-password').value);
        }
        const result = await api.profilo(); if (gen !== generazione) return;
        profilo = result; caricaPreferenze(); $('login-password').value = ''; dashboard(); naviga('dashboard-screen'); pianifica();
    } catch (error) { if (gen === generazione) { logout(); erroreLogin(error.message || 'Accesso non riuscito.'); } }
    finally { if (gen === generazione) $('btn-login').disabled = false; }
}
async function invia() {
    if (!profilo || invio) return;
    const input = $('chat-text-input'), message = input.value.trim() || (foto ? 'Foto allegata (protetta)' : ''); if (!message) return;
    if (message.length > 2000) { avviso('Massimo 2000 caratteri per messaggio.'); return; }
    invio = true; input.disabled = true; document.querySelector('.chat-send-btn').disabled = true;
    document.querySelector('[data-action=foto]').disabled = true; $('foto-status').disabled = true;
    const gen = generazione;
    if (!bozza || bozza.payload.testo !== message || bozza.foto !== foto) {
        const date = new Date(); bozza = { id: crypto.randomUUID(), foto, payload: { tipo:'chat', mittente:'cliente', autoreUid:api.uid,
            testo:message, data:date.toLocaleDateString('it-IT'), ora:date.toLocaleTimeString('it-IT'), timestamp:date.getTime() } };
        if (foto) bozza.payload.immagineStorage = foto.path;
    }
    try {
        if (foto && !foto.caricata) {
            const current = foto; await api.caricaFoto(current.path,current.blob);
            if (gen !== generazione) return;
            current.caricata = true;
        }
        await api.invia(bozza.id, bozza.payload); if (gen !== generazione) return;
        profilo.messaggi = { ...profilo.messaggi, [bozza.id]:bozza.payload }; bozza = null; input.value = ''; input.style.height = 'auto';
        foto = null; $('foto-status').classList.add('hidden');
        renderMessaggi(); aggiornaBadge();
    } catch (error) { gestisciErrore(error,gen); }
    finally { if (gen === generazione) {
        invio = false; input.disabled = false; document.querySelector('.chat-send-btn').disabled = false;
        document.querySelector('[data-action=foto]').disabled = false; $('foto-status').disabled = false;
    } }
}
function nascondi(tutti) {
    const ids = tutti ? messaggi(profilo.messaggi).map(m => m.id) : [...$('messages-container').querySelectorAll('input:checked')].map(el => el.value);
    if (!ids.length) { avviso('Seleziona almeno un messaggio.'); return; }
    $('confirm-message').textContent = 'Nascondere questi messaggi su questo dispositivo? Lo storico del negozio viene conservato.';
    $('confirm-modal').classList.add('active');
    const gen = generazione;
    $('btn-confirm-action').onclick = () => {
        if (gen !== generazione) return;
        const next = new Set([...nascosti,...ids]);
        try { salvaLocale(scope('nascosti'), [...next]); nascosti = next; selezione = false; renderMessaggi(); aggiornaBadge(); $('confirm-modal').classList.remove('active'); }
        catch { avviso('Impossibile salvare la preferenza su questo dispositivo.'); }
    };
}
const actions = {
    login: () => login(), logout, invia,
    seleziona: () => { selezione = !selezione; renderMessaggi(); }, nascondi: () => nascondi(false), nascondiTutti: () => nascondi(true),
    ripristinaMessaggi: () => {
        try { salvaLocale(scope('nascosti'),[]); nascosti.clear(); avviso('Messaggi nuovamente visibili.'); }
        catch { avviso('Impossibile aggiornare le preferenze su questo dispositivo.'); }
    },
    salvaPreferenze: () => {
        const next = { nascondiNome:$('setting-hide-name').checked,nascondiAvatar:$('setting-hide-avatar').checked,nomeCustom:$('setting-custom-name').value.trim().slice(0,80) };
        try { salvaLocale(scope('preferenze'),next); prefs = next; dashboard(); avviso('Preferenze salvate.'); } catch { avviso('Impossibile salvare le preferenze.'); }
    },
    password: async () => {
        const gen = generazione, button = document.querySelector('[data-action=password]'); button.disabled = true;
        try { await api.cambiaPassword(email,$('old-pwd').value,$('new-pwd').value); if (gen !== generazione) return;
            $('old-pwd').value = ''; $('new-pwd').value = ''; avviso('Password aggiornata.');
        } catch (error) { gestisciErrore(error,gen); } finally { if (gen === generazione) button.disabled = false; }
    },
    recupera: async () => {
        const address = $('login-email').value.trim(); if (!address || !$('login-email').checkValidity()) { erroreLogin('Inserisci prima la tua email.'); return; }
        const button = document.querySelector('[data-action=recupera]'), gen = generazione; button.disabled = true;
        try { await api.recuperaPassword(address); if (gen === generazione) avviso('Se l’indirizzo è registrato, riceverai le istruzioni per reimpostare la password.'); }
        catch (error) { if (gen === generazione) erroreLogin(error.message); } finally { button.disabled = false; }
    },
    foto: () => $('chat-image-input').click(),
    rimuoviFoto: () => { if (!invio) { foto = null; bozza = null; $('foto-status').classList.add('hidden'); } }
};
document.addEventListener('click', event => {
    const el = event.target.closest('[data-action],[data-screen],[data-close]'); if (!el) return;
    if (el.dataset.close) $(el.dataset.close).classList.remove('active');
    else if (el.dataset.screen) naviga(el.dataset.screen);
    else actions[el.dataset.action]?.();
});
$('login-password').addEventListener('keydown', event => { if (event.key === 'Enter' && !$('btn-login').disabled) login(); });
$('chat-text-input').addEventListener('input', event => { event.target.style.height = 'auto'; event.target.style.height = event.target.scrollHeight + 'px'; });
$('chat-image-input').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file || !profilo || invio) return;
    const gen = generazione; invio = true; document.querySelector('.chat-send-btn').disabled = true;
    try {
        const blob = await preparaFoto(file); if (gen !== generazione) return;
        foto = { blob, path:'allegati_fidelity/' + api.uid + '/' + crypto.randomUUID() + '.jpg', caricata:false };
        bozza = null; $('foto-status').textContent = 'Foto pronta: premi invia · Rimuovi foto'; $('foto-status').classList.remove('hidden');
    } catch (error) { if (gen === generazione) avviso(error.message); }
    finally { if (gen === generazione) { invio = false; document.querySelector('.chat-send-btn').disabled = false; } }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && profilo) aggiorna(); });
document.addEventListener('keydown', event => {
    if (['Enter',' '].includes(event.key) && event.target.matches('[data-screen]')) { event.preventDefault(); naviga(event.target.dataset.screen); }
});
let gesto = null;
document.addEventListener('pointerdown', event => {
    if (!event.target.closest('input,textarea,button,a')) gesto = { x:event.clientX,y:event.clientY };
});
document.addEventListener('pointerup', event => {
    if (!gesto) return;
    const dx = event.clientX - gesto.x, dy = event.clientY - gesto.y; gesto = null;
    if (!profilo || Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) / 2) return;
    const screens = ['dashboard-screen','messages-screen','settings-screen'];
    naviga(screens[Math.max(0,Math.min(2,screens.indexOf(screen) + (dx < 0 ? 1 : -1)))]);
});
document.addEventListener('pointercancel', () => { gesto = null; });

// Il vecchio salvataggio conteneva password e profili completi: non può autorizzare un accesso.
async function rimuoviArchivioLegacy() {
    await new Promise((resolve,reject) => {
        const req = indexedDB.open('FidelityAppDB',1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('appData')) req.result.createObjectStore('appData'); };
        req.onerror = () => reject(new Error('Memoria locale non disponibile.'));
        req.onblocked = () => reject(new Error('Chiudi le altre schede della vecchia app e riapri.'));
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('appData')) { db.close(); resolve(); return; }
            const tx = db.transaction('appData','readwrite'); tx.objectStore('appData').clear();
            tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(new Error('Impossibile rimuovere il vecchio accesso.')); };
        };
    });
}
$('btn-login').disabled = true;
try {
    await rimuoviArchivioLegacy();
    const saved = leggiLocale(SESSION_KEY,null); if (saved) await login(saved);
    $('btn-login').disabled = false;
} catch (error) { erroreLogin(error.message); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {
    $('sync-status').textContent = 'Installazione offline non disponibile. L’app resta utilizzabile online.';
});
