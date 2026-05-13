// --- BASE DE DATOS (DEXIE.JS) ---
const db = new Dexie("LapfixDB");

// Definimos la estructura de la tabla (solo los campos indexados por los que queramos buscar/ordenar)
db.version(1).stores({
    tickets: 'id, status, clienteNombre, fecha' 
});

// Incrementamos versión para agregar nuevas tablas y campos indexados
db.version(2).stores({
    tickets: 'id, status, clienteNombre, fecha, equipoSerie',
    clientes: 'telefono, nombre', // Usaremos teléfono como clave primaria por ser más único
    servicios: '++id, categoria, nombre' // id autoincremental
}).upgrade(tx => {
    // Si necesitas migrar datos viejos de tickets para que tengan un campo vacío de equipoSerie
    return tx.tickets.toCollection().modify(ticket => {
        if (ticket.equipoSerie === undefined) ticket.equipoSerie = '';
    });
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

    await renderDashboard(); // Cargar dashboard por defecto en lugar del kanban
    // await renderKanban(); // Lo pre-renderizamos cuando el usuario visite la pestaña

    await seedServiciosDefault();

    // Eventos Drag & Drop para las columnas del Kanban
    const kanbanCols = document.querySelectorAll('.col-content');
    kanbanCols.forEach(col => {
        col.addEventListener('dragover', allowDrop);
        col.addEventListener('drop', (ev) => drop(ev, col.dataset.status));
    });

    // Evento de búsqueda para Kanban
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', filtrarTickets);
    }

    // Delegación de eventos para botones del Kanban (Imprimir y Eliminar)
    const kanbanBoard = document.querySelector('.kanban-board');
    if (kanbanBoard) {
        kanbanBoard.addEventListener('click', (ev) => {
            const ticketCard = ev.target.closest('.ticket-card');
            if (!ticketCard) return;

            const ticketId = ticketCard.id;

            if (ev.target.closest('.btn-print')) {
                imprimirPresupuesto(ticketId);
            } else if (ev.target.closest('.btn-delete')) {
                borrarTicket(ticketId);
            }
        });
    }

    // Eventos para Exportar e Importar DB
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportData);
    }

    const importBtn = document.getElementById('import-btn');
    if (importBtn) {
        importBtn.addEventListener('click', importData);
    }
});

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
        console.log("Servicios por defecto cargados.");
    }
}

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
let statusChartInstance = null;

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
        // Usamos costoRepuestosNeto si existe (versión 2), si no, usamos el viejo precioRepuestos
        const costoRepuestos = t.costoRepuestosNeto !== undefined ? parseFloat(t.costoRepuestosNeto) : (parseFloat(t.precioRepuestos) || 0);
        gananciaNeta += (parseFloat(t.precioTotal) || 0) - costoRepuestos;
    });

    // Pendiente de cobro (Listos para entregar)
    let pendienteCobro = 0;
    const ticketsListos = tickets.filter(t => t.status === 'Listo para Entregar');
    ticketsListos.forEach(t => {
        pendienteCobro += parseFloat(t.precioTotal) || 0;
    });

    // Actualizar UI con formato de moneda
    document.getElementById('metric-total-tickets').innerText = totalTickets;
    document.getElementById('metric-gross-income').innerText = formatCurrency(ingresosBrutos);
    document.getElementById('metric-net-profit').innerText = formatCurrency(gananciaNeta);
    document.getElementById('metric-pending-payment').innerText = formatCurrency(pendienteCobro);

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
        const costoRepuestos = t.costoRepuestosNeto !== undefined ? parseFloat(t.costoRepuestosNeto) : (parseFloat(t.precioRepuestos) || 0);
        monthlyData[mesAnio].netos += (parseFloat(t.precioTotal) || 0) - costoRepuestos;
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

    // --- GRÁFICO DE TORTA (ESTADOS) ---
    const ctxStatus = document.getElementById('statusChart').getContext('2d');

    if (statusChartInstance) {
        statusChartInstance.destroy();
    }

    const statusCounts = {};
    KANBAN_STATUSES.forEach(s => statusCounts[s] = 0);
    tickets.forEach(t => {
        if(statusCounts[t.status] !== undefined) statusCounts[t.status]++;
    });

    statusChartInstance = new Chart(ctxStatus, {
        type: 'pie',
        data: {
            labels: KANBAN_STATUSES,
            datasets: [{
                data: KANBAN_STATUSES.map(s => statusCounts[s]),
                backgroundColor: [
                    '#64748b', // Pendiente (Neutral)
                    '#ec4899', // Pendiente Aprobación (Rosa)
                    '#3b82f6', // En proceso (Azul)
                    '#f59e0b', // Esperando repuestos (Naranja)
                    '#22c55e', // Listo para entregar (Verde)
                    '#a78bfa'  // Entregado (Morado)
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#f8fafc', font: { size: 10 } }
                }
            }
        }
    });
}

