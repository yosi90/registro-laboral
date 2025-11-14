// TODO Crear botón para eliminar un registro.
// TODO Terminar la funcionalidad de las incidencias.

/* @ts-nocheck */
import { useState, useRef, useEffect } from 'react';
import exifr from 'exifr';
import { jsPDF } from 'jspdf';
import { Camera, Clock, AlertCircle, FileText, Calendar, LogIn, LogOut, X, AlertTriangle } from 'lucide-react';
import { getDia, setDia, addDiaAlIndice, listDias } from './native/storage';
import type { RegistroData, Jornada } from './native/storage';
import { buildPdfName, fileExists, openFile, saveDataUrlSafe, readAsDataUrl, buildImageName, saveDataUrl, deletePublicFile } from './native/files';
import { compressImageDataUrl } from './native/imageTools';
import { App as CapApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';

export default function RegistroLaboral() {
    function yyyy_mm_dd_local(d = new Date()) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    const mesActualLocal = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();

    const [tipoRegistro, setTipoRegistro] = useState('');
    const [jornadasHoy, setJornadasHoy] = useState<Jornada[]>([]);
    const [notaIncidencia, setNotaIncidencia] = useState('');
    const [horaIncidencia, setHoraIncidencia] = useState('');
    const [dentroTrabajo, setDentroTrabajo] = useState(false);
    const [mostrarSelectorMes, setMostrarSelectorMes] = useState(false);
    // Estado actualmente no usado; el mes se pasa directamente a generarPDF
    const [dispositivoValido, setDispositivoValido] = useState(true);
    const [cargando, setCargando] = useState(false);
    const [fotoIncidencia, setFotoIncidencia] = useState<string>('');
    const inputRef = useRef<HTMLInputElement | null>(null);

    // Duraciones
    function hms(totalSec: number) {
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    function toSec(hora: string) {
        const [h, m, s] = hora.split(':').map(n => parseInt(n || '0', 10));
        return (h * 3600) + (m * 60) + (s || 0);
    }

    // Soporte mixto (ruta o dataURL)
    const toDataUrl = async (src: string) => (
        src?.startsWith('data:') ? src : await readAsDataUrl(src)
    );


    useEffect(() => {
        // Detecta y verifica al arrancar (lo tuyo de antes)
        const esTactil = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const tieneCamara = 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices;
        if (!esTactil || !tieneCamara) setDispositivoValido(false);
        verificarEstadoHoy();

        // --- LISTENERS ---
        let appStateHandle: PluginListenerHandle | undefined;

        (async () => {
            // 👇 Espera el handle real (no la promesa)
            appStateHandle = await CapApp.addListener('appStateChange', ({ isActive }) => {
                if (isActive) verificarEstadoHoy();
            });
        })();

        const onVis = () => {
            if (document.visibilityState === 'visible') verificarEstadoHoy();
        };
        document.addEventListener('visibilitychange', onVis);

        // Limpieza correcta
        return () => {
            appStateHandle?.remove();         // 👈 ahora sí existe remove()
            document.removeEventListener('visibilitychange', onVis);
        };
    }, []);

    const verificarEstadoHoy = async () => {
        const hoy = yyyy_mm_dd_local();
        try {
            const data = await getDia(hoy);
            const jornadas = data?.jornadas ?? [];
            setJornadasHoy(jornadas);
            const ultima = jornadas[jornadas.length - 1];
            const dentro = Boolean(ultima && ultima.entrada && !ultima.salida);

            // Fallback: si está en índice pero sin data (race), mantenemos estado
            if (!data) {
                const idx = await listDias();
                if (idx.includes(hoy)) {
                    setDentroTrabajo(true);
                    return;
                }
            }
            setDentroTrabajo(dentro);
        } catch {
            setDentroTrabajo(false);
        }
    };

    const iniciarRegistro = (tipo: string) => {
        setTipoRegistro(tipo);
        inputRef.current?.click();
    };

    const mostrarFormularioIncidencia = () => {
        setTipoRegistro('incidencia');
    };

    const archivoABase64 = (file: File): Promise<string | ArrayBuffer | null> => {
        return new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result);
            reader.onerror = (err) => rej(err);
            reader.readAsDataURL(file);
        });
    };

    const validarFechaFoto = async (file: File, tipoRegistro: string) => {
        const exif: { DateTimeOriginal?: Date } = await exifr.parse(file);
        const fechaFoto = exif?.DateTimeOriginal;

        if (!fechaFoto) {
            throw new Error('La foto no contiene datos de fecha. Asegúrate de que tu cámara guarde metadatos EXIF.');
        }

        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const fechaFotoSinHora = new Date(fechaFoto); fechaFotoSinHora.setHours(0, 0, 0, 0);

        if (fechaFotoSinHora.getTime() !== hoy.getTime()) {
            throw new Error('La foto debe ser de día hoy.');
        }

        if (tipoRegistro === 'salida') {
            const hoyStr = yyyy_mm_dd_local();
            const data = await getDia(hoyStr);
            const jornadas = data?.jornadas ?? [];
            const ultima = jornadas[jornadas.length - 1];
            if (ultima?.entrada) {
                const [hE, mE] = ultima.entrada.hora.split(':').map(Number);
                const fechaEntrada = new Date(fechaFoto);
                fechaEntrada.setHours(hE, mE, 0, 0);
                if (fechaFoto <= fechaEntrada) {
                    throw new Error('La foto de salida debe ser posterior a la última entrada abierta.');
                }
            }
        }

        return fechaFoto;
    };

    const guardarRegistro = async (
        tipo: 'entrada' | 'salida' | 'incidencia',
        hora: string,
        foto: string,
        nota = ''
    ) => {
        const hoy = yyyy_mm_dd_local();
        const data: RegistroData = (await getDia(hoy)) ?? { jornadas: [] };
        const jornadas = data.jornadas;

        const ultima = jornadas[jornadas.length - 1];

        if (tipo === 'entrada') {
            // Si la última jornada está abierta, evita duplicar; abre una nueva jornada
            if (ultima && !ultima.salida) {
                // opcional: podrías avisar; aquí abrimos una nueva igualmente
            }
            jornadas.push({ entrada: { hora, foto }, incidencias: [] });
            setDentroTrabajo(true); // optimista
        } else if (tipo === 'salida') {
            // Debe cerrar la última jornada abierta
            if (!ultima || ultima.salida) {
                alert('No hay una entrada abierta para cerrar.');
                return;
            }
            ultima.salida = { hora, foto };
            setDentroTrabajo(false); // optimista
        } else if (tipo === 'incidencia') {
            // Añade a la jornada abierta; si no hay, a la última; si no, crea una nueva “huérfana”
            if (ultima) {
                (ultima.incidencias = ultima.incidencias || []).push({ hora, foto, nota });
            } else {
                jornadas.push({ entrada: { hora, foto: '' }, incidencias: [{ hora, foto, nota }] });
            }
        }

        await setDia(hoy, { jornadas });
        await addDiaAlIndice(hoy);

        alert(`${tipo.charAt(0).toUpperCase() + tipo.slice(1)} registrada a las ${hora}`);
        setTimeout(verificarEstadoHoy, 150);
    };

    const eliminarEntrada = async (jIdx: number) => {
        const hoy = yyyy_mm_dd_local();
        const data: RegistroData = (await getDia(hoy)) ?? { jornadas: [] };
        const jor = data.jornadas[jIdx];
        if (!jor) return;

        // Borramos fotos asociadas (entrada y, si quieres, también salida e incidencias si vas a eliminar toda la jornada)
        if (jor.entrada?.foto) await deletePublicFile(jor.entrada.foto);

        // Si la jornada tiene salida o incidencias, decisión de UX:
        // Para mantener coherencia, eliminamos la jornada completa
        if (jor.salida?.foto) await deletePublicFile(jor.salida.foto);
        if (jor.incidencias?.length) {
            for (const inc of jor.incidencias) if (inc.foto) await deletePublicFile(inc.foto);
        }
        data.jornadas.splice(jIdx, 1);

        await setDia(hoy, data);
        await verificarEstadoHoy(); // esto recalcula dentroTrabajo
    };

    const eliminarSalida = async (jIdx: number) => {
        const hoy = yyyy_mm_dd_local();
        const data: RegistroData = (await getDia(hoy)) ?? { jornadas: [] };
        const jor = data.jornadas[jIdx];
        if (!jor || !jor.salida) return;

        if (jor.salida.foto) await deletePublicFile(jor.salida.foto);
        delete jor.salida;

        await setDia(hoy, data);
        await verificarEstadoHoy(); // con salida borrada, quedas "dentro"
    };

    // Abre la cámara / selector de archivos para añadir foto a la incidencia
    const anadirFotoIncidencia = () => {
        // nos aseguramos de que el flujo esté en "incidencia"
        setTipoRegistro('incidencia');
        inputRef.current?.click();
    };

    // Guarda la incidencia (foto opcional)
    const registrarIncidencia = async () => {
        if (!notaIncidencia.trim()) return; // deshabilitamos el botón si no hay texto

        const hora = (horaIncidencia && horaIncidencia.length >= 5)
            ? horaIncidencia
            : new Date().toTimeString().slice(0, 8); // HH:MM:SS

        await guardarRegistro(
            'incidencia',
            hora,
            fotoIncidencia || '',             // <- foto opcional
            notaIncidencia.trim()
        );

        // Limpiar y cerrar el formulario
        setNotaIncidencia('');
        setHoraIncidencia('');
        setFotoIncidencia('');
        setTipoRegistro('');
    };

    // Cancelar (✕)
    const cancelarIncidencia = () => {
        setTipoRegistro('');
        setNotaIncidencia('');
        setHoraIncidencia('');
        setFotoIncidencia('');
    };

    const eliminarIncidencia = async (jIdx: number, k: number) => {
        const hoy = yyyy_mm_dd_local();
        const data: RegistroData = (await getDia(hoy)) ?? { jornadas: [] };
        const jor = data.jornadas[jIdx];
        if (!jor?.incidencias) return;

        const inc = jor.incidencias[k];
        if (inc?.foto) await deletePublicFile(inc.foto);

        jor.incidencias.splice(k, 1);

        // Si la jornada queda vacía (sin entrada, salida ni incidencias), elimínala
        if (!jor.entrada && !jor.salida && (!jor.incidencias || jor.incidencias.length === 0)) {
            data.jornadas.splice(jIdx, 1);
        }

        await setDia(hoy, data);
        await verificarEstadoHoy();
    };

    const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setCargando(true);

        try {
            // Validar fecha de la foto (tu función ya lo hace con EXIF)
            const fechaFoto = await validarFechaFoto(file, tipoRegistro);

            // 1) convertir a dataURL (como ya tenías)
            const dataUrlOriginal = String(await archivoABase64(file));
            // 2) (opcional) comprimir
            const dataUrl = await compressImageDataUrl(dataUrlOriginal, 1280, 0.7);
            // 3) generar nombre y guardar fichero real
            const nombre = buildImageName(tipoRegistro as 'entrada' | 'salida' | 'incidencia', fechaFoto);
            const ruta = await saveDataUrl(nombre, dataUrl);
            // 4) guardar metadata con la **ruta** (no base64)
            const hora = fechaFoto.toTimeString().slice(0, 8); // HH:MM:SS

            if (tipoRegistro === 'incidencia') {
                setHoraIncidencia(hora);
                setFotoIncidencia(ruta);     // guardamos la ruta para el "Guardar"
                setCargando(false);
                return;
            }

            await guardarRegistro(tipoRegistro as 'entrada' | 'salida', hora, ruta);
            setTipoRegistro('');
        } catch (error: any) {
            alert(`Error: ${error?.message ?? String(error)}`);
            setTipoRegistro('');
        }

        setCargando(false);
        e.target.value = '';
    };

    const generarPDF = async (mes?: string) => {
        setCargando(true);
        try {
            // ==================== HELPERS LOCALES ====================
            const renderMonth = async (month: string, isFirstPage: boolean) => {
                // Recoger días del mes
                const todas = await listDias();
                const fechas = todas.filter(k => k.startsWith(month)).sort();
                if (!fechas.length) return { bytes: 0 };

                // -------- Agregados para estadísticas --------
                let totalSec = 0;
                let diasConReg = 0;
                let jornadasCerradas = 0;
                let jornadasAbiertas = 0;
                let incidenciasTot = 0;
                let primerFichaje: string | null = null;
                let ultimoFichaje: string | null = null;

                type FotoRef = { dia: string; jIdx: number; tipo: 'entrada' | 'salida'; dataUrl: string };
                const fotosAppendix: FotoRef[] = [];

                for (const f of fechas) {
                    const d = await getDia(f);
                    const jornadas = d?.jornadas ?? [];
                    if (jornadas.length) diasConReg++;

                    for (let j = 0; j < jornadas.length; j++) {
                        const jo = jornadas[j];

                        // horas
                        if (jo.entrada?.hora && jo.salida?.hora) {
                            totalSec += Math.max(0, toSec(jo.salida.hora) - toSec(jo.entrada.hora));
                            jornadasCerradas++;
                        } else {
                            jornadasAbiertas++;
                        }

                        // incidencias
                        incidenciasTot += jo.incidencias?.length || 0;

                        // primer/último fichaje del mes
                        if (jo.entrada?.hora) {
                            const eStamp = `${f} ${jo.entrada.hora}`;
                            if (!primerFichaje || eStamp < primerFichaje) primerFichaje = eStamp;
                            if (!ultimoFichaje || eStamp > ultimoFichaje) ultimoFichaje = eStamp;
                        }
                        if (jo.salida?.hora) {
                            const sStamp = `${f} ${jo.salida.hora}`;
                            if (!primerFichaje || sStamp < primerFichaje) primerFichaje = sStamp;
                            if (!ultimoFichaje || sStamp > ultimoFichaje) ultimoFichaje = sStamp;
                        }

                        // fotos para apéndice
                        if (jo.entrada?.foto) {
                            try { fotosAppendix.push({ dia: f, jIdx: j, tipo: 'entrada', dataUrl: await toDataUrl(jo.entrada.foto) }); } catch { }
                        }
                        if (jo.salida?.foto) {
                            try { fotosAppendix.push({ dia: f, jIdx: j, tipo: 'salida', dataUrl: await toDataUrl(jo.salida.foto) }); } catch { }
                        }
                    }
                }

                // ======= PÁGINA DE ESTADÍSTICAS (SIEMPRE SOLA) =======
                if (!isFirstPage) doc.addPage();
                doc.setFontSize(16); doc.setFont('helvetica', 'bold');
                doc.text(`Informe mensual — ${month}`, 105, 15, { align: 'center' });
                doc.setFont('helvetica', 'normal'); doc.setFontSize(11);

                // Grid con gutter entre cajas
                const G = 4; // gutter
                const box = (x: number, y: number, w: number, h: number, title: string, value: string) => {
                    doc.roundedRect(x, y, w, h, 2, 2);
                    doc.setFont('helvetica', 'bold'); doc.text(title, x + 4, y + 6);
                    doc.setFont('helvetica', 'normal'); doc.text(value, x + 4, y + 12);
                };
                const H = hms(totalSec);

                // Fila 1
                const w1 = 88;
                box(10, 25, w1, 18, 'Mes', month);
                box(10 + w1 + G, 25, w1, 18, 'Horas registradas', H);

                // Fila 2 (ya tenías gutter, lo mantenemos)
                box(10, 47, 60, 18, 'Días registrados', String(diasConReg));
                box(74, 47, 60, 18, 'Jornadas', `${jornadasCerradas + jornadasAbiertas} (${jornadasCerradas} cerradas, ${jornadasAbiertas} abiertas)`);
                box(138, 47, 62, 18, 'Incidencias', String(incidenciasTot));

                // Fila 3 con gutter entre cajas (separación pedida)
                const w3 = 88;
                box(10, 69, w3, 18, 'Primer fichaje', primerFichaje ? primerFichaje.split(' ').pop()! : '—');
                box(10 + w3 + G, 69, w3, 18, 'Último fichaje', ultimoFichaje ? ultimoFichaje.split(' ').pop()! : '—');

                // ⛔ Siempre salto de página tras estadísticas
                doc.addPage();

                // ======= DÍAS DEL MES =======
                let y = 20;
                const bottom = 280;
                const ensureSpace = (need: number) => { if (y + need > bottom) { doc.addPage(); y = 20; } };

                const PAGE_W = doc.internal.pageSize.getWidth();
                const MARGIN = 10;
                const LINE_H = 6;
                const TH = 14; // thumbnail
                const rightX = PAGE_W - MARGIN - TH;

                const drawLineWithThumb = async (label: string, value: string, foto?: string) => {
                    doc.text(`${label}: ${value}`, MARGIN + 2, y);
                    let blockH = LINE_H;
                    if (foto) {
                        try {
                            const thumb = await toDataUrl(foto);
                            doc.addImage(thumb, 'JPEG', rightX, y - (TH - LINE_H), TH, TH);
                            blockH = Math.max(LINE_H, TH + 2);
                        } catch { }
                    }
                    y += blockH;
                };

                for (const f of fechas) {
                    const d = await getDia(f);
                    const jornadas = d?.jornadas ?? [];
                    if (!jornadas.length) continue;

                    ensureSpace(14);
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
                    doc.text(`Fecha: ${f}`, MARGIN, y); y += 6;
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);

                    for (let j = 0; j < jornadas.length; j++) {
                        const jo = jornadas[j];
                        ensureSpace(12);
                        doc.setFont('helvetica', 'bold'); doc.text(`Jornada ${j + 1}`, MARGIN, y); y += 5;
                        doc.setFont('helvetica', 'normal');

                        if (jo.entrada) await drawLineWithThumb('Entrada', jo.entrada.hora, jo.entrada.foto);
                        if (jo.salida) await drawLineWithThumb('Salida', jo.salida.hora, jo.salida.foto);

                        if (jo.incidencias?.length) {
                            ensureSpace(6 + jo.incidencias.length * 6);
                            doc.setFont('helvetica', 'bold'); doc.text('Incidencias:', MARGIN + 2, y); y += 6;
                            doc.setFont('helvetica', 'normal');
                            for (let k = 0; k < jo.incidencias.length; k++) {
                                const inc = jo.incidencias[k];
                                doc.text(`${k + 1}. ${inc.hora}${inc.nota ? ' — ' + inc.nota : ''}`, MARGIN + 6, y);
                                y += 6;
                            }
                        }

                        y += 3;
                    }
                    y += 3;
                }

                // ======= APÉNDICE DE FOTOS =======
                if (fotosAppendix.length) {
                    doc.addPage();
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
                    doc.text('Apéndice de fotos', 105, 15, { align: 'center' });
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
                    let ax = 10, ay = 25; const AW = 60, AH = 60; const GAP = 6;
                    const place = async (t: FotoRef) => {
                        if (ax + AW > 200) { ax = 10; ay += AH + 18; }
                        if (ay + AH > 280) { doc.addPage(); ax = 10; ay = 20; }
                        doc.text(`${t.dia} · J${t.jIdx + 1} · ${t.tipo}`, ax, ay - 3);
                        try { doc.addImage(t.dataUrl, 'JPEG', ax, ay, AW, AH); } catch { }
                        ax += AW + GAP;
                    };
                    for (const f of fotosAppendix) { await place(f); }
                }
            };

            // ==================== RENDERIZADO ====================
            const nombreArchivo = buildPdfName(mes ?? 'completo');
            if (await fileExists(nombreArchivo)) {
                await openFile(nombreArchivo);
                return;
            }

            const doc = new jsPDF();

            if (mes) {
                // ---- SOLO ESE MES ----
                await renderMonth(mes, true);
            } else {
                // ---- HISTÓRICO: todos los meses, uno por página nueva ----
                const keys = await listDias();
                const months = Array.from(new Set(keys.map(k => k.slice(0, 7)))).sort();
                let first = true;
                for (const m of months) {
                    await renderMonth(m, first);
                    first = false;
                    // Al terminar un mes, SI NO es el último, aseguramos página nueva
                    if (m !== months[months.length - 1]) doc.addPage();
                }
            }

            // Guardar + abrir
            const pdfDataUrl = doc.output('datauristring');
            await saveDataUrlSafe(nombreArchivo, pdfDataUrl);
            await openFile(nombreArchivo);

        } catch (e: any) {
            alert('Error generando PDF: ' + (e?.message ?? String(e)));
        } finally {
            setCargando(false);
            setMostrarSelectorMes(false);
        }
    };


    const obtenerMesesDisponibles = async () => {
        try {
            const keys = await listDias();
            const meses = new Set<string>();
            keys.forEach(k => { if (/^\d{4}-\d{2}-\d{2}$/.test(k)) meses.add(k.slice(0, 7)); });
            return Array.from(meses).sort().reverse();
        } catch {
            return [];
        }
    };

    const abrirSelectorMes = async () => {
        const meses = await obtenerMesesDisponibles();
        if (meses.length === 0) {
            alert('No hay registros guardados.');
            return;
        }
        setMostrarSelectorMes(true);
    };

    if (!dispositivoValido) {
        return (
            <div className="bg-gray-900 text-white min-h-screen flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                    <AlertCircle className="w-20 h-20 text-red-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold mb-4">Dispositivo No Compatible</h1>
                    <p className="text-gray-300">
                        Esta aplicación solo funciona en dispositivos móviles con pantalla táctil y cámara.
                    </p>
                    <p className="text-gray-400 mt-4 text-sm">
                        Por favor, accede desde un teléfono móvil o tablet.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white min-h-screen p-6">
            <div className="max-w-md mx-auto">
                {/* Header */}
                <div className="text-center mb-8 pt-4">
                    <Clock className="w-16 h-16 mx-auto mb-4 text-blue-400" />
                    <h1 className="text-3xl font-bold">Registro de horario</h1>
                    <p className="text-gray-400 text-sm mt-2">
                        {new Date().toLocaleDateString('es-ES', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        })}
                    </p>
                </div>

                {/* Estado actual */}
                <div className="bg-gray-800 rounded-lg p-4 mb-6 border border-gray-700">
                    <div className="flex items-center justify-center">
                        <div className={`w-3 h-3 rounded-full mr-3 ${dentroTrabajo ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="text-lg">
                            {dentroTrabajo ? 'En jornada laboral' : 'Fuera de jornada'}
                        </span>
                    </div>
                </div>

                {/* Botones principales */}
                <div className="space-y-4 mb-6">
                    {!dentroTrabajo && (
                        <button
                            onClick={() => iniciarRegistro('entrada')}
                            disabled={cargando}
                            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-600 disabled:to-gray-700 rounded-xl px-6 py-4 w-full shadow-lg transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
                        >
                            <Camera className="w-6 h-6" />
                            <span className="text-lg font-semibold">Registrar Entrada</span>
                        </button>
                    )}

                    {dentroTrabajo && (
                        <button
                            onClick={() => iniciarRegistro('salida')}
                            disabled={cargando}
                            className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 disabled:from-gray-600 disabled:to-gray-700 rounded-xl px-6 py-4 w-full shadow-lg transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
                        >
                            <Camera className="w-6 h-6" />
                            <span className="text-lg font-semibold">Registrar Salida</span>
                        </button>
                    )}

                    <button
                        onClick={mostrarFormularioIncidencia}
                        disabled={cargando || tipoRegistro === 'incidencia'}
                        className="bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-700 hover:to-orange-700 disabled:from-gray-600 disabled:to-gray-700 rounded-xl px-6 py-4 w-full shadow-lg transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-3"
                    >
                        <AlertCircle className="w-6 h-6" />
                        <span className="text-lg font-semibold">Registrar Incidencia</span>
                    </button>
                </div>

                {/* Formulario de incidencia */}
                {tipoRegistro === 'incidencia' && (
                    <div className="bg-gray-800 p-6 rounded-xl mb-6 border border-yellow-600 shadow-xl">
                        <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-yellow-500" />
                            Nueva Incidencia
                        </h3>
                        <textarea
                            value={notaIncidencia}
                            onChange={(e) => setNotaIncidencia(e.target.value)}
                            placeholder="Describe la incidencia..."
                            className="w-full mb-4 p-3 rounded-lg text-black bg-white border-2 border-gray-300 focus:border-yellow-500 focus:outline-none min-h-32"
                        />
                        {fotoIncidencia ? (
                            <div className="text-xs text-green-400 mt-1">Foto añadida</div>
                        ) : null}
                        {/* Botonera incidencia */}
                        <div className="flex flex-wrap items-center gap-3 mt-3">
                            {/* Registrar incidencia: deshabilitado si no hay texto */}
                            <button
                                onClick={registrarIncidencia}
                                disabled={!notaIncidencia.trim() || cargando}
                                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
                            >
                                Registrar incidencia
                            </button>

                            {/* Añadir foto: siempre activo, la foto es opcional */}
                            <button
                                onClick={anadirFotoIncidencia}
                                disabled={cargando}
                                className="bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1 transition-colors"
                            >
                                <Camera className="w-4 h-4" />
                                Añadir foto
                            </button>

                            {/* Cancelar: equis roja sin texto */}
                            <button
                                onClick={cancelarIncidencia}
                                className="ml-auto text-red-500 hover:text-red-400 p-1"
                                aria-label="Cancelar incidencia"
                                title="Cancelar"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                    </div>
                )}

                {/* Jornadas de hoy */}
                <div className="bg-gray-800 rounded-lg p-4 mb-6 border border-gray-700">
                    <h3 className="text-lg font-semibold mb-3">Jornadas de hoy</h3>

                    {jornadasHoy.length === 0 && (
                        <p className="text-gray-400 text-sm">Aún no hay registros hoy.</p>
                    )}

                    <ul className="space-y-3">
                        {jornadasHoy.map((j, idx) => (
                            <li key={idx} className="text-sm space-y-1">
                                {/* Entrada */}
                                <div className="flex items-center gap-2">
                                    <LogIn className="w-4 h-4 text-green-400" />
                                    <span className="text-gray-300">Entrada</span>
                                    <span className="ml-auto font-mono">{j.entrada?.hora ?? '--:--:--'}</span>
                                    <button
                                        onClick={() => eliminarEntrada(idx)}
                                        className="ml-2 w-6 h-6 flex items-center justify-center rounded-lg bg-black/40 text-red-400 hover:text-red-300"
                                        aria-label="Eliminar jornada"
                                        title="Eliminar jornada"
                                    >
                                        x
                                    </button>
                                </div>

                                {/* Salida (si existe) */}
                                {j.salida && (
                                    <div className="flex items-center gap-2">
                                        <LogOut className="w-4 h-4 text-red-400" />
                                        <span className="text-gray-300">Salida</span>
                                        <span className="ml-auto font-mono">{j.salida.hora}</span>
                                        <button
                                            onClick={() => eliminarSalida(idx)}
                                            className="ml-2 w-6 h-6 flex items-center justify-center rounded-lg bg-black/40 text-red-400 hover:text-red-300"
                                            aria-label="Eliminar salida"
                                            title="Eliminar salida"
                                        >
                                            x
                                        </button>
                                    </div>
                                )}

                                {/* Incidencias (si hay) */}
                                {j.incidencias?.length ? (
                                    <div className="space-y-1">
                                        {j.incidencias.map((inc, k) => (
                                            <div key={k} className="flex items-center gap-2">
                                                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                                                <span className="text-gray-300">Incidencia {k + 1}</span>
                                                <span className="ml-auto font-mono">{inc.hora}</span>
                                                <button
                                                    onClick={() => eliminarIncidencia(idx, k)}
                                                    className="ml-2 w-6 h-6 flex items-center justify-center rounded-lg bg-black/40 text-red-400 hover:text-red-300"
                                                    aria-label="Eliminar incidencia"
                                                    title="Eliminar incidencia"
                                                >
                                                    x
                                                </button>
                                            </div>

                                        ))}
                                    </div>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Input oculto de archivo */}
                <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    ref={inputRef}
                    onChange={onFileChange}
                />

                {/* Botón de informe */}
                <div className="pt-6 border-t border-gray-700">
                    <button
                        onClick={abrirSelectorMes}
                        disabled={cargando}
                        className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 disabled:from-gray-600 disabled:to-gray-700 rounded-xl px-6 py-4 w-full shadow-lg transition-all flex items-center justify-center gap-3">
                        <FileText className="w-6 h-6" />
                        <span className="text-lg font-semibold">Generar Informe PDF</span>
                    </button>
                </div>

                {/* Modal selector de mes */}
                {mostrarSelectorMes && (
                    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
                        <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full border border-gray-700">
                            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                <Calendar className="w-5 h-5" />
                                Seleccionar Período
                            </h3>
                            <button
                                onClick={() => generarPDF()}
                                className="bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-3 w-full mb-3 transition-colors"
                            >
                                Todos los registros
                            </button>
                            <button
                                onClick={() => generarPDF(mesActualLocal)}
                                className="bg-green-600 hover:bg-green-700 rounded-lg px-4 py-3 w-full mb-4 transition-colors"
                            >
                                Mes actual
                            </button>
                            <button
                                onClick={() => setMostrarSelectorMes(false)}
                                className="bg-gray-600 hover:bg-gray-700 rounded-lg px-4 py-3 w-full transition-colors"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}

                {/* Indicador de carga */}
                {cargando && (
                    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
                        <div className="bg-gray-800 rounded-xl p-6 text-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                            <p className="text-lg">Procesando...</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}