export async function blobToDataUrl(blob: Blob): Promise<string> {
    return await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(blob);
    });
}

export async function compressImageDataUrl(dataUrl: string, maxW = 1280, quality = 0.7): Promise<string> {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const ratio = img.width / img.height;
    const w = Math.min(img.width, maxW);
    const h = Math.round(w / ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
}