// --- LÓGICA DE MONEDA (FORMATTER) ---
function formatCurrency(value) {
    const num = parseFloat(value) || 0;
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(num);
}

// --- LÓGICA DE FORMULARIO (Cálculo Realtime) ---
function calcularTotal() {
    const repuestosNeto = parseFloat(document.getElementById('precioRepuestos').value) || 0;
    const margen = parseFloat(document.getElementById('margenRepuestos').value) || 0;
    const subtotalRepuestos = repuestosNeto + (repuestosNeto * margen / 100);

    document.getElementById('subtotalRepuestosSpan').innerText = formatCurrency(subtotalRepuestos);

    const manoObra = parseFloat(document.getElementById('precioManoObra').value) || 0;
    const sena = parseFloat(document.getElementById('precioSena').value) || 0;
    
    const total = (subtotalRepuestos + manoObra) - sena;
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

    const clienteTel = document.getElementById('clienteTelefono').value;
    const clienteNom = document.getElementById('clienteNombre').value;

    const repuestosNeto = parseFloat(document.getElementById('precioRepuestos').value) || 0;
    const margen = parseFloat(document.getElementById('margenRepuestos').value) || 0;
    const subtotalRepuestos = repuestosNeto + (repuestosNeto * margen / 100);

    const nuevoTicket = {
        id: nuevoId,
        clienteNombre: clienteNom,
        clienteTelefono: clienteTel,
        equipoSerie: document.getElementById('equipoSerie').value,
        equipoModelo: document.getElementById('equipoModelo').value,
        obsInicial: document.getElementById('obsInicial').value,
        trabajoRealizar: document.getElementById('trabajoRealizar').value,
        precioRepuestos: subtotalRepuestos, // Guardamos el valor final de venta del repuesto
        costoRepuestosNeto: repuestosNeto, // Guardamos el costo real para calcular ganancias precisas
        precioManoObra: document.getElementById('precioManoObra').value,
        precioSena: document.getElementById('precioSena').value,
        precioTotal: document.getElementById('precioTotal').value,
        status: 'Pendiente', // Estado inicial por defecto
        fecha: new Date().toISOString(),
        fechaEntrega: null // La garantía empieza cuando esto se rellena
    };

    // Guardar o actualizar cliente
    await db.clientes.put({ telefono: clienteTel, nombre: clienteNom });

    await db.tickets.add(nuevoTicket);
    
    // Actualizar datalist para futuras búsquedas
    await cargarClientesDataList();

    // Limpiar formulario y mostrar notificación
    this.reset();
    document.getElementById('historialEquipoContainer').innerHTML = '';
    calcularTotal(); // Resetea el total a 0
    showToast(`¡Ticket ${nuevoTicket.id} creado con éxito!`);
    switchView('kanban-view');
});

// --- LÓGICA DE CLIENTES E HISTORIAL ---
async function cargarClientesDataList() {
    const clientes = await db.clientes.toArray();
    const dataList = document.getElementById('clientesList');
    if (dataList) {
        dataList.innerHTML = '';
        clientes.forEach(c => {
            const option = document.createElement('option');
            option.value = c.telefono;
            option.textContent = c.nombre;
            dataList.appendChild(option);
        });
    }
}

async function buscarClientePorTelefono() {
    const telefono = document.getElementById('clienteTelefono').value;
    if (telefono) {
        const cliente = await db.clientes.get(telefono);
        if (cliente) {
            document.getElementById('clienteNombre').value = cliente.nombre;
            showToast(`Cliente encontrado: ${cliente.nombre}`);
        }
    }
}

async function buscarHistorialEquipo() {
    const serie = document.getElementById('equipoSerie').value;
    const container = document.getElementById('historialEquipoContainer');

    if (!serie || serie.trim() === '') {
        container.innerHTML = '';
        return;
    }

    const ticketsPrevios = await db.tickets.where('equipoSerie').equals(serie).toArray();

    if (ticketsPrevios.length > 0) {
        let html = `<strong style="color: var(--accent-electric)">Atención: Este equipo tiene ${ticketsPrevios.length} ingreso(s) previo(s).</strong><ul style="padding-left: 20px; margin-top:5px; color: var(--text-muted)">`;
        ticketsPrevios.forEach(t => {
            const fechaStr = new Date(t.fecha).toLocaleDateString();
            html += `<li>[${fechaStr}] ${t.id} - Falla: ${t.trabajoRealizar.substring(0,30)}... (${t.status})</li>`;
        });
        html += `</ul>`;
        container.innerHTML = html;
    } else {
        container.innerHTML = `<span style="color: var(--text-muted)">Primer ingreso para este número de serie.</span>`;
    }
}

// Cargar datalist al inicio
document.addEventListener('DOMContentLoaded', cargarClientesDataList);

