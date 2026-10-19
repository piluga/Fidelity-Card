(() => {
    const error = document.getElementById('login-error');
    const fail = text => { error.textContent = text; error.style.display = 'block'; document.getElementById('btn-login').disabled = true; };
    if (location.protocol === 'file:') { fail('Per avviare dal PC usa Avvia Fidelity.bat. Per il telefono pubblica il portale su HTTPS.'); return; }
    if (!window.isSecureContext) { fail('Apri il portale tramite HTTPS per accedere in sicurezza. Per la prova locale usa Avvia Fidelity.bat.'); return; }
    const link = document.createElement('link'); link.rel = 'manifest'; link.href = './manifest.json'; document.head.append(link);
    import('./app.js').catch(() => fail('Avvio non riuscito. Controlla che tutti i file della nuova versione siano presenti e ricarica.'));
})();
