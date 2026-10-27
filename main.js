// =========================================================
// LAPFIX — Lógica Principal de Aplicación
// =========================================================

// --- MANEJO GLOBAL DE ERRORES ---
window.addEventListener('error', (ev) => {
    console.error(ev.error || ev.message);
    if (typeof showToast === 'function') showToast(`Error: ${ev.message}`, 5000, 'error');
});
window.addEventListener('unhandledrejection', (ev) => {
    console.error(ev.reason);
    const msg = (ev.reason && ev.reason.message) || ev.reason;
    if (typeof showToast === 'function') showToast(`Error: ${msg}`, 5000, 'error');
});

if (typeof Dexie === 'undefined') {
    alert('No se pudo cargar la librería de base de datos (vendor/dexie.min.js). Verificá que la carpeta "vendor" esté junto a index.html.');
    throw new Error('Dexie no está disponible');
}

// --- UTILIDADES ---
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function safeRun(nombre, fn) {
    try {
        await fn();
    } catch (err) {
        console.error(`Error en ${nombre}:`, err);
        showToast(`Error en ${nombre}: ${err.message || err}`, 5000, 'error');
    }
}

function formatCurrency(value) {
    const num = parseFloat(value) || 0;
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(num);
}

function formatShortDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

function formatFullDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// --- BASE DE DATOS (DEXIE.JS) ---
const db = new Dexie('LapfixDB');

db.version(1).stores({
    tickets: 'id, status, clienteNombre, fecha'
});

db.version(2).stores({
    tickets: 'id, status, clienteNombre, fecha, equipoSerie',
    clientes: 'telefono, nombre',
    servicios: '++id, categoria, nombre'
}).upgrade(tx => {
    return tx.tickets.toCollection().modify(ticket => {
        if (ticket.equipoSerie === undefined) ticket.equipoSerie = '';
    });
});

const KANBAN_STATUSES = [
    'Pendiente',
    'Pendiente Aprobación',
    'En Proceso',
    'Esperando Repuestos',
    'Listo para Entregar',
    'Entregado'
];

const STATUS_COLORS = {
    'Pendiente': '#64748b',
    'Pendiente Aprobación': '#ec4899',
    'En Proceso': '#3b82f6',
    'Esperando Repuestos': '#f59e0b',
    'Listo para Entregar': '#10b981',
    'Entregado': '#8b5cf6'
};

// Estado de UI en memoria
let currentKanbanMode = localStorage.getItem('lapfix_kanban_mode') || 'board';
let hideDelivered = localStorage.getItem('lapfix_hide_delivered') === 'true';
let selectedServiceCategory = 'all';
let lastAutoFilledName = '';
let printAfterSave = false;

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initSidebarAndNav();
    initModals();
    initIntakeFormEvents();
    initKanbanEvents();
    initServicesEvents();
    initBackupEvents();
    initKeyboardShortcuts();

    // Fecha actual en encabezado de resumen
    const dateSub = document.getElementById('dashboard-date-subtitle');
    if (dateSub) {
        const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        dateSub.textContent = `${hoy.charAt(0).toUpperCase() + hoy.slice(1)} · Estado operativo y financiero del taller.`;
    }

    // Migración de localStorage legado si existiera
    await safeRun('migración de datos', async () => {
        const legacyTickets = localStorage.getItem('lapfix_tickets');
        if (legacyTickets) {
            const parsedTickets = JSON.parse(legacyTickets);
            if (Array.isArray(parsedTickets) && parsedTickets.length > 0) {
                await db.tickets.bulkPut(parsedTickets.filter(t => t && t.id));
            }
            localStorage.removeItem('lapfix_tickets');
        }
    });

    await safeRun('carga de servicios', seedServiciosDefault);
    await safeRun('tarifario', renderServicios);
    await safeRun('agenda de clientes', cargarClientesDataList);
    await safeRun('contador activo', updateNavActiveBadge);
    await safeRun('resumen', renderDashboard);
});

// --- TEMA CLARO / OSCURO ---
function initTheme() {
    const savedTheme = localStorage.getItem('lapfix_theme') || 'dark';
    applyTheme(savedTheme);

    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            localStorage.setItem('lapfix_theme', next);
            if (document.getElementById('dashboard-view').classList.contains('active')) {
                renderDashboard();
            }
        });
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const label = document.getElementById('theme-label');
    if (label) {
        label.textContent = theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro';
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
        metaTheme.setAttribute('content', theme === 'dark' ? '#090d16' : '#f3f6fb');
    }
}

// --- NAVEGACIÓN Y SIDEBAR ---
function initSidebarAndNav() {
    const appShell = document.getElementById('app-shell');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const backdrop = document.getElementById('sidebar-backdrop');

    if (localStorage.getItem('sidebar_collapsed') === 'true') {
        appShell.classList.add('sidebar-collapsed');
    }

    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            appShell.classList.toggle('sidebar-collapsed');
            localStorage.setItem('sidebar_collapsed', appShell.classList.contains('sidebar-collapsed'));
        });
    }

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => appShell.classList.add('mobile-nav-open'));
    }
    if (backdrop) {
        backdrop.addEventListener('click', () => appShell.classList.remove('mobile-nav-open'));
    }

    // Links de navegación principal
    document.querySelectorAll('.nav-link[data-view]').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Botones de acceso rápido
    document.querySelectorAll('[data-goto]').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.goto));
    });

    const quickNew = document.getElementById('btn-quick-new');
    if (quickNew) {
        quickNew.addEventListener('click', () => {
            switchView('ticket-view');
            setTimeout(() => document.getElementById('clienteTelefono')?.focus(), 60);
        });
    }

    const mobileNew = document.getElementById('mobile-new-btn');
    if (mobileNew) {
        mobileNew.addEventListener('click', () => {
            switchView('ticket-view');
            setTimeout(() => document.getElementById('clienteTelefono')?.focus(), 60);
        });
    }
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-link[data-view]').forEach(el => el.classList.remove('active'));

    const section = document.getElementById(viewId);
    if (section) section.classList.add('active');

    const activeNav = document.querySelector(`.nav-link[data-view="${viewId}"]`);
    if (activeNav) activeNav.classList.add('active');

    document.getElementById('app-shell')?.classList.remove('mobile-nav-open');

    if (viewId === 'dashboard-view') renderDashboard();
    if (viewId === 'kanban-view') renderKanban(document.getElementById('searchInput')?.value || '');
    if (viewId === 'services-view') renderServicios();
    if (viewId === 'settings-view') renderSettingsStats();
}

async function updateNavActiveBadge() {
    const badge = document.getElementById('nav-active-count');
    if (!badge) return;
    const all = await db.tickets.toArray();
    const activos = all.filter(t => t.status !== 'Entregado').length;
    badge.textContent = activos;
}

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            cerrarModalesAbiertos();
            return;
        }
        // Ignorar atajos si hay un modal abierto o se está escribiendo en un campo
        if (document.querySelector('.modal-backdrop:not([hidden])')) return;
        const tag = (ev.target && ev.target.tagName) || '';
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || ev.target?.isContentEditable) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

        if (ev.key === 'n' || ev.key === 'N') {
            ev.preventDefault();
            switchView('ticket-view');
            document.getElementById('clienteTelefono')?.focus();
        } else if (ev.key === '/') {
            ev.preventDefault();
            switchView('kanban-view');
            document.getElementById('searchInput')?.focus();
        }
    });
}

// --- MODALES Y CONFIRMACIÓN ---
let confirmResolver = null;

function initModals() {
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = document.getElementById(btn.dataset.closeModal);
            if (modal) modal.hidden = true;
        });
    });

    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener('click', (ev) => {
            if (ev.target === backdrop) {
                if (backdrop.id === 'confirm-modal' && confirmResolver) {
                    resolverConfirmacion(false);
                } else {
                    backdrop.hidden = true;
                }
            }
        });
    });

    document.getElementById('confirm-cancel-btn')?.addEventListener('click', () => resolverConfirmacion(false));
    document.getElementById('confirm-cancel-x')?.addEventListener('click', () => resolverConfirmacion(false));
    document.getElementById('confirm-accept-btn')?.addEventListener('click', () => resolverConfirmacion(true));
}

function cerrarModalesAbiertos() {
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal && !confirmModal.hidden) {
        resolverConfirmacion(false);
        return;
    }
    document.querySelectorAll('.modal-backdrop:not([hidden])').forEach(m => {
        m.hidden = true;
    });
}

function confirmarAccion({ titulo = 'Confirmar acción', mensaje = '¿Deseás continuar?', textoConfirmar = 'Confirmar', peligro = true } = {}) {
    return new Promise(resolve => {
        confirmResolver = resolve;
        document.getElementById('confirm-modal-title').textContent = titulo;
        document.getElementById('confirm-modal-message').textContent = mensaje;
        const acceptBtn = document.getElementById('confirm-accept-btn');
        acceptBtn.textContent = textoConfirmar;
        acceptBtn.className = peligro ? 'btn btn-danger' : 'btn btn-primary';
        document.getElementById('confirm-modal').hidden = false;
        acceptBtn.focus();
    });
}

function resolverConfirmacion(valor) {
    document.getElementById('confirm-modal').hidden = true;
    if (confirmResolver) {
        const fn = confirmResolver;
        confirmResolver = null;
        fn(valor);
    }
}

