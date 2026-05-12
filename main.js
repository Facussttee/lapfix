// --- BASE DE DATOS (DEXIE.JS) ---
const db = new Dexie("LapfixDB");

// Definimos la estructura de la tabla (solo los campos indexados por los que queramos buscar/ordenar)
db.version(1).stores({
    tickets: 'id, status, clienteNombre, fecha' 
});

const KANBAN_STATUSES = ['Pendiente', 'En Proceso', 'Esperando Repuestos', 'Listo para Entregar', 'Entregado'];

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
        card.ondragstart = (e) => drag(e);

        card.innerHTML = `
            <div class="tc-header">
                <span class="tc-id">${ticket.id}</span>
                <span class="tc-cliente">${ticket.clienteNombre}</span>
            </div>
            <div class="tc-equipo">💻 ${ticket.equipoModelo}</div>
            <div class="tc-footer">
                <span class="tc-garantia ${garantiaClase}">${garantiaTexto}</span>
                <span class="tc-total">$${ticket.precioTotal}</span>
                <button class="btn-delete" onclick="borrarTicket('${ticket.id}')">Eliminar</button>
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