// --- GESTIÓN DE SERVICIOS PREDEFINIDOS ---
async function renderServicios() {
    const servicios = await db.servicios.toArray();

    // Rellenar tabla en el dashboard
    const tableBody = document.querySelector('#servicesTable tbody');
    if (tableBody) {
        tableBody.innerHTML = '';
        servicios.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${s.categoria}</td>
                <td>
                    <strong>${s.nombre}</strong>
                    <br><small class="text-muted">${s.justificacion || ''}</small>
                </td>
                <td style="color: var(--accent-neon); font-weight: bold;">$${s.precioSugerido}</td>
                <td>
                    <button class="btn-delete" onclick="borrarServicio(${s.id})">Eliminar</button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // Rellenar select en Nuevo Ticket
    const select = document.getElementById('servicioSelect');
    if (select) {
        // Guardar la primera opción
        const defaultOption = select.options[0];
        select.innerHTML = '';
        select.appendChild(defaultOption);

        // Agrupar por categoría (opcional pero queda más prolijo)
        const categorias = [...new Set(servicios.map(s => s.categoria))];

        categorias.forEach(cat => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = cat;

            servicios.filter(s => s.categoria === cat).forEach(s => {
                const option = document.createElement('option');
                option.value = s.id;
                option.textContent = `${s.nombre} - $${s.precioSugerido}`;
                // Guardamos data extra en los atributos para sacarla fácil al seleccionar
                option.dataset.precio = s.precioSugerido;
                option.dataset.nombre = s.nombre;
                optgroup.appendChild(option);
            });

            select.appendChild(optgroup);
        });
    }
}

async function aplicarServicioSeleccionado() {
    const select = document.getElementById('servicioSelect');
    if (select.value) {
        const option = select.options[select.selectedIndex];
        const nombreServicio = option.dataset.nombre;
        const precioSugerido = option.dataset.precio;

        // Auto-completar campos
        const trabajoActual = document.getElementById('trabajoRealizar').value;
        if (!trabajoActual.includes(nombreServicio)) {
            document.getElementById('trabajoRealizar').value = trabajoActual ? `${trabajoActual}\n+ ${nombreServicio}` : nombreServicio;
        }

        document.getElementById('precioManoObra').value = precioSugerido;
        calcularTotal();
    }
}

async function mostrarModalServicio() {
    const categoria = prompt("Categoría del servicio (Ej: Hardware, Software, Diagnóstico):");
    if (!categoria) return;

    const nombre = prompt("Nombre del servicio:");
    if (!nombre) return;

    const precioStr = prompt("Precio sugerido ($):");
    if (!precioStr) return;
    const precio = parseFloat(precioStr);

    const justificacion = prompt("Justificación o descripción (Opcional):") || "";

    await db.servicios.add({
        categoria,
        nombre,
        precioSugerido: precio,
        justificacion
    });

    showToast("Servicio agregado exitosamente");
    await renderServicios();
}

async function borrarServicio(id) {
    if(confirm("¿Estás seguro de eliminar este servicio? No afectará a los tickets ya creados.")) {
        await db.servicios.delete(id);
        await renderServicios();
    }
}

// Cargar servicios al inicio
document.addEventListener('DOMContentLoaded', renderServicios);

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

    const statusCounts = {};
    KANBAN_STATUSES.forEach(s => statusCounts[s] = 0);

    ticketsFiltrados.forEach(ticket => {
        statusCounts[ticket.status] = (statusCounts[ticket.status] || 0) + 1;

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
                <span class="tc-total">${formatCurrency(ticket.precioTotal)}</span>
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
        if (countEl) countEl.innerText = statusCounts[estado] || 0;
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
                <span>${formatCurrency(ticket.precioRepuestos || 0)}</span>
            </div>
            <div class="pt-row">
                <span>Mano de Obra:</span>
                <span>${formatCurrency(ticket.precioManoObra || 0)}</span>
            </div>
            <div class="pt-row">
                <span>Seña Dejada:</span>
                <span>${formatCurrency(ticket.precioSena || 0)}</span>
            </div>
            <div class="pt-row pt-final">
                <span>Total a Cobrar:</span>
                <span>${formatCurrency(ticket.precioTotal)}</span>
            </div>
        </div>

        <div class="print-terms">
            <h4>Términos y Condiciones</h4>
            <p>1. El presupuesto tiene una validez de 15 días corridos a partir de la fecha de emisión.</p>
            <p>2. Pasados los 90 días desde que se notifica la reparación, si el equipo no es retirado, la empresa no se responsabiliza por el mismo y podrá disponer de él para cubrir los gastos de almacenamiento.</p>
            <p>3. La garantía sobre la reparación es de 30 días y no cubre fallas causadas por mal uso o factores externos (golpes, derrames de líquidos, etc).</p>
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