// --- SERVICIOS POR DEFECTO ---
async function seedServiciosDefault() {
    const cuenta = await db.servicios.count();
    if (cuenta === 0) {
        const serviciosDefault = [
            { categoria: 'Diagnóstico', nombre: 'Diagnóstico Completo (con informe)', precioSugerido: 30000, justificacion: 'Valoración del conocimiento técnico aplicado.' },
            { categoria: 'Software', nombre: 'Formateo Completo + Backup (25GB)', precioSugerido: 62000, justificacion: 'Equilibrio entre tiempo de instalación y seguridad.' },
            { categoria: 'Software', nombre: 'Optimización / Limpieza de Virus', precioSugerido: 46000, justificacion: 'Análisis profundo de logs y registro.' },
            { categoria: 'Software', nombre: 'Soporte Remoto (por hora)', precioSugerido: 36300, justificacion: 'Tasa profesional estándar para incidencias.' },
            { categoria: 'Hardware', nombre: 'Limpieza + Pasta Térmica (PC Desktop)', precioSugerido: 46000, justificacion: 'Incluye materiales de calidad y desarme.' },
            { categoria: 'Hardware', nombre: 'Limpieza + Pasta Térmica (Notebook/Gamer)', precioSugerido: 72000, justificacion: 'Mayor riesgo por fragilidad y pastas premium.' },
            { categoria: 'Hardware', nombre: 'Armado de PC Básica (Home/Oficina)', precioSugerido: 82820, justificacion: 'Piso de mercado para ensamblado profesional.' },
            { categoria: 'Hardware', nombre: 'Armado de PC Gamer / Workstation', precioSugerido: 130000, justificacion: 'Gestión de cables avanzada y tests de estrés.' },
            { categoria: 'Hardware', nombre: 'Clonado de Disco (SATA a SSD)', precioSugerido: 77000, justificacion: 'Transferencia bit a bit con verificación.' },
            { categoria: 'Hardware', nombre: 'Reparación de Bisagras (Mano de Obra)', precioSugerido: 108900, justificacion: 'Trabajo artesanal con alta tasa de éxito.' },
            { categoria: 'Hardware', nombre: 'Cambio de Pantalla o Teclado (Laptops)', precioSugerido: 58000, justificacion: 'Tarifa plana por intervención en carcasas.' },
            { categoria: 'Datos', nombre: 'Recuperación de Datos Lógica (sin lab)', precioSugerido: 105000, justificacion: 'Piso por responsabilidad sobre la información.' }
        ];
        await db.servicios.bulkAdd(serviciosDefault);
    }
}

// --- DASHBOARD FINANCIERO Y OPERATIVO ---
let financeChartInstance = null;
let statusChartInstance = null;

function calcularIngresoCobrado(ticket) {
    // El saldo final (precioTotal) + la seña abonada conforman el ingreso total cobrado por el trabajo
    return (parseFloat(ticket.precioTotal) || 0) + (parseFloat(ticket.precioSena) || 0);
}

function calcularCostoRepuestosNeto(ticket) {
    return ticket.costoRepuestosNeto !== undefined
        ? (parseFloat(ticket.costoRepuestosNeto) || 0)
        : (parseFloat(ticket.precioRepuestos) || 0);
}

async function renderDashboard() {
    const tickets = await db.tickets.toArray();
    const totalTickets = tickets.length;
    const activos = tickets.filter(t => t.status !== 'Entregado');
    const entregados = tickets.filter(t => t.status === 'Entregado');
    const listos = tickets.filter(t => t.status === 'Listo para Entregar');

    let ingresosBrutos = 0;
    let gananciaNeta = 0;

    entregados.forEach(t => {
        const ingreso = calcularIngresoCobrado(t);
        const costoNeto = calcularCostoRepuestosNeto(t);
        ingresosBrutos += ingreso;
        gananciaNeta += ingreso - costoNeto;
    });

    const pendienteCobro = listos.reduce((acc, t) => acc + (parseFloat(t.precioTotal) || 0), 0);

    document.getElementById('metric-active-tickets').textContent = activos.length;
    document.getElementById('metric-total-tickets').textContent = totalTickets;
    document.getElementById('metric-pending-payment').textContent = formatCurrency(pendienteCobro);
    document.getElementById('metric-ready-count').textContent =
        listos.length === 1 ? '1 equipo listo para retirar' : `${listos.length} equipos listos para retirar`;
    document.getElementById('metric-gross-income').textContent = formatCurrency(ingresosBrutos);
    document.getElementById('metric-net-profit').textContent = formatCurrency(gananciaNeta);

    renderDashboardLists(tickets);
    renderDashboardCharts(tickets, entregados);
}

function renderDashboardLists(tickets) {
    // 1. Requieren atención: Listos para entregar o Pendiente Aprobación
    const attentionEl = document.getElementById('attention-tickets-list');
    if (attentionEl) {
        const relevantes = tickets
            .filter(t => t.status === 'Listo para Entregar' || t.status === 'Pendiente Aprobación')
            .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
            .slice(0, 5);

        if (relevantes.length === 0) {
            attentionEl.innerHTML = `<div class="empty-state-mini">No hay equipos pendientes de retiro ni de aprobación.</div>`;
        } else {
            attentionEl.innerHTML = relevantes.map(t => `
                <div class="compact-item" data-open-ticket="${escapeHtml(t.id)}">
                    <div class="compact-item-main">
                        <div class="compact-item-title">${escapeHtml(t.equipoModelo || 'Sin modelo')} · <span class="text-muted">${escapeHtml(t.clienteNombre || 'Sin nombre')}</span></div>
                        <div class="compact-item-sub">${escapeHtml(t.id)} · ${escapeHtml(t.status)}</div>
                    </div>
                    <div class="compact-item-right">
                        <strong class="text-success">${formatCurrency(t.precioTotal)}</strong>
                    </div>
                </div>
            `).join('');
        }
    }

    // 2. Ingresos recientes
    const recentEl = document.getElementById('recent-tickets-list');
    if (recentEl) {
        const recientes = [...tickets]
            .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))
            .slice(0, 5);

        if (recientes.length === 0) {
            recentEl.innerHTML = `<div class="empty-state-mini">Todavía no registraste equipos. Usá "+ Nuevo Ingreso" para comenzar.</div>`;
        } else {
            recentEl.innerHTML = recientes.map(t => `
                <div class="compact-item" data-open-ticket="${escapeHtml(t.id)}">
                    <div class="compact-item-main">
                        <div class="compact-item-title">${escapeHtml(t.equipoModelo || 'Sin modelo')}</div>
                        <div class="compact-item-sub">${escapeHtml(t.id)} · ${escapeHtml(t.clienteNombre || 'Sin nombre')} · ${formatShortDate(t.fecha)}</div>
                    </div>
                    <div class="compact-item-right">
                        <span class="cat-badge">${escapeHtml(t.status || 'Pendiente')}</span>
                    </div>
                </div>
            `).join('');
        }
    }

    document.querySelectorAll('[data-open-ticket]').forEach(item => {
        item.addEventListener('click', () => abrirModalTicket(item.dataset.openTicket));
    });
}

function renderDashboardCharts(tickets, entregados) {
    if (typeof Chart === 'undefined') return;

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const tickColor = isLight ? '#64748b' : '#94a3b8';
    const legendColor = isLight ? '#0f172a' : '#f1f5f9';
    const gridColor = isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(148, 163, 184, 0.1)';

    // Agrupar cronológicamente por YYYY-MM
    const monthlyMap = new Map();
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    entregados.forEach(t => {
        const d = new Date(t.fechaEntrega || t.fecha);
        if (Number.isNaN(d.getTime())) return;
        const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        if (!monthlyMap.has(sortKey)) {
            monthlyMap.set(sortKey, { label, brutos: 0, netos: 0 });
        }
        const entry = monthlyMap.get(sortKey);
        const ingreso = calcularIngresoCobrado(t);
        const costo = calcularCostoRepuestosNeto(t);
        entry.brutos += ingreso;
        entry.netos += ingreso - costo;
    });

    const sortedKeys = [...monthlyMap.keys()].sort();
    const labels = sortedKeys.map(k => monthlyMap.get(k).label);
    const brutosData = sortedKeys.map(k => monthlyMap.get(k).brutos);
    const netosData = sortedKeys.map(k => monthlyMap.get(k).netos);

    const ctxFinance = document.getElementById('financeChart').getContext('2d');
    if (financeChartInstance) financeChartInstance.destroy();

    financeChartInstance = new Chart(ctxFinance, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : ['Sin entregas aún'],
            datasets: [
                {
                    label: 'Ingresos Cobrados',
                    data: brutosData.length > 0 ? brutosData : [0],
                    backgroundColor: 'rgba(59, 130, 246, 0.72)',
                    borderRadius: 6,
                    maxBarThickness: 38
                },
                {
                    label: 'Ganancia Neta',
                    data: netosData.length > 0 ? netosData : [0],
                    backgroundColor: 'rgba(16, 185, 129, 0.78)',
                    borderRadius: 6,
                    maxBarThickness: 38
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: gridColor },
                    ticks: { color: tickColor }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: tickColor }
                }
            },
            plugins: {
                legend: {
                    labels: { color: legendColor, usePointStyle: true, boxWidth: 8 }
                }
            }
        }
    });

    // Gráfico Doughnut de estados
    const statusCounts = {};
    KANBAN_STATUSES.forEach(s => { statusCounts[s] = 0; });
    tickets.forEach(t => {
        const st = KANBAN_STATUSES.includes(t.status) ? t.status : 'Pendiente';
        statusCounts[st]++;
    });

    const totalCount = tickets.length;
    const ctxStatus = document.getElementById('statusChart').getContext('2d');
    if (statusChartInstance) statusChartInstance.destroy();

    statusChartInstance = new Chart(ctxStatus, {
        type: 'doughnut',
        data: totalCount > 0 ? {
            labels: KANBAN_STATUSES,
            datasets: [{
                data: KANBAN_STATUSES.map(s => statusCounts[s]),
                backgroundColor: KANBAN_STATUSES.map(s => STATUS_COLORS[s]),
                borderWidth: 0
            }]
        } : {
            labels: ['Sin equipos'],
            datasets: [{
                data: [1],
                backgroundColor: [isLight ? '#e2e8f0' : '#1e293b'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '64%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: legendColor, usePointStyle: true, boxWidth: 8, font: { size: 11 } }
                },
                tooltip: {
                    enabled: totalCount > 0
                }
            }
        }
    });
}

