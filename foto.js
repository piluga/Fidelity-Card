// Ricodifica locale: niente SVG/HTML e niente metadati EXIF/GPS nel file inviato.
export async function preparaFoto(file) {
    if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)
        throw new Error('Scegli una foto JPEG, PNG o WebP fino a 10 MB.');
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error();
        const scale = Math.min(1,1920 / Math.max(bitmap.width,bitmap.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',0.85));
        if (!blob || blob.size > 5 * 1024 * 1024) throw new Error();
        return blob;
    } catch { throw new Error('Foto non leggibile o troppo grande. Scegli un’altra immagine.'); }
    finally { bitmap?.close(); }
}
