// --- BASE DE DATOS (DEXIE.JS) ---
const db = new Dexie("LapfixDB");

// Definimos la estructura de la tabla (solo los campos indexados por los que queramos buscar/ordenar)
db.version(1).stores({
    tickets: 'id, status, clienteNombre, fecha' 
});

const KANBAN_STATUSES = ['Pendiente', 'Pendiente Aprobación', 'En Proceso', 'Esperando Repuestos', 'Listo para Entregar', 'Entregado'];

// Al cargar la ventana
document.addEventListener('DOMContentLoaded', async () => {
    // Crear el contenedor de notificaciones si no existe
    if (!document.getElementById('toast-container')) {
        const toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
    }

    // Migración automática de localStorage a Dexie (Para no perder datos previos)
    const legacyTickets = localStorage.getItem('lapfix_tickets');
    if (legacyTickets) {
        const parsedTickets = JSON.parse(legacyTickets);
        if (parsedTickets.length > 0) {
            await db.tickets.bulkPut(parsedTickets); // Guarda todos de golpe
        }
        localStorage.removeItem('lapfix_tickets'); // Limpia el localStorage viejo
    }

    // Lógica del Sidebar Retráctil
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const appContainer = document.querySelector('.app-container');

    // Revisa si el estado del sidebar está guardado en localStorage
    if (localStorage.getItem('sidebar_collapsed') === 'true') {
        appContainer.classList.add('sidebar-collapsed');
    }

    sidebarToggle.addEventListener('click', () => {
        appContainer.classList.toggle('sidebar-collapsed');
        // Guarda el estado actual (true/false) en localStorage
        const isCollapsed = appContainer.classList.contains('sidebar-collapsed');
        localStorage.setItem('sidebar_collapsed', isCollapsed);
    });

    // Navegación
    document.getElementById('nav-ticket').addEventListener('click', () => switchView('ticket-view'));
    document.getElementById('nav-kanban').addEventListener('click', () => switchView('kanban-view'));
    document.getElementById('nav-dashboard').addEventListener('click', () => switchView('dashboard-view'));
    document.getElementById('nav-settings').addEventListener('click', () => switchView('settings-view'));

    // Cálculo de totales en tiempo real
    document.getElementById('precioRepuestos').addEventListener('input', calcularTotal);
    document.getElementById('precioManoObra').addEventListener('input', calcularTotal);
    document.getElementById('precioSena').addEventListener('input', calcularTotal);

    // Búsqueda en Kanban
    document.getElementById('searchInput').addEventListener('input', filtrarTickets);

    // Exportación e Importación
    document.getElementById('export-btn').addEventListener('click', exportData);
    document.getElementById('import-btn').addEventListener('click', importData);

    // Drag and Drop en columnas Kanban
    document.querySelectorAll('.col-content').forEach(col => {
        col.addEventListener('dragover', allowDrop);
        col.addEventListener('drop', (e) => {
            const nuevoEstado = col.getAttribute('data-status');
            drop(e, nuevoEstado);
        });
    });

    // Delegación de eventos para botones en tarjetas Kanban (Eliminar e Imprimir)
    document.querySelector('.kanban-board').addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('btn-delete')) {
            const ticketId = target.closest('.ticket-card').id;
            borrarTicket(ticketId);
        } else if (target.classList.contains('btn-print')) {
            const ticketId = target.closest('.ticket-card').id;
            imprimirPresupuesto(ticketId);
        }
    });

    await renderKanban();
});

// --- NAVEGACIÓN ---
function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    
    document.getElementById(viewId).classList.add('active');
    
    if(viewId === 'ticket-view') document.getElementById('nav-ticket').classList.add('active');
    if(viewId === 'kanban-view') {
        document.getElementById('nav-kanban').classList.add('active');
        renderKanban(); // Refrescar por si hubo cambios
    }
    if(viewId === 'settings-view') document.getElementById('nav-settings').classList.add('active');
    if(viewId === 'dashboard-view') {
        document.getElementById('nav-dashboard').classList.add('active');
        renderDashboard();
    }
}

// --- LÓGICA DE DASHBOARD FINANCIERO ---
let financeChartInstance = null;