// --- INGRESO DE EQUIPO (FORMULARIO NUEVO TICKET) ---
function initIntakeFormEvents() {
    const form = document.getElementById('ticket-form');
    if (!form) return;

    // Cálculo en vivo de montos
    ['precioRepuestos', 'margenRepuestos', 'precioManoObra', 'precioSena'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calcularTotal);
    });

    // Presets rápidos de margen
    document.querySelectorAll('#margin-presets [data-margin]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('margenRepuestos').value = btn.dataset.margin;
            document.querySelectorAll('#margin-presets [data-margin]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            calcularTotal();
        });
    });

    // Presets rápidos de seña
    document.querySelectorAll('#sena-presets [data-sena]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('precioSena').value = btn.dataset.sena;
            document.querySelectorAll('#sena-presets [data-sena]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            calcularTotal();
        });
    });

    // Selección rápida: Tipo de equipo
    document.querySelectorAll('#device-type-chips [data-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            const el = document.getElementById('equipoModelo');
            const knownTypes = ['Notebook', 'PC Desktop', 'PC Gamer', 'All-in-One', 'Consola'];
            let val = el.value.trim();
            for (const t of knownTypes) {
                if (val.toLowerCase().startsWith(t.toLowerCase())) {
                    val = val.substring(t.length).trim();
                    break;
                }
            }
            el.value = val ? `${type} ${val}` : `${type} `;
            document.querySelectorAll('#device-type-chips [data-type]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            el.focus();
        });
    });

    // Selección rápida: Marca de equipo
    document.querySelectorAll('#device-brand-chips [data-brand]').forEach(btn => {
        btn.addEventListener('click', () => {
            const brand = btn.dataset.brand;
            const el = document.getElementById('equipoModelo');
            const knownBrands = ['Lenovo', 'HP', 'Dell', 'Asus', 'Acer', 'Apple', 'Samsung', 'Banghó', 'Exo', 'MSI'];
            let val = el.value.trim();
            let replaced = false;
            for (const b of knownBrands) {
                const re = new RegExp(`\\b${b}\\b`, 'i');
                if (re.test(val)) {
                    val = val.replace(re, brand);
                    replaced = true;
                    break;
                }
            }
            if (!replaced) {
                val = val ? `${val} ${brand}` : brand;
            }
            el.value = val.endsWith(' ') ? val : `${val} `;
            document.querySelectorAll('#device-brand-chips [data-brand]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            el.focus();
        });
    });

    // Chips rápidos para observaciones estéticas y accesorios
    document.querySelectorAll('#obs-quick-chips [data-obs]').forEach(chip => {
        chip.addEventListener('click', () => {
            const obsEl = document.getElementById('obsInicial');
            const texto = chip.dataset.obs;
            const actual = obsEl.value.trim();
            if (!actual.toLowerCase().includes(texto.toLowerCase())) {
                obsEl.value = actual ? `${actual}, ${texto}` : texto;
                chip.classList.add('active');
            }
        });
    });

    // Chips rápidos para síntomas y fallas reportadas
    document.querySelectorAll('#symptoms-quick-chips [data-symptom]').forEach(chip => {
        chip.addEventListener('click', () => {
            const symptom = chip.dataset.symptom;
            const el = document.getElementById('trabajoRealizar');
            const val = el.value.trim();
            if (!val.toLowerCase().includes(symptom.toLowerCase())) {
                el.value = val ? `${val}\n• ${symptom}` : `• ${symptom}`;
                chip.classList.add('active');
                showToast(`Síntoma añadido: ${symptom}`);
            } else {
                showToast('Ese síntoma ya está añadido');
            }
        });
    });

    // Botón rápido: Dejar a Revisar (Diagnóstico)
    document.getElementById('btn-quick-diagnosis')?.addEventListener('click', async () => {
        let diagPrice = 30000;
        try {
            const diagService = await db.servicios.filter(s => s.categoria === 'Diagnóstico').first();
            if (diagService && diagService.precioSugerido) {
                diagPrice = diagService.precioSugerido;
            }
        } catch (err) {
            console.warn('Error buscando servicio diagnóstico:', err);
        }

        document.getElementById('precioManoObra').value = diagPrice;
        document.getElementById('precioRepuestos').value = 0;
        document.getElementById('margenRepuestos').value = 0;

        const trabajoInput = document.getElementById('trabajoRealizar');
        const actual = trabajoInput.value.trim();
        const diagTexto = 'Revisión y diagnóstico técnico para presupuesto';
        if (!actual.toLowerCase().includes('diagnóstico') && !actual.toLowerCase().includes('diagnostico')) {
            trabajoInput.value = actual ? `${actual}\n• ${diagTexto}` : `• ${diagTexto}`;
        }
        calcularTotal();
        showToast(`Configurado: Diagnóstico inicial (${formatCurrency(diagPrice)})`);
    });

    // Búsqueda inteligente de cliente por teléfono (sin pisar nombres escritos manualmente)
    const telInput = document.getElementById('clienteTelefono');
    telInput?.addEventListener('change', buscarClientePorTelefono);
    telInput?.addEventListener('input', () => {
        document.getElementById('clienteMatchHint').innerHTML = '';
    });

    // Historial de equipo por número de serie
    document.getElementById('equipoSerie')?.addEventListener('change', buscarHistorialEquipo);
    document.getElementById('equipoSerie')?.addEventListener('input', () => {
        if (!document.getElementById('equipoSerie').value.trim()) {
            document.getElementById('historialEquipoWrapper').hidden = true;
        }
    });

    // Selección de servicio predefinido
    document.getElementById('servicioSelect')?.addEventListener('change', aplicarServicioSeleccionado);

    // Botón limpiar formulario
    document.getElementById('btn-clear-form')?.addEventListener('click', limpiarFormularioIngreso);

    // Botón Guardar e Imprimir
    document.getElementById('btn-save-and-print')?.addEventListener('click', () => {
        if (form.reportValidity()) {
            printAfterSave = true;
            form.requestSubmit();
        }
    });

    form.addEventListener('submit', guardarTicket);
    calcularTotal();
}

function limpiarFormularioIngreso() {
    const form = document.getElementById('ticket-form');
    form?.reset();
    lastAutoFilledName = '';
    document.getElementById('clienteMatchHint').innerHTML = '';
    document.getElementById('historialEquipoContainer').innerHTML = '';
    document.getElementById('historialEquipoWrapper').hidden = true;
    document.querySelectorAll('#ticket-form .chip.active, #ticket-form .mini-chip.active').forEach(c => c.classList.remove('active'));
    calcularTotal();
}

function calcularTotal() {
    const repuestosNeto = parseFloat(document.getElementById('precioRepuestos')?.value) || 0;
    const margen = parseFloat(document.getElementById('margenRepuestos')?.value) || 0;
    const subtotalRepuestos = repuestosNeto + (repuestosNeto * margen / 100);
    const manoObra = parseFloat(document.getElementById('precioManoObra')?.value) || 0;
    const sena = parseFloat(document.getElementById('precioSena')?.value) || 0;

    const totalTrabajo = subtotalRepuestos + manoObra;
    const saldo = Math.max(0, totalTrabajo - sena);

    document.getElementById('subtotalRepuestosSpan').textContent = formatCurrency(subtotalRepuestos);
    document.getElementById('summaryManoObraSpan').textContent = formatCurrency(manoObra);
    document.getElementById('summarySubtotalTrabajoSpan').textContent = formatCurrency(totalTrabajo);
    document.getElementById('summarySenaSpan').textContent = `- ${formatCurrency(sena)}`;
    document.getElementById('summaryTotalDisplay').textContent = formatCurrency(saldo);
    document.getElementById('precioTotal').value = saldo;
}

async function generarId() {
    const tickets = await db.tickets.toArray();
    const numeros = tickets
        .map(t => parseInt(String(t.id || '').split('-')[1], 10))
        .filter(n => Number.isFinite(n));
    const maxEnDb = numeros.length > 0 ? Math.max(...numeros) : 0;
    const ultimoEmitido = parseInt(localStorage.getItem('lapfix_last_seq') || '0', 10) || 0;

    let siguiente = Math.max(maxEnDb, ultimoEmitido) + 1;
    let id = `LPX-${String(siguiente).padStart(3, '0')}`;
    while (await db.tickets.get(id)) {
        siguiente++;
        id = `LPX-${String(siguiente).padStart(3, '0')}`;
    }
    localStorage.setItem('lapfix_last_seq', String(siguiente));
    return id;
}

async function guardarTicket(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const shouldPrint = printAfterSave;
    printAfterSave = false;

    const submitBtn = form.querySelector('button[type="submit"]');
    const savePrintBtn = document.getElementById('btn-save-and-print');
    if (submitBtn) submitBtn.disabled = true;
    if (savePrintBtn) savePrintBtn.disabled = true;

    try {
        calcularTotal();
        const nuevoId = await generarId();

        const clienteTel = document.getElementById('clienteTelefono').value.trim();
        const clienteNom = document.getElementById('clienteNombre').value.trim();

        const repuestosNeto = parseFloat(document.getElementById('precioRepuestos').value) || 0;
        const margen = parseFloat(document.getElementById('margenRepuestos').value) || 0;
        const subtotalRepuestos = repuestosNeto + (repuestosNeto * margen / 100);

        const nuevoTicket = {
            id: nuevoId,
            clienteNombre: clienteNom,
            clienteTelefono: clienteTel,
            equipoSerie: document.getElementById('equipoSerie').value.trim(),
            equipoModelo: document.getElementById('equipoModelo').value.trim(),
            obsInicial: document.getElementById('obsInicial').value.trim(),
            trabajoRealizar: document.getElementById('trabajoRealizar').value.trim(),
            precioRepuestos: subtotalRepuestos,
            costoRepuestosNeto: repuestosNeto,
            margenRepuestos: margen,
            precioManoObra: parseFloat(document.getElementById('precioManoObra').value) || 0,
            precioSena: parseFloat(document.getElementById('precioSena').value) || 0,
            precioTotal: parseFloat(document.getElementById('precioTotal').value) || 0,
            status: 'Pendiente',
            fecha: new Date().toISOString(),
            fechaEntrega: null
        };

        await db.transaction('rw', db.clientes, db.tickets, async () => {
            if (clienteTel) await db.clientes.put({ telefono: clienteTel, nombre: clienteNom });
            await db.tickets.add(nuevoTicket);
        });

        await cargarClientesDataList();
        await updateNavActiveBadge();

        limpiarFormularioIngreso();
        showToast(`Ticket ${nuevoTicket.id} registrado correctamente`);
        switchView('kanban-view');

        if (shouldPrint) {
            await imprimirPresupuesto(nuevoTicket.id);
        }
    } catch (err) {
        console.error('Error al guardar el ticket:', err);
        showToast(`No se pudo guardar el ticket: ${err.message || err}`, 5000, 'error');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (savePrintBtn) savePrintBtn.disabled = false;
    }
}

