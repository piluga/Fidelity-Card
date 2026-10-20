export class ErroreFirebase extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

// La UI conserva solo il refresh token, esclusivamente con consenso «Resta collegato».
export function creaClient(config, { fetchImpl = globalThis.fetch.bind(globalThis), now = Date.now, timeout = 15000, onSession = () => {} } = {}) {
    let sessione = null, generazione = 0, rinnovo = null;
    const pendenti = new Set();
    const configurato = (() => {
        try {
            const url = new URL(config.databaseURL);
            return Boolean(config.apiKey?.trim()) && url.protocol === 'https:' &&
                /\.(firebasedatabase\.app|firebaseio\.com)$/.test(url.hostname) &&
                !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
        } catch { return false; }
    })();
    const erroreSessione = () => new ErroreFirebase('SESSIONE', 'Sessione terminata. Accedi nuovamente.');
    function esci() {
        generazione++; sessione = null; rinnovo = null;
        pendenti.forEach(controller => controller.abort()); pendenti.clear();
    }
    async function richiesta(url, init = {}, signal, formato = 'json', durata = timeout) {
        const controller = new AbortController();
        pendenti.add(controller);
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        const timer = setTimeout(abort, durata);
        try {
            const response = await fetchImpl(url, { ...init, signal: controller.signal,
                cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
            if (formato === 'blob' && response.ok) {
                const blob = await response.blob();
                if (blob.size > 5 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(blob.type))
                    throw new ErroreFirebase('FOTO', 'Immagine non valida.');
                return blob;
            }
            let data;
            try { data = await response.json(); }
            catch (error) {
                if (controller.signal.aborted) throw error;
                throw new ErroreFirebase('RISPOSTA', 'Risposta del servizio non valida. Riprova.');
            }
            if (!response.ok || data?.error) {
                const code = data?.error?.message || '';
                if (/INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_EMAIL/.test(code))
                    throw new ErroreFirebase('CREDENZIALI', 'Email o password non valide.');
                if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND|INVALID_ID_TOKEN/.test(code))
                    throw erroreSessione();
                if (response.status === 429 || /TOO_MANY_ATTEMPTS/.test(code))
                    throw new ErroreFirebase('LIMITE', 'Troppi tentativi. Attendi prima di riprovare.');
                if (response.status === 401 || response.status === 403)
                    throw new ErroreFirebase('PERMESSI', 'Accesso ai dati non autorizzato. Verifica i permessi dell’account.');
                if (/OPERATION_NOT_ALLOWED|API_KEY_INVALID|PROJECT_NOT_FOUND/.test(code))
                    throw new ErroreFirebase('CONFIG', 'Accesso Firebase non configurato. Contatta chi gestisce l’app.');
                throw new ErroreFirebase('SERVIZIO', 'Servizio non disponibile. Riprova più tardi.');
            }
            return data;
        } catch (error) {
            if (error instanceof ErroreFirebase) throw error;
            if (signal?.aborted) throw new DOMException('Richiesta annullata', 'AbortError');
            throw new ErroreFirebase('RETE', 'Collegamento non disponibile o scaduto. Controlla la connessione e riprova.');
        } finally {
            clearTimeout(timer); pendenti.delete(controller); signal?.removeEventListener('abort', abort);
        }
    }
    function salva(data, gen, refresh = false) {
        if (generazione !== gen) throw erroreSessione();
        const idToken = refresh ? data.id_token : data.idToken;
        const refreshToken = refresh ? data.refresh_token : data.refreshToken;
        const uid = refresh ? data.user_id : data.localId;
        const durata = Number(refresh ? data.expires_in : data.expiresIn);
        if (!idToken || !refreshToken || !uid || !Number.isFinite(durata) || durata <= 0)
            throw new ErroreFirebase('RISPOSTA', 'Sessione Firebase non valida.');
        if (refresh && uid !== sessione?.uid) throw erroreSessione();
        sessione = { idToken, refreshToken, uid, expiresAt: now() + durata * 1000 };
        onSession({ uid, refreshToken });
    }
    async function accedi(email, password) {
        esci();
        if (!configurato) throw new ErroreFirebase('CONFIG', 'Configurazione Firebase da completare.');
        const gen = generazione;
        const data = await richiesta('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(config.apiKey), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true })
        });
        salva(data, gen);
        return { uid: sessione.uid };
    }
    async function token() {
        if (!sessione) throw erroreSessione();
        if (now() < sessione.expiresAt - 60000) return sessione.idToken;
        if (!rinnovo) {
            const gen = generazione;
            rinnovo = (async () => {
                try {
                    const data = await richiesta('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(config.apiKey), {
                        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: sessione.refreshToken }).toString()
                    });
                    salva(data, gen, true);
                } catch (error) {
                    if (error.code === 'SESSIONE' && gen === generazione) esci();
                    throw error;
                } finally { if (gen === generazione) rinnovo = null; }
            })();
        }
        await rinnovo;
        if (!sessione) throw erroreSessione();
        return sessione.idToken;
    }
    const key = value => {
        if (typeof value !== 'string' || !value || /[.#$\[\]\/\x00-\x1f\x7f]/.test(value) || value.length > 128)
            throw new ErroreFirebase('ASSOCIAZIONE', 'Tessera non associata. Contatta il negozio.');
        return encodeURIComponent(value);
    };
    async function database(path, init = {}) {
        const gen = generazione, idToken = await token();
        if (gen !== generazione) throw erroreSessione();
        const url = new URL(path + '.json', new URL('/', config.databaseURL));
        url.searchParams.set('auth', idToken);
        const result = await richiesta(url.href, init);
        if (gen !== generazione) throw erroreSessione();
        return result;
    }
    async function ripristina(saved) {
        esci();
        key(saved?.uid);
        if (typeof saved.refreshToken !== 'string' || !saved.refreshToken) throw erroreSessione();
        sessione = { uid: saved.uid, refreshToken: saved.refreshToken, expiresAt: 0 };
        await token();
        return { uid: sessione.uid };
    }
    async function tessera() {
        if (!sessione) throw erroreSessione();
        const id = await database('associazioni_clienti/' + key(sessione.uid));
        key(id);
        return id;
    }
    async function profilo() {
        const scheda = await tessera();
        // Nessuna lettura del record completo: esclude password, telefono e dati interni.
        const campi = ['nome', 'punti', 'bonus', 'dataUltimaOperazione', 'messaggi'];
        const values = await Promise.all(campi.map(c => database('clienti/' + key(scheda) + '/' + c)));
        if (values.every(v => v === null)) throw new ErroreFirebase('TESSERA', 'Tessera non disponibile. Contatta il negozio.');
        // FIDELITY_ELIMINA_CLIENTE_SYNC_V1: preferenze private per UID, mai messaggi originali.
        // Senza regole dedicate NON bloccare login, lettura punti e messaggi.
        let eliminati = {}, eliminazioneDisponibile = true;
        try {
            const result = await database('preferenze_clienti/' + key(sessione.uid) + '/messaggi_eliminati');
            if (result !== null && (typeof result !== 'object' || Array.isArray(result)))
                throw new ErroreFirebase('DATI', 'Preferenze messaggi non valide.');
            eliminati = result ?? {};
        } catch (error) {
            if (error.code !== 'PERMESSI') throw error;
            eliminazioneDisponibile = false;
        }
        return { scheda, ...Object.fromEntries(campi.map((c,i) => [c,values[i]])),
            messaggiEliminati: eliminati, eliminazioneDisponibile };
    }
    async function eliminaMessaggi(ids) {
        if (!sessione) throw erroreSessione();
        if (!Array.isArray(ids) || !ids.length || ids.length > 100 ||
            !ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128))
            throw new ErroreFirebase('MESSAGGIO', 'Selezione non valida (massimo 100 messaggi).');
        // Scrive solo marker privati di eliminazione; NON effettua DELETE sui messaggi.
        // Singoli PUT indipendenti evitano la perdita di eliminazioni simultanee di due device.
        const unici = [...new Set(ids)];
        // Piccoli gruppi paralleli: non bloccare la UI per decine di richieste in serie.
        for (let i = 0; i < unici.length; i += 5) {
            const risultati = await Promise.allSettled(unici.slice(i, i + 5).map(id =>
                database('preferenze_clienti/' + key(sessione.uid) + '/messaggi_eliminati/' + key(id), {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'true'
                })
            ));
            const errore = risultati.find(result => result.status === 'rejected');
            if (errore) throw errore.reason;
        }
        return true;
    }
    async function invia(id, messaggio) {
        const scheda = await tessera();
        if (messaggio.autoreUid !== sessione?.uid || messaggio.tipo !== 'chat' || messaggio.mittente !== 'cliente' ||
            typeof messaggio.testo !== 'string' || !messaggio.testo.trim() || messaggio.testo.length > 2000)
            throw new ErroreFirebase('MESSAGGIO', 'Messaggio non valido (massimo 2000 caratteri).');
        if (messaggio.immagineStorage) percorsoFoto(messaggio.immagineStorage);
        return database('clienti/' + key(scheda) + '/messaggi/' + key(id), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(messaggio)
        });
    }
    function percorsoFoto(path) {
        if (!sessione || typeof path !== 'string' || !path.startsWith('allegati_fidelity/' + sessione.uid + '/') ||
            !/^[a-zA-Z0-9_-]+\.jpg$/.test(path.split('/')[2] || '') || path.split('/').length !== 3)
            throw new ErroreFirebase('FOTO', 'Allegato non autorizzato.');
        return path;
    }
    function storageURL() {
        if (!/^[a-zA-Z0-9.-]+$/.test(config.storageBucket || '')) throw new ErroreFirebase('FOTO', 'Spazio foto da configurare.');
        return 'https://firebasestorage.googleapis.com/v0/b/' + encodeURIComponent(config.storageBucket) + '/o';
    }
    async function storageRequest(url, init, formato = 'json') {
        const gen = generazione, idToken = await token();
        if (gen !== generazione) throw erroreSessione();
        try {
            const result = await richiesta(url, { ...init, headers: { ...init.headers, Authorization: 'Firebase ' + idToken } }, undefined, formato, 60000);
            if (gen !== generazione) throw erroreSessione();
            return result;
        } catch (error) {
            if (error.code === 'PERMESSI' || error.code === 'SERVIZIO')
                throw new ErroreFirebase('FOTO', 'Foto non disponibile: verificare attivazione e permessi dello spazio protetto.');
            throw error;
        }
    }
    async function caricaFoto(path, blob) {
        percorsoFoto(path);
        if (!(blob instanceof Blob) || blob.type !== 'image/jpeg' || blob.size === 0 || blob.size > 5 * 1024 * 1024)
            throw new ErroreFirebase('FOTO', 'Formato o dimensione foto non validi (massimo 5 MB).');
        const boundary = crypto.randomUUID();
        const metadata = { name:path, contentType:blob.type, cacheControl:'private, no-store' };
        const body = new Blob([
            '--' + boundary + '\r\nContent-Type: application/json; charset=utf-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n',
            '--' + boundary + '\r\nContent-Type: image/jpeg\r\n\r\n', blob, '\r\n--' + boundary + '--'
        ]);
        let result;
        try {
            result = await storageRequest(storageURL() + '?name=' + encodeURIComponent(path), {
                method:'POST', headers:{ 'Content-Type':'multipart/related; boundary=' + boundary, 'X-Goog-Upload-Protocol':'multipart' }, body
            });
        } catch (error) {
            // Un upload concluso con risposta persa non va duplicato né sovrascritto.
            // Ogni foto ha un percorso casuale, mantenuto per i tentativi della stessa bozza.
            try { const existing = await leggiFoto(path); if (existing.size === blob.size) return path; } catch { /* Mantiene l'errore originale. */ }
            throw error;
        }
        if (result.name !== path || result.bucket !== config.storageBucket) throw new ErroreFirebase('FOTO', 'Risposta caricamento non valida.');
        return path;
    }
    async function leggiFoto(path) {
        percorsoFoto(path);
        return storageRequest(storageURL() + '/' + encodeURIComponent(path) + '?alt=media', {}, 'blob');
    }
    async function cambiaPassword(email, precedente, nuova) {
        if (nuova.length < 6) throw new ErroreFirebase('PASSWORD', 'Usa almeno 6 caratteri per la nuova password.');
        const gen = generazione, uid = sessione?.uid;
        const authURL = action => 'https://identitytoolkit.googleapis.com/v1/accounts:' + action + '?key=' + encodeURIComponent(config.apiKey);
        const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const verificata = await richiesta(authURL('signInWithPassword'), post({ email, password: precedente, returnSecureToken: true }));
        if (gen !== generazione || verificata.localId !== uid) throw erroreSessione();
        const result = await richiesta(authURL('update'), post({ idToken: verificata.idToken, password: nuova, returnSecureToken: true }));
        if (result.localId !== uid) throw erroreSessione();
        salva(result, gen);
    }
    async function recuperaPassword(email) {
        await richiesta('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=' + encodeURIComponent(config.apiKey), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'PASSWORD_RESET', email })
        });
    }
    return { configurato, accedi, ripristina, esci, profilo, invia, eliminaMessaggi, cambiaPassword, recuperaPassword, caricaFoto, leggiFoto,
        get uid() { return sessione?.uid; }, get autenticato() { return Boolean(sessione); } };
}
