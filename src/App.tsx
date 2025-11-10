/* @ts-nocheck */
import { useState, useRef, useEffect } from 'react';
import exifr from 'exifr';
import { jsPDF } from 'jspdf';
import { Camera, Clock, AlertCircle, FileText, Calendar } from 'lucide-react';

export default function RegistroLaboral() {

    // 🔧 Fallback de window.storage si no existe
    if (!window.storage) {
        window.storage = {
            async get(key) {
                const value = localStorage.getItem(key);
                return value ? { value } : null;
            },
            async set(key, value) {
                localStorage.setItem(key, value);
            },
            async list() {
                return { keys: Object.keys(localStorage) };
            }
        };
    }

    const [tipoRegistro, setTipoRegistro] = useState('');
    const [notaIncidencia, setNotaIncidencia] = useState('');
    const [horaIncidencia, setHoraIncidencia] = useState('');
    const [dentroTrabajo, setDentroTrabajo] = useState(false);
    const [mostrarSelectorMes, setMostrarSelectorMes] = useState(false);
    // Estado actualmente no usado; el mes se pasa directamente a generarPDF
    const [dispositivoValido, setDispositivoValido] = useState(true);
    const [cargando, setCargando] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        // Detectar si es dispositivo táctil con cámara
        const esTactil = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const tieneCamara = 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices;

        if (!esTactil || !tieneCamara) {
            setDispositivoValido(false);
        }

        // Verificar estado del día actual
        verificarEstadoHoy();
    }, []);

    const verificarEstadoHoy = async () => {
        const hoy = new Date().toISOString().slice(0, 10);
        try {
            const result = await window.storage.get(hoy);
            if (result) {
                const data = JSON.parse(result.value);
                setDentroTrabajo(data.entrada && !data.salida);
            }
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

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const fechaFotoSinHora = new Date(fechaFoto);
        fechaFotoSinHora.setHours(0, 0, 0, 0);

        // Validar que la foto sea del día actual
        if (fechaFotoSinHora.getTime() !== hoy.getTime()) {
            throw new Error('La foto debe ser del día actual.');
        }

        // Si es salida, validar que sea posterior a la entrada
        if (tipoRegistro === 'salida') {
            const hoyStr = new Date().toISOString().slice(0, 10);
            const result = await window.storage.get(hoyStr);

            if (result) {
                const data = JSON.parse(result.value);
                if (data.entrada) {
                    const [horaE, minE] = data.entrada.hora.split(':').map(Number);
                    const fechaEntrada = new Date(fechaFoto);
                    fechaEntrada.setHours(horaE, minE, 0, 0);

                    if (fechaFoto <= fechaEntrada) {
                        throw new Error('La foto de salida debe ser posterior a la hora de entrada.');
                    }
                }
            }
        }

        return fechaFoto;
    };

    const guardarRegistro = async (tipo: 'entrada' | 'salida' | 'incidencia', hora: string, foto: string, nota = '') => {
        const hoy = new Date().toISOString().slice(0, 10);
        type Registro = {
            hora: string;
            foto: string;
        };

        type RegistroIncidencia = Registro & {
            nota: string;
        };

        interface RegistroData {
            entrada?: Registro;
            salida?: Registro;
            incidencias?: RegistroIncidencia[];
        }

        let data: RegistroData = {};

        try {
            const result: { value: string } = await window.storage.get(hoy);
            if (result) {
                data = JSON.parse(result.value) as RegistroData;
            }
        } catch {
            data = {};
        }

        if (tipo === 'incidencia') {
            data.incidencias = data.incidencias || [];
            data.incidencias.push({ hora, foto, nota });
        } else if (tipo === 'entrada') {
            data.entrada = { hora, foto };
        } else if (tipo === 'salida') {
            data.salida = { hora, foto };
        }

        await window.storage.set(hoy, JSON.stringify(data));
        alert(`${tipo.charAt(0).toUpperCase() + tipo.slice(1)} registrada a las ${hora}`);

        await verificarEstadoHoy();
    };

    const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setCargando(true);

        try {
            // Validar fecha de la foto
            const fechaFoto = await validarFechaFoto(file, tipoRegistro);

            const base64 = String(await archivoABase64(file));
            const hora = fechaFoto.toTimeString().slice(0, 5);

            if (tipoRegistro === 'incidencia') {
                setHoraIncidencia(hora);
                // Para incidencias, esperamos a que el usuario complete el formulario
                setCargando(false);
                return;
            }

            await guardarRegistro(tipoRegistro as 'entrada' | 'salida', hora, base64);
            setTipoRegistro('');
        } catch (error: Error | unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            alert(`Error: ${errorMessage}`);
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
        const doc = new jsPDF();

        try {
            const result = await window.storage.list();
            const fechas = result.keys
                .filter((key: string) => {
                    if (mes) {
                        return key.startsWith(mes);
                    }
                    return true;
                })
                .sort();

            if (fechas.length === 0) {
                alert('No hay registros para el período seleccionado.');
                setCargando(false);
                return;
            }

            for (let i = 0; i < fechas.length; i++) {
                const fecha = fechas[i];
                const result = await window.storage.get(fecha);
                const d = JSON.parse(result.value);

                if (i > 0) doc.addPage();
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.text(`Fecha: ${fecha}`, 10, 10);
                doc.setFont('helvetica', 'normal');

                let y = 25;

                if (d.entrada) {
                    doc.setFontSize(12);
                    doc.text(`Entrada: ${d.entrada.hora}`, 10, y);
                    y += 5;
                    if (d.entrada.foto) {
                        try {
                            doc.addImage(d.entrada.foto, 'JPEG', 10, y, 50, 50);
                            y += 55;
                        } catch {
                            doc.text('(Error cargando imagen)', 10, y);
                            y += 10;
                        }
                    }
                }

                if (d.salida) {
                    doc.text(`Salida: ${d.salida.hora}`, 10, y);
                    y += 5;
                    if (d.salida.foto) {
                        try {
                            doc.addImage(d.salida.foto, 'JPEG', 10, y, 50, 50);
                            y += 55;
                        } catch {
                            doc.text('(Error cargando imagen)', 10, y);
                            y += 10;
                        }
                    }
                }

                if (d.incidencias && d.incidencias.length > 0) {
                    doc.setFont('helvetica', 'bold');
                    doc.text('Incidencias:', 10, y);
                    doc.setFont('helvetica', 'normal');
                    y += 5;

                    d.incidencias.forEach((inc: { hora: string; nota: string; foto?: string }, idx: number) => {
                        doc.text(`${idx + 1}. Hora: ${inc.hora}`, 10, y);
                        y += 5;
                        doc.text(`   Nota: ${inc.nota}`, 10, y);
                        y += 5;
                        if (inc.foto) {
                            try {
                                doc.addImage(inc.foto, 'JPEG', 10, y, 50, 50);
                                y += 55;
                            } catch {
                                doc.text('   (Error cargando imagen)', 10, y);
                                y += 10;
                            }
                        }
                    });
                }
            }

            const nombreArchivo = mes
                ? `registro_laboral_${mes}.pdf`
                : 'registro_laboral_completo.pdf';

            doc.save(nombreArchivo);
        } catch (error: Error | unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            alert('Error generando PDF: ' + errorMessage);
        }

        setCargando(false);
        setMostrarSelectorMes(false);
    };

    const obtenerMesesDisponibles = async () => {
        try {
            const result = await window.storage.list();
            const meses = new Set();

            result.keys.forEach((key: string) => {
                if (key.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    meses.add(key.slice(0, 7));
                }
            });

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
                                onClick={() => generarPDF(new Date().toISOString().slice(0, 7))}
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