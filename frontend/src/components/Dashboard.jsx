import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  LogOut, Send, MessageCircle, Terminal, Clock, Timer, Upload,
  Users, Settings, LayoutDashboard, ShieldCheck, X, Menu,
  Loader2, Sparkles, FileText, Trash2, Smartphone, CheckCheck,
  Copy, Check, Video, Phone, MoreVertical, Paperclip, Smile,
  Mic, Wifi, Battery, Sun, Moon, FlaskConical, Zap, RefreshCw,
  Server, Cpu, CheckCircle2, AlertCircle, UserPlus, UserMinus,
  Search, Plus, Pencil, Save, Download, RotateCcw, AlertTriangle, Database,
  Calendar, ExternalLink
} from 'lucide-react';
import './Dashboard.css';

const API_BASE = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? 'https://bot-whatsapp-mensajes-automatico.onrender.com' : 'http://localhost:3000');
axios.defaults.withCredentials = true;

const PLANTILLAS = [
  { 
    id: 'rec',
    nombre: "Recordatorio de Pago", 
    texto: "Estimado/a cliente, le recordamos cordialmente que su cuenta presenta saldo pendiente. Por favor responda con su comprobante para actualizar su estado a la brevedad." 
  },
  { 
    id: 'abo',
    nombre: "Confirmación de Abono", 
    texto: "Estimado cliente, hemos registrado con éxito su abono a la cuenta. Su saldo ha sido actualizado en nuestro sistema. ¡Muchas gracias por su puntualidad!" 
  },
  { 
    id: 'ven',
    nombre: "Aviso de Vencimiento", 
    texto: "Aviso importante de cobranza: Su ciclo de facturación vence en las próximas 24 horas. Evite recargos regularizando su balance a la brevedad." 
  },
];

const VARIABLES = [
  { tag: "{{nombre}}", label: "Nombre", desc: "Nombre del cliente" },
  { tag: "{{monto}}", label: "Monto", desc: "Monto a cobrar" },
  { tag: "{{vencimiento}}", label: "Vencimiento", desc: "Fecha de vencimiento" },
  { tag: "{{enlace_pago}}", label: "Enlace de Pago", desc: "Link para pagar" }
];

const PRESETS_DELAY = [
  { label: "2s (Rápido)", val: 2 },
  { label: "4s (Recomendado)", val: 4 },
  { label: "8s (Seguro)", val: 8 },
  { label: "15s (Antispam)", val: 15 },
];

function normalizeClients(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(client => client && typeof client === 'object' && !Array.isArray(client))
    .map(client => ({
      ...client,
      id: typeof client.id === 'string' ? client.id : String(client.id ?? ''),
      nombre: typeof client.nombre === 'string' ? client.nombre : '',
      numero: typeof client.numero === 'string' ? client.numero : String(client.numero ?? ''),
      nota: typeof client.nota === 'string' ? client.nota : ''
    }))
    .filter(client => client.id && client.numero);
}

function normalizeTemplates(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(template => template && typeof template === 'object' && !Array.isArray(template))
    .map((template, index) => ({
      id: typeof template.id === 'string' ? template.id : `template-${index}`,
      nombre: typeof template.nombre === 'string' ? template.nombre : 'Plantilla',
      texto: typeof template.texto === 'string' ? template.texto : ''
    }));
}

function normalizeUsers(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(user => user && typeof user === 'object' && !Array.isArray(user))
    .map(user => ({
      ...user,
      name: typeof user.name === 'string' ? user.name : '',
      email: typeof user.email === 'string' ? user.email : '',
      role: typeof user.role === 'string' ? user.role : 'USER'
    }));
}

function normalizeBackups(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(backup => backup && typeof backup === 'object' && !Array.isArray(backup))
    .filter(backup => typeof backup.folder === 'string');
}