// --- CLIENTES E HISTORIAL DE SERIE ---
async function cargarClientesDataList() {
    const clientes = await db.clientes.toArray();
    const dataList = document.getElementById('clientesList');
    if (!dataList) return;
    dataList.innerHTML = '';
    clientes.forEach(c => {
        const option = document.createElement('option');
        option.value = c.telefono;
        option.textContent = c.nombre;
        dataList.appendChild(option);
    });
}

async function buscarClientePorTelefono() {
    const telInput = document.getElementById('clienteTelefono');
    const nomInput = document.getElementById('clienteNombre');
    const hint = document.getElementById('clienteMatchHint');
    const telefono = telInput.value.trim();

    hint.innerHTML = '';
    if (!telefono) return;

    const cliente = await db.clientes.get(telefono);
    if (cliente) {
        const nombreActual = nomInput.value.trim();
        if (!nombreActual || nombreActual === lastAutoFilledName) {
            nomInput.value = cliente.nombre;
            lastAutoFilledName = cliente.nombre;
            hint.textContent = `Cliente frecuente: ${cliente.nombre}`;
        } else if (nombreActual !== cliente.nombre) {
            // No pisa lo que el usuario ya escribió manualmente: ofrece aplicarlo con un clic
            hint.innerHTML = `Registrado como <strong>${escapeHtml(cliente.nombre)}</strong> · <a href="#" id="applyClientNameLink" style="color:var(--primary)">Usar este nombre</a>`;
            document.getElementById('applyClientNameLink')?.addEventListener('click', (ev) => {
                ev.preventDefault();
                nomInput.value = cliente.nombre;
                lastAutoFilledName = cliente.nombre;
                hint.textContent = `Cliente frecuente: ${cliente.nombre}`;
            });
        }
    } else if (nomInput.value.trim() === lastAutoFilledName && lastAutoFilledName !== '') {
        // Si cambió a un teléfono nuevo y el nombre venía autocompletado del teléfono anterior, lo limpiamos
        nomInput.value = '';
        lastAutoFilledName = '';
    }
}

async function buscarHistorialEquipo() {
    const serie = document.getElementById('equipoSerie').value.trim();
    const wrapper = document.getElementById('historialEquipoWrapper');
    const container = document.getElementById('historialEquipoContainer');

    if (!serie) {
        container.innerHTML = '';
        wrapper.hidden = true;
        return;
    }

    const todos = await db.tickets.toArray();
    const ticketsPrevios = todos.filter(t => String(t.equipoSerie || '').trim().toLowerCase() === serie.toLowerCase());

    wrapper.hidden = false;
    if (ticketsPrevios.length > 0) {
        let html = `<strong>Este número de serie registra ${ticketsPrevios.length} ingreso(s) previo(s):</strong><ul>`;
        ticketsPrevios.forEach(t => {
            html += `<li>[${formatFullDate(t.fecha)}] <strong>${escapeHtml(t.id)}</strong> — ${escapeHtml(String(t.trabajoRealizar || '').substring(0, 45))} (${escapeHtml(t.status)})</li>`;
        });
        html += `</ul>`;
        container.innerHTML = html;
    } else {
        container.innerHTML = `<span class="text-muted">Primer ingreso registrado para el número de serie <strong>${escapeHtml(serie)}</strong>.</span>`;
    }
}

function agregarServicioAlTicket(nombreServicio, precioSugerido) {
    if (!nombreServicio) return;
    const trabajoInput = document.getElementById('trabajoRealizar');
    const manoObraInput = document.getElementById('precioManoObra');

    const trabajoActual = trabajoInput.value.trim();
    const yaIncluido = trabajoActual.toLowerCase().includes(nombreServicio.toLowerCase());

    if (!yaIncluido) {
        trabajoInput.value = trabajoActual ? `${trabajoActual}\n+ ${nombreServicio}` : `+ ${nombreServicio}`;
        const manoObraActual = parseFloat(manoObraInput.value) || 0;
        manoObraInput.value = manoObraActual + (parseFloat(precioSugerido) || 0);
        showToast(`Servicio agregado: ${nombreServicio}`);
    } else {
        showToast('Ese servicio ya está agregado en la descripción.');
    }
    calcularTotal();
}

function aplicarServicioSeleccionado() {
    const select = document.getElementById('servicioSelect');
    if (!select.value) return;

    const option = select.options[select.selectedIndex];
    const nombreServicio = option.dataset.nombre;
    const precioSugerido = parseFloat(option.dataset.precio) || 0;

    agregarServicioAlTicket(nombreServicio, precioSugerido);
    select.value = '';
}

// --- TABLERO KANBAN Y VISTA LISTA ---
function initKanbanEvents() {
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    const hideToggle = document.getElementById('hideDeliveredToggle');
    const btnBoard = document.getElementById('view-mode-board');
    const btnList = document.getElementById('view-mode-list');

    if (hideToggle) {
        hideToggle.checked = hideDelivered;
        hideToggle.addEventListener('change', () => {
            hideDelivered = hideToggle.checked;
            localStorage.setItem('lapfix_hide_delivered', String(hideDelivered));
            renderKanban(searchInput?.value || '');
        });
    }

    const setMode = (mode) => {
        currentKanbanMode = mode;
        localStorage.setItem('lapfix_kanban_mode', mode);
        btnBoard?.classList.toggle('active', mode === 'board');
        btnList?.classList.toggle('active', mode === 'list');
        document.getElementById('kanban-board-container').hidden = mode !== 'board';
        document.getElementById('tickets-list-container').hidden = mode !== 'list';
    };
    setMode(currentKanbanMode);

    btnBoard?.addEventListener('click', () => setMode('board'));
    btnList?.addEventListener('click', () => setMode('list'));

    searchInput?.addEventListener('input', () => {
        if (clearBtn) clearBtn.hidden = !searchInput.value;
        renderKanban(searchInput.value);
    });

    clearBtn?.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.hidden = true;
        renderKanban('');
        searchInput.focus();
    });

    // Drag & Drop con indicador visual en columnas
    document.querySelectorAll('.kanban-col').forEach(colWrapper => {
        const colContent = colWrapper.querySelector('.col-content');
        if (!colContent) return;

        colWrapper.addEventListener('dragover', (ev) => {
            ev.preventDefault();
            colWrapper.classList.add('drag-over');
        });
        colWrapper.addEventListener('dragleave', (ev) => {
            if (!colWrapper.contains(ev.relatedTarget)) {
                colWrapper.classList.remove('drag-over');
            }
        });
        colWrapper.addEventListener('drop', (ev) => {
            colWrapper.classList.remove('drag-over');
            drop(ev, colContent.dataset.status);
        });
    });

    // Delegación de clics en el tablero Kanban
    document.getElementById('kanban-board-container')?.addEventListener('click', (ev) => {
        const card = ev.target.closest('.ticket-card');
        if (!card) return;
        const ticketId = card.id;

        if (ev.target.closest('.btn-print')) {
            ev.stopPropagation();
            imprimirPresupuesto(ticketId);
        } else if (ev.target.closest('.btn-delete')) {
            ev.stopPropagation();
            borrarTicket(ticketId);
        } else {
            abrirModalTicket(ticketId);
        }
    });
}

function getWarrantyStatus(ticket) {
    if (ticket.status !== 'Entregado' || !ticket.fechaEntrega) {
        return { text: '', className: '' };
    }
    const fechaEntrega = new Date(ticket.fechaEntrega);
    const fechaVencimiento = new Date(fechaEntrega);
    fechaVencimiento.setMonth(fechaVencimiento.getMonth() + 1);

    if (new Date() <= fechaVencimiento) {
        return { text: 'Garantía vigente', className: 'garantia-vigente' };
    }
    return { text: 'Garantía vencida', className: 'garantia-vencida' };
}

let kanbanRenderSeq = 0;

