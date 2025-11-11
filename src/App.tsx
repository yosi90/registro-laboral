/* @ts-nocheck */
import { useState, useRef, useEffect } from 'react';
import exifr from 'exifr';
import { jsPDF } from 'jspdf';
import { Camera, Clock, AlertCircle, FileText, Calendar, LogIn, LogOut } from 'lucide-react';
import { getDia, setDia, addDiaAlIndice, listDias } from './native/storage';
import type { RegistroData, Jornada } from './native/storage';
import { buildPdfName, fileExists, openFile, saveDataUrlSafe, readAsDataUrl, buildImageName, saveDataUrl } from './native/files';
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
    const inputRef = useRef<HTMLInputElement | null>(null);

    // Distingue si viene de la época "antigua" (dataURL) o de fichero nuevo (ruta)
    const toDataUrl = async (src: string) => {
        return src.startsWith('data:') ? src : await readAsDataUrl(src);
    };

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
                await guardarRegistro('incidencia', hora, ruta, notaIncidencia);
                setNotaIncidencia('');
                setHoraIncidencia('');
                setTipoRegistro('');
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

    const guardarIncidencia = async () => {
        if (!notaIncidencia.trim()) {
            alert('Por favor, describe la incidencia.');
            return;
        }

        inputRef.current?.click();
    };

    // Función comentada porque no está siendo utilizada actualmente
    // const completarIncidencia = async (foto: string, hora: string) => {
    //   await guardarRegistro('incidencia', hora, foto, notaIncidencia);
    //   setNotaIncidencia('');
    //   setHoraIncidencia('');
    //   setTipoRegistro('');
    // };

    const generarPDF = async (mes?: string) => {
        setCargando(true);
        try {
            const periodo = mes ?? 'completo';
            const nombreArchivo = buildPdfName(periodo);

            // Si ya existe, lo abrimos y salimos
            if (await fileExists(nombreArchivo)) {
                await openFile(nombreArchivo);
                return;
            }

            const doc = new jsPDF();

            // 1) Fechas a incluir
            const todas = await listDias();
            const fechas = todas
                .filter(k => (mes ? k.startsWith(mes) : true))
                .sort();

            if (fechas.length === 0) {
                alert('No hay registros para el período seleccionado.');
                return;
            }

            // 2) Para cada fecha, dibujamos su página
            for (let i = 0; i < fechas.length; i++) {
                const fecha = fechas[i];
                const d = await getDia(fecha);                 // <- AQUÍ está "d"
                const jornadas = (d?.jornadas ?? []) as Jornada[];

                if (i > 0) doc.addPage();
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.text(`Fecha: ${fecha}`, 10, 10);
                doc.setFont('helvetica', 'normal');

                let y = 25;                                    // <- AQUÍ está "y"

                if (jornadas.length === 0) {
                    doc.text('Sin jornadas registradas', 10, y);
                    y += 8;
                }

                for (let j = 0; j < jornadas.length; j++) {
                    const jor = jornadas[j];

                    doc.setFont('helvetica', 'bold');
                    doc.text(`Jornada ${j + 1}`, 10, y); y += 6;
                    doc.setFont('helvetica', 'normal');

                    // Entrada
                    if (jor.entrada) {
                        doc.text(`Entrada: ${jor.entrada.hora}`, 10, y); y += 5;
                        if (jor.entrada.foto) {
                            try {
                                const dataUrl = await toDataUrl(jor.entrada.foto);
                                doc.addImage(dataUrl, 'JPEG', 10, y, 50, 50); y += 55;
                            } catch { doc.text('(Error cargando imagen)', 10, y); y += 10; }
                        }
                    }

                    // Salida
                    if (jor.salida) {
                        doc.text(`Salida: ${jor.salida.hora}`, 10, y); y += 5;
                        if (jor.salida.foto) {
                            try {
                                const dataUrl = await toDataUrl(jor.salida.foto);
                                doc.addImage(dataUrl, 'JPEG', 10, y, 50, 50); y += 55;
                            } catch { doc.text('(Error cargando imagen)', 10, y); y += 10; }
                        }
                    }

                    // Incidencias
                    if (jor.incidencias?.length) {
                        doc.setFont('helvetica', 'bold');
                        doc.text('Incidencias:', 10, y); y += 5;
                        doc.setFont('helvetica', 'normal');
                        for (let k = 0; k < jor.incidencias.length; k++) {
                            const inc = jor.incidencias[k];
                            doc.text(`${k + 1}. Hora: ${inc.hora}`, 10, y); y += 5;
                            doc.text(`   Nota: ${inc.nota}`, 10, y); y += 5;
                            if (inc.foto) {
                                try {
                                    const dataUrl = await toDataUrl(inc.foto);
                                    doc.addImage(dataUrl, 'JPEG', 10, y, 50, 50); y += 55;
                                } catch { doc.text('   (Error cargando imagen)', 10, y); y += 10; }
                            }
                        }
                    }

                    y += 5; // separación entre jornadas
                }
            }

            // 3) Guardar y abrir
            const pdfDataUrl = doc.output('datauristring');
            await saveDataUrlSafe(nombreArchivo, pdfDataUrl);
            await openFile(nombreArchivo);
        } catch (err: any) {
            alert('Error generando PDF: ' + (err?.message ?? String(err)));
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
                        <div className="flex gap-3">
                            <button
                                onClick={guardarIncidencia}
                                disabled={cargando || !notaIncidencia.trim()}
                                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded-lg px-6 py-3 flex-1 font-semibold transition-colors"
                            >
                                {horaIncidencia ? 'Guardar' : 'Tomar Foto'}
                            </button>
                            <button
                                onClick={() => {
                                    setTipoRegistro('');
                                    setNotaIncidencia('');
                                    setHoraIncidencia('');
                                }}
                                className="bg-gray-600 hover:bg-gray-700 rounded-lg px-6 py-3 font-semibold transition-colors"
                            >
                                Cancelar
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

                    <ul className="space-y-2">
                        {jornadasHoy.map((j, idx) => (
                            <li key={idx} className="text-sm">
                                {/* Entrada */}
                                <div className="flex items-center gap-2">
                                    <LogIn className="w-4 h-4 text-green-400" />
                                    <span className="text-gray-300">Entrada</span>
                                    <span className="ml-auto font-mono">{j.entrada?.hora ?? '--:--:--'}</span>
                                </div>

                                {/* Salida (si existe) */}
                                {j.salida && (
                                    <div className="flex items-center gap-2 mt-1">
                                        <LogOut className="w-4 h-4 text-red-400" />
                                        <span className="text-gray-300">Salida</span>
                                        <span className="ml-auto font-mono">{j.salida.hora}</span>
                                    </div>
                                )}
                                {/* Incidencias (si hay) */}
                                {j.incidencias?.length ? (
                                    <div className="mt-1 ml-6 text-xs text-gray-400">
                                        {j.incidencias.map((inc, k) => (
                                            <div key={k}>• Incidencia {k + 1}: {inc.hora}</div>
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
                        className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 rounded-xl px-6 py-4 w-full shadow-lg transition-all flex items-center justify-center gap-3"
                    >
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