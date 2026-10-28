import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentModal } from '../../components/PaymentModal.tsx';
import type { BillingPlanWithId, Customer, PppSecret } from '../../types.ts';

vi.mock('../../contexts/LocalizationContext.tsx', () => ({
    useLocalization: () => ({ t: (key: string) => key, formatCurrency: (value: number) => `PHP ${value}` }),
}));

type PaymentProps = React.ComponentProps<typeof PaymentModal>;
const routerId = 'router/a +1';
const secretName = 'LimpotDanteA.15mb+8/253';
const billingUsername = 'Portal.Dante+253/billing?';
const plan: BillingPlanWithId = {
    id: 'plan-15', routerId, name: '15 Mbps', price: 500, cycle: 'Monthly', cycle_days: 30,
    pppoeProfile: '15mb', description: '', currency: 'PHP',
};
const customer: Customer = {
    id: 'customer-253', routerId, username: billingUsername, pppoeSecret: secretName,
    fullName: 'Dante Limpot', accountNumber: 'BILL/253 +A', address: 'Billing address',
};
const secret = (overrides: Partial<PppSecret> = {}): PppSecret => ({
    id: '*router-secret-253', name: secretName, profile: '15mb', service: 'pppoe', disabled: 'false',
    comment: JSON.stringify({ planType: 'postpaid', accountNumber: 'STALE-TOP', customer: { accountNumber: 'STALE-NESTED' } }),
    ...overrides,
});
const onSave = vi.fn<Parameters<PaymentProps['onSave']>, ReturnType<PaymentProps['onSave']>>();
const onClose = vi.fn();
const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
const props = (value: PppSecret): PaymentProps => ({
    isOpen: true, secret: value, routerId, plans: [plan], nonPaymentProfile: 'non-payment',
    companySettings: {}, onSave, onClose,
});
const unpaid = [{ month: '2026-09', planName: plan.name, planPrice: plan.price }];
const invoice = { id: 'invoice/billing-253', planName: 'Billing account invoice', amount: 500 };
const response = (value: unknown) => ({ ok: true, json: async () => value }) as Response;

function expectBillingReads(username: string, accountNumber: string | null, postpaid = true) {
    const calls = fetchMock.mock.calls;
    expect(calls).toHaveLength(postpaid ? 3 : 2);
    const paths = calls.map(([url]) => new URL(String(url), 'http://test.invalid'));
    expect(paths.map(url => url.pathname).sort()).toEqual([
        ...(postpaid ? [`/api/billing-ledger/unpaid/${encodeURIComponent(routerId)}/${encodeURIComponent(username)}`] : []),
        `/api/client-balance/${encodeURIComponent(routerId)}/${encodeURIComponent(username)}`,
        '/api/db/client-invoices-lookup',
    ].sort());
    const params = paths.find(url => url.pathname === '/api/db/client-invoices-lookup')!.searchParams;
    expect(Object.fromEntries(params)).toEqual({
        routerId, username, status: 'PENDING', ...(accountNumber ? { accountNumber } : {}),
    });
    for (const [, options] of calls) {
        expect(options?.method ?? 'GET').toBe('GET');
        expect(options?.body).toBeUndefined();
    }
}

async function submit() {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Process Payment' })); });
}

