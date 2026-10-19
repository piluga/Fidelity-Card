export function numero(value) {
    if (value === null || value === '' || typeof value === 'boolean') return null;
    const n = Number(typeof value === 'string' ? value.replace(',', '.') : value);
    return Number.isFinite(n) ? n : null;
}
export function messaggi(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value).filter(([,m]) => m && typeof m === 'object' && !Array.isArray(m))
        .map(([id,m]) => ({ ...m, id, tempo: (numero(m.timestamp) || 0) * (Number(m.timestamp) < 1e11 ? 1000 : 1) }))
        .sort((a,b) => a.tempo - b.tempo || a.id.localeCompare(b.id));
}
export const testo = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
export function immagineSicura(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
    catch { return null; }
}
export function ultimiPunti(value) {
    const movimenti = messaggi(value).filter(m => m.tipo === 'transazione' || (m.tipo !== 'chat' && m.punti_caricati != null));
    return numero(movimenti.at(-1)?.punti_caricati) ?? 0;
}
