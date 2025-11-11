import { Preferences } from '@capacitor/preferences';

export type Registro = { hora: string; foto: string };
export type RegistroIncidencia = Registro & { nota: string };
export type Jornada = {
    entrada: Registro;
    salida?: Registro;
    incidencias?: RegistroIncidencia[];
};

export interface RegistroData {
    jornadas: Jornada[];
}

// ---- helpers de índice (igual que antes) ----
const INDEX_KEY = '__indice_dias__';
const KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function listDias(): Promise<string[]> {
    const { value } = await Preferences.get({ key: INDEX_KEY });
    return value ? JSON.parse(value) as string[] : [];
}

export async function addDiaAlIndice(key: string) {
    const dias = await listDias();
    if (!dias.includes(key)) {
        dias.push(key);
        dias.sort();
        await Preferences.set({ key: INDEX_KEY, value: JSON.stringify(dias) });
    }
}

// ---- migración v0 -> v1 (jornadas) ----
function normalize(raw: any): RegistroData | undefined {
    if (!raw) return undefined;

    // Nuevo formato ya OK
    if (Array.isArray(raw.jornadas)) return { jornadas: raw.jornadas as Jornada[] };

    // Formato antiguo: { entrada?, salida?, incidencias? }
    const jornadas: Jornada[] = [];
    if (raw.entrada) {
        jornadas.push({
            entrada: raw.entrada,
            salida: raw.salida,
            incidencias: raw.incidencias ?? [],
        });
    } else if (raw.salida) {
        // Raro, pero preservamos
        jornadas.push({ entrada: raw.salida, incidencias: raw.incidencias ?? [] });
    } else if (Array.isArray(raw.incidencias) && raw.incidencias.length) {
        // No había entrada/salida pero sí incidencias: crea jornada “huérfana”
        jornadas.push({ entrada: { hora: '00:00', foto: '' }, incidencias: raw.incidencias });
    }

    return { jornadas };
}

export async function getDia(key: string): Promise<RegistroData | undefined> {
    if (!KEY_REGEX.test(key)) return undefined;
    const { value } = await Preferences.get({ key });
    if (!value) return undefined;

    const raw = JSON.parse(value);
    const norm = normalize(raw);
    if (!norm) return undefined;

    // si migramos, persistimos en nuevo formato
    if (!raw.jornadas) {
        await Preferences.set({ key, value: JSON.stringify(norm) });
    }
    return norm;
}

export async function setDia(key: string, data: RegistroData): Promise<void> {
    if (!KEY_REGEX.test(key)) throw new Error('Clave inválida (YYYY-MM-DD)');
    await Preferences.set({ key, value: JSON.stringify(data) });
}

export async function removeDiasAntiguos(dias = 90) {
    const hoy = new Date();
    const indice = await listDias();
    const keep: string[] = [];
    for (const k of indice) {
        const d = new Date(k);
        const diff = (hoy.getTime() - d.getTime()) / 86400000;
        if (diff <= dias) keep.push(k);
        else await Preferences.remove({ key: k });
    }
    await Preferences.set({ key: INDEX_KEY, value: JSON.stringify(keep) });
}