async function renderDashboard() {
    const tickets = await db.tickets.toArray();

    // Métricas básicas
    const totalTickets = tickets.length;

    // Solo consideramos para ingresos/ganancias los tickets que ya están facturados o entregados.
    // Opcional: Podrías considerar también los "Listos para Entregar" si así lo deseas, pero
    // comúnmente el ingreso real es cuando se entrega.
    const ticketsEntregados = tickets.filter(t => t.status === 'Entregado');

    let ingresosBrutos = 0;
    let gananciaNeta = 0;

    ticketsEntregados.forEach(t => {
        ingresosBrutos += parseFloat(t.precioTotal) || 0;
        // Asumiendo que la ganancia neta es la mano de obra + cualquier seña extra si aplica
        // (o simplemente restamos los repuestos del total cobrado).
        const costoRepuestos = parseFloat(t.precioRepuestos) || 0;
        gananciaNeta += (parseFloat(t.precioTotal) || 0) - costoRepuestos;
    });

    // Pendiente de cobro (Listos para entregar)
    let pendienteCobro = 0;
    const ticketsListos = tickets.filter(t => t.status === 'Listo para Entregar');
    ticketsListos.forEach(t => {
        pendienteCobro += parseFloat(t.precioTotal) || 0;
    });

    // Actualizar UI
    document.getElementById('metric-total-tickets').innerText = totalTickets;
    document.getElementById('metric-gross-income').innerText = `$${ingresosBrutos.toFixed(2)}`;
    document.getElementById('metric-net-profit').innerText = `$${gananciaNeta.toFixed(2)}`;
    document.getElementById('metric-pending-payment').innerText = `$${pendienteCobro.toFixed(2)}`;

    // Preparar datos para el gráfico (Agrupados por mes)
    const monthlyData = {};
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    ticketsEntregados.forEach(t => {
        const fecha = new Date(t.fechaEntrega || t.fecha);
        const mesAnio = `${monthNames[fecha.getMonth()]} ${fecha.getFullYear()}`;

        if (!monthlyData[mesAnio]) {
            monthlyData[mesAnio] = { brutos: 0, netos: 0 };
        }

        monthlyData[mesAnio].brutos += parseFloat(t.precioTotal) || 0;
        monthlyData[mesAnio].netos += (parseFloat(t.precioTotal) || 0) - (parseFloat(t.precioRepuestos) || 0);
    });

    const labels = Object.keys(monthlyData);
    const brutosData = labels.map(l => monthlyData[l].brutos);
    const netosData = labels.map(l => monthlyData[l].netos);

    // Dibujar el gráfico con Chart.js
    const ctx = document.getElementById('financeChart').getContext('2d');

    // Si ya existe un gráfico previo, lo destruimos para evitar superposición
    if (financeChartInstance) {
        financeChartInstance.destroy();
    }

    financeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : ['Sin datos aún'],
            datasets: [
                {
                    label: 'Ingresos Brutos',
                    data: brutosData.length > 0 ? brutosData : [0],
                    backgroundColor: 'rgba(59, 130, 246, 0.5)', // Electric blue
                    borderColor: 'rgb(59, 130, 246)',
                    borderWidth: 1
                },
                {
                    label: 'Ganancia Neta',
                    data: netosData.length > 0 ? netosData : [0],
                    backgroundColor: 'rgba(34, 197, 94, 0.5)', // Neon green
                    borderColor: 'rgb(34, 197, 94)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: '#94a3b8'
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#94a3b8'
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#f8fafc'
                    }
                }
            }
        }
    });
}

// --- LÓGICA DE FORMULARIO (Cálculo Realtime) ---
function calcularTotal() {
    const repuestos = parseFloat(document.getElementById('precioRepuestos').value) || 0;
    const manoObra = parseFloat(document.getElementById('precioManoObra').value) || 0;
    const sena = parseFloat(document.getElementById('precioSena').value) || 0;
    
    const total = (repuestos + manoObra) - sena;
    document.getElementById('precioTotal').value = total > 0 ? total : 0;
}

// --- CREACIÓN DE TICKET (CREATE) ---
async function generarId() {
    const tickets = await db.tickets.toArray();
    if (tickets.length === 0) return 'LPX-001';
    // Buscar el número más alto actual
    const maxId = Math.max(...tickets.map(t => parseInt(t.id.split('-')[1])));
    // Sumar 1 y rellenar con ceros a la izquierda (ej: 002)
    return `LPX-${String(maxId + 1).padStart(3, '0')}`;
}

