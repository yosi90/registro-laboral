import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const BASE_DIR = Directory.ExternalStorage;      // raíz del almacenamiento compartido
const BASE_PATH = 'Download/RegistroLaboral';     // subcarpeta

export async function saveDataUrl(fileName: string, dataUrl: string) {
    await Filesystem.writeFile({
        directory: BASE_DIR,
        path: `${BASE_PATH}/${fileName}`,
        data: dataUrl,         // dataURL completa: 'data:image/jpeg;base64,...'
        recursive: true
    });
    return `${BASE_PATH}/${fileName}`;     // ruta relativa guardable en JSON
}

export async function readAsDataUrl(path: string): Promise<string> {
    const { data } = await Filesystem.readFile({ directory: BASE_DIR, path });
    const ext = path.split('.').pop()?.toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'png' ? 'image/png'
            : ext === 'pdf' ? 'application/pdf'
                : 'application/octet-stream';
    return `data:${mime};base64,${data}`;
}

export async function getUri(path: string) {
    return Filesystem.getUri({ directory: BASE_DIR, path });
}

export function buildImageName(tipo: 'entrada' | 'salida' | 'incidencia', fecha: Date) {
    const iso = fecha.toISOString().replace(/[:.]/g, '-');
    return `${iso}_${tipo}.jpg`;
}

export async function ensurePublicFolder() {
    try {
        const perm = await Filesystem.checkPermissions();
        if ((perm as any).publicStorage !== 'granted') {
            await Filesystem.requestPermissions();
        }
    } catch { }
    try {
        await Filesystem.mkdir({ directory: BASE_DIR, path: BASE_PATH, recursive: true });
    } catch { }
}

export function buildPdfName(periodo: string) {
    return `informe_${periodo}.pdf`;
}

export async function fileExists(fileName: string) {
    await ensurePublicFolder();
    try {
        await Filesystem.stat({ directory: BASE_DIR, path: `${BASE_PATH}/${fileName}` });
        return true;
    } catch { return false; }
}

export async function openFile(fileName: string) {
    await ensurePublicFolder();
    const { uri } = await Filesystem.getUri({ directory: BASE_DIR, path: `${BASE_PATH}/${fileName}` });
    await Share.share({ title: fileName, url: uri });
}

export async function saveDataUrlSafe(fileName: string, dataUrl: string) {
    await ensurePublicFolder();
    const fullPath = `${BASE_PATH}/${fileName}`;
    try {
        await Filesystem.stat({ directory: BASE_DIR, path: fullPath });
        await Filesystem.deleteFile({ directory: BASE_DIR, path: fullPath });
    } catch { }
    await Filesystem.writeFile({
        directory: BASE_DIR,
        path: fullPath,
        data: dataUrl,
        recursive: true,
    });
    return fullPath;
}