function normalizeQrValue(value) {
  if (typeof value !== 'string') return '';

  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('data:image/')) return '';

  const [header, payload] = trimmed.split(',');
  if (!header || !payload || !header.includes(';base64')) return '';

  return trimmed;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('DISCONNECTED');
  const [qr, setQr] = useState('');
  const [logs, setLogs] = useState([]);
  const [numbers, setNumbers] = useState('18095550123');
  const [message, setMessage] = useState("");
  const [isEditingMessage, setIsEditingMessage] = useState(false);
    
  const [loading, setLoading] = useState(false);
  const [delay, setDelay] = useState(4);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [horaActual, setHoraActual] = useState('12:00');
  const [userRole, setUserRole] = useState('USER');
  const [userEmail, setUserEmail] = useState('');

  // Estados para la Suite de Pruebas y Diagnóstico Backend
  const [testNumber, setTestNumber] = useState('18095550123');
  const [testMessage, setTestMessage] = useState('Mensaje de prueba desde Gateway de Pagos y Cobranzas WhatsApp.');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const [checkLoading, setCheckLoading] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  const [healthData, setHealthData] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [apiPing, setApiPing] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [restartingClient, setRestartingClient] = useState(false);

  // Estados para Directorio de Clientes (CRUD)
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [newClientNombre, setNewClientNombre] = useState('');
  const [newClientNumero, setNewClientNumero] = useState('');
  const [newClientNota, setNewClientNota] = useState('');
  const [newClientEstado, setNewClientEstado] = useState('PENDIENTE'); // 'PENDIENTE' | 'VENCIDO' | 'PAGADO'
  const [clientFilterStatus, setClientFilterStatus] = useState('ALL'); // 'ALL' | 'PENDIENTE' | 'VENCIDO' | 'PAGADO'
  const [editingClientId, setEditingClientId] = useState(null);
  const [clientAdding, setClientAdding] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clientViewMode, setClientViewMode] = useState('directory'); // 'directory' | 'bulk'

  // Estados para Envío Directo a un Cliente específico (Modal y Acción)
  const [directSendClient, setDirectSendClient] = useState(null);
  const [directSendMessage, setDirectSendMessage] = useState('');
  const [directSending, setDirectSending] = useState(false);

  // Estados para Modal de Envío a Todos los Clientes (1 Clic)
  const [sendAllModalOpen, setSendAllModalOpen] = useState(false);
  const [sendAllMessage, setSendAllMessage] = useState('');
  const [sendAllSending, setSendAllSending] = useState(false);
  const [sendAllAudience, setSendAllAudience] = useState('ALL'); // 'ALL' | 'PENDIENTE' | 'VENCIDO'
  const [sendAllMode, setSendAllMode] = useState('NOW'); // 'NOW' | 'SCHEDULE'
  const [sendAllScheduleTime, setSendAllScheduleTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [sendAllTab, setSendAllTab] = useState('compose'); // 'compose' | 'qr' | 'wame'

  // Estados para Programaciones del Scheduler
  const [schedules, setSchedules] = useState([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);

  // Estados para Plantillas
  const [plantillas, setPlantillas] = useState([]);

  // Estados para Usuarios Plataforma (Admin)
  const [platformUsers, setPlatformUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [backups, setBackups] = useState([]);
  const [backupLoading, setBackupLoading] = useState(false);

  // Notificaciones Toast flotantes
  const [toast, setToast] = useState(null);

  // Auto-cierre de sesión por inactividad a los 30 minutos sin movimiento (Protege privacidad y libera memoria)
  const INACTIVITY_TIMEOUT_SECONDS = 1800; // 30 minutos
  const [autoResetEnabled, setAutoResetEnabled] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(INACTIVITY_TIMEOUT_SECONDS);
  const lastActivityRef = useRef(Date.now());

  const loadingRef = useRef(loading);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  const logsEndRef = useRef(null);
  const socketRef = useRef(null);
  const fileInputRef = useRef(null);
  const fileInputClientsRef = useRef(null);
  const fileInputBackupRef = useRef(null);
  const textareaRef = useRef(null);

  const showToast = (tipo, mensaje) => {
    setToast({ tipo, mensaje });
    setTimeout(() => setToast(null), 3800);
  };

  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setHoraActual(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 30000);
    return () => clearInterval(timer);
  }, []);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rawText = typeof ev.target.result === 'string' ? ev.target.result : '';
      const nums = rawText.split(/[\n,;]+/).map(n => n.trim()).filter(Boolean);
      setNumbers(prev => {
        const old = (typeof prev === 'string' ? prev : '').split('\n').map(n => n.trim()).filter(Boolean);
        return Array.from(new Set([...old, ...nums])).join('\n');
      });
      showToast('success', `Importados ${nums.length} números desde el archivo.`);
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const insertarVariable = (variable) => {
    
    if (!textareaRef.current) {
      setMessage(prev => prev + " " + variable);
      return;
    }
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const nuevo = message.substring(0, start) + " " + variable + " " + message.substring(end);
    setMessage(nuevo);
  };

  // Conexión Socket.IO y Listeners
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { navigate('/login'); return; }

    try {
      const decoded = JSON.parse(atob(token.split('.')[1]));
      if (decoded) {
        if (decoded.role) setUserRole(decoded.role);
        if (typeof decoded.email === 'string' && decoded.email.trim()) {
          const accountEmail = decoded.email.trim().toLowerCase();
          setUserEmail(accountEmail);
          setDarkMode(localStorage.getItem(`wa_dark_mode:${accountEmail}`) === 'true');
          setAutoResetEnabled(localStorage.getItem(`wa_auto_reset_30m:${accountEmail}`) !== 'false');
        }
        
        if (decoded.role === 'ADMIN') {
          fetchPlatformUsers();
          fetchBackups();
        }
      }
    } catch (e) {
      console.error("Error decoding token", e);
    }

    socketRef.current = io(API_BASE, { auth: { token } });
    
    socketRef.current.on('connect_error', (err) => {
      if (err.message === 'Authentication error') {
        localStorage.removeItem('token');
        navigate('/login');
      }
    });

    socketRef.current.on('status', s => setStatus(s));
    socketRef.current.on('qr', q => {
      const nextQr = normalizeQrValue(q);
      setQr(nextQr);
    });
    socketRef.current.on('log', log => {
      const logText = typeof log === 'string' ? log : String(log ?? 'Evento recibido');
      setLogs(p => [...p, { 
        text: logText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type: logText.includes('Error') ? 'error' : logText.includes('Aviso') ? 'warn' : 'success'
      }].slice(-300));
      if (logText.includes('finalizada') || logText.includes('completada')) {
        setLoading(false);
        setSimulating(false);
      }
    });

    // Escuchar actualizaciones en tiempo real del directorio de clientes
    socketRef.current.on('clients_updated', (updated) => {
      setClients(normalizeClients(updated));
    });

    // Escuchar actualizaciones de programaciones automáticas
    socketRef.current.on('schedules_updated', (updated) => {
      setSchedules(Array.isArray(updated) ? updated : []);
    });

    // Medición inicial de ping, salud, estado de WhatsApp y carga de clientes
    fetchHealthAndPing();
    fetchClients();
    fetchSchedules();
    fetchTemplates();
    fetchStatus();

    // Interceptor para expiración de sesión (401 Unauthorized)
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        // Solo redirigir si el token expiró o es inválido (401).
        // NUNCA en 403 (permiso denegado), para evitar bucles de redirección que apagan la pantalla.
        if (error.response && error.response.status === 401) {
          localStorage.removeItem('token');
          navigate('/login');
        }
        return Promise.reject(error);
      }
    );

    // Sondeo de estado inicial mientras WhatsApp arranca
    const statusInterval = setInterval(() => {
      fetchStatus();
    }, 4000);

    return () => {
      axios.interceptors.response.eject(interceptor);
      clearInterval(statusInterval);
      socketRef.current?.disconnect();
    };
  }, [navigate]);

  const fetchStatus = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await axios.get(`${API_BASE}/api/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data) {
        const nextStatus = typeof res.data.status === 'string' ? res.data.status : 'DISCONNECTED';
        const nextQr = normalizeQrValue(res.data.qr);

        setStatus(nextStatus);
        if (nextStatus === 'CONNECTED' || nextStatus === 'AUTHENTICATED' || !nextQr) {
          setQr('');
        } else {
          setQr(nextQr);
        }
      }
    } catch (err) {
      console.error('Error fetching status:', err);
    }
  };

    const handleCheckWhatsAppStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      showToast('info', 'Comprobando estado de vinculación con WhatsApp...');
      const res = await axios.post(`${API_BASE}/api/whatsapp/check-status`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data?.status === 'CONNECTED') {
        setStatus('CONNECTED');
        setQr('');
        showToast('success', '¡WhatsApp está vinculado y listo!');
      } else if (res.data?.status === 'AUTHENTICATED') {
        setStatus('AUTHENTICATED');
        setQr('');
        showToast('info', 'Código escaneado. Sincronizando mensajes...');
      } else {
        const nextQr = normalizeQrValue(res.data?.qr);
        if (nextQr) setQr(nextQr);
        if (res.data?.status) setStatus(res.data.status);
        showToast('warn', 'Aún no se ha detectado el escaneo. Por favor escanea el código QR con tu celular.');
      }
    } catch (err) {
      fetchStatus();
    }
  };

  const handleDisconnectWhatsApp = async () => {
    if (status === 'INITIALIZING') {
      showToast('info', 'La pasarela ya se está iniciando. Por favor espera a que aparezca el código QR.');
      fetchStatus();
      return;
    }
    if (status === 'CONNECTED') {
      if (!window.confirm("¿Deseas desvincular tu cuenta de WhatsApp para enlazar otro número telefónico?")) return;
    } else {
      if (!window.confirm("¿Deseas reiniciar la conexión de WhatsApp para regenerar el código QR?")) return;
    }
    try {
      const token = localStorage.getItem('token');
      setStatus('INITIALIZING');
      setQr('');
      showToast('info', 'Reiniciando pasarela de WhatsApp...');
      const res = await axios.post(`${API_BASE}/api/whatsapp/disconnect`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data?.message) {
        showToast('info', res.data.message);
      }
      setTimeout(fetchStatus, 3000);
    } catch (err) {
      showToast('error', err.response?.data?.message || err.response?.data?.error || 'Error al reiniciar WhatsApp.');
      fetchStatus();
    }
  };

  const fetchTemplates = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await axios.get(`${API_BASE}/api/templates`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.data || typeof res.data !== 'object') {
        throw new Error('El servidor devolvió una respuesta de plantillas inválida.');
      }
      setPlantillas(normalizeTemplates(res.data?.plantillas));
      if (typeof res.data?.currentMessage === 'string') setMessage(res.data.currentMessage);
      if (Number.isFinite(res.data?.delay) && res.data.delay > 0) setDelay(res.data.delay);
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  };

  const saveTemplatesToBackend = async (nuevasPlantillas, nuevoMensaje, nuevoDelay) => {
    const token = localStorage.getItem('token');
    if (!token) {
      showToast('error', 'Tu sesión expiró. Inicia sesión nuevamente para guardar los cambios.');
      return false;
    }
    const parsedDelay = Number(nuevoDelay !== undefined ? nuevoDelay : delay);
    const safeDelay = Number.isFinite(parsedDelay)
      ? Math.min(Math.max(parsedDelay, 1), 60)
      : 4;
    try {
      await axios.put(`${API_BASE}/api/templates`, {
        plantillas: normalizeTemplates(nuevasPlantillas || plantillas),
        currentMessage: nuevoMensaje !== undefined ? nuevoMensaje : message,
        delay: safeDelay
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDelay(safeDelay);
      showToast('success', 'Cambios guardados en tu cuenta.');
      return true;
    } catch (err) {
      console.error('Error saving personal templates:', err);
      showToast('error', err.response?.data?.error || 'No se pudieron guardar tus cambios.');
      return false;
    }
  };

  useEffect(() => { 
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [logs]);

  const handleLogout = () => { 
    try {
      localStorage.removeItem('token'); 
      localStorage.removeItem('wa_session_start_time');
      localStorage.removeItem('wa_logout_reason');
      socketRef.current?.disconnect();
    } catch {}

    try {
      axios.post(`${API_BASE}/api/logout`, {}, { withCredentials: true, timeout: 2000 }).catch(() => {});
    } catch {}

    window.location.href = '/login'; 
  };

  const handleToggleAutoReset = (val) => {
    setAutoResetEnabled(val);
    if (userEmail) {
      localStorage.setItem(`wa_auto_reset_30m:${userEmail}`, val ? 'true' : 'false');
    }
    showToast(val ? 'success' : 'info', val ? 'Cierre por inactividad (30 min) activado.' : 'Cierre por inactividad desactivado.');
  };

  const handleToggleDarkMode = () => {
    setDarkMode(current => {
      const next = !current;
      if (userEmail) {
        localStorage.setItem(`wa_dark_mode:${userEmail}`, next ? 'true' : 'false');
      }
      return next;
    });
  };

  const handleExtendSession = () => {
    lastActivityRef.current = Date.now();
    setSecondsLeft(INACTIVITY_TIMEOUT_SECONDS);
    showToast('success', 'Contador de inactividad reiniciado (30 minutos).');
  };

  const executeAutoReset = () => {
    try {
      localStorage.removeItem('token');
      localStorage.setItem('wa_logout_reason', 'inactivity_30m');
      socketRef.current?.disconnect();
    } catch {}

    try {
      axios.post(`${API_BASE}/api/logout`, {}, { withCredentials: true, timeout: 2000 }).catch(() => {});
    } catch {}

    window.location.href = '/login';
  };

  // Detección de movimiento y actividad del usuario (mouse, teclado, touch, scroll)
  useEffect(() => {
    let throttleTimer = null;
    const recordUserActivity = () => {
      lastActivityRef.current = Date.now();
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
        }, 1000);
      }
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    activityEvents.forEach(evt => window.addEventListener(evt, recordUserActivity, { passive: true }));

    return () => {
      activityEvents.forEach(evt => window.removeEventListener(evt, recordUserActivity));
      if (throttleTimer) clearTimeout(throttleTimer);
    };
  }, []);

  // Temporizador de inactividad: cuenta regresiva solo cuando NO hay movimiento
  useEffect(() => {
    if (!autoResetEnabled) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const elapsedIdle = Math.floor((now - lastActivityRef.current) / 1000);
      const remaining = Math.max(0, INACTIVITY_TIMEOUT_SECONDS - elapsedIdle);

      // Optimización: solo provocar re-render en UI cuando cambia significativamente o en el último minuto
      setSecondsLeft(prev => {
        if (remaining <= 60 || Math.abs(prev - remaining) >= 10 || remaining <= 0) {
          return remaining;
        }
        return prev;
      });

      if (remaining === 60) {
        showToast('warn', '⚠️ Inactividad detectada: la sesión se cerrará en 1 minuto si no hay movimiento.');
      }

      if (remaining <= 0) {
        if (loadingRef.current) {
          // Si hay una campaña de envío activa, posponer 5 minutos para no interrumpir
          lastActivityRef.current = Date.now() - (INACTIVITY_TIMEOUT_SECONDS - 300) * 1000;
          return;
        }
        clearInterval(timer);
        executeAutoReset();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [autoResetEnabled]);

  const formatTimeRemaining = (totalSec) => {
    const safeTotal = typeof totalSec === 'number' && Number.isFinite(totalSec) ? Math.max(0, totalSec) : 0;
    const mins = Math.floor(safeTotal / 60);
    const secs = safeTotal % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Función para consultar Ping y Salud del Backend
  const fetchHealthAndPing = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setHealthLoading(true);
    const startPing = Date.now();
    try {
      const [resHealth] = await Promise.all([
        axios.get(`${API_BASE}/api/test/health`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.post(`${API_BASE}/api/test/ping`, { timestamp: startPing }, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      const latency = Date.now() - startPing;
      setApiPing(latency);
      setHealthData(resHealth.data);
    } catch (err) {
      console.error('Error fetching health:', err);
    } finally {
      setHealthLoading(false);
    }
  };

  // == MÉTODOS CRUD PARA GESTIÓN DE CLIENTES ==
  const fetchClients = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setClientsLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/clients`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setClients(normalizeClients(res.data));
    } catch (err) {
      console.error('Error fetching clients:', err);
    } finally {
      setClientsLoading(false);
    }
  };

  const fetchSchedules = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setSchedulesLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/schedules`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSchedules(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Error fetching schedules:', err);
    } finally {
      setSchedulesLoading(false);
    }
  };

  const handleCancelSchedule = async (id) => {
    if (!window.confirm('¿Desea cancelar este envío programado?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE}/api/schedules/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showToast('success', 'Envío programado cancelado.');
      fetchSchedules();
    } catch (err) {
      showToast('error', 'Error cancelando la programación.');
    }
  };

  const fetchPlatformUsers = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setUsersLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPlatformUsers(normalizeUsers(res.data));
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchBackups = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await axios.get(`${API_BASE}/api/admin/backups`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBackups(normalizeBackups(res.data));
    } catch (err) {
      console.error('Error fetching backups:', err);
    }
  };

  const handleCreateBackup = async () => {
    if (backupLoading) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    setBackupLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/admin/backup`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showToast('success', `Respaldo exitoso: ${res.data.manifest.folder}`);
      fetchBackups();
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Error al generar respaldo.');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestoreBackup = async (folderName) => {
    if (!window.confirm(`⚠️ ATENCIÓN: ¿Deseas restaurar la base de datos desde la copia "${folderName}"?\n\nLos datos actuales de clientes, usuarios y plantillas serán reemplazados por los de este respaldo.`)) {
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;
    setBackupLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/admin/backup/restore/${encodeURIComponent(folderName)}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showToast('success', res.data.message || 'Copia de seguridad restaurada exitosamente.');
      fetchBackups();
      fetchClients();
      fetchTemplates();
      fetchPlatformUsers();
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Error al restaurar la copia de seguridad.');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDownloadBackup = async (folderName) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      showToast('info', `Descargando respaldo "${folderName}"...`);
      const res = await axios.get(`${API_BASE}/api/admin/backup/${encodeURIComponent(folderName)}/download`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folderName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('success', 'Archivo de respaldo descargado correctamente.');
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Error al descargar respaldo.');
    }
  };

    const handleClearAllClients = async () => {
    if (clients.length === 0) return;
    if (!window.confirm(`¿Confirmas que deseas vaciar y eliminar TODOS los ${clients.length} cliente(s) del directorio? Esta acción no se puede deshacer.`)) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE}/api/clients`, {
        data: { all: true },
        headers: { Authorization: `Bearer ${token}` }
      });
      setClients([]);
      showToast('success', 'Directorio de clientes vaciado correctamente.');
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Error al vaciar directorio.');
    }
  };

  const handleExportClients = () => {
    if (clients.length === 0) {
      showToast('warn', 'No hay clientes registrados en tu directorio para exportar.');
      return;
    }
    const dataStr = JSON.stringify(clients, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `directorio_clientes_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('success', `Exportados ${clients.length} clientes a archivo JSON.`);
  };

  const handleImportClientsFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const token = localStorage.getItem('token');
        const res = await axios.post(`${API_BASE}/api/clients/import`, parsed, {
          headers: { Authorization: `Bearer ${token}` }
        });
        showToast('success', res.data.message || 'Clientes importados exitosamente.');
        fetchClients();
      } catch (err) {
        showToast('error', err.response?.data?.error || 'Error al procesar el archivo JSON de clientes.');
      } finally {
        if (fileInputClientsRef.current) fileInputClientsRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleUploadBackupFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const token = localStorage.getItem('token');
        setBackupLoading(true);
        const res = await axios.post(`${API_BASE}/api/admin/backup/upload`, parsed, {
          headers: { Authorization: `Bearer ${token}` }
        });
        showToast('success', res.data.message || 'Respaldo importado exitosamente.');
        fetchBackups();
        fetchClients();
        fetchTemplates();
        fetchPlatformUsers();
      } catch (err) {
        showToast('error', err.response?.data?.error || 'Error al procesar archivo de respaldo.');
      } finally {
        setBackupLoading(false);
        if (fileInputBackupRef.current) fileInputBackupRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleDeleteOwnAccount = async () => {
    const confirmText = prompt(
      '⚠️ PELIGRO: Esta acción eliminará permanentemente tu cuenta, tu sesión de WhatsApp, tu lista de clientes y tus plantillas de mensajes.\n\nPara confirmar, escribe "ELIMINAR" a continuación:'
    );
    if (confirmText !== 'ELIMINAR') {
      if (confirmText !== null) showToast('warn', 'Eliminación cancelada. Debes escribir "ELIMINAR" exactamente.');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE}/api/account`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      localStorage.removeItem('token');
      alert('Tu cuenta ha sido eliminada permanentemente. Gracias por haber usado la plataforma.');
      navigate('/login');
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Error al eliminar cuenta.');
    }
  };

  const handleDeleteUserByAdmin = async (targetEmail) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar permanentemente la cuenta de "${targetEmail}" y todos sus clientes y datos asociados?`)) {
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const res = await axios.delete(`${API_BASE}/api/users/${encodeURIComponent(targetEmail)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showToast('success', res.data.message || `Usuario "${targetEmail}" eliminado.`);
      fetchPlatformUsers();
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Error al eliminar usuario.');
    }
  };

  const handleSaveClient = async (e) => {
    if (e) e.preventDefault();
    if (clientAdding) return;
    if (!newClientNombre.trim() || !newClientNumero.trim()) {
      showToast('error', 'El nombre y el número telefónico son obligatorios.');
      return;
    }
    const cleanNum = newClientNumero.replace(/\s+/g, '').replace('+', '');
    if (!/^\d{7,15}$/.test(cleanNum)) {
      showToast('error', 'El número debe contener entre 7 y 15 dígitos numéricos (ej: 18095550123).');
      return;
    }

    setClientAdding(true);
    try {
      const token = localStorage.getItem('token');
      const payload = {
        nombre: newClientNombre.trim(),
        numero: cleanNum,
        nota: newClientNota.trim(),
        estado: newClientEstado
      };
      
      let res;
      if (editingClientId) {
        res = await axios.put(`${API_BASE}/api/clients/${editingClientId}`, payload, {
          headers: { Authorization: `Bearer ${token}` }
        });
        showToast('success', `Cliente "${res.data.nombre}" actualizado con éxito.`);
      } else {
        res = await axios.post(`${API_BASE}/api/clients`, payload, {
          headers: { Authorization: `Bearer ${token}` }
        });
        showToast('success', `Cliente "${res.data.nombre}" agregado con éxito.`);
      }
      
      setClients(prev => {
        const list = Array.isArray(prev) ? prev : [];
        const without = list.filter(c => c && c.id !== res.data.id && c.numero !== res.data.numero);
        return normalizeClients([...without, res.data]);
      });
      setNewClientNombre('');
      setNewClientNumero('');
      setNewClientNota('');
      setNewClientEstado('PENDIENTE');
      setEditingClientId(null);
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Error al guardar el cliente.');
    } finally {
      setClientAdding(false);
    }
  };

  const handleEditClick = (client) => {
    setEditingClientId(client.id);
    setNewClientNombre(client.nombre);
    setNewClientNumero(client.numero);
    setNewClientNota(client.nota || '');
    setNewClientEstado(client.estado || 'PENDIENTE');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('info', `Modo edición activado para ${client.nombre}`);
  };

  const cancelEdit = () => {
    setEditingClientId(null);
    setNewClientNombre('');
    setNewClientNumero('');
    setNewClientNota('');
    setNewClientEstado('PENDIENTE');
  };

  const handleToggleClientStatus = async (client, nextStatus) => {
    try {
      const token = localStorage.getItem('token');
      await axios.put(`${API_BASE}/api/clients/${client.id}`, { estado: nextStatus }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setClients(prev => prev.map(c => c.id === client.id ? { ...c, estado: nextStatus } : c));
      showToast('success', `${client.nombre} ahora está: ${nextStatus === 'PAGADO' ? 'Pagado / Al día' : nextStatus === 'VENCIDO' ? 'Factura Vencida' : 'Saldo Pendiente'}`);
    } catch (err) {
      showToast('error', 'Error actualizando estado del cliente.');
    }
  };

  const handleOpenWhatsAppDirect = (client, customMsg) => {
    let cleanNum = (client.numero || "").replace(/\D/g, "");
    if (cleanNum.startsWith("00")) cleanNum = cleanNum.substring(2);
    if (cleanNum.length === 10 && /^(809|829|849)/.test(cleanNum)) {
      cleanNum = "1" + cleanNum;
    }
    const baseText = customMsg || message || `Estimado/a ${client.nombre}, le saludamos cordialmente para recordarle la gestión de su cuenta.`;
    const personalized = baseText
      .replace(/{{nombre}}/g, client.nombre)
      .replace(/{{nota}}/g, client.nota || "")
      .replace(/{{monto}}/g, "su saldo pendiente")
      .replace(/{{vencimiento}}/g, "la fecha límite");
    const waUrl = `https://wa.me/${cleanNum}?text=${encodeURIComponent(personalized)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDeleteClient = async (id, nombre) => {
    if (!window.confirm(`¿Confirma eliminar al cliente "${nombre}" del directorio?`)) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE}/api/clients/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setClients(prev => prev.filter(c => c.id !== id));
      showToast('success', `Cliente "${nombre}" eliminado del directorio.`);
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Error al eliminar cliente.');
    }
  };

  const handleSyncClientsToMassSend = () => {
    if (!clients.length) {
      showToast('warn', 'No hay clientes en el directorio para transferir.');
      return;
    }
    const nums = clients.map(c => c.numero).filter(Boolean);
    setNumbers(prev => {
      const old = (typeof prev === 'string' ? prev : '').split('\n').map(n => n.trim()).filter(Boolean);
      return Array.from(new Set([...old, ...nums])).join('\n');
    });
    showToast('success', `Se sincronizaron ${nums.length} números a la lista de envíos.`);
    setActiveTab('dashboard');
  };

  const handleOpenDirectSend = (client) => {
    setDirectSendClient(client);
    const defaultMsg = message && message.trim()
      ? message.replace(/{{nombre}}/g, client.nombre).replace(/{{nota}}/g, client.nota || "")
      : `Estimado/a ${client.nombre}, le recordamos cordialmente que su cuenta presenta saldo pendiente. Por favor responda con su comprobante para actualizar su estado a la brevedad.`;
    setDirectSendMessage(defaultMsg);
  };

  const handleSendDirectMessage = async () => {
    if (!directSendClient || !directSendMessage.trim() || directSending) return;
    if (status !== 'CONNECTED') {
      showToast('error', 'Tu WhatsApp no está vinculado. Por favor escanea tu código QR en la Consola de Envío.');
      return;
    }
    setDirectSending(true);
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_BASE}/api/send`, {
        numbers: [directSendClient.numero],
        message: directSendMessage.trim(),
        delay: 1
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      showToast('success', `¡Mensaje enviado con éxito a ${directSendClient.nombre}!`);
      setDirectSendClient(null);
    } catch (err) {
      showToast('error', `Error al enviar mensaje: ${err.response?.data?.error || err.message}`);
    } finally {
      setDirectSending(false);
    }
  };

  const handleLoadClientToConsole = (client) => {
    setNumbers(client.numero);
    const personalizedMsg = `Estimado/a ${client.nombre}, le recordamos cordialmente que su cuenta presenta saldo pendiente. Por favor responda con su comprobante para actualizar su estado.`;
    if (!message || !message.trim()) {
      setMessage(personalizedMsg);
    }
    setActiveTab('dashboard');
    showToast('success', `Cliente ${client.nombre} (+${client.numero}) cargado en la Consola de Envíos.`);
    if (directSendClient) setDirectSendClient(null);
  };

  const handleTestClientDirect = (client) => {
    setTestNumber(client.numero);
    setTestMessage(`Estimado/a ${client.nombre}, le recordamos cordialmente que su cuenta presenta saldo pendiente.`);
    setActiveTab('testing');
    showToast('info', `Cargado ${client.nombre} en el Laboratorio de Pruebas.`);
  };

  // 1. Envío de Campaña Masiva
  const handleSend = async () => {
    if (loading) return;
    const nums = (typeof numbers === 'string' ? numbers : '').split(/[\n,;]+/).map(n => n.trim()).filter(Boolean);
    if (!nums.length) {
      if (clients.length > 0) {
        handleOpenSendAllModal();
        return;
      }
      showToast('error', 'Por favor ingrese al menos un destinatario o registre clientes en el directorio.'); 
      return; 
    }
    if (!message.trim()) { 
      showToast('error', 'Por favor redacte el mensaje a enviar.'); 
      return; 
    }
    setLoading(true);
    setLogs(p => [...p, { 
      text: 'Transmisión masiva iniciada por el usuario...', 
      time: new Date().toLocaleTimeString(),
      type: 'info' 
    }]);

    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_BASE}/api/send`,
        { numbers: nums, message, delay: Number(delay) },
        { headers: { Authorization: `Bearer ${token}` } });
      showToast('success', `Campaña enviada a ${nums.length} destinatario(s).`);
    } catch (err) {
      setLogs(p => [...p, { 
        text: `Error de envío: ${err.response?.data?.error || err.message}`, 
        time: new Date().toLocaleTimeString(),
        type: 'error'
      }]);
      showToast('error', err.response?.data?.error || 'Error al iniciar transmisión.');
      setLoading(false);
    }
  };

  // 1.5 Envío Rápido y Fácil a Todos los Clientes (1 Clic)
  const handleOpenSendAllModal = () => {
    if (clients.length === 0) {
      showToast('error', 'Aún no tienes clientes en tu directorio. Agrega al menos un cliente.');
      setActiveTab('contacts');
      return;
    }
    fetchStatus();
    const defaultTemplate = message && message.trim()
      ? message
      : 'Estimado/a {{nombre}}, le recordamos cordialmente que su cuenta presenta saldo pendiente. Por favor responda con su comprobante para actualizar su estado a la brevedad. ¡Muchas gracias!';
    setSendAllMessage(defaultTemplate);
    setSendAllTab('compose');
    setSendAllModalOpen(true);
  };

  const handleOpenAllWhatsAppTabs = (clientList, customMsg) => {
    if (!clientList || clientList.length === 0) return;
    if (clientList.length > 5 && !window.confirm(`¿Confirmas abrir pestañas de WhatsApp Web para ${clientList.length} clientes?`)) {
      return;
    }
    clientList.forEach((c, idx) => {
      setTimeout(() => {
        handleOpenWhatsAppDirect(c, customMsg);
      }, idx * 500);
    });
    showToast('success', `Abriendo WhatsApp Web para ${clientList.length} cliente(s)...`);
  };

  const handleConfirmSendAll = async () => {
    if (sendAllSending) return;
    if (!sendAllMessage.trim()) {
      showToast('error', 'El mensaje no puede estar vacío.');
      return;
    }

    const targetClients = sendAllAudience === 'ALL'
      ? clients
      : clients.filter(c => (c.estado || 'PENDIENTE') === sendAllAudience);

    if (targetClients.length === 0) {
      showToast('error', `No tienes clientes registrados con el filtro seleccionado (${sendAllAudience}).`);
      return;
    }

    if (sendAllMode === 'SCHEDULE') {
      const scheduleDate = new Date(sendAllScheduleTime);
      if (isNaN(scheduleDate.getTime()) || scheduleDate.getTime() <= (Date.now() + 10000)) {
        showToast('error', 'La fecha programada debe ser al menos 1 minuto en el futuro.');
        return;
      }

      setSendAllSending(true);
      try {
        const token = localStorage.getItem('token');
        await axios.post(`${API_BASE}/api/schedules`, {
          messageTemplate: sendAllMessage.trim(),
          delay: Number(delay) || 4,
          filterEstado: sendAllAudience,
          scheduledAt: scheduleDate.toISOString()
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
        showToast('success', `¡Campaña programada exitosamente para ${scheduleDate.toLocaleString()}!`);
        setSendAllModalOpen(false);
        fetchSchedules();
      } catch (err) {
        showToast('error', err.response?.data?.error || 'Error programando campaña.');
      } finally {
        setSendAllSending(false);
      }
      return;
    }

    // Modo Inmediato: si no está conectado, cambiar a la pestaña de QR
    if (status !== 'CONNECTED') {
      setSendAllTab('qr');
      showToast('info', 'Tu WhatsApp no está vinculado. Por favor escanea el código QR para iniciar el envío.');
      return;
    }

    setSendAllSending(true);
    setLoading(true);
    setLogs(p => [...p, { 
      text: `🚀 [ENVÍO A TODOS] Iniciando transmisión a ${targetClients.length} clientes (${sendAllAudience})...`, 
      time: new Date().toLocaleTimeString(),
      type: 'info' 
    }]);

    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_BASE}/api/send-auto-collections`,
        { messageTemplate: sendAllMessage.trim(), delay: Number(delay) || 3, filterEstado: sendAllAudience },
        { headers: { Authorization: `Bearer ${token}` } });
      showToast('success', `¡Campaña iniciada para los ${targetClients.length} clientes!`);
      setSendAllModalOpen(false);
      setActiveTab('dashboard'); // Cambiar a la consola para ver los logs en vivo
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      setLogs(p => [...p, { 
        text: `Error de cobro automático: ${errMsg}`, 
        time: new Date().toLocaleTimeString(),
        type: 'error'
      }]);
      showToast('error', errMsg);
      setLoading(false);
    } finally {
      setSendAllSending(false);
    }
  };

  // Compatibilidad hacia atrás
  const handleAutoCollection = () => {
    handleOpenSendAllModal();
  };

  // 2. Envío de Prueba Individual (Direct Single Test)
  const handleSingleTest = async () => {
    if (testLoading) return;
    if (!testNumber.trim() || !testMessage.trim()) {
      showToast('error', 'Ingrese número de prueba y mensaje.');
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API_BASE}/api/test/single`,
        { number: testNumber, message: testMessage },
        { headers: { Authorization: `Bearer ${token}` } });
      setTestResult({ success: true, ...res.data });
      showToast('success', `Mensaje de prueba entregado a ${testNumber}`);
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      setTestResult({ success: false, error: errMsg });
      showToast('error', errMsg);
    } finally {
      setTestLoading(false);
    }
  };

  // 3. Comprobación de Número en WhatsApp
  const handleCheckNumber = async () => {
    if (checkLoading) return;
    if (!testNumber.trim()) {
      showToast('error', 'Ingrese el número a comprobar en la casilla de arriba.');
      return;
    }
    setCheckLoading(true);
    setCheckResult(null);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API_BASE}/api/test/check-number`,
        { number: testNumber },
        { headers: { Authorization: `Bearer ${token}` } });
      setCheckResult(res.data);
      if (res.data.exists) {
        showToast('success', `¡${testNumber} tiene WhatsApp activo!`);
      } else {
        showToast('warn', `${testNumber} no está registrado en WhatsApp.`);
      }
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      setCheckResult({ error: errMsg });
      showToast('error', errMsg);
    } finally {
      setCheckLoading(false);
    }
  };

  // 4. Simulación de Campaña Masiva (Dry-run / Sandbox)
  const handleSimulate = async () => {
    if (simulating) return;
    setSimulating(true);
    try {
      const token = localStorage.getItem('token');
      const testList = (typeof numbers === 'string' ? numbers : '').split(/[\n,;]+/).map(n => n.trim()).filter(Boolean);
      const targetList = testList.length > 0 ? testList.slice(0, 5) : ['18095550101', '18095550102', '18095550103'];
      await axios.post(`${API_BASE}/api/test/simulate`,
        { numbers: targetList, message: 'Simulación de Cobranza Automatizada WhatsApp', delay: Number(delay) || 2 },
        { headers: { Authorization: `Bearer ${token}` } });
      showToast('info', `Simulando envío a ${targetList.length} números.`);
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Error al iniciar simulación.');
      setSimulating(false);
    }
  };

  // 5. Reinicio de Sesión WhatsApp
  const handleRestartClient = async () => {
    if (restartingClient) return;
    if (!window.confirm('¿Desea reiniciar la conexión de WhatsApp y regenerar el código QR?')) return;
    setRestartingClient(true);
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_BASE}/api/test/restart-client`, {}, { headers: { Authorization: `Bearer ${token}` } });
      showToast('info', 'Reiniciando pasarela de WhatsApp...');
      setTimeout(() => {
        fetchHealthAndPing();
        setRestartingClient(false);
      }, 3000);
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Error al reiniciar.');
      setRestartingClient(false);
    }
  };

  const copiarTexto = () => {
    navigator.clipboard.writeText(message);
    setCopiado(true);
    showToast('info', 'Mensaje copiado al portapapeles');
    setTimeout(() => setCopiado(false), 1500);
  };

  const totalDestinatarios = (typeof numbers === 'string' ? numbers : '').split(/[\n,;]+/).filter(n => n && n.trim()).length;

  const filteredClients = (Array.isArray(clients) ? clients : []).filter(c => {
    if (!c || typeof c !== 'object') return false;
    const matchesStatus = clientFilterStatus === 'ALL' || (c.estado || 'PENDIENTE') === clientFilterStatus;
    if (!matchesStatus) return false;
    if (!clientSearch || !clientSearch.trim()) return true;
    const term = clientSearch.toLowerCase();
    const nom = (c.nombre || '').toLowerCase();
    const num = (c.numero || '').toString();
    const not = (c.nota || '').toLowerCase();
    return nom.includes(term) || num.includes(term) || not.includes(term);
  });

  return (
    <div className={`dashboard-page ${darkMode ? "dark" : ""}`}>
      
      {/* Franja decorativa verde WhatsApp en la parte superior */}
      <div className="dashboard-top-banner" />

      {/* Notificación Toast Flotante */}
      {toast && (
        <div className={`wa-toast-alert wa-toast-${toast.tipo}`}>
          {toast.tipo === 'success' && <CheckCircle2 size={16} />}
          {toast.tipo === 'error' && <AlertCircle size={16} />}
          {toast.tipo === 'info' && <Zap size={16} />}
          {toast.tipo === 'warn' && <AlertCircle size={16} />}
          <span>{toast.mensaje}</span>
        </div>
      )}

      {/* Modal de Envío Directo de Mensaje a Cliente */}
      {directSendClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div 
            className="w-full max-w-lg rounded-2xl border shadow-2xl p-6 space-y-4 relative"
            style={{ background: "var(--wa-card)", borderColor: "var(--wa-border)", color: "var(--wa-text)" }}
          >
            {/* Cabecera del Modal */}
            <div className="flex items-start justify-between pb-3 border-b" style={{ borderColor: "var(--wa-border)" }}>
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shrink-0 shadow"
                  style={{ background: "linear-gradient(135deg, var(--wa-dark), var(--wa-button))" }}
                >
                  {directSendClient.nombre ? directSendClient.nombre.slice(0, 2).toUpperCase() : 'CL'}
                </div>
                <div>
                  <h3 className="text-sm font-bold block" style={{ color: "var(--wa-text)" }}>
                    Enviar Mensaje a {directSendClient.nombre}
                  </h3>
                  <span className="text-xs font-medium block mt-0.5" style={{ color: "var(--wa-muted)" }}>
                    +{directSendClient.numero} {directSendClient.nota ? `• ${directSendClient.nota}` : ''}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDirectSendClient(null)}
                className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                style={{ color: "var(--wa-muted)" }}
                title="Cerrar ventana"
              >
                <X size={18} />
              </button>
            </div>

            {/* Estado de WhatsApp */}
            <div className="flex items-center justify-between text-xs px-3 py-2 rounded-xl" style={{ background: "var(--wa-input-bg)" }}>
              <span className="font-semibold" style={{ color: "var(--wa-muted)" }}>Estado de WhatsApp:</span>
              <span className="font-bold flex items-center gap-1.5" style={{ color: status === 'CONNECTED' ? "var(--wa-green)" : "var(--wa-error)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: status === 'CONNECTED' ? "var(--wa-green)" : "var(--wa-error)" }} />
                {status === 'CONNECTED' ? 'WhatsApp Vinculado' : 'WhatsApp Desconectado'}
              </span>
            </div>

            {/* Plantillas Rápidas para el cliente */}
            <div>
              <span className="text-[11px] font-bold block mb-1.5" style={{ color: "var(--wa-muted)" }}>
                Plantillas sugeridas:
              </span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setDirectSendMessage(`Estimado/a ${directSendClient.nombre}, le recordamos cordialmente que su cuenta presenta saldo pendiente. Por favor responda con su comprobante para actualizar su estado a la brevedad.`)}
                  className="text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition-all hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  style={{ borderColor: "var(--wa-border)", color: "var(--wa-button)" }}
                >
                  Recordatorio
                </button>
                <button
                  type="button"
                  onClick={() => setDirectSendMessage(`Estimado/a ${directSendClient.nombre}, hemos registrado con éxito su abono a la cuenta. Su saldo ha sido actualizado en nuestro sistema. ¡Muchas gracias por su puntualidad!`)}
                  className="text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition-all hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  style={{ borderColor: "var(--wa-border)", color: "var(--wa-button)" }}
                >
                  Confirmación Abono
                </button>
                <button
                  type="button"
                  onClick={() => setDirectSendMessage(`Aviso importante: Estimado/a ${directSendClient.nombre}, le notificamos que su cuenta se encuentra en fase de regularización. Comuníquese hoy para acordar su forma de pago.`)}
                  className="text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition-all hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  style={{ borderColor: "var(--wa-border)", color: "var(--wa-button)" }}
                >
                  Aviso Regularización
                </button>
              </div>
            </div>

            {/* Redacción del Mensaje */}
            <div>
              <label className="text-[11px] font-bold block mb-1.5" style={{ color: "var(--wa-muted)" }}>
                Mensaje a enviar:
              </label>
              <textarea
                rows={5}
                value={directSendMessage}
                onChange={(e) => setDirectSendMessage(e.target.value)}
                className="wa-textarea text-xs w-full"
                placeholder="Escriba el mensaje para este cliente..."
              />
            </div>

            {/* Acciones */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => handleLoadClientToConsole(directSendClient)}
                  className="btn-wa-secondary text-xs py-2 px-3 justify-center"
                  title="Cargar número a la Consola de Envío para previsualización o edición extendida"
                >
                  <LayoutDashboard size={14} />
                  <span>Abrir en Consola</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenWhatsAppDirect(directSendClient, directSendMessage)}
                  className="btn-wa-secondary text-xs py-2 px-3 justify-center flex items-center gap-1.5"
                  title="Abrir chat en WhatsApp Web o App en una nueva pestaña (no requiere pasarela activa)"
                  style={{ color: "#25d366", borderColor: "rgba(37, 211, 102, 0.4)" }}
                >
                  <MessageCircle size={14} />
                  <span>Chat Directo Web</span>
                </button>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setDirectSendClient(null)}
                  className="btn-wa-secondary w-full sm:w-auto text-xs py-2 px-4 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSendDirectMessage}
                  disabled={directSending || !directSendMessage.trim() || status !== 'CONNECTED'}
                  className="btn-wa-primary w-full sm:w-auto text-xs py-2 px-5 justify-center"
                  title={status !== 'CONNECTED' ? 'WhatsApp debe estar vinculado en la Consola para enviar' : 'Enviar mensaje por WhatsApp ahora'}
                >
                  {directSending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      <span>Enviar por Pasarela</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* == MODAL PROFESIONAL DE ENVÍO A TODOS LOS CLIENTES (1 CLIC) == */}
      {sendAllModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-fadeIn overflow-y-auto">
          <div 
            className="w-full max-w-xl rounded-3xl border shadow-2xl p-5 sm:p-7 space-y-4 relative my-auto transition-all"
            style={{ background: "var(--wa-card)", borderColor: "var(--wa-border)", color: "var(--wa-text)" }}
          >
            {/* Cabecera del Modal con Icono e Info */}
            <div className="flex items-start justify-between pb-3 border-b" style={{ borderColor: "var(--wa-border)" }}>
              <div className="flex items-center gap-3">
                <div 
                  className="w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-white shrink-0 shadow-md"
                  style={{ background: "linear-gradient(135deg, #00a884, #128c7e)" }}
                >
                  <Users size={22} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-bold block" style={{ color: "var(--wa-text)" }}>
                      Enviar a Todos mis Clientes
                    </h3>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                      {clients.length} contactos
                    </span>
                  </div>
                  <span className="text-xs font-medium block mt-0.5" style={{ color: "var(--wa-muted)" }}>
                    Campaña de mensajería automática y personalizada
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSendAllModalOpen(false)}
                className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                style={{ color: "var(--wa-muted)" }}
                title="Cerrar ventana"
              >
                <X size={18} />
              </button>
            </div>

            {/* Pestañas de Navegación del Modal */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/5 dark:bg-white/5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setSendAllTab('compose')}
                className={`flex-1 py-1.5 px-3 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  sendAllTab === 'compose'
                    ? 'bg-[#00a884] text-white shadow-sm font-bold'
                    : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                <Send size={13} />
                <span>Mensaje & Audiencia</span>
              </button>
              <button
                type="button"
                onClick={() => { setSendAllTab('qr'); fetchStatus(); }}
                className={`flex-1 py-1.5 px-3 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  sendAllTab === 'qr'
                    ? 'bg-[#00a884] text-white shadow-sm font-bold'
                    : status !== 'CONNECTED' 
                      ? 'text-amber-600 font-bold hover:bg-amber-500/10' 
                      : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                <Smartphone size={13} />
                <span>{status === 'CONNECTED' ? 'Vincular QR' : 'Escanear QR'}</span>
                {status !== 'CONNECTED' && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
              </button>
              <button
                type="button"
                onClick={() => setSendAllTab('wame')}
                className={`flex-1 py-1.5 px-3 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  sendAllTab === 'wame'
                    ? 'bg-[#00a884] text-white shadow-sm font-bold'
                    : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
              >
                <ExternalLink size={13} />
                <span>WhatsApp Web</span>
              </button>
            </div>

            {/* PESTAÑA 1: REDACCIÓN & AUDIENCIA */}
            {sendAllTab === 'compose' && (
              <div className="space-y-4 animate-fadeIn">
                {/* Indicador de Estado de Conexión */}
                <div 
                  className="p-2.5 rounded-xl border flex items-center justify-between text-xs"
                  style={{
                    background: status === 'CONNECTED' ? "rgba(37, 211, 102, 0.08)" : "rgba(245, 158, 11, 0.08)",
                    borderColor: status === 'CONNECTED' ? "rgba(37, 211, 102, 0.3)" : "rgba(245, 158, 11, 0.35)"
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${status === 'CONNECTED' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                    <span className="font-bold" style={{ color: status === 'CONNECTED' ? "var(--wa-green)" : "#d97706" }}>
                      {status === 'CONNECTED' ? 'WhatsApp Vinculado y Listo para Transmitir' : 'WhatsApp Desconectado en la Nube'}
                    </span>
                  </div>
                  {status !== 'CONNECTED' && (
                    <button
                      type="button"
                      onClick={() => setSendAllTab('qr')}
                      className="text-[11px] font-bold text-amber-700 underline hover:opacity-80 cursor-pointer"
                    >
                      Ver Código QR ➔
                    </button>
                  )}
                </div>

                {/* Filtro de Audiencia Segmentada */}
                <div>
                  <span className="text-[11px] font-bold block mb-1.5" style={{ color: "var(--wa-muted)" }}>
                    Público objetivo de este envío:
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setSendAllAudience('ALL')}
                      className={`p-2 rounded-xl border text-center text-xs font-bold transition-all cursor-pointer ${sendAllAudience === 'ALL' ? 'border-[#00a884] bg-[#00a884]/10 text-[#00a884] shadow-xs' : 'border-gray-200 dark:border-gray-700 text-gray-500'}`}
                    >
                      🎯 Todos ({clients.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSendAllAudience('PENDIENTE')}
                      className={`p-2 rounded-xl border text-center text-xs font-bold transition-all cursor-pointer ${sendAllAudience === 'PENDIENTE' ? 'border-amber-500 bg-amber-500/10 text-amber-600 shadow-xs' : 'border-gray-200 dark:border-gray-700 text-gray-500'}`}
                    >
                      🟡 Pendientes ({clients.filter(c => (c.estado || 'PENDIENTE') === 'PENDIENTE').length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSendAllAudience('VENCIDO')}
                      className={`p-2 rounded-xl border text-center text-xs font-bold transition-all cursor-pointer ${sendAllAudience === 'VENCIDO' ? 'border-red-500 bg-red-500/10 text-red-600 shadow-xs' : 'border-gray-200 dark:border-gray-700 text-gray-500'}`}
                    >
                      🔴 Vencidos ({clients.filter(c => c.estado === 'VENCIDO').length})
                    </button>
                  </div>
                </div>

                {/* Editor de Mensaje y Variables */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[11px] font-bold" style={{ color: "var(--wa-muted)" }}>
                      Mensaje a transmitir:
                    </label>
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-gray-400">Insertar:</span>
                      {['{{nombre}}', '{{nota}}', '{{monto}}'].map(tag => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setSendAllMessage(prev => (prev || '') + ' ' + tag)}
                          className="px-1.5 py-0.5 rounded font-mono bg-black/5 dark:bg-white/10 hover:bg-[#00a884]/20 hover:text-[#00a884] transition-colors cursor-pointer"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    rows={4}
                    value={sendAllMessage}
                    onChange={(e) => setSendAllMessage(e.target.value)}
                    className="wa-textarea text-xs w-full leading-relaxed"
                    placeholder="Escribe el mensaje personalizado que recibirán tus clientes..."
                  />
                  <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                    <span>{sendAllMessage.length} / 4096 caracteres</span>
                    <span>Intervalo seguro: {delay}s entre cada envío</span>
                  </div>
                </div>

                {/* Vista previa WhatsApp en vivo */}
                <div className="p-3 rounded-2xl border space-y-1 shadow-inner" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                  <div className="flex items-center justify-between text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                    <span>Vista previa en vivo</span>
                    <span>Cliente: {clients[0]?.nombre || 'Elena Gómez'}</span>
                  </div>
                  <p className="text-xs italic leading-relaxed pt-1" style={{ color: "var(--wa-text)" }}>
                    "{sendAllMessage
                      .replace(/{{nombre}}/g, clients[0]?.nombre || 'Elena Gómez')
                      .replace(/{{nota}}/g, clients[0]?.nota || 'Plan mensual activo')
                      .replace(/{{monto}}/g, 'su saldo pendiente')
                      .replace(/{{vencimiento}}/g, 'la fecha límite')}"
                  </p>
                </div>

                {/* Toggle Opcional de Programación */}
                <div className="flex items-center justify-between text-xs pt-1">
                  <button
                    type="button"
                    onClick={() => setSendAllMode(prev => prev === 'NOW' ? 'SCHEDULE' : 'NOW')}
                    className="text-xs text-gray-500 hover:text-emerald-600 flex items-center gap-1.5 cursor-pointer font-medium"
                  >
                    <Calendar size={13} />
                    <span>{sendAllMode === 'SCHEDULE' ? 'Cambiar a Enviar Inmediatamente' : '¿Programar para otra fecha u hora?'}</span>
                  </button>

                  {sendAllMode === 'SCHEDULE' && (
                    <input
                      type="datetime-local"
                      value={sendAllScheduleTime}
                      onChange={(e) => setSendAllScheduleTime(e.target.value)}
                      className="wa-textarea text-xs py-1 px-2.5 sm:w-auto"
                    />
                  )}
                </div>

                {/* Acciones Finales: NUNCA DESACTIVADAS */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-3 border-t" style={{ borderColor: "var(--wa-border)" }}>
                  <button
                    type="button"
                    onClick={() => setSendAllModalOpen(false)}
                    className="btn-wa-secondary w-full sm:w-auto text-xs py-2 px-4 cursor-pointer justify-center"
                  >
                    Cancelar
                  </button>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    {status === 'CONNECTED' ? (
                      <button
                        type="button"
                        onClick={handleConfirmSendAll}
                        disabled={sendAllSending || !sendAllMessage.trim()}
                        className="btn-wa-primary w-full sm:w-auto text-xs py-2.5 px-6 font-bold cursor-pointer shadow-md flex items-center justify-center gap-2"
                        style={{ background: "#00a884" }}
                      >
                        {sendAllSending ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            <span>Transmitiendo Campaña...</span>
                          </>
                        ) : sendAllMode === 'SCHEDULE' ? (
                          <>
                            <Calendar size={15} />
                            <span>Programar Envío ({
                              sendAllAudience === 'ALL'
                                ? clients.length
                                : clients.filter(c => (c.estado || 'PENDIENTE') === sendAllAudience).length
                            })</span>
                          </>
                        ) : (
                          <>
                            <Send size={15} />
                            <span>🚀 Enviar a Todos ({
                              sendAllAudience === 'ALL'
                                ? clients.length
                                : clients.filter(c => (c.estado || 'PENDIENTE') === sendAllAudience).length
                            })</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setSendAllTab('wame')}
                          className="btn-wa-secondary w-full sm:w-auto text-xs py-2.5 px-3.5 font-bold cursor-pointer flex items-center justify-center gap-1.5"
                          title="Enviar individualmente por WhatsApp Web sin esperar vincular el QR"
                        >
                          <ExternalLink size={13} />
                          <span>Enviar vía Web</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSendAllTab('qr')}
                          className="btn-wa-primary w-full sm:w-auto text-xs py-2.5 px-5 font-bold cursor-pointer shadow-md flex items-center justify-center gap-2"
                          style={{ background: "#d97706" }}
                          title="Escanear código QR para activar el envío en lote"
                        >
                          <Smartphone size={15} />
                          <span>Vincular QR para Enviar</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* PESTAÑA 2: VINCULACIÓN CON CÓDIGO QR */}
            {sendAllTab === 'qr' && (
              <div className="space-y-4 animate-fadeIn">
                <div className="p-4 rounded-2xl border space-y-3 text-center" style={{ background: "rgba(245, 158, 11, 0.06)", borderColor: "rgba(245, 158, 11, 0.35)" }}>
                  <div className="flex items-center justify-center gap-2 text-amber-600 font-bold text-xs">
                    <Smartphone size={16} />
                    <span>Vinculación Rápida de WhatsApp en la Nube</span>
                  </div>

                  {status === 'CONNECTED' ? (
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 space-y-2">
                      <div className="flex items-center justify-center gap-2 font-bold text-sm">
                        <CheckCircle2 size={18} />
                        <span>¡Tu WhatsApp ya está vinculado y listo!</span>
                      </div>
                      <p className="text-xs">
                        Puedes regresar a la pestaña de mensaje y transmitir tu campaña a todos los clientes.
                      </p>
                      <button
                        type="button"
                        onClick={() => setSendAllTab('compose')}
                        className="btn-wa-primary text-xs py-2 px-5 font-bold mx-auto cursor-pointer"
                        style={{ background: "#00a884" }}
                      >
                        Continuar al Envío ➔
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--wa-muted)" }}>
                        Escanea este código con tu celular para que el sistema envíe tus mensajes automáticamente:
                        <br />
                        <strong className="text-[11px]" style={{ color: "var(--wa-text)" }}>
                          WhatsApp &gt; Dispositivos vinculados &gt; Vincular un dispositivo
                        </strong>
                      </p>

                      {qr ? (
                        <div className="py-1">
                          <div className="inline-block p-2 rounded-2xl bg-white border-2 shadow-lg" style={{ borderColor: "#00a884" }}>
                            <img src={qr} alt="Código QR WhatsApp" className="w-44 h-44 mx-auto" />
                          </div>
                        </div>
                      ) : (
                        <div className="py-8 flex flex-col items-center justify-center gap-2">
                          <Loader2 size={28} className="animate-spin" style={{ color: "var(--wa-button)" }} />
                          <span className="text-xs font-semibold" style={{ color: "var(--wa-muted)" }}>
                            Generando tu código QR... por favor espera un momento
                          </span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handleCheckWhatsAppStatus}
                          className="btn-wa-primary text-xs py-2 px-4 cursor-pointer font-bold flex items-center gap-1.5 shadow-sm"
                          style={{ background: "#00a884" }}
                        >
                          <RefreshCw size={13} />
                          <span>¿Ya lo escaneaste? Verificar Estado</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => { fetchStatus(); showToast('info', 'Actualizando código QR...'); }}
                          className="btn-wa-secondary text-xs py-2 px-3.5 cursor-pointer"
                        >
                          Refrescar QR
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: "var(--wa-border)" }}>
                  <button
                    type="button"
                    onClick={() => setSendAllTab('compose')}
                    className="btn-wa-secondary text-xs py-2 px-4 cursor-pointer"
                  >
                    ← Volver al Mensaje
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendAllTab('wame')}
                    className="text-xs font-bold text-[#00a884] hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span>O enviar directo vía WhatsApp Web</span>
                    <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* PESTAÑA 3: WHATSAPP WEB DIRECTO (wa.me) */}
            {sendAllTab === 'wame' && (
              <div className="space-y-4 animate-fadeIn">
                <div className="p-3.5 rounded-2xl border space-y-2" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold block" style={{ color: "var(--wa-text)" }}>
                        Envío Inmediato vía WhatsApp Web (Sin Código QR)
                      </span>
                      <span className="text-[11px] block" style={{ color: "var(--wa-muted)" }}>
                        Abre cada conversación con el mensaje ya redactado y personalizado.
                      </span>
                    </div>
                    {clients.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleOpenAllWhatsAppTabs(clients, sendAllMessage || message)}
                        className="btn-wa-primary text-[11px] py-1.5 px-3 font-bold cursor-pointer shadow-xs flex items-center gap-1"
                        style={{ background: "#00a884" }}
                        title="Abrir pestañas de WhatsApp Web para todos los clientes a la vez"
                      >
                        <ExternalLink size={12} />
                        <span>Abrir Todos</span>
                      </button>
                    )}
                  </div>

                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1 pt-1">
                    {clients.map(c => (
                      <div 
                        key={c.id} 
                        className="flex items-center justify-between p-2.5 rounded-xl border transition-all text-xs"
                        style={{ background: "var(--wa-card)", borderColor: "var(--wa-border)" }}
                      >
                        <div className="flex items-center gap-2.5">
                          <div 
                            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0"
                            style={{ background: "linear-gradient(135deg, #075e54, #128c7e)" }}
                          >
                            {(c.nombre || 'CL').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-bold block" style={{ color: "var(--wa-text)" }}>{c.nombre}</span>
                            <span className="text-[10px]" style={{ color: "var(--wa-muted)" }}>+{c.numero}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenWhatsAppDirect(c, sendAllMessage || message)}
                          className="btn-wa-primary text-xs py-1.5 px-3 cursor-pointer flex items-center gap-1.5 font-bold shadow-xs"
                          style={{ background: "#00a884" }}
                        >
                          <ExternalLink size={12} />
                          <span>Enviar a {c.nombre.split(' ')[0]}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: "var(--wa-border)" }}>
                  <button
                    type="button"
                    onClick={() => setSendAllTab('compose')}
                    className="btn-wa-secondary text-xs py-2 px-4 cursor-pointer"
                  >
                    ← Volver al Mensaje
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendAllModalOpen(false)}
                    className="btn-wa-secondary text-xs py-2 px-4 cursor-pointer"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Overlay móvil para sidebar */}
      {menuAbierto && (
        <div 
          className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm"
          onClick={() => setMenuAbierto(false)} 
        />
      )}

      {/* == BARRA LATERAL (Sidebar estilo WhatsApp Web) == */}
      <aside className={`wa-sidebar ${menuAbierto ? "open" : ""}`}>
        
        {/* Cabecera del Sidebar */}
        <div className="wa-sidebar-header">
          <div className="flex items-center gap-2.5">
            <div className="wa-logo-badge">
              <MessageCircle size={28} />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight block" style={{ color: "var(--wa-text)" }}>
                WhatsApp Pagos
              </span>
              <span className="text-[10px] uppercase font-bold block" style={{ color: "var(--wa-button)" }}>
                Panel Administrativo
              </span>
            </div>
          </div>
          <button 
            className="md:hidden text-slate-400 p-1 hover:opacity-80"
            onClick={() => setMenuAbierto(false)}
          >
            <X size={18} />
          </button>
        </div>

        {/* Lista de Navegación */}
        <div className="wa-nav-list">
          <button
            type="button"
            onClick={() => { setActiveTab('dashboard'); setMenuAbierto(false); }}
            className={`wa-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
          >
            <div className="flex items-center gap-2.5">
              <LayoutDashboard size={17} />
              <span>Consola de Envío</span>
            </div>
            {status === 'CONNECTED' && (
              <span className="w-2 h-2 rounded-full pulse-indicator" style={{ background: "var(--wa-green)" }} />
            )}
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('contacts'); setMenuAbierto(false); }}
            className={`wa-nav-item ${activeTab === 'contacts' ? 'active' : ''}`}
          >
            <div className="flex items-center gap-2.5">
              <Users size={17} />
              <span>Directorio de Clientes</span>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--wa-input-bg)", color: "var(--wa-muted)" }}>
              {clients.length}
            </span>
          </button>

          {userRole === 'ADMIN' && (
            <button
              type="button"
              onClick={() => { setActiveTab('testing'); setMenuAbierto(false); }}
              className={`wa-nav-item ${activeTab === 'testing' ? 'active' : ''}`}
            >
              <div className="flex items-center gap-2.5">
                <FlaskConical size={17} />
                <span>Pruebas y Diagnóstico</span>
              </div>
            </button>
          )}

          {userRole === 'ADMIN' && (
            <button
              type="button"
              onClick={() => { setActiveTab('users'); setMenuAbierto(false); }}
              className={`wa-nav-item ${activeTab === 'users' ? 'active' : ''}`}
            >
              <div className="flex items-center gap-2.5">
                <ShieldCheck size={17} />
                <span>Usuarios de Plataforma</span>
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={() => { setActiveTab('settings'); setMenuAbierto(false); }}
            className={`wa-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          >
            <div className="flex items-center gap-2.5">
              <Settings size={17} />
              <span>Configuración</span>
            </div>
          </button>
        </div>

        {/* Footer del Sidebar */}
        <div className="wa-sidebar-footer">
          <div className="flex items-center justify-between p-2 rounded-xl mb-3" style={{ background: "var(--wa-input-bg)" }}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white shadow-sm" style={{ background: userRole === 'ADMIN' ? "#f59e0b" : "var(--wa-button)" }}>
                {userEmail ? userEmail[0].toUpperCase() : 'U'}
              </div>
              <div className="text-left overflow-hidden">
                <span className="text-xs font-semibold block truncate" style={{ color: "var(--wa-text)", maxWidth: "140px" }} title={userEmail}>
                  {userEmail || 'Usuario'}
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: status === 'CONNECTED' ? '#25d366' : '#9ca3af' }}></span>
                  <span className="text-[10px] block font-medium" style={{ color: "var(--wa-muted)" }}>
                    {userRole === 'ADMIN' ? 'Administrador' : 'Sesión Activa'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] px-1 pb-2 font-medium" style={{ color: "var(--wa-muted)" }}>
            <span className="flex items-center gap-1">
              <Timer size={11} />
              Auto-reinicio (30m):
            </span>
            <span 
              className="font-bold cursor-pointer hover:underline"
              onClick={handleExtendSession}
              title={autoResetEnabled ? "Se reinicia con el movimiento. Cierra tras 30 min sin uso." : "Desactivado en Ajustes"}
              style={{ color: autoResetEnabled ? (secondsLeft <= 60 ? "var(--wa-error)" : secondsLeft <= 300 ? "#f59e0b" : "var(--wa-text)") : "var(--wa-muted)" }}
            >
              {autoResetEnabled ? `Inactivo: ${formatTimeRemaining(secondsLeft)}` : "Desactivado"}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90"
            style={{ color: "var(--wa-error)", background: "rgba(234, 0, 56, 0.08)" }}
          >
            <LogOut size={14} />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* == CONTENIDO PRINCIPAL == */}
      <div className="wa-main-content">
        
        {/* Cabecera Superior Sticky */}
        <header className="wa-header">
          <div className="flex items-center gap-3">
            <button 
              className="md:hidden p-1.5 rounded-lg"
              style={{ color: "var(--wa-text)", background: "var(--wa-input-bg)" }}
              onClick={() => setMenuAbierto(true)}
            >
              <Menu size={18} />
            </button>
            <div>
              <h1 className="text-sm font-bold tracking-tight" style={{ color: "var(--wa-text)" }}>
                <span>
                  {activeTab === 'dashboard' ? 'Campañas Automatizadas de Cobro' :
                   activeTab === 'testing' ? 'Laboratorio de Pruebas & Diagnóstico del Backend' :
                   activeTab === 'contacts' ? 'Directorio de Números Telefónicos' :
                   activeTab === 'users' ? 'Gestión de Usuarios de Plataforma' :
                   activeTab === 'settings' ? 'Ajustes del Gateway' : 'Panel'}
                </span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Widget Inactividad 30m */}
            <div 
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer select-none"
              onClick={handleExtendSession}
              style={{
                background: !autoResetEnabled ? "rgba(107, 114, 128, 0.12)" : secondsLeft <= 60 ? "rgba(234, 0, 56, 0.15)" : secondsLeft <= 300 ? "rgba(245, 158, 11, 0.15)" : "rgba(59, 130, 246, 0.12)",
                color: !autoResetEnabled ? "var(--wa-muted)" : secondsLeft <= 60 ? "var(--wa-error)" : secondsLeft <= 300 ? "#f59e0b" : "#3b82f6",
                border: "1px solid var(--wa-border)"
              }}
              title={autoResetEnabled ? `Se reinicia con cualquier movimiento o tecla. Cierra sesión tras 30 min sin movimiento (${formatTimeRemaining(secondsLeft)} restantes). Haz clic para reiniciar a 30m.` : 'Cierre por inactividad desactivado. Haz clic en Ajustes para activarlo.'}
            >
              <Timer size={11} className={autoResetEnabled && secondsLeft <= 60 ? 'animate-pulse' : ''} />
              <span>{autoResetEnabled ? `Inactivo: ${formatTimeRemaining(secondsLeft)}` : 'Inactivo: Off'}</span>
              {autoResetEnabled && (
                <span className="text-[9px] opacity-75 hover:opacity-100 font-bold ml-0.5 px-1 py-0.2 rounded bg-black/10 dark:bg-white/10" title="Reiniciar a 30 minutos">
                  Reset
                </span>
              )}
            </div>

            {/* Medidor de Ping / Latencia */}
            {apiPing !== null && (
              <div 
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                style={{
                  background: apiPing < 100 ? "rgba(37, 211, 102, 0.12)" : "rgba(245, 158, 11, 0.12)",
                  color: apiPing < 100 ? "var(--wa-button)" : "#f59e0b",
                  border: "1px solid var(--wa-border)"
                }}
                title="Latencia de respuesta del servidor Express"
              >
                <Zap size={11} />
                <span>{apiPing} ms API</span>
              </div>
            )}

            {/* Estado de Conexión WhatsApp */}
            <div 
              className="px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2"
              style={{
                background: status === 'CONNECTED' ? 'rgba(37, 211, 102, 0.12)' : status === 'AUTHENTICATED' ? 'rgba(59, 130, 246, 0.12)' : status === 'QR_READY' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(234, 0, 56, 0.12)',
                color: status === 'CONNECTED' ? 'var(--wa-button)' : status === 'AUTHENTICATED' ? '#3b82f6' : status === 'QR_READY' ? '#f59e0b' : 'var(--wa-error)',
                border: `1px solid ${status === 'CONNECTED' ? 'rgba(37, 211, 102, 0.3)' : status === 'AUTHENTICATED' ? 'rgba(59, 130, 246, 0.3)' : status === 'QR_READY' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(234, 0, 56, 0.3)'}`
              }}
            >
              <span 
                className={`w-2 h-2 rounded-full ${status === 'CONNECTED' || status === 'AUTHENTICATED' ? 'pulse-indicator' : ''}`}
                style={{ 
                  background: status === 'CONNECTED' ? 'var(--wa-green)' : status === 'AUTHENTICATED' ? '#3b82f6' : status === 'QR_READY' ? '#f59e0b' : 'var(--wa-error)'
                }}
              />
              <span className="hidden sm:inline">
                {status === 'CONNECTED' ? 'WhatsApp Enlazado' : status === 'AUTHENTICATED' ? 'Vinculando...' : status === 'QR_READY' ? 'Escanea el Código' : 'Desconectado'}
              </span>
            </div>

            {/* Alternador de Modo Claro / Oscuro */}
            <button 
              type="button" 
              className="theme-toggle-mini"
              onClick={handleToggleDarkMode}
              aria-label="Cambiar tema"
            >
              <span>{darkMode ? <Sun size={13} /> : <Moon size={13} />}</span>
              <span className="hidden md:inline">{darkMode ? 'Claro' : 'Oscuro'}</span>
            </button>

            {/* Botón Cerrar Sesión en Barra Superior */}
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all hover:opacity-90 cursor-pointer shadow-sm"
              style={{ background: "rgba(234, 0, 56, 0.12)", color: "var(--wa-error)", border: "1px solid rgba(234, 0, 56, 0.25)" }}
              title="Cerrar sesión y salir al login"
            >
              <LogOut size={12} />
              <span>Salir</span>
            </button>
          </div>
        </header>

        {/* Contenido Acotado y Ergonómico */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6">
          
          {/* BANNER DE ESTADO DE WHATSAPP (Aviso de conexión para entrega de mensajes) */}
          {status !== 'CONNECTED' ? (
            <div 
              className="p-3.5 sm:p-4 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs"
              style={{ background: "rgba(245, 158, 11, 0.08)", borderColor: "rgba(245, 158, 11, 0.35)" }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold" style={{ background: "rgba(245, 158, 11, 0.2)", color: "#d97706" }}>
                  <Smartphone size={22} />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-bold flex items-center gap-2" style={{ color: "#d97706" }}>
                    <span>⚠️ WhatsApp Desconectado</span>
                    <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30">
                      Acción Requerida
                    </span>
                  </h3>
                  <p className="text-[11px] sm:text-xs mt-0.5 text-gray-600 dark:text-gray-300">
                    Los mensajes no saldrán hasta que vincules WhatsApp escaneando el código QR en la Consola.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setActiveTab('dashboard'); showToast('info', 'Escanea el código QR que se muestra a la derecha en la Consola.'); }}
                className="text-xs font-bold px-4 py-2 rounded-xl transition-all cursor-pointer whitespace-nowrap shadow-xs"
                style={{ background: "#d97706", color: "#fff" }}
              >
                Escanear Código QR
              </button>
            </div>
          ) : (
            <div 
              className="p-3 rounded-2xl border flex items-center justify-between gap-3 shadow-xs"
              style={{ background: "rgba(37, 211, 102, 0.08)", borderColor: "rgba(37, 211, 102, 0.25)" }}
            >
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                  WhatsApp Vinculado y Activo
                </span>
                <span className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 hidden sm:inline">
                  — Listo para enviar mensajes a todos tus clientes con 1 clic.
                </span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                Línea Conectada
              </span>
            </div>
          )}

          {/* Tarjetas KPI Informativas Superiores */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="wa-kpi-chip">
              <span className="wa-kpi-label">Destinatarios</span>
              <span className="wa-kpi-val">{totalDestinatarios}</span>
            </div>
            <div className="wa-kpi-chip">
              <span className="wa-kpi-label">Intervalo de Envío</span>
              <span className="wa-kpi-val" style={{ color: "var(--wa-button)" }}>{delay}s</span>
            </div>
            <div className="wa-kpi-chip">
              <span className="wa-kpi-label">Logs en Consola</span>
              <span className="wa-kpi-val">{logs.length}</span>
            </div>
            <div className="wa-kpi-chip">
              <span className="wa-kpi-label">Diagnóstico</span>
              <span className="wa-kpi-val" style={{ color: "var(--wa-button)" }}>
                {apiPing ? `${apiPing} ms` : 'Activo'}
              </span>
            </div>
          </div>

          {/* == PESTAÑA 1: CONSOLA DE ENVÍOS == */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Columna Izquierda: Redacción & Terminal (6 Cols) */}
              <div className="lg:col-span-6 space-y-8">
                
                {/* Tarjeta de Redacción */}
                <div className="wa-card space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: "var(--wa-border)" }}>
                    <div className="flex items-center gap-2">
                      <FileText size={17} style={{ color: "var(--wa-button)" }} />
                      <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: "var(--wa-text)" }}>
                        Redacción del Mensaje
                      </h2>
                    </div>

                    {/* Selector de Tiempo */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold" style={{ color: "var(--wa-muted)" }}>Ritmo:</span>
                      <div className="flex gap-1">
                        {PRESETS_DELAY.map((p, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              const val = p.val;
                              setDelay(val);
                              void saveTemplatesToBackend(plantillas, message, val);
                            }}
                            className="text-[10px] px-2 py-1 rounded-md font-semibold transition-all hover:opacity-90"
                            style={{
                              background: Number(delay) === p.val ? "var(--wa-button)" : "var(--wa-input-bg)",
                              color: Number(delay) === p.val ? "#fff" : "var(--wa-muted)"
                            }}
                            title={`Establecer en ${p.val}s`}
                          >
                            {p.val}s
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                        <input
                          type="number"
                          min="1"
                          max="60"
                          value={delay}
                          onChange={(e) => setDelay(e.target.value)}
                          onBlur={() => {
                            const val = Math.max(1, Number(delay) || 4);
                            setDelay(val);
                            void saveTemplatesToBackend(plantillas, message, val);
                          }}
                          className="w-7 text-center text-[10px] font-bold bg-transparent outline-none"
                          style={{ color: "var(--wa-text)" }}
                          title="Intervalo personalizado en segundos"
                        />
                        <span className="text-[9px] font-semibold" style={{ color: "var(--wa-muted)" }}>seg</span>
                      </div>
                    </div>
                  </div>

                  {/* Plantillas en Tarjetas */}
                  <div>
                    <div className="mb-2">
                      <span className="text-[11px] font-bold block" style={{ color: "var(--wa-muted)" }}>
                        Plantillas sugeridas:
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(Array.isArray(plantillas) ? plantillas : []).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setMessage(p.texto);
                            setIsEditingMessage(true);
                            showToast("info", `Plantilla "${p.nombre}" aplicada al mensaje.`);
                          }}
                          className="text-left p-2.5 rounded-xl border transition-all text-xs hover:border-[#00a884] cursor-pointer"
                          style={{
                            background: "var(--wa-input-bg)",
                            borderColor: "var(--wa-border)",
                            color: "var(--wa-text)"
                          }}
                          title="Haga clic para aplicar esta plantilla al mensaje"
                        >
                          <span className="font-bold block mb-1 text-[11px]" style={{ color: "var(--wa-button)" }}>
                            {p.nombre}
                          </span>
                          <p className="text-[10px] line-clamp-2 leading-relaxed" style={{ color: "var(--wa-muted)" }}>
                            {p.texto}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Variables Dinámicas */}
                  <div className="p-2.5 rounded-xl border" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                    <span className="text-[10px] uppercase font-bold tracking-wider block mb-1.5" style={{ color: "var(--wa-muted)" }}>
                      Variables personalizables (clic para insertar):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {VARIABLES.map((v, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setIsEditingMessage(true);
                            insertarVariable(v.tag);
                          }}
                          className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all hover:bg-[#00a884] hover:text-white shadow-xs"
                          style={{
                            background: "var(--wa-card)",
                            color: "var(--wa-button)",
                            borderColor: "var(--wa-border)"
                          }}
                          title={`Insertar ${v.label} en el mensaje`}
                        >
                          <Plus size={11} />
                          <span>{v.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tarjeta de Acción Rápida: Enviar a Todos los Clientes */}
                  <div className="p-3.5 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs" 
                       style={{ background: "rgba(0, 168, 132, 0.08)", borderColor: "rgba(0, 168, 132, 0.35)" }}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold" style={{ background: "#00a884", color: "#fff" }}>
                        <Users size={20} />
                      </div>
                      <div>
                        <span className="text-xs font-bold block" style={{ color: "var(--wa-text)" }}>
                          Envío Fácil con 1 Clic a Todos tus Clientes
                        </span>
                        <span className="text-[11px] block" style={{ color: "var(--wa-muted)" }}>
                          {clients.length > 0 
                            ? `Tienes ${clients.length} cliente(s) registrados. Envía tu mensaje a todos con un solo clic.` 
                            : 'Agrega tus clientes en la pestaña Directorio para enviarles con 1 clic.'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenSendAllModal}
                      className="btn-wa-primary sm:w-auto px-4 py-2 text-xs font-bold cursor-pointer flex items-center gap-1.5 shadow-sm whitespace-nowrap"
                      style={{ background: "#00a884" }}
                      title="Abrir ventana de confirmación para enviar a todos los clientes registrados"
                    >
                      <Send size={13} />
                      <span>🚀 Enviar a Todos ({clients.length})</span>
                    </button>
                  </div>

                  {/* Área de Texto */}
                  <div>
                    <div className="relative">
                      <textarea
                        ref={textareaRef}
                        value={message || ""}
                        onChange={e => setMessage(e.target.value)}
                        readOnly={!isEditingMessage}
                        rows={5}
                        maxLength={4096}
                        className={`wa-textarea transition-all duration-300 ${isEditingMessage ? 'focus:ring-2 focus:ring-[#00a884]' : 'opacity-85'}`}
                        style={{ 
                          background: "var(--wa-input-bg)", 
                          color: "var(--wa-text)", 
                          borderColor: "var(--wa-border)" 
                        }}
                        placeholder={isEditingMessage ? "Escriba el mensaje para sus clientes..." : "Mensaje protegido. Presione 'Editar' para redactar o modificar."}
                      />
                    </div>
                    <div className="flex justify-between items-center mt-2 px-1">
                      <div className="flex items-center gap-2">
                        {!isEditingMessage ? (
                          <button
                            type="button"
                            onClick={() => {
                              setIsEditingMessage(true);
                              setTimeout(() => textareaRef.current?.focus(), 50);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#00a884] text-white hover:bg-[#008f6f] transition-all font-semibold shadow-sm text-xs"
                            title="Editar mensaje"
                          >
                            <Pencil size={13} />
                            <span className="text-[11px] font-bold uppercase tracking-wider">Editar</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                const saved = await saveTemplatesToBackend(plantillas, message, delay);
                                if (saved) setIsEditingMessage(false);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#00a884] text-white hover:bg-[#008f6f] transition-colors shadow-sm"
                              title="Guardar cambios del mensaje"
                            >
                              <Save size={14} />
                              <span className="text-[11px] font-bold uppercase tracking-wider">Guardar</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setIsEditingMessage(false);
                                fetchTemplates();
                                showToast("info", "Edición cancelada.");
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors shadow-sm"
                              title="Cancelar y descartar cambios"
                            >
                              <X size={14} />
                              <span className="text-[11px] font-bold uppercase tracking-wider">Cancelar</span>
                            </button>
                          </>
                        )}
                      </div>
                      <div className="flex justify-end items-center text-[11px]" style={{ color: "var(--wa-muted)" }}>
                        <button
                          type="button"
                          onClick={copiarTexto}
                          className="hover:underline flex items-center gap-1 font-semibold"
                          style={{ color: "var(--wa-button)" }}
                        >
                          <span>{copiado ? <Check size={12} /> : <Copy size={12} />}</span>
                          <span>{copiado ? 'Copiado' : 'Copiar texto'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              {/* Columna Derecha: Mockup Celular, Destinatarios y Enviar (6 Cols) */}
              <div className="lg:col-span-6 space-y-8">
                
                {/* MOCKUP DE TELÉFONO WHATSAPP */}
                <div className="wa-card">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b" style={{ borderColor: "var(--wa-border)" }}>
                    <div className="flex items-center gap-2">
                      <Smartphone size={24} style={{ color: "var(--wa-button)" }} />
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--wa-text)" }}>
                        Vista Previa Cliente
                      </span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(0, 168, 132, 0.12)", color: "var(--wa-button)" }}>
                      WhatsApp Web
                    </span>
                  </div>

                  {/* Chasis del Celular */}
                  <div className="wa-mockup-frame">

                    {/* Barra de Estado */}
                    <div style={{ background: "#1f2c34", padding: "6px 14px", display: "flex", justifyContent: "space-between", color: "#fff", fontSize: "10px" }}>
                      <span>{horaActual}</span>
                      <div style={{ width: "50px", height: "10px", background: "#000", borderRadius: "10px" }} />
                      <div className="flex items-center gap-1.5 opacity-90">
                        <Wifi size={10} />
                        <Battery size={11} />
                      </div>
                    </div>

                    {/* Cabecera WhatsApp */}
                    <div className="wa-mockup-header">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white" style={{ background: "#25d366" }}>
                          NB
                        </div>
                        <div className="text-left leading-none">
                          <span className="font-bold text-xs block">NeoBanco Pagos</span>
                          <span className="text-[9px] opacity-80 mt-0.5 block">en línea</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 opacity-80">
                        <Video size={16} />
                        <Phone size={16} />
                        <MoreVertical size={16} />
                      </div>
                    </div>

                    {/* Conversación */}
                    <div className="wa-mockup-chat">
                      <div className="wa-bubble-in">
                        <p>Hola, ¿tienen recordatorio de mi facturación?</p>
                        <span style={{ fontSize: "9px", opacity: 0.6, display: "block", textAlign: "right", marginTop: "2px" }}>11:45 a. m.</span>
                      </div>

                      <div className="wa-bubble-out">
                        <p style={{ whiteSpace: "pre-wrap" }}>{message || 'Escriba un mensaje para previsualizarlo...'}</p>
                        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "3px", marginTop: "3px", fontSize: "9px", opacity: 0.7 }}>
                          <span>{horaActual}</span>
                          <CheckCheck size={14} color="#53bdeb" />
                        </div>
                      </div>
                    </div>

                    {/* Barra de Entrada de WhatsApp */}
                    <div style={{ background: "#1f2c34", padding: "6px 8px", display: "flex", alignItems: "center", gap: "8px" }}>
                      <Smile size={18} color="#8696a0" />
                      <div style={{ flex: 1, background: "#2a3942", borderRadius: "18px", padding: "4px 12px", fontSize: "11px", color: "#8696a0" }}>
                        Mensaje
                      </div>
                      <Paperclip size={16} color="#8696a0" />
                      <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "#00a884", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                        <Mic size={14} />
                      </div>
                    </div>

                  </div>
                </div>

                {/* == DESTINATARIOS Y ARCHIVO == */}
                <div className="wa-card space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--wa-text)" }}>
                      <Users size={14} style={{ color: "var(--wa-button)" }} />
                      Destinatarios Activos
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: "rgba(0, 168, 132, 0.12)", color: "var(--wa-button)" }}>
                      {totalDestinatarios} números
                    </span>
                  </div>

                  <textarea
                    value={numbers}
                    onChange={e => setNumbers(e.target.value)}
                    rows={3}
                    className="wa-textarea text-xs"
                    placeholder="18095550123&#10;18095550124"
                  />

                  <input 
                    type="file" 
                    accept=".csv, .txt" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload} 
                    className="hidden" 
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current.click()}
                      className="btn-wa-secondary w-full justify-center cursor-pointer"
                    >
                      <Upload size={13} style={{ color: "var(--wa-button)" }} />
                      <span>Cargar CSV / TXT</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setNumbers('')}
                      className="btn-wa-secondary w-full justify-center cursor-pointer"
                      style={{ color: "var(--wa-error)" }}
                    >
                      <Trash2 size={13} />
                      <span>Limpiar</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleSyncClientsToMassSend}
                    disabled={clients.length === 0}
                    className="btn-wa-primary w-full justify-center text-xs py-2 shadow-xs cursor-pointer flex items-center gap-2"
                    title={`Cargar los ${clients.length} contactos de tu directorio a la lista de destinatarios`}
                  >
                    <Users size={14} />
                    <span>Cargar Todos los Clientes Agregados ({clients.length})</span>
                  </button>
                </div>

                {/* == ESTADO DEL CÓDIGO QR / VINCULACIÓN == */}
                <div className="wa-card text-center space-y-3">
                  {status === 'CONNECTED' ? (
                    <div className="py-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(37, 211, 102, 0.15)", color: "var(--wa-green)" }}>
                          <ShieldCheck size={22} />
                        </div>
                        <div className="text-left">
                          <span className="text-xs font-bold block" style={{ color: "var(--wa-text)" }}>WhatsApp Vinculado</span>
                          <span className="text-[11px] block" style={{ color: "var(--wa-muted)" }}>Sesión activa en tu cuenta</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleDisconnectWhatsApp}
                        className="text-[11px] px-3 py-1.5 rounded-lg border font-semibold transition-all hover:bg-red-500/10 text-red-500 border-red-500/30"
                        title="Desvincular esta línea telefónica y generar un nuevo código QR"
                      >
                        Cambiar Teléfono
                      </button>
                    </div>
                  ) : status === 'AUTHENTICATED' ? (
                    <div className="py-4 space-y-2">
                      <div className="flex items-center justify-center gap-2" style={{ color: "var(--wa-button)" }}>
                        <Loader2 size={18} className="animate-spin" />
                        <span className="text-xs font-bold">Código QR escaneado con éxito</span>
                      </div>
                      <p className="text-[11px]" style={{ color: "var(--wa-muted)" }}>
                        Autenticando sesión y sincronizando mensajes...
                      </p>
                    </div>
                  ) : qr && status !== 'CONNECTED' && status !== 'AUTHENTICATED' ? (
                    <div className="py-2">
                      <div className="inline-block p-2.5 rounded-2xl bg-white border-2 shadow-sm mb-2" style={{ borderColor: "var(--wa-button)" }}>
                        <img src={qr} alt="Código QR WhatsApp" className="w-40 h-40 mx-auto" />
                      </div>
                      <span className="text-xs font-bold block" style={{ color: "var(--wa-text)" }}>Escanea con tu celular</span>
                      <span className="text-[11px] block mt-0.5" style={{ color: "var(--wa-muted)" }}>
                        WhatsApp &gt; Dispositivos vinculados &gt; Vincular un dispositivo
                      </span>
                      <div className="mt-3 flex flex-col sm:flex-row items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={handleCheckWhatsAppStatus}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all shadow-sm"
                          style={{ borderColor: "var(--wa-button)", color: "var(--wa-button)", background: "rgba(0, 168, 132, 0.08)" }}
                        >
                          ¿Ya escaneaste? Verificar Estado
                        </button>
                        <button
                          type="button"
                          onClick={handleDisconnectWhatsApp}
                          className="text-[11px] text-gray-500 hover:text-gray-700 underline"
                        >
                          Regenerar código QR
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="py-4 space-y-2">
                      <div className="flex items-center justify-center gap-2" style={{ color: "var(--wa-muted)" }}>
                        <Loader2 size={16} className="animate-spin" style={{ color: "var(--wa-button)" }} />
                        <span className="text-xs font-semibold">
                          {status === 'INITIALIZING'
                            ? 'Iniciando pasarela de WhatsApp en la nube...'
                            : status === 'QR_READY'
                              ? 'Cargando código QR...'
                              : 'Conectando con la pasarela de WhatsApp...'}
                        </span>
                      </div>
                      <p className="text-[11px]" style={{ color: "var(--wa-muted)" }}>
                        {status === 'INITIALIZING'
                          ? 'Preparando Chromium y cargando WhatsApp Web. Esto toma unos momentos.'
                          : 'Esperando imagen del código QR.'}
                      </p>
                      <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => { fetchStatus(); showToast('info', 'Consultando estado del código QR...'); }}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all shadow-sm"
                          style={{ borderColor: "var(--wa-button)", color: "var(--wa-button)", background: "rgba(0, 168, 132, 0.08)" }}
                        >
                          Actualizar Código QR
                        </button>
                        <button
                          type="button"
                          onClick={handleDisconnectWhatsApp}
                          className="text-[11px] text-gray-500 hover:text-gray-700 underline"
                        >
                          Reiniciar pasarela
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* == BOTONES DE ENVÍO Y TEST RÁPIDO == */}
                <div className="space-y-2">
                  <button
                    onClick={handleSend}
                    disabled={status !== 'CONNECTED' || loading}
                    className="btn-wa-primary"
                    title={status !== 'CONNECTED' ? 'Escanea el código QR superior para vincular WhatsApp antes de enviar' : 'Iniciar transmisión masiva'}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        <span>Transmitiendo Campaña...</span>
                      </>
                    ) : status !== 'CONNECTED' ? (
                      <>
                        <Smartphone size={16} />
                        <span>Vincular WhatsApp para Enviar</span>
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        <span>Iniciar Transmisión Masiva</span>
                      </>
                    )}
                  </button>

                  {clients.length > 0 && (
                    <button
                      type="button"
                      onClick={handleOpenSendAllModal}
                      disabled={status !== 'CONNECTED' || loading}
                      className="btn-wa-secondary w-full justify-center font-bold text-xs py-2.5 cursor-pointer shadow-xs"
                      style={{ borderColor: "var(--wa-button)", color: "var(--wa-button)" }}
                      title={`Enviar mensaje directo a todos los ${clients.length} clientes del directorio`}
                    >
                      <Users size={14} />
                      <span>🚀 Enviar a Todos mis Clientes ({clients.length})</span>
                    </button>
                  )}

                  {status !== 'CONNECTED' && (
                    <p className="text-[11px] text-center font-medium" style={{ color: "var(--wa-muted)" }}>
                      Escanea el código QR arriba para activar el envío.
                    </p>
                  )}
                </div>

              </div>

            </div>

            {/* == SECCIÓN DE ENVÍOS PROGRAMADOS (SCHEDULER) == */}
            <div className="wa-card space-y-3">
              <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: "var(--wa-border)" }}>
                <div className="flex items-center gap-2">
                  <Calendar size={17} style={{ color: "var(--wa-button)" }} />
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--wa-text)" }}>
                    Envíos Automáticos Programados ({schedules.filter(s => s.status === 'SCHEDULED').length})
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={fetchSchedules}
                  disabled={schedulesLoading}
                  className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw size={11} className={schedulesLoading ? 'animate-spin' : ''} />
                  <span>Actualizar</span>
                </button>
              </div>

              {schedules.length === 0 ? (
                <p className="text-xs py-2 text-center" style={{ color: "var(--wa-muted)" }}>
                  No tienes campañas programadas. Puedes programar un envío con fecha futura desde el botón "Enviar a Todos".
                </p>
              ) : (
                <div className="space-y-2">
                  {schedules.slice(0, 5).map((s) => (
                    <div 
                      key={s.id}
                      className="p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span 
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              s.status === 'SCHEDULED' ? 'bg-amber-500/15 text-amber-600 border border-amber-500/30' :
                              s.status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30' :
                              s.status === 'RUNNING' ? 'bg-blue-500/15 text-blue-600 border border-blue-500/30 animate-pulse' :
                              'bg-red-500/15 text-red-600 border border-red-500/30'
                            }`}
                          >
                            {s.status === 'SCHEDULED' ? 'Programado' : s.status === 'COMPLETED' ? 'Ejecutado' : s.status === 'RUNNING' ? 'Enviando...' : 'Fallido'}
                          </span>
                          <span className="font-bold flex items-center gap-1" style={{ color: "var(--wa-text)" }}>
                            <Clock size={12} />
                            {new Date(s.scheduledAt).toLocaleString()}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            (Audiencia: {s.filterEstado || 'TODOS'})
                          </span>
                        </div>
                        <p className="text-[11px] line-clamp-1 italic text-gray-500">
                          "{s.messageTemplate}"
                        </p>
                      </div>

                      {s.status === 'SCHEDULED' && (
                        <button
                          type="button"
                          onClick={() => handleCancelSchedule(s.id)}
                          className="btn-wa-secondary text-xs py-1 px-2.5 text-red-500 border-red-500/30 hover:bg-red-500/10 cursor-pointer self-end sm:self-center"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

          {/* == PESTAÑA 2: LABORATORIO DE PRUEBAS & DIAGNÓSTICO DEL SISTEMA (SOLO ADMIN) == */}
          {activeTab === 'testing' && userRole === 'ADMIN' && (
            <div className="space-y-6">
              
              {/* Tarjeta de Métricas y Diagnóstico General */}
              <div className="wa-card space-y-4">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 pb-3 border-b" style={{ borderColor: "var(--wa-border)" }}>
                  <div>
                    <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--wa-text)" }}>
                      <Server size={17} style={{ color: "var(--wa-button)" }} />
                      Diagnóstico del Sistema & Métricas en Vivo
                    </h2>
                    <p className="text-xs mt-0.5" style={{ color: "var(--wa-muted)" }}>
                      Estado operativo del servidor Express y del socket de WhatsApp.
                    </p>
                  </div>
                  
                  <button
                    type="button"
                    onClick={fetchHealthAndPing}
                    disabled={healthLoading}
                    className="btn-wa-secondary"
                  >
                    <RefreshCw size={14} className={healthLoading ? 'animate-spin' : ''} />
                    <span>Actualizar Métricas</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="p-3 rounded-xl border" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                    <span className="text-[10px] uppercase font-bold block" style={{ color: "var(--wa-muted)" }}>Latencia API</span>
                    <span className="text-lg font-bold block mt-1" style={{ color: "var(--wa-button)" }}>
                      {apiPing !== null ? `${apiPing} ms` : '--'}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--wa-muted)" }}>Respuesta HTTP</span>
                  </div>

                  <div className="p-3 rounded-xl border" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                    <span className="text-[10px] uppercase font-bold block" style={{ color: "var(--wa-muted)" }}>Tiempo Activo</span>
                    <span className="text-lg font-bold block mt-1" style={{ color: "var(--wa-text)" }}>
                      {healthData?.uptime || '--'}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--wa-muted)" }}>Uptime Servidor</span>
                  </div>

                  <div className="p-3 rounded-xl border" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                    <span className="text-[10px] uppercase font-bold block" style={{ color: "var(--wa-muted)" }}>Memoria RAM Heap</span>
                    <span className="text-lg font-bold block mt-1" style={{ color: "var(--wa-text)" }}>
                      {healthData?.memoryMB?.heapUsed ? `${healthData.memoryMB.heapUsed} MB` : '--'}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--wa-muted)" }}>RSS: {healthData?.memoryMB?.rss || '--'} MB</span>
                  </div>

                  <div className="p-3 rounded-xl border" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                    <span className="text-[10px] uppercase font-bold block" style={{ color: "var(--wa-muted)" }}>Cliente WhatsApp</span>
                    <span className="text-lg font-bold block mt-1" style={{ color: status === 'CONNECTED' ? 'var(--wa-green)' : '#f59e0b' }}>
                      {status === 'CONNECTED' ? 'EN LÍNEA' : status === 'QR_READY' ? 'ESPERA QR' : 'INACTIVO'}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--wa-muted)" }}>
                      {healthData?.clientInfo?.pushname ? healthData.clientInfo.pushname : 'whatsapp-web.js'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl border col-span-2 md:col-span-1" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                    <span className="text-[10px] uppercase font-bold flex items-center gap-1" style={{ color: "var(--wa-muted)" }}>
                      <Database size={11} /> Base de Datos
                    </span>
                    <span className="text-sm font-bold block mt-1 truncate" style={{ color: healthData?.database?.isMongoConnected ? 'var(--wa-green)' : 'var(--wa-button)' }}>
                      {healthData?.database?.isMongoConnected ? 'MongoDB Atlas' : 'Local Seguro'}
                    </span>
                    <span className="text-[10px] truncate block" style={{ color: "var(--wa-muted)" }}>
                      {healthData?.database?.isMongoConnected ? (healthData?.database?.databaseName || 'Atlas Conectado') : 'Cifrado AES-256'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Grid con las Herramientas de Prueba Específicas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 1. Envío de Prueba Individual */}
                <div className="wa-card space-y-4">
                  <div className="pb-3 border-b flex items-center justify-between" style={{ borderColor: "var(--wa-border)" }}>
                    <div className="flex items-center gap-2">
                      <Send size={16} style={{ color: "var(--wa-button)" }} />
                      <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--wa-text)" }}>
                        Prueba 1: Envío Directo (1 Mensaje)
                      </h3>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--wa-input-bg)", color: "var(--wa-muted)" }}>
                      POST /api/test/single
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] font-bold block mb-1" style={{ color: "var(--wa-muted)" }}>
                        Número de Destino (con código país):
                      </label>
                      <input
                        type="text"
                        value={testNumber}
                        onChange={e => setTestNumber(e.target.value)}
                        maxLength={20}
                        className="wa-textarea"
                        placeholder="18095550123"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold block mb-1" style={{ color: "var(--wa-muted)" }}>
                        Cuerpo del Mensaje de Prueba:
                      </label>
                      <textarea
                        value={testMessage}
                        onChange={e => setTestMessage(e.target.value)}
                        rows={2}
                        maxLength={4096}
                        className="wa-textarea"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleSingleTest}
                      disabled={testLoading}
                      className="btn-wa-primary text-xs py-2.5"
                    >
                      {testLoading ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Transmitiendo mensaje de prueba...</span>
                        </>
                      ) : (
                        <>
                          <Zap size={14} />
                          <span>Disparar Mensaje de Prueba</span>
                        </>
                      )}
                    </button>

                    {testResult && (
                      <div 
                        className="p-3 rounded-xl text-xs border"
                        style={{
                          background: testResult.success ? "rgba(37, 211, 102, 0.08)" : "rgba(234, 0, 56, 0.08)",
                          borderColor: testResult.success ? "var(--wa-green)" : "var(--wa-error)"
                        }}
                      >
                        <div className="font-bold flex items-center gap-1.5" style={{ color: testResult.success ? "var(--wa-button)" : "var(--wa-error)" }}>
                          {testResult.success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                          <span>{testResult.success ? 'Envío Exitoso' : 'Fallo en Envío'}</span>
                        </div>
                        <p className="mt-1 text-[11px]" style={{ color: "var(--wa-text)" }}>
                          {testResult.message || testResult.error}
                        </p>
                        {testResult.jid && (
                          <span className="text-[10px] block mt-1 opacity-70">
                            JID Oficial: {testResult.jid}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Verificador de Cuenta de WhatsApp */}
                <div className="wa-card space-y-4">
                  <div className="pb-3 border-b flex items-center justify-between" style={{ borderColor: "var(--wa-border)" }}>
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={16} style={{ color: "var(--wa-button)" }} />
                      <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--wa-text)" }}>
                        Prueba 2: Comprobador de Cuenta WhatsApp
                      </h3>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--wa-input-bg)", color: "var(--wa-muted)" }}>
                      POST /api/test/check-number
                    </span>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs" style={{ color: "var(--wa-muted)" }}>
                      Consulta los servidores oficiales de WhatsApp para confirmar si un número está registrado sin enviarle ningún mensaje.
                    </p>

                    <div>
                      <label className="text-[11px] font-bold block mb-1" style={{ color: "var(--wa-muted)" }}>
                        Número a Comprobar:
                      </label>
                      <input
                        type="text"
                        value={testNumber}
                        onChange={e => setTestNumber(e.target.value)}
                        maxLength={20}
                        className="wa-textarea"
                        placeholder="18095550123"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleCheckNumber}
                      disabled={checkLoading}
                      className="btn-wa-secondary w-full justify-center text-xs py-2.5 font-bold"
                    >
                      {checkLoading ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Verificando en servidores WhatsApp...</span>
                        </>
                      ) : (
                        <>
                          <Users size={14} style={{ color: "var(--wa-button)" }} />
                          <span>Comprobar Si Tiene WhatsApp</span>
                        </>
                      )}
                    </button>

                    {checkResult && (
                      <div 
                        className="p-3 rounded-xl text-xs border"
                        style={{
                          background: checkResult.exists ? "rgba(37, 211, 102, 0.08)" : "rgba(245, 158, 11, 0.08)",
                          borderColor: checkResult.exists ? "var(--wa-green)" : "#f59e0b"
                        }}
                      >
                        <div className="font-bold flex items-center gap-1.5" style={{ color: checkResult.exists ? "var(--wa-button)" : "#f59e0b" }}>
                          {checkResult.exists ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                          <span>{checkResult.exists ? 'Cuenta WhatsApp Activa' : 'Sin Cuenta en WhatsApp'}</span>
                        </div>
                        <p className="mt-1 text-[11px]" style={{ color: "var(--wa-text)" }}>
                          {checkResult.exists ? `El número ${checkResult.cleanNumber} está registrado y listo para recibir cobros.` : checkResult.message || 'Este número no tiene cuenta.'}
                        </p>
                        {checkResult.jid && (
                          <span className="text-[10px] block mt-1 opacity-70">
                            JID Oficial: {checkResult.jid}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Simulador de Campaña Masiva (Sandbox Dry-Run) */}
                <div className="wa-card space-y-4">
                  <div className="pb-3 border-b flex items-center justify-between" style={{ borderColor: "var(--wa-border)" }}>
                    <div className="flex items-center gap-2">
                      <Sparkles size={16} style={{ color: "var(--wa-button)" }} />
                      <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--wa-text)" }}>
                        Prueba 3: Simulador de Campaña (Sandbox)
                      </h3>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--wa-input-bg)", color: "var(--wa-muted)" }}>
                      POST /api/test/simulate
                    </span>
                  </div>

                  <p className="text-xs" style={{ color: "var(--wa-muted)" }}>
                    Ejecuta un ciclo de transmisión simulado para probar tiempos, barras de progreso y eventos de socket sin gastar envíos reales.
                  </p>

                  <button
                    type="button"
                    onClick={handleSimulate}
                    disabled={simulating}
                    className="btn-wa-secondary w-full justify-center text-xs py-2.5 font-bold"
                  >
                    {simulating ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Ejecutando Simulación en Vivo...</span>
                      </>
                    ) : (
                      <>
                        <Zap size={14} style={{ color: "var(--wa-button)" }} />
                        <span>Iniciar Simulación Sandbox</span>
                      </>
                    )}
                  </button>
                </div>

                {/* 4. Control de Conexión y Sesión WhatsApp */}
                <div className="wa-card space-y-4">
                  <div className="pb-3 border-b flex items-center justify-between" style={{ borderColor: "var(--wa-border)" }}>
                    <div className="flex items-center gap-2">
                      <RefreshCw size={16} style={{ color: "var(--wa-button)" }} />
                      <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--wa-text)" }}>
                        Prueba 4: Control de Ciclo de Vida
                      </h3>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--wa-input-bg)", color: "var(--wa-muted)" }}>
                      POST /api/test/restart-client
                    </span>
                  </div>

                  <p className="text-xs" style={{ color: "var(--wa-muted)" }}>
                    Reinicia el motor Puppeteer y el cliente de WhatsApp para desatorar sesiones congeladas o forzar la generación de un nuevo código QR.
                  </p>

                  <button
                    type="button"
                    onClick={handleRestartClient}
                    disabled={restartingClient}
                    className="btn-wa-secondary w-full justify-center text-xs py-2.5 font-bold"
                    style={{ color: "var(--wa-error)" }}
                  >
                    {restartingClient ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Reiniciando Motor WhatsApp...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw size={14} />
                        <span>Reiniciar Sesión / Forzar Nuevo QR</span>
                      </>
                    )}
                  </button>
                </div>

              </div>

              {/* Terminal de Eventos de Prueba (Solo Administrador) */}
              <div className="wa-terminal-box shadow-md">
                <div className="wa-terminal-header">
                  <div className="flex items-center gap-2">
                    <Terminal size={14} style={{ color: "var(--wa-green)" }} />
                    <span>HISTORIAL DE ACTIVIDAD EN VIVO (ADMINISTRADOR)</span>
                  </div>
                  <button 
                    onClick={() => setLogs([])}
                    className="hover:underline flex items-center gap-1 text-[11px] font-bold"
                    style={{ color: "#8696a0" }}
                  >
                    <Trash2 size={12} /> Limpiar
                  </button>
                </div>
                <div className="wa-terminal-body">
                  <div style={{ color: "#8696a0" }}>
                    [{new Date().toLocaleTimeString()}] Laboratorio de pruebas conectado vía WebSocket.
                  </div>
                  {(Array.isArray(logs) ? logs : []).map((rawLog, i) => {
                    const log = (rawLog && typeof rawLog === 'object') ? rawLog : { text: String(rawLog || ''), time: '--', type: 'info' };
                    return (
                      <div 
                        key={i} 
                        style={{
                          color: log.type === 'error' ? 'var(--wa-error)' : log.type === 'warn' ? '#f59e0b' : 'var(--wa-green)'
                        }}
                      >
                        <span style={{ color: "#8696a0", marginRight: "6px" }}>[{log.time || '--'}]</span>
                        <span>{log.text}</span>
                      </div>
                    );
                  })}
                  <div ref={logsEndRef} />
                </div>
              </div>

            </div>
          )}

          {activeTab === 'testing' && userRole !== 'ADMIN' && (
            <div className="wa-card text-center py-12 space-y-3">
              <FlaskConical size={36} className="mx-auto" style={{ color: "var(--wa-button)" }} />
              <h3 className="text-sm font-bold" style={{ color: "var(--wa-text)" }}>Sección de Administración</h3>
              <p className="text-xs max-w-md mx-auto" style={{ color: "var(--wa-muted)" }}>
                El laboratorio de pruebas y diagnóstico del backend está reservado exclusivamente para el Administrador Principal.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className="btn-wa-primary text-xs mx-auto mt-2"
              >
                Volver a Consola de Envío
              </button>
            </div>
          )}

          {/* == PESTAÑA 3: DIRECTORIO DE CLIENTES (CRUD) == */}
          {activeTab === 'contacts' && (
            <div className="space-y-6">
              
              {/* Cabecera y Selector de Modalidad */}
              <div className="wa-card space-y-4">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 pb-3 border-b" style={{ borderColor: "var(--wa-border)" }}>
                  <div>
                    <h2 className="text-base font-bold flex items-center gap-2" style={{ color: "var(--wa-text)" }}>
                      <Users size={18} style={{ color: "var(--wa-button)" }} />
                      Directorio de Clientes & Contactos
                    </h2>
                    <p className="text-xs mt-0.5" style={{ color: "var(--wa-muted)" }}>
                      Base de datos persistente para administración de contactos y cobros automatizados.
                    </p>
                  </div>

                  {/* Alternador de Vista: Directorio vs Editor Masivo */}
                  <div className="flex items-center gap-1.5 p-1 rounded-xl" style={{ background: "var(--wa-input-bg)" }}>
                    <button
                      type="button"
                      onClick={() => setClientViewMode('directory')}
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
                      style={{
                        background: clientViewMode === 'directory' ? "var(--wa-card)" : "transparent",
                        color: clientViewMode === 'directory' ? "var(--wa-button)" : "var(--wa-muted)",
                        boxShadow: clientViewMode === 'directory' ? "0 2px 6px rgba(0,0,0,0.06)" : "none"
                      }}
                    >
                      Base de Datos ({clients.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setClientViewMode('bulk')}
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
                      style={{
                        background: clientViewMode === 'bulk' ? "var(--wa-card)" : "transparent",
                        color: clientViewMode === 'bulk' ? "var(--wa-button)" : "var(--wa-muted)",
                        boxShadow: clientViewMode === 'bulk' ? "0 2px 6px rgba(0,0,0,0.06)" : "none"
                      }}
                    >
                      Editor Masivo (CSV / TXT)
                    </button>
                  </div>
                </div>

                {/* Sub-vista 1: Base de Datos de Clientes */}
                {clientViewMode === 'directory' && (
                  <div className="space-y-5">
                    
                    {/* Formulario: Agregar / Editar Cliente */}
                    <form onSubmit={handleSaveClient} className="p-4 rounded-xl border space-y-3" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                      <div className="flex items-center gap-2 pb-2 border-b" style={{ borderColor: "var(--wa-border)" }}>
                        <UserPlus size={16} style={{ color: "var(--wa-button)" }} />
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--wa-text)" }}>
                          {editingClientId ? 'Editar Cliente' : 'Registrar Nuevo Cliente'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div>
                          <label className="text-[11px] font-bold block mb-1" style={{ color: "var(--wa-muted)" }}>
                            Nombre Completo *
                          </label>
                          <div>
                            <input
                              type="text"
                              value={newClientNombre}
                              onChange={e => setNewClientNombre(e.target.value)}
                              maxLength={100}
                              placeholder="ej: María Gómez"
                              className="wa-textarea"
                              required
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[11px] font-bold block mb-1" style={{ color: "var(--wa-muted)" }}>
                            Número WhatsApp *
                          </label>
                          <div>
                            <input
                              type="text"
                              value={newClientNumero}
                              onChange={e => setNewClientNumero(e.target.value)}
                              maxLength={20}
                              placeholder="ej: 18095550123"
                              className="wa-textarea"
                              required
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-[11px] font-bold block mb-1" style={{ color: "var(--wa-muted)" }}>
                            Estado de Cuenta
                          </label>
                          <select
                            value={newClientEstado}
                            onChange={e => setNewClientEstado(e.target.value)}
                            className="wa-textarea cursor-pointer text-xs font-semibold"
                            style={{ background: "var(--wa-input-bg)", color: "var(--wa-text)" }}
                          >
                            <option value="PENDIENTE">🟡 Saldo Pendiente</option>
                            <option value="VENCIDO">🔴 Factura Vencida</option>
                            <option value="PAGADO">🟢 Pagado / Al Día</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-[11px] font-bold block mb-1" style={{ color: "var(--wa-muted)" }}>
                            Nota / Concepto (Opcional)
                          </label>
                          <input
                            type="text"
                            value={newClientNota}
                            onChange={e => setNewClientNota(e.target.value)}
                            maxLength={500}
                            placeholder="ej: Factura #104 - RD$ 3,500"
                            className="wa-textarea"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end pt-1 gap-2">
                        {editingClientId && (
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="btn-wa-secondary sm:w-auto px-4 py-2.5 text-xs"
                          >
                            Cancelar
                          </button>
                        )}
                        <button
                          type="submit"
                          disabled={clientAdding}
                          className="btn-wa-primary sm:w-auto px-5 py-2.5 text-xs"
                        >
                          {clientAdding ? (
                            <>
                              <Loader2 size={14} className="animate-spin" />
                              <span>Guardando...</span>
                            </>
                          ) : (
                            <>
                              <UserPlus size={14} />
                              <span>{editingClientId ? 'Actualizar Cliente' : 'Guardar Cliente'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>

                    {/* Barra de Filtros y Sincronización */}
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                      <div className="relative flex-1 max-w-md">
                        <input
                          type="text"
                          value={clientSearch}
                          onChange={e => setClientSearch(e.target.value)}
                          maxLength={100}
                          placeholder="Buscar por nombre, teléfono o nota..."
                          className="wa-textarea pl-9 text-xs"
                        />
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--wa-muted)" }} />
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={fetchClients}
                          disabled={clientsLoading}
                          className="btn-wa-secondary text-xs"
                          title="Actualizar lista de clientes"
                        >
                          <RefreshCw size={13} className={clientsLoading ? 'animate-spin' : ''} />
                          <span>Actualizar</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleSyncClientsToMassSend}
                          disabled={clients.length === 0}
                          className="btn-wa-primary text-xs py-2 px-3.5 cursor-pointer flex items-center gap-1.5 shadow-sm"
                          title="Cargar todos los números a la consola de envíos masivos para personalizar el mensaje antes de transmitir"
                        >
                          <Send size={13} />
                          <span>Cargar Todos en Consola</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleExportClients}
                          disabled={clients.length === 0}
                          className="btn-wa-secondary text-xs py-2 px-3 cursor-pointer"
                          title="Descargar copia de seguridad de clientes en JSON"
                        >
                          <Download size={13} />
                          <span>Descargar BD</span>
                        </button>

                        <input
                          type="file"
                          ref={fileInputClientsRef}
                          onChange={handleImportClientsFile}
                          accept=".json"
                          style={{ display: "none" }}
                        />
                        <button
                          type="button"
                          onClick={() => fileInputClientsRef.current && fileInputClientsRef.current.click()}
                          className="btn-wa-secondary text-xs py-2 px-3 cursor-pointer"
                          title="Subir / Importar archivo de clientes JSON a tu directorio"
                        >
                          <Upload size={13} />
                          <span>Importar JSON</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleClearAllClients}
                          disabled={clients.length === 0}
                          className="btn-wa-secondary text-xs py-2 px-3 hover:bg-red-500/10 text-red-500 border-red-500/30 cursor-pointer"
                          title="Vaciar y eliminar todos los clientes del directorio"
                        >
                          <Trash2 size={13} />
                          <span>Vaciar</span>
                        </button>
                      </div>
                    </div>

                    {/* Filtros rápidos por Estado */}
                    <div className="flex items-center gap-2 flex-wrap mb-4">
                      <span className="text-xs font-semibold" style={{ color: "var(--wa-muted)" }}>Filtrar:</span>
                      {[
                        { id: 'ALL', label: 'Todos', count: clients.length },
                        { id: 'PENDIENTE', label: 'Pendientes', count: clients.filter(c => (c.estado || 'PENDIENTE') === 'PENDIENTE').length },
                        { id: 'VENCIDO', label: 'Vencidos', count: clients.filter(c => c.estado === 'VENCIDO').length },
                        { id: 'PAGADO', label: 'Pagados', count: clients.filter(c => c.estado === 'PAGADO').length },
                      ].map(pill => {
                        const active = clientFilterStatus === pill.id;
                        return (
                          <button
                            key={pill.id}
                            type="button"
                            onClick={() => setClientFilterStatus(pill.id)}
                            className={`px-2.5 py-1 text-xs rounded-full border transition-all cursor-pointer font-medium flex items-center gap-1.5 ${
                              active
                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                : 'hover:opacity-80'
                            }`}
                            style={!active ? { borderColor: "var(--wa-border)", color: "var(--wa-text)", background: "var(--wa-card)" } : {}}
                          >
                            <span>{pill.label}</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${active ? 'bg-white/20 text-white' : 'bg-black/5 dark:bg-white/10'}`}>
                              {pill.count}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Listado de Tarjetas de Clientes */}
                    {clientsLoading && clients.length === 0 ? (
                      <div className="py-12 text-center" style={{ color: "var(--wa-muted)" }}>
                        <Loader2 size={24} className="animate-spin mx-auto mb-2" style={{ color: "var(--wa-button)" }} />
                        <span className="text-xs font-semibold">Cargando directorio de clientes...</span>
                      </div>
                    ) : filteredClients.length === 0 ? (
                      <div className="py-12 text-center rounded-xl border border-dashed" style={{ borderColor: "var(--wa-border)" }}>
                        <Users size={32} className="mx-auto mb-2 opacity-40" style={{ color: "var(--wa-muted)" }} />
                        <p className="text-sm font-bold" style={{ color: "var(--wa-text)" }}>
                          {clientSearch ? 'No se encontraron clientes con ese criterio' : 'No hay clientes registrados en el directorio'}
                        </p>
                        <p className="text-xs mt-1" style={{ color: "var(--wa-muted)" }}>
                          {clientSearch ? 'Pruebe con otro término de búsqueda o limpie el filtro.' : 'Complete el formulario superior para registrar su primer cliente.'}
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {(Array.isArray(filteredClients) ? filteredClients : []).map((c) => {
                          const iniciales = String(c?.nombre || 'CL')
                            .trim()
                            .split(/\s+/)
                            .filter(Boolean)
                            .map(n => (n ? n[0] : ''))
                            .slice(0, 2)
                            .join('')
                            .toUpperCase() || 'CL';
                          return (
                            <div 
                              key={c.id} 
                              className="p-4 rounded-2xl border transition-all hover:shadow-lg hover:-translate-y-0.5 flex flex-col justify-between relative overflow-hidden group"
                              style={{ background: "var(--wa-card)", borderColor: "var(--wa-border)" }}
                            >
                              <div className="absolute top-0 right-0 w-16 h-16 rounded-bl-full z-0 pointer-events-none opacity-10" style={{ background: "var(--wa-button)" }} />
                              
                              <div className="space-y-3 z-10 relative">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-center gap-3">
                                    <div 
                                      className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm text-white shrink-0 shadow-sm"
                                      style={{ background: "linear-gradient(135deg, var(--wa-dark), var(--wa-button))" }}
                                    >
                                      {iniciales}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-bold block leading-tight" style={{ color: "var(--wa-text)" }}>
                                          {c.nombre}
                                        </span>
                                        {/* Status Badge interactivo */}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const current = c.estado || 'PENDIENTE';
                                            const next = current === 'PENDIENTE' ? 'VENCIDO' : current === 'VENCIDO' ? 'PAGADO' : 'PENDIENTE';
                                            handleToggleClientStatus(c, next);
                                          }}
                                          title="Clic para cambiar: Pendiente ➔ Vencido ➔ Pagado"
                                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold border transition-all cursor-pointer ${
                                            (c.estado || 'PENDIENTE') === 'PAGADO'
                                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                                              : (c.estado || 'PENDIENTE') === 'VENCIDO'
                                              ? 'bg-red-500/10 text-red-600 border-red-500/30'
                                              : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                                          }`}
                                        >
                                          {(c.estado || 'PENDIENTE') === 'PAGADO' ? '🟢 Pagado' : (c.estado || 'PENDIENTE') === 'VENCIDO' ? '🔴 Vencido' : '🟡 Pendiente'}
                                        </button>
                                      </div>
                                      <div className="flex items-center gap-1.5 mt-1" style={{ color: "var(--wa-muted)" }}>
                                        <MessageCircle size={11} style={{ color: "var(--wa-button)" }} />
                                        <span className="text-xs font-medium">
                                          +{c.numero}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                    <button
                                      type="button"
                                      onClick={() => handleEditClick(c)}
                                      className="p-1.5 rounded-lg transition-all hover:bg-blue-50 text-blue-400 hover:text-blue-600"
                                      title={`Editar a ${c.nombre}`}
                                    >
                                      <Pencil size={15} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteClient(c.id, c.nombre)}
                                      className="p-1.5 rounded-lg transition-all hover:bg-red-50 text-red-400 hover:text-red-600"
                                      title={`Eliminar a ${c.nombre}`}
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  </div>
                                </div>

                                {c.nota && (
                                  <div className="text-xs p-2.5 rounded-xl border flex items-start gap-2 shadow-inner" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)", color: "var(--wa-text)" }}>
                                    <FileText size={14} className="shrink-0 mt-0.5" style={{ color: "var(--wa-muted)" }} />
                                    <span className="line-clamp-2 leading-relaxed">{c.nota}</span>
                                  </div>
                                )}
                              </div>

                              <div className="pt-3 mt-4 border-t flex items-center justify-between z-10 relative" style={{ borderColor: "var(--wa-border)" }}>
                                <span className="text-[10px] font-medium flex items-center gap-1" style={{ color: "var(--wa-muted)" }}>
                                  <Clock size={11} />
                                  {c.agregadoEl ? new Date(c.agregadoEl).toLocaleDateString() : 'Activo'}
                                </span>

                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenDirectSend(c)}
                                    className="text-xs font-bold flex items-center gap-1.5 transition-all px-3 py-1.5 rounded-lg text-white shadow-sm hover:opacity-90 cursor-pointer"
                                    style={{ background: "var(--wa-button)" }}
                                    title={`Enviar mensaje por WhatsApp a ${c.nombre}`}
                                  >
                                    <Send size={12} />
                                    <span>Enviar</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenWhatsAppDirect(c)}
                                    className="text-xs font-bold flex items-center gap-1 transition-all px-2.5 py-1.5 rounded-lg border hover:bg-emerald-500/10 text-emerald-600 border-emerald-500/30 cursor-pointer"
                                    title={`Abrir chat directo en WhatsApp Web / App para ${c.nombre}`}
                                  >
                                    <ExternalLink size={12} />
                                    <span className="hidden sm:inline">wa.me</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleLoadClientToConsole(c)}
                                    className="p-1.5 rounded-lg border transition-all hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                                    style={{ borderColor: "var(--wa-border)", color: "var(--wa-muted)" }}
                                    title={`Cargar ${c.nombre} en la Consola de Envío`}
                                  >
                                    <LayoutDashboard size={14} />
                                  </button>
                                  {userRole === 'ADMIN' && (
                                    <button
                                      type="button"
                                      onClick={() => handleTestClientDirect(c)}
                                      className="p-1.5 rounded-lg border transition-all hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                                      style={{ borderColor: "var(--wa-border)", color: "var(--wa-muted)" }}
                                      title="Abrir en Laboratorio de Pruebas (Admin)"
                                    >
                                      <FlaskConical size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex justify-between items-center text-xs pt-2" style={{ color: "var(--wa-muted)" }}>
                      <span>Mostrando <strong>{filteredClients.length}</strong> de <strong>{clients.length}</strong> cliente(s)</span>
                    </div>
                  </div>
                )}

                {/* Sub-vista 2: Editor Masivo / Carga de Archivos */}
                {clientViewMode === 'bulk' && (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                      <p className="text-xs" style={{ color: "var(--wa-muted)" }}>
                        Pegue o cargue los números telefónicos con código de país (uno por línea o separados por coma).
                      </p>
                      <button
                        onClick={() => fileInputRef.current.click()}
                        className="btn-wa-primary sm:w-auto text-xs py-2"
                      >
                        <Upload size={14} /> Cargar Archivo (CSV/TXT)
                      </button>
                    </div>

                    <textarea
                      value={numbers}
                      onChange={e => setNumbers(e.target.value)}
                      rows={10}
                      className="wa-textarea"
                      placeholder="18095550123&#10;18095550124"
                    />

                    <div className="flex justify-between items-center text-xs pt-1" style={{ color: "var(--wa-muted)" }}>
                      <span>Total en lista rápida: <strong style={{ color: "var(--wa-button)" }}>{totalDestinatarios}</strong> contactos</span>
                      <button 
                        onClick={() => setNumbers('')}
                        className="hover:underline flex items-center gap-1 font-semibold"
                        style={{ color: "var(--wa-error)" }}
                      >
                        <Trash2 size={13} /> Vaciar listado
                      </button>
                    </div>
                  </div>
                )}

              </div>

            </div>
          )}

          {/* == PESTAÑA 4: CONFIGURACIÓN == */}
          {/* == PESTAÑA: USUARIOS (SOLO ADMIN) == */}
          {activeTab === 'users' && userRole === 'ADMIN' && (
            <div className="space-y-6">
              <div className="wa-card space-y-4">
                <div className="pb-3 border-b flex justify-between items-center" style={{ borderColor: "var(--wa-border)" }}>
                  <div>
                    <h2 className="text-base font-bold flex items-center gap-2" style={{ color: "var(--wa-text)" }}>
                      <ShieldCheck size={18} style={{ color: "var(--wa-button)" }} />
                      Usuarios Registrados
                    </h2>
                    <p className="text-xs mt-0.5" style={{ color: "var(--wa-muted)" }}>
                      Administración de cuentas con acceso al dashboard.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={fetchPlatformUsers}
                    disabled={usersLoading}
                    className="btn-wa-secondary text-xs"
                  >
                    <RefreshCw size={13} className={usersLoading ? 'animate-spin' : ''} />
                    <span>Actualizar</span>
                  </button>
                </div>

                {usersLoading && platformUsers.length === 0 ? (
                  <div className="py-8 text-center" style={{ color: "var(--wa-muted)" }}>
                    <Loader2 size={24} className="animate-spin mx-auto mb-2" style={{ color: "var(--wa-button)" }} />
                    <span className="text-xs font-semibold">Cargando usuarios...</span>
                  </div>
                ) : platformUsers.length === 0 ? (
                  <div className="py-8 text-center rounded-xl border border-dashed" style={{ borderColor: "var(--wa-border)" }}>
                    <p className="text-sm font-bold" style={{ color: "var(--wa-text)" }}>No hay usuarios registrados</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(Array.isArray(platformUsers) ? platformUsers : []).map((u, i) => (
                      <div key={i} className="p-4 rounded-xl border flex items-center justify-between" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm" style={{ background: "var(--wa-button)" }}>
                            {String(u?.name || 'U')[0]?.toUpperCase() || 'U'}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold" style={{ color: "var(--wa-text)" }}>{u.name || 'Sin Nombre'}</p>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                u.role === 'ADMIN'
                                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                                  : 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                              }`}>
                                {u.role === 'ADMIN' ? 'Administrador' : 'Usuario'}
                              </span>
                            </div>
                            <p className="text-xs" style={{ color: "var(--wa-muted)" }}>{u.email}</p>
                            {u.verifiedAt && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ background: "rgba(37, 211, 102, 0.12)", color: "var(--wa-green)" }}>Verificado</span>}
                          </div>
                        </div>
                        {u.role !== 'ADMIN' && u.email !== userEmail && (
                          <button
                            type="button"
                            onClick={() => handleDeleteUserByAdmin(u.email)}
                            className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition"
                            title="Eliminar usuario y sus datos"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Sección de Respaldos de Seguridad */}
              <div className="wa-card space-y-4">
                <div className="pb-3 border-b flex items-center justify-between" style={{ borderColor: "var(--wa-border)" }}>
                  <div>
                    <h2 className="text-base font-bold flex items-center gap-2" style={{ color: "var(--wa-text)" }}>
                      <Server size={18} style={{ color: "var(--wa-button)" }} />
                      Copias de Seguridad Automatizadas (Backups)
                    </h2>
                    <p className="text-xs mt-0.5" style={{ color: "var(--wa-muted)" }}>
                      Respaldo diario automático de base de datos y sesión de WhatsApp (.wwebjs_auth) para migración sin re-escanear QR.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={fileInputBackupRef}
                      onChange={handleUploadBackupFile}
                      accept=".json"
                      style={{ display: "none" }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputBackupRef.current && fileInputBackupRef.current.click()}
                      disabled={backupLoading}
                      className="btn-wa-secondary text-xs py-2 px-3 flex items-center gap-1.5"
                      title="Subir y restaurar un archivo de respaldo JSON desde tu computadora"
                    >
                      <Upload size={13} />
                      <span>Subir Respaldo</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateBackup}
                      disabled={backupLoading}
                      className="btn-wa-primary text-xs py-2 px-3 flex items-center gap-1.5"
                    >
                      {backupLoading ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      <span>Crear Respaldo Ahora</span>
                    </button>
                  </div>
                </div>

                {backups.length === 0 ? (
                  <p className="text-xs text-center py-4" style={{ color: "var(--wa-muted)" }}>
                    No se han registrado respaldos manuales previos. El sistema ejecuta respaldos automáticos diarios cada 24 horas.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(Array.isArray(backups) ? backups : []).slice(0, 8).map((b, idx) => (
                      <div key={idx} className="p-3 rounded-xl border flex items-center justify-between text-xs" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={14} style={{ color: "var(--wa-button)" }} />
                          <div>
                            <span className="font-bold block" style={{ color: "var(--wa-text)" }}>{b.folder}</span>
                            <span className="text-[10px]" style={{ color: "var(--wa-muted)" }}>
                              {b.manifest?.createdAt ? new Date(b.manifest.createdAt).toLocaleString() : 'Fecha desconocida'} • Origen: {b.manifest?.trigger || 'AUTO'}
                              {b.manifest?.stats && ` • ${b.manifest.stats.clients || 0} clientes, ${b.manifest.stats.users || 0} usuarios`}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(37, 211, 102, 0.12)", color: "var(--wa-green)" }}>
                            {b.manifest?.hasAuthSession ? 'BD + Sesión QR' : 'Base de Datos'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDownloadBackup(b.folder)}
                            className="p-1.5 rounded-lg border text-xs flex items-center gap-1 hover:bg-black/5 dark:hover:bg-white/5"
                            style={{ borderColor: "var(--wa-border)", color: "var(--wa-text)" }}
                            title="Descargar respaldo JSON"
                          >
                            <Download size={12} />
                            <span className="hidden sm:inline">Descargar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRestoreBackup(b.folder)}
                            disabled={backupLoading}
                            className="p-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition"
                            style={{ background: "rgba(245, 158, 11, 0.15)", color: "#d97706" }}
                            title="Restaurar base de datos a este punto"
                          >
                            <RotateCcw size={12} />
                            <span className="hidden sm:inline">Restaurar</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}

          {activeTab === 'users' && userRole !== 'ADMIN' && (
            <div className="wa-card text-center py-12 space-y-3">
              <ShieldCheck size={36} className="mx-auto" style={{ color: "var(--wa-button)" }} />
              <h3 className="text-sm font-bold" style={{ color: "var(--wa-text)" }}>Sección de Administración</h3>
              <p className="text-xs max-w-md mx-auto" style={{ color: "var(--wa-muted)" }}>
                La gestión de cuentas y respaldos está reservada para las cuentas de Administrador Principal.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className="btn-wa-primary text-xs mx-auto mt-2"
              >
                Volver a Consola de Envío
              </button>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="wa-card max-w-xl space-y-5">
              <div className="pb-3 border-b" style={{ borderColor: "var(--wa-border)" }}>
                <h2 className="text-base font-bold" style={{ color: "var(--wa-text)" }}>Configuración del Gateway</h2>
                <p className="text-xs" style={{ color: "var(--wa-muted)" }}>Parámetros operativos de entrega y seguridad.</p>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 rounded-xl border flex items-center justify-between" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                  <div>
                    <span className="text-xs font-bold block" style={{ color: "var(--wa-text)" }}>Tiempo Antispam</span>
                    <span className="text-[11px] block mt-0.5" style={{ color: "var(--wa-muted)" }}>Segundos de espera entre cada mensaje.</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={delay}
                      onChange={e => setDelay(e.target.value)}
                        onBlur={() => { void saveTemplatesToBackend(plantillas, message, delay); }}
                      className="w-14 text-center font-bold text-xs p-1.5 rounded-lg border outline-none"
                      style={{ background: "var(--wa-card)", borderColor: "var(--wa-border)", color: "var(--wa-button)" }}
                    />
                    <span className="text-xs font-semibold" style={{ color: "var(--wa-muted)" }}>seg</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border flex items-center justify-between" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                  <div>
                    <span className="text-xs font-bold block" style={{ color: "var(--wa-text)" }}>Firma Criptográfica JWT</span>
                    <span className="text-[11px] block mt-0.5" style={{ color: "var(--wa-muted)" }}>Tokens de autorización seguros con HS256.</span>
                  </div>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: "rgba(37, 211, 102, 0.15)", color: "var(--wa-button)" }}>
                    ACTIVO
                  </span>
                </div>

                <div className="p-3.5 rounded-xl border flex items-center justify-between" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                  <div>
                    <span className="text-xs font-bold block" style={{ color: "var(--wa-text)" }}>Motor WhatsApp Web</span>
                    <span className="text-[11px] block mt-0.5" style={{ color: "var(--wa-muted)" }}>whatsapp-web.js con parche oficial LID.</span>
                  </div>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: "rgba(0, 168, 132, 0.15)", color: "var(--wa-button)" }}>
                    PARCHEADO
                  </span>
                </div>

                <div className="p-3.5 rounded-xl border flex items-center justify-between" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                  <div>
                    <span className="text-xs font-bold block" style={{ color: "var(--wa-text)" }}>Suite de Diagnósticos</span>
                    <span className="text-[11px] block mt-0.5" style={{ color: "var(--wa-muted)" }}>Endpoints de salud, pings y sandbox.</span>
                  </div>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: "rgba(37, 211, 102, 0.15)", color: "var(--wa-button)" }}>
                    HABILITADO
                  </span>
                </div>

                <div className="p-3.5 rounded-xl border flex items-center justify-between" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                  <div>
                    <span className="text-xs font-bold block" style={{ color: "var(--wa-text)" }}>Cifrado de Datos en Reposo</span>
                    <span className="text-[11px] block mt-0.5" style={{ color: "var(--wa-muted)" }}>Notas y balances protegidos con AES-256-GCM.</span>
                  </div>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: "rgba(37, 211, 102, 0.15)", color: "var(--wa-green)" }}>
                    AES-256-GCM
                  </span>
                </div>

                <div className="p-3.5 rounded-xl border flex items-center justify-between" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                  <div>
                    <span className="text-xs font-bold block" style={{ color: "var(--wa-text)" }}>Respaldos Diarios Automáticos</span>
                    <span className="text-[11px] block mt-0.5" style={{ color: "var(--wa-muted)" }}>Copia programada cada 24 horas (BD + Sesión WhatsApp).</span>
                  </div>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: "rgba(37, 211, 102, 0.15)", color: "var(--wa-green)" }}>
                    ACTIVO (24H)
                  </span>
                </div>
                {/* Opción de Auto-Reinicio de 30 minutos */}
                <div className="p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ background: "var(--wa-input-bg)", borderColor: "var(--wa-border)" }}>
                  <div>
                    <div className="flex items-center gap-2">
                      <Timer size={15} style={{ color: "var(--wa-button)" }} />
                      <span className="text-xs font-bold" style={{ color: "var(--wa-text)" }}>Cierre de Sesión por Inactividad (30 Minutos sin Movimiento)</span>
                    </div>
                    <span className="text-[11px] block mt-1" style={{ color: "var(--wa-muted)" }}>
                      El sistema detecta automáticamente el movimiento del mouse, clics o teclado y mantiene tu sesión activa. Si dejas de usar la aplicación y no hay movimiento durante 30 minutos continuos, la sesión se cerrará de forma segura hacia el login para proteger la privacidad de los datos de tus clientes y liberar memoria.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {autoResetEnabled && (
                      <button
                        type="button"
                        onClick={handleExtendSession}
                        className="text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition hover:opacity-80 cursor-pointer"
                        style={{ borderColor: "var(--wa-border)", color: "var(--wa-text)" }}
                        title="Reiniciar el contador a 30 minutos desde ahora"
                      >
                        Reiniciar 30m
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleAutoReset(!autoResetEnabled)}
                      className={`text-[11px] font-bold px-3 py-1 rounded-full transition-all cursor-pointer ${autoResetEnabled ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/40' : 'bg-gray-500/20 text-gray-400 border border-gray-500/40'}`}
                    >
                      {autoResetEnabled ? 'ACTIVO (30 MIN)' : 'DESACTIVADO'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Zona de Peligro: Eliminar Cuenta */}
              <div className="p-4 rounded-xl border border-red-500/30 mt-6" style={{ background: "rgba(239, 68, 68, 0.05)" }}>
                <div className="flex items-center gap-2 mb-2 text-red-500 font-bold text-sm">
                  <AlertTriangle size={17} />
                  <span>Zona de Peligro</span>
                </div>
                <p className="text-xs mb-4" style={{ color: "var(--wa-muted)" }}>
                  Al eliminar tu cuenta se borrarán permanentemente tu acceso, tus clientes registrados, tus plantillas personalizadas y tu sesión activa de WhatsApp. Esta acción no se puede deshacer.
                </p>
                <button
                  type="button"
                  onClick={handleDeleteOwnAccount}
                  className="py-2 px-3.5 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-700 transition flex items-center gap-1.5 shadow-sm"
                >
                  <Trash2 size={14} />
                  <span>Eliminar mi Cuenta</span>
                </button>
              </div>
            </div>
          )}

        </main>
      </div>

    </div>
  );
}