document.getElementById('ticket-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const nuevoId = await generarId();

    const nuevoTicket = {
        id: nuevoId,
        clienteNombre: document.getElementById('clienteNombre').value,
        clienteTelefono: document.getElementById('clienteTelefono').value,
        equipoModelo: document.getElementById('equipoModelo').value,
        obsInicial: document.getElementById('obsInicial').value,
        trabajoRealizar: document.getElementById('trabajoRealizar').value,
        precioRepuestos: document.getElementById('precioRepuestos').value,
        precioManoObra: document.getElementById('precioManoObra').value,
        precioSena: document.getElementById('precioSena').value,
        precioTotal: document.getElementById('precioTotal').value,
        status: 'Pendiente', // Estado inicial por defecto
        fecha: new Date().toISOString(),
        fechaEntrega: null // La garantía empieza cuando esto se rellena
    };

    await db.tickets.add(nuevoTicket);
    
    // Limpiar formulario y mostrar notificación
    this.reset();
    calcularTotal(); // Resetea el total a 0
    showToast(`¡Ticket ${nuevoTicket.id} creado con éxito!`);
    switchView('kanban-view');
});

// --- NOTIFICACIONES (TOAST) ---
function showToast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    container.appendChild(toast);

    // Auto-eliminar el toast después de la duración especificada
    setTimeout(() => {
        toast.remove();
    }, duration);
}

// --- LÓGICA DE GARANTÍA ---
function getWarrantyStatus(ticket) {
    if (ticket.status !== 'Entregado' || !ticket.fechaEntrega) {
        return { text: '', className: '' }; // No aplica garantía aún
    }

    const fechaEntrega = new Date(ticket.fechaEntrega);
    const fechaVencimiento = new Date(fechaEntrega);
    fechaVencimiento.setMonth(fechaVencimiento.getMonth() + 1); // Sumamos 1 mes

    const hoy = new Date();

    if (hoy <= fechaVencimiento) {
        return { text: 'Garantía Vigente', className: 'garantia-vigente' };
    } else {
        return { text: 'Garantía Vencida', className: 'garantia-vencida' };
    }
}


// --- KANBAN BOARD (READ & FILTER) ---
async function renderKanban(filtro = '') {
    // Limpiar columnas
    KANBAN_STATUSES.forEach(estado => {
        const statusId = estado.replace(/ /g, '-');
        const listEl = document.getElementById(`list-${statusId}`);
        if (listEl) listEl.innerHTML = '';
    });

    // Filtrar y renderizar
    const lowerFiltro = filtro.toLowerCase();
    const ticketsFiltrados = await db.tickets.filter(t =>
        t.id.toLowerCase().includes(lowerFiltro) ||
        t.clienteNombre.toLowerCase().includes(lowerFiltro)
    ).toArray();

    ticketsFiltrados.forEach(ticket => {
        const { text: garantiaTexto, className: garantiaClase } = getWarrantyStatus(ticket);

        const card = document.createElement('div');
        card.className = 'ticket-card';
        card.draggable = true;
        card.id = ticket.id;
        card.addEventListener('dragstart', drag);

        card.innerHTML = `
            <div class="tc-header">
                <span class="tc-id">${ticket.id}</span>
                <span class="tc-cliente">${ticket.clienteNombre}</span>
            </div>
            <div class="tc-equipo">💻 ${ticket.equipoModelo}</div>
            <div class="tc-footer">
                <span class="tc-garantia ${garantiaClase}">${garantiaTexto}</span>
                <span class="tc-total">$${ticket.precioTotal}</span>
                <div style="display:flex; gap:0.5rem">
                    <button class="btn-print" title="Imprimir">🖨️</button>
                    <button class="btn-delete">Eliminar</button>
                </div>
            </div>
        `;
        
        const statusId = ticket.status.replace(/ /g, '-');
        const column = document.getElementById(`list-${statusId}`);
        if (column) column.appendChild(card);
    });

    // Actualizar contadores
    KANBAN_STATUSES.forEach(estado => {
        const statusId = estado.replace(/ /g, '-');
        const countEl = document.getElementById(`count-${statusId}`);
        if (countEl) countEl.innerText = ticketsFiltrados.filter(t => t.status === estado).length;
    });
}

function filtrarTickets() {
    const texto = document.getElementById('searchInput').value;
    renderKanban(texto);
}

// --- DELETE ---
async function borrarTicket(id) {
    if(confirm(`¿Estás seguro de eliminar el ticket ${id}? Esta acción no se puede deshacer.`)) {
        await db.tickets.delete(id);
        await renderKanban();
    }
}

// --- DRAG AND DROP (UPDATE) ---
function drag(ev) {
    // Guardamos el ID del ticket que estamos arrastrando
    ev.dataTransfer.setData("ticketId", ev.target.id);
}

function allowDrop(ev) {
    // Necesario para permitir que el elemento se suelte aquí
    ev.preventDefault();
}

