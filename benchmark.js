const { performance } = require('perf_hooks');

const KANBAN_STATUSES = ['Pendiente', 'Pendiente Aprobación', 'En Proceso', 'Esperando Repuestos', 'Listo para Entregar', 'Entregado'];

// Generate mock tickets
const numTickets = 10000;
const ticketsFiltrados = [];
for (let i = 0; i < numTickets; i++) {
    ticketsFiltrados.push({
        status: KANBAN_STATUSES[Math.floor(Math.random() * KANBAN_STATUSES.length)]
    });
}

function runOriginal() {
    const start = performance.now();
    for(let i=0; i<1000; i++) {
        KANBAN_STATUSES.forEach(estado => {
            const count = ticketsFiltrados.filter(t => t.status === estado).length;
        });
    }
    return performance.now() - start;
}

function runOptimized() {
    const start = performance.now();
    for(let i=0; i<1000; i++) {
        const counts = {};
        KANBAN_STATUSES.forEach(estado => counts[estado] = 0);

        ticketsFiltrados.forEach(ticket => {
            if (counts[ticket.status] !== undefined) {
                counts[ticket.status]++;
            }
        });

        KANBAN_STATUSES.forEach(estado => {
            const count = counts[estado];
        });
    }
    return performance.now() - start;
}

const origTime = runOriginal();
const optTime = runOptimized();

console.log(`Original Time: ${origTime.toFixed(2)} ms`);
console.log(`Optimized Time: ${optTime.toFixed(2)} ms`);
console.log(`Improvement: ${((origTime - optTime) / origTime * 100).toFixed(2)}%`);
