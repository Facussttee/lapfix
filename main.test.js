const test = require('node:test');
const assert = require('node:assert');

// Mock browser globals before requiring main.js
global.Dexie = class {
    constructor() {}
    version() { return { stores: () => {} }; }
};
global.document = {
    addEventListener: () => {},
    getElementById: () => ({
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        appendChild: () => {}
    }),
    querySelector: () => ({
        classList: { add: () => {}, remove: () => {}, contains: () => false }
    }),
    createElement: () => ({
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        appendChild: () => {}
    }),
    body: { appendChild: () => {} }
};
global.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
};

const { getWarrantyStatus } = require('./main.js');

test('getWarrantyStatus - should return empty for non-delivered status', () => {
    const ticket = { status: 'Pendiente', fechaEntrega: null };
    const result = getWarrantyStatus(ticket);
    assert.deepStrictEqual(result, { text: '', className: '' });
});

test('getWarrantyStatus - should return empty when fechaEntrega is missing', () => {
    const ticket = { status: 'Entregado', fechaEntrega: null };
    const result = getWarrantyStatus(ticket);
    assert.deepStrictEqual(result, { text: '', className: '' });
});

test('getWarrantyStatus - should return Vigente when within one month', () => {
    const today = new Date().toISOString();
    const ticket = { status: 'Entregado', fechaEntrega: today };
    const result = getWarrantyStatus(ticket);
    assert.deepStrictEqual(result, { text: 'Garantía Vigente', className: 'garantia-vigente' });
});

test('getWarrantyStatus - should return Vencida when more than one month passed', () => {
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const ticket = { status: 'Entregado', fechaEntrega: twoMonthsAgo.toISOString() };
    const result = getWarrantyStatus(ticket);
    assert.deepStrictEqual(result, { text: 'Garantía Vencida', className: 'garantia-vencida' });
});

test('getWarrantyStatus - edge case: end of month (Jan 31st)', () => {
    // January 31st
    const deliveryDate = new Date(2024, 0, 31);
    const ticket = { status: 'Entregado', fechaEntrega: deliveryDate.toISOString() };

    // The code adds 1 month: new Date(2024, 0, 31).setMonth(0 + 1) -> Feb 31 -> March 2 (since 2024 is leap year, Feb has 29 days)
    // So Feb 29 should still be within warranty.
    const feb29 = new Date(2024, 1, 29);

    // We need to mock 'today' or at least understand what 'hoy' will be.
    // Since getWarrantyStatus uses 'new Date()', we can temporarily mock global.Date
    const RealDate = global.Date;
    global.Date = class extends RealDate {
        constructor(arg) {
            if (arg) return new RealDate(arg);
            return feb29;
        }
    };

    try {
        const result = getWarrantyStatus(ticket);
        // On Feb 29, it should still be valid because Jan 31 + 1 month = March 2 in JS
        assert.deepStrictEqual(result, { text: 'Garantía Vigente', className: 'garantia-vigente' });
    } finally {
        global.Date = RealDate;
    }
});