async function drop(ev, nuevoEstado) {
    ev.preventDefault();
    const ticketId = ev.dataTransfer.getData("ticketId");
    
    const ticket = await db.tickets.get(ticketId);
    if (ticket) {
        ticket.status = nuevoEstado;
        // Si el nuevo estado es "Entregado" y no tenía fecha de entrega, la establecemos.
        if (nuevoEstado === 'Entregado' && !ticket.fechaEntrega) {
            ticket.fechaEntrega = new Date().toISOString();
        }

        await db.tickets.put(ticket);
        // Repintamos el tablero sin recargar la página
        renderKanban(document.getElementById('searchInput').value);
    }
}

// --- IMPRESIÓN DE PRESUPUESTO ---
async function imprimirPresupuesto(id) {
    const ticket = await db.tickets.get(id);
    if (!ticket) return;

    const printContainer = document.getElementById('print-container');
    const fechaActual = new Date().toLocaleDateString('es-ES');

    printContainer.innerHTML = `
        <div class="print-header">
            <div class="print-logo">LAP<span>FIX</span></div>
            <div>
                <h2>Presupuesto / Orden de Servicio</h2>
                <p>Fecha: ${fechaActual}</p>
                <p><strong>Ticket ID:</strong> ${ticket.id}</p>
            </div>
        </div>

        <div class="print-section">
            <h3>Datos del Cliente</h3>
            <p><strong>Nombre:</strong> ${ticket.clienteNombre}</p>
            <p><strong>Teléfono:</strong> ${ticket.clienteTelefono}</p>
        </div>

        <div class="print-section">
            <h3>Datos del Equipo</h3>
            <p><strong>Modelo:</strong> ${ticket.equipoModelo}</p>
            <p><strong>Observaciones:</strong> ${ticket.obsInicial || 'N/A'}</p>
        </div>

        <div class="print-section">
            <h3>Trabajo a Realizar / Falla</h3>
            <p>${ticket.trabajoRealizar}</p>
        </div>

        <div class="print-totals">
            <div class="pt-row">
                <span>Costo Repuestos:</span>
                <span>$${ticket.precioRepuestos || 0}</span>
            </div>
            <div class="pt-row">
                <span>Mano de Obra:</span>
                <span>$${ticket.precioManoObra || 0}</span>
            </div>
            <div class="pt-row">
                <span>Seña Dejada:</span>
                <span>$${ticket.precioSena || 0}</span>
            </div>
            <div class="pt-row pt-final">
                <span>Total a Cobrar:</span>
                <span>$${ticket.precioTotal}</span>
            </div>
        </div>

        <div class="print-terms">
            <h4>Términos y Condiciones</h4>
            <p>1. El presupuesto tiene una validez de 15 días corridos a partir de la fecha de emisión.</p>
            <p>2. Pasados los 90 días desde que se notifica la reparación, si el equipo no es retirado, la empresa no se responsabiliza por el mismo y podrá disponer de él para cubrir los gastos de almacenamiento.</p>
            <p>3. La garantía sobre la reparación es de 30 días y no cubre fallas causadas por mal uso o factores externos (golpes, derrames de líquidos, etc).</p>
        </div>

        <div class="print-signatures">
            <div class="sig-box">Firma Técnico / Local</div>
            <div class="sig-box">Firma Cliente</div>
        </div>
    `;

    window.print();
}

// --- RESPALDO Y RESTAURACIÓN (BACKUP/RESTORE) ---
async function exportData() {
    try {
        const tickets = await db.tickets.toArray();
        const dataStr = JSON.stringify(tickets, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

        const exportFileDefaultName = `lapfix_backup_${new Date().toISOString().split('T')[0]}.json`;

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();

        showToast("¡Respaldo descargado con éxito!");
    } catch (error) {
        console.error("Error al exportar datos:", error);
        showToast("Error al exportar los datos.");
    }
}

async function importData() {
    const fileInput = document.getElementById('importFile');
    const file = fileInput.files[0];

    if (!file) {
        showToast("Por favor, selecciona un archivo de respaldo (.json) primero.");
        return;
    }

    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const importedTickets = JSON.parse(event.target.result);

            if (!Array.isArray(importedTickets)) {
                throw new Error("El formato del archivo no es válido.");
            }

            if (confirm("¿Estás seguro de restaurar estos datos? Los tickets actuales podrían ser reemplazados.")) {
                await db.tickets.bulkPut(importedTickets);
                showToast(`¡Se han restaurado ${importedTickets.length} tickets!`);
                fileInput.value = ''; // Clear input
            }
        } catch (error) {
            console.error("Error al importar datos:", error);
            showToast("Error al procesar el archivo. Asegúrate de que es un respaldo válido.");
        }
    };
    reader.readAsText(file);
}