beforeEach(() => {
    vi.resetAllMocks();
    onSave.mockResolvedValue(true);
    // All requests terminate here; the real modal has no database/router service dependency.
    vi.stubGlobal('fetch', fetchMock.mockImplementation(async (url) => {
        const path = new URL(String(url), 'http://test.invalid').pathname;
        if (path.startsWith('/api/billing-ledger/unpaid/')) return response(unpaid);
        if (path.startsWith('/api/client-balance/')) return response({ balance: -100 });
        if (path === '/api/db/client-invoices-lookup') return response([invoice]);
        throw new Error(`Unexpected request: ${url}`);
    }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('PaymentModal billing identity reads', () => {
    it.each(['postpaid', 'prepaid'])('uses the linked billing username and customer account number for %s, not router/comment identities', async planType => {
        const current = secret({
            customer,
            comment: JSON.stringify({ planType, accountNumber: 'STALE-TOP', customer: { accountNumber: 'STALE-NESTED' } }),
        });
        render(<PaymentModal {...props(current)} />);
        await screen.findByRole('option', { name: 'Billing account invoice — PHP 500' });
        expectBillingReads(billingUsername, customer.accountNumber!, planType === 'postpaid');
        expect(screen.getByText('For user: Dante Limpot')).toBeInTheDocument();
        expect(screen.getByText('Client Credit Available')).toBeInTheDocument();
        expect(screen.getByLabelText(/Custom Amount Paid/)).toHaveAttribute('placeholder', 'Exact: PHP 400');
        if (planType === 'postpaid') expect(screen.getByRole('combobox', { name: 'Billing Month' })).toHaveValue('2026-09');
        else expect(screen.queryByRole('combobox', { name: 'Billing Month' })).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/Custom Amount Paid/), { target: { value: '425' } });
        await submit();
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith({
            sale: expect.objectContaining({ clientName: customer.fullName, clientAddress: customer.address, invoiceId: invoice.id, finalAmount: 425, planType }),
            payment: expect.objectContaining({ plan, creditApplied: 100, overpaymentCredit: 25, ...(planType === 'postpaid' ? { coveredMonth: '2026-09' } : {}) }),
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(current.name).toBe(secretName);
        expectBillingReads(billingUsername, customer.accountNumber!, planType === 'postpaid');
    });

    it.each([
        ['top-level account', { accountNumber: 'ROUTER/253 +A', customer: { accountNumber: 'IGNORED-NESTED' } }, 'ROUTER/253 +A'],
        ['nested account', { customer: { username: 'ignored-comment-login', accountNumber: 'NESTED/253 +B' } }, 'NESTED/253 +B'],
        ['no account', {}, null],
    ] as const)('falls back to the entire secret name without a customer (%s)', async (_kind, comment, accountNumber) => {
        render(<PaymentModal {...props(secret({ comment: JSON.stringify({ planType: 'postpaid', ...comment }) }))} />);
        await screen.findByRole('option', { name: 'Billing account invoice — PHP 500' });
        expectBillingReads(secretName, accountNumber);
        expect(screen.getByText(`For user: ${secretName}`)).toBeInTheDocument();
        await submit();
        expect(onSave).toHaveBeenCalledWith({
            sale: expect.objectContaining({ clientName: secretName, invoiceId: invoice.id, finalAmount: 400 }),
            payment: expect.objectContaining({ coveredMonth: '2026-09', creditApplied: 100 }),
        });
    });

    it('submits only once while payment is pending and closes on a successful callback without retrying', async () => {
        let resolve!: (value: boolean) => void;
        onSave.mockReturnValue(new Promise<boolean>(res => { resolve = res; }));
        const current = secret({ customer });
        const view = render(<PaymentModal {...props(current)} />);
        await screen.findByRole('option', { name: 'Billing account invoice — PHP 500' });
        await submit();
        const processing = screen.getByRole('button', { name: 'Processing...' });
        expect(processing).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        fireEvent.click(processing);
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();

        // A successful payment with a non-fatal warning still returns true to the modal.
        await act(async () => { resolve(true); });
        expect(onClose).toHaveBeenCalledTimes(1);
        view.rerender(<PaymentModal {...props(current)} isOpen={false} />);
        expect(screen.queryByRole('button', { name: 'Process Payment' })).not.toBeInTheDocument();
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        expectBillingReads(billingUsername, customer.accountNumber!);
    });

    it('still uses the customer account number when the router comment is malformed', async () => {
        render(<PaymentModal {...props(secret({ customer, comment: '{broken' }))} />);
        await screen.findByRole('option', { name: 'Billing account invoice — PHP 500' });
        expectBillingReads(billingUsername, customer.accountNumber!, false);
    });

    it('falls back to the secret name when the customer billing username is empty', async () => {
        render(<PaymentModal {...props(secret({ customer: { ...customer, username: '' } }))} />);
        await screen.findByRole('option', { name: 'Billing account invoice — PHP 500' });
        expectBillingReads(secretName, customer.accountNumber!);
    });

    it('reloads billing reads when a customer attaches to the same secret, but preserves edits on equivalent rerenders', async () => {
        const initial = secret();
        const view = render(<PaymentModal {...props(initial)} />);
        await screen.findByRole('option', { name: 'Billing account invoice — PHP 500' });
        expectBillingReads(secretName, 'STALE-TOP');
        fetchMock.mockClear();
        fetchMock.mockImplementation(async (url) => {
            const path = new URL(String(url), 'http://test.invalid').pathname;
            if (path.startsWith('/api/billing-ledger/unpaid/')) return response([{ month: '2026-08', planName: plan.name, planPrice: 500 }]);
            if (path.startsWith('/api/client-balance/')) return response({ balance: -50 });
            if (path === '/api/db/client-invoices-lookup') return response([{ ...invoice, id: 'linked-invoice', planName: 'Linked account invoice' }]);
            throw new Error(`Unexpected request: ${url}`);
        });
        view.rerender(<PaymentModal {...props({ ...initial, customer })} />);
        await screen.findByRole('option', { name: 'Linked account invoice — PHP 500' });
        expectBillingReads(billingUsername, customer.accountNumber!);
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Billing Month' })).toHaveValue('2026-08'));
        expect(screen.getByLabelText(/Custom Amount Paid/)).toHaveAttribute('placeholder', 'Exact: PHP 450');

        fireEvent.change(screen.getByLabelText(/Custom Amount Paid/), { target: { value: '475' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Payment Method' }), { target: { value: 'GCASH' } });
        view.rerender(<PaymentModal {...props({ ...initial, customer: { ...customer } })} plans={[{ ...plan }]} />);
        expect(screen.getByLabelText(/Custom Amount Paid/)).toHaveValue(475);
        expect(screen.getByRole('combobox', { name: 'Payment Method' })).toHaveValue('GCASH');
        expectBillingReads(billingUsername, customer.accountNumber!);
        await submit();
        expect(onSave).toHaveBeenCalledWith({
            sale: expect.objectContaining({ invoiceId: 'linked-invoice', payment_method: 'GCASH', finalAmount: 475 }),
            payment: expect.objectContaining({ coveredMonth: '2026-08', creditApplied: 50, overpaymentCredit: 25 }),
        });
    });
});