async function renderKanban(filtro = '') {
    const seq = ++kanbanRenderSeq;

    // Mostrar/ocultar columna Entregado según preferencia
    const deliveredCol = document.getElementById('col-wrapper-Entregado');
    if (deliveredCol) deliveredCol.hidden = hideDelivered;

    const q = filtro.trim().toLowerCase();
    const ticketsFiltrados = await db.tickets.filter(t => {
        if (!q) return true;
        return (
            String(t.id || '').toLowerCase().includes(q) ||
            String(t.clienteNombre || '').toLowerCase().includes(q) ||
            String(t.clienteTelefono || '').toLowerCase().includes(q) ||
            String(t.equipoModelo || '').toLowerCase().includes(q) ||
            String(t.equipoSerie || '').toLowerCase().includes(q)
        );
    }).toArray();

    // Si otra llamada más nueva a renderKanban se disparó mientras esperábamos IndexedDB, descartamos esta
    if (seq !== kanbanRenderSeq) return;

    KANBAN_STATUSES.forEach(estado => {
        const statusId = estado.replace(/ /g, '-');
        const listEl = document.getElementById(`list-${statusId}`);
        if (listEl) listEl.innerHTML = '';
    });

    // Ordenar más recientes primero
    ticketsFiltrados.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));

    ticketsFiltrados.forEach(ticket => {
        const { text: garantiaTexto, className: garantiaClase } = getWarrantyStatus(ticket);
        const sena = parseFloat(ticket.precioSena) || 0;

        const card = document.createElement('div');
        card.className = 'ticket-card';
        card.draggable = true;
        card.id = ticket.id;
        card.addEventListener('dragstart', drag);
        card.addEventListener('dragend', () => card.classList.remove('dragging'));

        card.innerHTML = `
            <div class="tc-header">
                <span class="tc-id">${escapeHtml(ticket.id)}</span>
                <span class="tc-date">${formatShortDate(ticket.fecha)}</span>
            </div>
            <div class="tc-equipo">${escapeHtml(ticket.equipoModelo || 'Equipo sin especificar')}</div>
            <div class="tc-cliente-row">
                <span class="tc-cliente">${escapeHtml(ticket.clienteNombre || 'Sin cliente')}</span>
            </div>
            ${ticket.trabajoRealizar ? `<div class="tc-trabajo">${escapeHtml(ticket.trabajoRealizar)}</div>` : ''}
            <div class="tc-footer">
                <div class="tc-badges">
                    ${garantiaTexto ? `<span class="tc-garantia ${garantiaClase}">${garantiaTexto}</span>` : ''}
                    ${!garantiaTexto && sena > 0 ? `<span class="tc-sena-tag" title="Seña abonada">Seña ${formatCurrency(sena)}</span>` : ''}
                </div>
                <div class="tc-right-actions">
                    <span class="tc-total">${formatCurrency(ticket.precioTotal)}</span>
                    <button type="button" class="card-action-btn btn-print" title="Imprimir orden">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                    </button>
                    <button type="button" class="card-action-btn btn-delete" title="Eliminar ticket">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        const estado = KANBAN_STATUSES.includes(ticket.status) ? ticket.status : 'Pendiente';
        const statusId = estado.replace(/ /g, '-');
        const column = document.getElementById(`list-${statusId}`);
        if (column) column.appendChild(card);
    });

    // Actualizar contadores y placeholders de columnas vacías
    KANBAN_STATUSES.forEach(estado => {
        const statusId = estado.replace(/ /g, '-');
        const count = ticketsFiltrados.filter(t =>
            (KANBAN_STATUSES.includes(t.status) ? t.status : 'Pendiente') === estado
        ).length;

        const countEl = document.getElementById(`count-${statusId}`);
        if (countEl) countEl.textContent = count;

        const listEl = document.getElementById(`list-${statusId}`);
        if (listEl && count === 0) {
            listEl.innerHTML = `<div class="col-empty">Sin equipos</div>`;
        }
    });

    renderTicketsTable(ticketsFiltrados);
}

function renderTicketsTable(tickets) {
    const tbody = document.getElementById('ticketsTableBody');
    if (!tbody) return;

    const visibles = hideDelivered ? tickets.filter(t => t.status !== 'Entregado') : tickets;

    if (visibles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-muted);">No se encontraron tickets con los filtros actuales.</td></tr>`;
        return;
    }

    tbody.innerHTML = visibles.map(t => {
        const estadoActual = KANBAN_STATUSES.includes(t.status) ? t.status : 'Pendiente';
        const { text: garantiaTexto, className: garantiaClase } = getWarrantyStatus(t);
        const optionsHtml = KANBAN_STATUSES.map(st =>
            `<option value="${escapeHtml(st)}" ${st === estadoActual ? 'selected' : ''}>${escapeHtml(st)}</option>`
        ).join('');

        return `
            <tr class="clickable-row" data-row-ticket="${escapeHtml(t.id)}">
                <td>
                    <span class="tc-id">${escapeHtml(t.id)}</span>
                    <div class="text-muted" style="font-size:0.75rem; margin-top:3px;">${formatFullDate(t.fecha)}</div>
                </td>
                <td>
                    <strong>${escapeHtml(t.clienteNombre || 'Sin nombre')}</strong>
                    <div class="text-muted" style="font-size:0.78rem;">${escapeHtml(t.clienteTelefono || '')}</div>
                </td>
                <td>
                    <strong>${escapeHtml(t.equipoModelo || 'Sin modelo')}</strong>
                    <div class="text-muted" style="font-size:0.78rem; max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(t.trabajoRealizar || '')}</div>
                </td>
                <td class="no-row-open">
                    <select class="status-select-inline" data-inline-status="${escapeHtml(t.id)}">
                        ${optionsHtml}
                    </select>
                </td>
                <td>
                    <strong class="text-success">${formatCurrency(t.precioTotal)}</strong>
                    ${garantiaTexto ? `<div><span class="tc-garantia ${garantiaClase}">${garantiaTexto}</span></div>` : ''}
                </td>
                <td class="text-right no-row-open">
                    <button type="button" class="icon-btn" data-table-print="${escapeHtml(t.id)}" title="Imprimir orden">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                    </button>
                    <button type="button" class="icon-btn danger" data-table-delete="${escapeHtml(t.id)}" title="Eliminar">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('tr[data-row-ticket]').forEach(row => {
        row.addEventListener('click', (ev) => {
            if (ev.target.closest('.no-row-open')) return;
            abrirModalTicket(row.dataset.rowTicket);
        });
    });

    tbody.querySelectorAll('[data-inline-status]').forEach(sel => {
        sel.addEventListener('change', async () => {
            await actualizarEstadoTicket(sel.dataset.inlineStatus, sel.value);
        });
    });

    tbody.querySelectorAll('[data-table-print]').forEach(btn => {
        btn.addEventListener('click', () => imprimirPresupuesto(btn.dataset.tablePrint));
    });

    tbody.querySelectorAll('[data-table-delete]').forEach(btn => {
        btn.addEventListener('click', () => borrarTicket(btn.dataset.tableDelete));
    });
}

function drag(ev) {
    const card = ev.target.closest ? ev.target.closest('.ticket-card') : ev.target;
    card.classList.add('dragging');
    ev.dataTransfer.setData('text/plain', card.id);
    ev.dataTransfer.effectAllowed = 'move';
}

async function drop(ev, nuevoEstado) {
    ev.preventDefault();
    const ticketId = ev.dataTransfer.getData('text/plain');
    if (!ticketId || !nuevoEstado) return;
    await actualizarEstadoTicket(ticketId, nuevoEstado);
}

async function actualizarEstadoTicket(ticketId, nuevoEstado) {
    const ticket = await db.tickets.get(ticketId);
    if (!ticket) return;

    ticket.status = nuevoEstado;
    if (nuevoEstado === 'Entregado' && !ticket.fechaEntrega) {
        ticket.fechaEntrega = new Date().toISOString();
    }

    await db.tickets.put(ticket);
    await updateNavActiveBadge();
    await renderKanban(document.getElementById('searchInput')?.value || '');
}

async function borrarTicket(id) {
    const ok = await confirmarAccion({
        titulo: `Eliminar ticket ${id}`,
        mensaje: `¿Estás seguro de eliminar el ticket ${id}? Esta acción quitará el registro de forma permanente.`,
        textoConfirmar: 'Eliminar Ticket',
        peligro: true
    });
    if (!ok) return;

    await db.tickets.delete(id);
    document.getElementById('ticket-modal').hidden = true;
    await updateNavActiveBadge();
    await renderKanban(document.getElementById('searchInput')?.value || '');
    if (document.getElementById('dashboard-view').classList.contains('active')) {
        await renderDashboard();
    }
    showToast(`Ticket ${id} eliminado`);
}

// --- MODAL DE DETALLE Y EDICIÓN DE TICKET ---
function buildWhatsAppUrl(ticket) {
    const digits = String(ticket.clienteTelefono || '').replace(/\D/g, '');
    if (!digits) return '';
    // Si es un número móvil argentino de 10 dígitos (ej. 1122334455), prefijar 549
    const phone = digits.length === 10 ? `549${digits}` : digits;

    let msg = `Hola ${ticket.clienteNombre || ''}, te escribimos de *LAPFIX* por tu equipo *${ticket.equipoModelo || ''}* (Orden *${ticket.id}*).`;
    if (ticket.status === 'Listo para Entregar') {
        msg += ` ¡Ya está listo para retirar! Saldo pendiente: *${formatCurrency(ticket.precioTotal)}*.`;
    } else if (ticket.status === 'Pendiente Aprobación') {
        msg += ` Ya realizamos el diagnóstico. El presupuesto queda con un saldo de *${formatCurrency(ticket.precioTotal)}*. Avisanos si avanzamos.`;
    }
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

async function abrirModalTicket(id) {
    const ticket = await db.tickets.get(id);
    if (!ticket) return;

    document.getElementById('editTicketId').value = ticket.id;
    document.getElementById('modal-ticket-id').textContent = ticket.id;
    document.getElementById('modal-ticket-title').textContent = ticket.equipoModelo || 'Detalle del Ticket';

    const fechaIngreso = formatFullDate(ticket.fecha);
    const fechaEnt = ticket.fechaEntrega ? ` · Entregado el ${formatFullDate(ticket.fechaEntrega)}` : '';
    document.getElementById('modal-ticket-dates').textContent = `Ingresado el ${fechaIngreso}${fechaEnt}`;

    // Selector de estado
    const statusSel = document.getElementById('editStatus');
    const estadoActual = KANBAN_STATUSES.includes(ticket.status) ? ticket.status : 'Pendiente';
    statusSel.innerHTML = KANBAN_STATUSES.map(st =>
        `<option value="${escapeHtml(st)}" ${st === estadoActual ? 'selected' : ''}>${escapeHtml(st)}</option>`
    ).join('');

    // Garantía
    const warrantyWrap = document.getElementById('modal-warranty-badge-wrap');
    const { text: gText, className: gClass } = getWarrantyStatus(ticket);
    warrantyWrap.innerHTML = gText ? `<span class="tc-garantia ${gClass}">${gText}</span>` : '';

    // Botón WhatsApp
    const waBtn = document.getElementById('modal-whatsapp-btn');
    const waUrl = buildWhatsAppUrl(ticket);
    if (waUrl) {
        waBtn.href = waUrl;
        waBtn.hidden = false;
    } else {
        waBtn.hidden = true;
    }

    // Campos de datos
    document.getElementById('editClienteNombre').value = ticket.clienteNombre || '';
    document.getElementById('editClienteTelefono').value = ticket.clienteTelefono || '';
    document.getElementById('editEquipoModelo').value = ticket.equipoModelo || '';
    document.getElementById('editEquipoSerie').value = ticket.equipoSerie || '';
    document.getElementById('editObsInicial').value = ticket.obsInicial || '';
    document.getElementById('editTrabajoRealizar').value = ticket.trabajoRealizar || '';

    // Precios: reconstruir margen si es un ticket anterior que no guardaba margenRepuestos
    const repVenta = parseFloat(ticket.precioRepuestos) || 0;
    const repNeto = ticket.costoRepuestosNeto !== undefined ? (parseFloat(ticket.costoRepuestosNeto) || 0) : repVenta;
    let margen = ticket.margenRepuestos !== undefined
        ? (parseFloat(ticket.margenRepuestos) || 0)
        : (repNeto > 0 ? Math.round(((repVenta - repNeto) / repNeto) * 10000) / 100 : 0);

    document.getElementById('editCostoRepuestosNeto').value = repNeto || '';
    document.getElementById('editMargenRepuestos').value = margen;
    document.getElementById('editPrecioManoObra').value = parseFloat(ticket.precioManoObra) || '';
    document.getElementById('editPrecioSena').value = parseFloat(ticket.precioSena) || '';

    calcularTotalEdicion();
    document.getElementById('ticket-modal').hidden = false;
}

function calcularTotalEdicion() {
    const neto = parseFloat(document.getElementById('editCostoRepuestosNeto').value) || 0;
    const margen = parseFloat(document.getElementById('editMargenRepuestos').value) || 0;
    const ventaRep = neto + (neto * margen / 100);
    const mo = parseFloat(document.getElementById('editPrecioManoObra').value) || 0;
    const sena = parseFloat(document.getElementById('editPrecioSena').value) || 0;
    const totalTrabajo = ventaRep + mo;
    const saldo = Math.max(0, totalTrabajo - sena);

    document.getElementById('editRepuestosVentaSpan').textContent = formatCurrency(ventaRep);
    document.getElementById('editTotalTrabajoSpan').textContent = formatCurrency(totalTrabajo);
    document.getElementById('editSaldoTotalSpan').textContent = formatCurrency(saldo);
    return { neto, margen, ventaRep, mo, sena, saldo };
}

document.addEventListener('DOMContentLoaded', () => {
    ['editCostoRepuestosNeto', 'editMargenRepuestos', 'editPrecioManoObra', 'editPrecioSena'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calcularTotalEdicion);
    });

    document.getElementById('modal-print-btn')?.addEventListener('click', () => {
        const id = document.getElementById('editTicketId').value;
        if (id) imprimirPresupuesto(id);
    });

    document.getElementById('modal-delete-btn')?.addEventListener('click', () => {
        const id = document.getElementById('editTicketId').value;
        if (id) borrarTicket(id);
    });

    document.getElementById('edit-ticket-form')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const id = document.getElementById('editTicketId').value;
        const ticket = await db.tickets.get(id);
        if (!ticket) return;

        const { neto, margen, ventaRep, mo, sena, saldo } = calcularTotalEdicion();
        const nuevoEstado = document.getElementById('editStatus').value;
        const clienteNom = document.getElementById('editClienteNombre').value.trim();
        const clienteTel = document.getElementById('editClienteTelefono').value.trim();

        ticket.status = nuevoEstado;
        if (nuevoEstado === 'Entregado' && !ticket.fechaEntrega) {
            ticket.fechaEntrega = new Date().toISOString();
        }
        ticket.clienteNombre = clienteNom;
        ticket.clienteTelefono = clienteTel;
        ticket.equipoModelo = document.getElementById('editEquipoModelo').value.trim();
        ticket.equipoSerie = document.getElementById('editEquipoSerie').value.trim();
        ticket.obsInicial = document.getElementById('editObsInicial').value.trim();
        ticket.trabajoRealizar = document.getElementById('editTrabajoRealizar').value.trim();
        ticket.costoRepuestosNeto = neto;
        ticket.margenRepuestos = margen;
        ticket.precioRepuestos = ventaRep;
        ticket.precioManoObra = mo;
        ticket.precioSena = sena;
        ticket.precioTotal = saldo;

        await db.transaction('rw', db.tickets, db.clientes, async () => {
            await db.tickets.put(ticket);
            if (clienteTel) await db.clientes.put({ telefono: clienteTel, nombre: clienteNom });
        });

        document.getElementById('ticket-modal').hidden = true;
        await cargarClientesDataList();
        await updateNavActiveBadge();
        await renderKanban(document.getElementById('searchInput')?.value || '');
        if (document.getElementById('dashboard-view').classList.contains('active')) {
            await renderDashboard();
        }
        showToast(`Ticket ${id} actualizado`);
    });
});

// --- GESTIÓN DE SERVICIOS Y TARIFARIO ---
function initServicesEvents() {
    document.getElementById('btn-new-service')?.addEventListener('click', () => abrirModalServicio());
    document.getElementById('serviceSearchInput')?.addEventListener('input', renderServicios);

    document.getElementById('service-form')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const editId = document.getElementById('serviceEditId').value;
        const categoria = document.getElementById('serviceCategoria').value.trim();
        const nombre = document.getElementById('serviceNombre').value.trim();
        const precio = parseFloat(document.getElementById('servicePrecio').value);
        const justificacion = document.getElementById('serviceJustificacion').value.trim();

        if (!categoria || !nombre || !Number.isFinite(precio) || precio < 0) {
            showToast('Completá una categoría, nombre y precio válido.', 4000, 'error');
            return;
        }

        if (editId) {
            await db.servicios.put({ id: Number(editId), categoria, nombre, precioSugerido: precio, justificacion });
            showToast('Servicio actualizado');
        } else {
            await db.servicios.add({ categoria, nombre, precioSugerido: precio, justificacion });
            showToast('Servicio agregado al tarifario');
        }

        document.getElementById('service-modal').hidden = true;
        await renderServicios();
    });
}

async function abrirModalServicio(id = null) {
    const form = document.getElementById('service-form');
    form.reset();
    document.getElementById('serviceEditId').value = '';

    if (id !== null) {
        const s = await db.servicios.get(Number(id));
        if (!s) return;
        document.getElementById('service-modal-title').textContent = 'Editar Servicio';
        document.getElementById('serviceEditId').value = s.id;
        document.getElementById('serviceCategoria').value = s.categoria || '';
        document.getElementById('serviceNombre').value = s.nombre || '';
        document.getElementById('servicePrecio').value = s.precioSugerido ?? 0;
        document.getElementById('serviceJustificacion').value = s.justificacion || '';
    } else {
        document.getElementById('service-modal-title').textContent = 'Nuevo Servicio';
    }

    document.getElementById('service-modal').hidden = false;
    document.getElementById('serviceCategoria').focus();
}

async function borrarServicio(id) {
    const s = await db.servicios.get(Number(id));
    if (!s) return;

    const ok = await confirmarAccion({
        titulo: 'Eliminar servicio',
        mensaje: `¿Eliminar "${s.nombre}" del tarifario? Los tickets ya creados no se verán afectados.`,
        textoConfirmar: 'Eliminar',
        peligro: true
    });
    if (!ok) return;

    await db.servicios.delete(Number(id));
    showToast('Servicio eliminado');
    await renderServicios();
}

async function renderServicios() {
    const servicios = await db.servicios.toArray();
    const categorias = [...new Set(servicios.map(s => s.categoria).filter(Boolean))];

    // Pills de categorías
    const pillsWrap = document.getElementById('service-category-pills');
    if (pillsWrap) {
        if (selectedServiceCategory !== 'all' && !categorias.includes(selectedServiceCategory)) {
            selectedServiceCategory = 'all';
        }
        pillsWrap.innerHTML = [
            `<button type="button" class="pill ${selectedServiceCategory === 'all' ? 'active' : ''}" data-cat="all">Todos (${servicios.length})</button>`,
            ...categorias.map(cat => {
                const n = servicios.filter(s => s.categoria === cat).length;
                return `<button type="button" class="pill ${selectedServiceCategory === cat ? 'active' : ''}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)} (${n})</button>`;
            })
        ].join('');

        pillsWrap.querySelectorAll('.pill').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedServiceCategory = btn.dataset.cat;
                renderServicios();
            });
        });
    }

    // Tabla filtrada en vista Tarifario
    const searchQ = (document.getElementById('serviceSearchInput')?.value || '').trim().toLowerCase();
    const filtrados = servicios.filter(s => {
        const matchCat = selectedServiceCategory === 'all' || s.categoria === selectedServiceCategory;
        const matchText = !searchQ ||
            String(s.nombre || '').toLowerCase().includes(searchQ) ||
            String(s.categoria || '').toLowerCase().includes(searchQ) ||
            String(s.justificacion || '').toLowerCase().includes(searchQ);
        return matchCat && matchText;
    });

    const tableBody = document.querySelector('#servicesTable tbody');
    if (tableBody) {
        if (filtrados.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 2rem; color: var(--text-muted);">No hay servicios para mostrar.</td></tr>`;
        } else {
            tableBody.innerHTML = filtrados.map(s => `
                <tr>
                    <td><span class="cat-badge">${escapeHtml(s.categoria)}</span></td>
                    <td>
                        <strong>${escapeHtml(s.nombre)}</strong>
                        ${s.justificacion ? `<div class="text-muted" style="font-size:0.79rem; margin-top:2px;">${escapeHtml(s.justificacion)}</div>` : ''}
                    </td>
                    <td><strong class="text-success">${formatCurrency(s.precioSugerido)}</strong></td>
                    <td class="text-right">
                        <button type="button" class="icon-btn" data-edit-service="${Number(s.id)}" title="Editar servicio">
                            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 20h9"></path>
                                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                            </svg>
                        </button>
                        <button type="button" class="icon-btn danger" data-delete-service="${Number(s.id)}" title="Eliminar servicio">
                            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </td>
                </tr>
            `).join('');

            tableBody.querySelectorAll('[data-edit-service]').forEach(btn => {
                btn.addEventListener('click', () => abrirModalServicio(btn.dataset.editService));
            });
            tableBody.querySelectorAll('[data-delete-service]').forEach(btn => {
                btn.addEventListener('click', () => borrarServicio(btn.dataset.deleteService));
            });
        }
    }

    // Poblar selector en Nuevo Ingreso
    const select = document.getElementById('servicioSelect');
    if (select) {
        const defaultOption = select.options[0];
        select.innerHTML = '';
        select.appendChild(defaultOption);

        categorias.forEach(cat => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = cat;
            servicios.filter(s => s.categoria === cat).forEach(s => {
                const option = document.createElement('option');
                option.value = s.id;
                option.textContent = `${s.nombre} — ${formatCurrency(s.precioSugerido)}`;
                option.dataset.precio = s.precioSugerido;
                option.dataset.nombre = s.nombre;
                optgroup.appendChild(option);
            });
            select.appendChild(optgroup);
        });
    }

    // Poblar servicios habituales (frecuentes en Nuevo Ingreso)
    const freqGrid = document.getElementById('frequent-services-grid');
    if (freqGrid) {
        const frecuentes = servicios.slice(0, 6);
        if (frecuentes.length === 0) {
            freqGrid.innerHTML = `<span class="text-muted" style="font-size:0.8rem;">No hay servicios cargados en el tarifario.</span>`;
        } else {
            freqGrid.innerHTML = frecuentes.map(s => `
                <button type="button" class="service-card-btn" data-freq-nombre="${escapeHtml(s.nombre)}" data-freq-precio="${s.precioSugerido}">
                    <span class="sc-name">${escapeHtml(s.nombre)}</span>
                    <span class="sc-price">${formatCurrency(s.precioSugerido)}</span>
                </button>
            `).join('');

            freqGrid.querySelectorAll('.service-card-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    agregarServicioAlTicket(btn.dataset.freqNombre, parseFloat(btn.dataset.freqPrecio) || 0);
                });
            });
        }
    }
}

// --- NOTIFICACIONES TOAST ---
function showToast(message, duration = 3200, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = type === 'error' ? 'toast toast-error' : 'toast';
    toast.textContent = message;

    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

// --- IMPRESIÓN DE ORDEN DE SERVICIO / PRESUPUESTO ---
async function imprimirPresupuesto(id) {
    const ticket = await db.tickets.get(id);
    if (!ticket) return;

    const printContainer = document.getElementById('print-container');
    const fechaEmision = new Date().toLocaleDateString('es-AR');
    const fechaIngreso = formatFullDate(ticket.fecha) || fechaEmision;

    const repuestos = parseFloat(ticket.precioRepuestos) || 0;
    const manoObra = parseFloat(ticket.precioManoObra) || 0;
    const sena = parseFloat(ticket.precioSena) || 0;
    const subtotal = repuestos + manoObra;

    printContainer.innerHTML = `
        <div class="print-header">
            <div>
                <div class="print-logo">LAP<span>FIX</span></div>
                <div class="print-sub">Servicio Técnico Especializado</div>
            </div>
            <div class="print-meta">
                <h2>Orden de Servicio / Presupuesto</h2>
                <p><strong>Orden N°:</strong> ${escapeHtml(ticket.id)}</p>
                <p><strong>Fecha de ingreso:</strong> ${escapeHtml(fechaIngreso)}</p>
                <p><strong>Estado:</strong> ${escapeHtml(ticket.status || 'Pendiente')}</p>
            </div>
        </div>

        <div class="print-grid-2">
            <div class="print-box">
                <h3>Datos del Cliente</h3>
                <p><strong>Nombre:</strong> ${escapeHtml(ticket.clienteNombre)}</p>
                <p><strong>Teléfono:</strong> ${escapeHtml(ticket.clienteTelefono)}</p>
            </div>
            <div class="print-box">
                <h3>Datos del Equipo</h3>
                <p><strong>Equipo / Modelo:</strong> ${escapeHtml(ticket.equipoModelo)}</p>
                <p><strong>N° de Serie:</strong> ${escapeHtml(ticket.equipoSerie || 'No especificado')}</p>
            </div>
        </div>

        <div class="print-box">
            <h3>Estado Inicial y Accesorios Recibidos</h3>
            <p>${escapeHtml(ticket.obsInicial || 'Sin observaciones particulares.')}</p>
        </div>

        <div class="print-box">
            <h3>Falla Reportada / Trabajo a Realizar</h3>
            <p style="white-space: pre-line;">${escapeHtml(ticket.trabajoRealizar)}</p>
        </div>

        <div class="print-totals">
            <div class="pt-row">
                <span>Repuestos / Materiales:</span>
                <span>${formatCurrency(repuestos)}</span>
            </div>
            <div class="pt-row">
                <span>Mano de Obra:</span>
                <span>${formatCurrency(manoObra)}</span>
            </div>
            <div class="pt-row">
                <span>Subtotal del Trabajo:</span>
                <span>${formatCurrency(subtotal)}</span>
            </div>
            <div class="pt-row">
                <span>Seña / Adelanto Abonado:</span>
                <span>- ${formatCurrency(sena)}</span>
            </div>
            <div class="pt-row pt-final">
                <span>Saldo a Pagar:</span>
                <span>${formatCurrency(ticket.precioTotal)}</span>
            </div>
        </div>

        <div class="print-terms">
            <h4>Términos y Condiciones</h4>
            <p>1. El presupuesto tiene una validez de 15 días corridos a partir de la fecha de emisión.</p>
            <p>2. Pasados los 90 días desde que se notifica la finalización o presupuesto del equipo sin ser retirado, el taller no se responsabiliza por el mismo y podrá disponer de él para cubrir gastos operativos y de almacenamiento.</p>
            <p>3. La garantía sobre la mano de obra realizada es de 30 días desde la entrega y no cubre fallas causadas por mal uso, golpes, sobretensión o derrames de líquidos.</p>
        </div>

        <div class="print-signatures">
            <div class="sig-box">Firma Técnico / Taller</div>
            <div class="sig-box">Firma y Aclaración Cliente</div>
        </div>
    `;

    window.print();
}

// --- RESPALDO Y RESTAURACIÓN ---
function initBackupEvents() {
    document.getElementById('export-btn')?.addEventListener('click', exportData);
    document.getElementById('import-btn')?.addEventListener('click', importData);
    document.getElementById('btn-seed-demo')?.addEventListener('click', () => generarTicketsDemo(25));
    document.getElementById('btn-demo-dashboard')?.addEventListener('click', () => generarTicketsDemo(25));
    document.getElementById('btn-clear-demo')?.addEventListener('click', limpiarTodosLosTickets);
}

async function renderSettingsStats() {
    document.getElementById('db-stat-tickets').textContent = await db.tickets.count();
    document.getElementById('db-stat-clientes').textContent = await db.clientes.count();
    document.getElementById('db-stat-servicios').textContent = await db.servicios.count();
}

async function exportData() {
    try {
        const backup = {
            app: 'LAPFIX',
            version: 2,
            fecha: new Date().toISOString(),
            tickets: await db.tickets.toArray(),
            clientes: await db.clientes.toArray(),
            servicios: await db.servicios.toArray()
        };
        const dataStr = JSON.stringify(backup, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const exportFileDefaultName = `lapfix_backup_${new Date().toISOString().split('T')[0]}.json`;

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', url);
        linkElement.setAttribute('download', exportFileDefaultName);
        document.body.appendChild(linkElement);
        linkElement.click();
        linkElement.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        showToast('Respaldo descargado con éxito');
    } catch (error) {
        console.error('Error al exportar datos:', error);
        showToast('Error al exportar los datos.', 4000, 'error');
    }
}

async function importData() {
    const fileInput = document.getElementById('importFile');
    const file = fileInput.files[0];

    if (!file) {
        showToast('Seleccioná un archivo de respaldo (.json) primero.', 4000, 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = async function (event) {
        try {
            const data = JSON.parse(event.target.result);

            const tickets = Array.isArray(data) ? data : data.tickets;
            const clientes = Array.isArray(data) ? [] : (data.clientes || []);
            const servicios = Array.isArray(data) ? [] : (data.servicios || []);

            if (!Array.isArray(tickets) || !Array.isArray(clientes) || !Array.isArray(servicios)) {
                throw new Error('El formato del archivo no es válido.');
            }

            const ticketsValidos = tickets.filter(t => t && t.id);

            const ok = await confirmarAccion({
                titulo: 'Restaurar respaldo',
                mensaje: `Se importarán ${ticketsValidos.length} tickets, ${clientes.length} clientes y ${servicios.length} servicios. Los registros con el mismo ID serán actualizados.`,
                textoConfirmar: 'Restaurar Datos',
                peligro: false
            });
            if (!ok) return;

            await db.transaction('rw', db.tickets, db.clientes, db.servicios, async () => {
                await db.tickets.bulkPut(ticketsValidos);
                if (clientes.length) await db.clientes.bulkPut(clientes.filter(c => c && c.telefono));
                if (servicios.length) await db.servicios.bulkPut(servicios.filter(s => s && s.nombre));
            });

            showToast(`Se restauraron ${ticketsValidos.length} tickets con éxito`);
            fileInput.value = '';
            await safeRun('tarifario', renderServicios);
            await safeRun('agenda de clientes', cargarClientesDataList);
            await safeRun('contador activo', updateNavActiveBadge);
            await safeRun('estadísticas', renderSettingsStats);
        } catch (error) {
            console.error('Error al importar datos:', error);
            showToast('Error al procesar el archivo. Verificá que sea un respaldo válido.', 5000, 'error');
        }
    };
    reader.readAsText(file);
}

// --- GENERADOR DE TICKETS DE PRUEBA (DEMO) ---
async function generarTicketsDemo(cantidad = 25) {
    const nombres = [
        'Martín Gómez', 'Lucía Fernández', 'Valentina Ruiz', 'Lucas Pereyra',
        'Sofía Méndez', 'Diego Morales', 'Camila Sosa', 'Nicolás Castro',
        'Agustina Romero', 'Mateo Benítez', 'Joaquín Silva', 'Florencia Herrera',
        'Julián Álvarez', 'Mariana Paz', 'Federico Rossi', 'Camila Torres',
        'Gonzalo Díaz', 'Paula Navarro', 'Sebastián Ramos', 'Abril Giménez'
    ];

    const equipos = [
        { modelo: 'Notebook Lenovo IdeaPad 3 15ITL6', serie: 'PF2A8K12' },
        { modelo: 'MacBook Air 13" M1 2020', serie: 'C02XYZ1290' },
        { modelo: 'PC Gamer AMD Ryzen 7 5700X + RTX 3070', serie: 'SN-GAMER-01' },
        { modelo: 'Notebook ASUS ROG Strix G15', serie: 'R9N0CV88' },
        { modelo: 'Notebook Dell Inspiron 15 3520', serie: '8H2K9133' },
        { modelo: 'Notebook HP Pavilion 15-eg0025nr', serie: '5CD21099' },
        { modelo: 'PC Desktop Intel Core i5 12400 Office', serie: 'DESK-I5-44' },
        { modelo: 'All-in-One HP 24-df0014la', serie: 'HP-AIO-77' },
        { modelo: 'Consola Sony PlayStation 5 Standard', serie: 'PS5-9921-A' },
        { modelo: 'Notebook Acer Nitro 5 AN515-57', serie: 'NHQ7ZAA001' },
        { modelo: 'Notebook Lenovo ThinkPad T14 Gen 2', serie: 'PF3X91A0' },
        { modelo: 'MacBook Pro 14" M2 Pro 2023', serie: 'FVFFK201' },
        { modelo: 'Consola Sony PlayStation 4 Slim 1TB', serie: 'CUH-2215B' },
        { modelo: 'PC Gamer Intel Core i7 13700KF + RTX 4070', serie: 'SN-GAMER-02' },
        { modelo: 'Notebook Banghó Bes Pro G04', serie: 'BG-5544-P' }
    ];

    const trabajos = [
        {
            desc: '• Muy lenta / Limpieza de virus\n+ Formateo Completo + Backup (25GB)',
            repNeto: 0, margen: 0, mo: 62000, sena: 20000, obs: 'Con cargador original'
        },
        {
            desc: '• Levanta temperatura / Se apaga sola\n+ Limpieza + Pasta Térmica (Notebook/Gamer)',
            repNeto: 0, margen: 0, mo: 72000, sena: 20000, obs: 'Con cargador original, Rayones leves de uso'
        },
        {
            desc: '• Pantalla rota / Sin video\n+ Cambio de Pantalla o Teclado (Laptops)',
            repNeto: 95000, margen: 30, mo: 58000, sena: 70000, obs: 'Sin cargador, Detalle en carcasa'
        },
        {
            desc: '• No arranca Windows / Disco dañado\n+ Clonado de Disco (SATA a SSD)',
            repNeto: 48000, margen: 35, mo: 77000, sena: 30000, obs: 'Con cargador original'
        },
        {
            desc: '• Bisagras rotas / Carcasa dañada\n+ Reconstrucción artesanal de anclajes de bisagras',
            repNeto: 12000, margen: 25, mo: 108900, sena: 40000, obs: 'Con cargador original'
        },
        {
            desc: '• No enciende\n• Revisión y diagnóstico técnico para presupuesto',
            repNeto: 0, margen: 0, mo: 30000, sena: 0, obs: 'Con cargador original'
        },
        {
            desc: '• Mantenimiento preventivo completo\n+ Limpieza + Pasta Térmica (PC Desktop)',
            repNeto: 0, margen: 0, mo: 46000, sena: 0, obs: 'Gabinete completo'
        },
        {
            desc: '• Optimización profunda de sistema operativo y drivers',
            repNeto: 0, margen: 0, mo: 46000, sena: 15000, obs: 'Con cargador original'
        },
        {
            desc: '• Recuperación de datos por borrado accidental\n+ Recuperación de Datos Lógica',
            repNeto: 0, margen: 0, mo: 105000, sena: 30000, obs: 'Disco externo USB'
        },
        {
            desc: '• Armado y configuración de PC Gamer\n+ Gestión de cables avanzada + stress test',
            repNeto: 0, margen: 0, mo: 130000, sena: 50000, obs: 'Componentes en cajas cerradas'
        }
    ];

    const estadosPool = [
        'Entregado', 'Entregado', 'Entregado', 'Entregado', 'Entregado', 'Entregado',
        'Listo para Entregar', 'Listo para Entregar', 'Listo para Entregar',
        'En Proceso', 'En Proceso', 'En Proceso',
        'Esperando Repuestos', 'Esperando Repuestos',
        'Pendiente Aprobación', 'Pendiente Aprobación',
        'Pendiente', 'Pendiente'
    ];

    const ahora = new Date();
    const nuevosTickets = [];
    const nuevosClientes = [];

    const ticketsExistentes = await db.tickets.toArray();
    const numeros = ticketsExistentes
        .map(t => parseInt(String(t.id || '').split('-')[1], 10))
        .filter(n => Number.isFinite(n));
    let seq = Math.max(0, ...numeros, parseInt(localStorage.getItem('lapfix_last_seq') || '0', 10));

    const mesesAtras = [90, 60, 30, 5];
    let entregadoCount = 0;

    for (let i = 0; i < cantidad; i++) {
        seq++;
        const id = `LPX-${String(seq).padStart(3, '0')}`;
        const nombre = nombres[i % nombres.length];
        const tel = `11${Math.floor(40000000 + (i * 1234567) % 50000000)}`;
        const eq = equipos[i % equipos.length];
        const trab = trabajos[i % trabajos.length];
        const status = estadosPool[i % estadosPool.length];

        const repNeto = trab.repNeto;
        const margen = trab.margen;
        const precioRepuestos = repNeto + (repNeto * margen / 100);
        const precioManoObra = trab.mo;
        const precioSena = trab.sena;
        const totalTrabajo = precioRepuestos + precioManoObra;
        const saldoFinal = Math.max(0, totalTrabajo - precioSena);

        let fechaObj;
        let fechaEntregaObj = null;

        if (status === 'Entregado') {
            const baseDias = mesesAtras[entregadoCount % mesesAtras.length];
            entregadoCount++;
            const varDias = (i * 3) % 15;
            const diasTotales = baseDias + varDias;
            fechaObj = new Date(ahora.getTime() - diasTotales * 24 * 60 * 60 * 1000);
            fechaEntregaObj = new Date(fechaObj.getTime() + 3 * 24 * 60 * 60 * 1000);
        } else {
            const diasAtras = (i * 2) % 12;
            fechaObj = new Date(ahora.getTime() - diasAtras * 24 * 60 * 60 * 1000);
        }

        nuevosTickets.push({
            id,
            clienteNombre: nombre,
            clienteTelefono: tel,
            equipoModelo: eq.modelo,
            equipoSerie: `${eq.serie}-${seq}`,
            obsInicial: trab.obs,
            trabajoRealizar: trab.desc,
            costoRepuestosNeto: repNeto,
            margenRepuestos: margen,
            precioRepuestos,
            precioManoObra,
            precioSena,
            precioTotal: saldoFinal,
            status,
            fecha: fechaObj.toISOString(),
            fechaEntrega: fechaEntregaObj ? fechaEntregaObj.toISOString() : null
        });

        nuevosClientes.push({ telefono: tel, nombre });
    }

    localStorage.setItem('lapfix_last_seq', String(seq));

    await db.transaction('rw', db.clientes, db.tickets, async () => {
        await db.clientes.bulkPut(nuevosClientes);
        await db.tickets.bulkPut(nuevosTickets);
    });

    await updateNavActiveBadge();
    await cargarClientesDataList();
    await renderSettingsStats();
    await renderDashboard();
    await renderKanban();

    showToast(`¡Se generaron ${cantidad} tickets de prueba con éxito!`);
    switchView('dashboard-view');
}

async function limpiarTodosLosTickets() {
    const total = await db.tickets.count();
    if (total === 0) {
        showToast('No hay tickets para eliminar.');
        return;
    }
    const ok = await confirmarAccion({
        titulo: 'Vaciar base de tickets',
        mensaje: `¿Estás seguro de que querés eliminar los ${total} tickets existentes? Esta acción no se puede deshacer.`,
        textoConfirmar: 'Eliminar todos',
        peligro: true
    });
    if (!ok) return;

    await db.tickets.clear();
    localStorage.removeItem('lapfix_last_seq');
    await updateNavActiveBadge();
    await renderSettingsStats();
    await renderDashboard();
    await renderKanban();
    showToast('Se eliminaron todos los tickets correctamente.');
}

window.generarTicketsDemo = generarTicketsDemo;
window.limpiarTodosLosTickets = limpiarTodosLosTickets;
