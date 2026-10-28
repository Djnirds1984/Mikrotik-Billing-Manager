import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pppoe } from '../../components/Pppoe.tsx';
import { getPppProfiles, getPppSecrets, processPppPayment, savePppUser } from '../../services/mikrotikService.ts';
import { dbApi } from '../../services/databaseService.ts';
import { generateApplicationForm } from '../../services/applicationService.ts';
import type { BillingPlanWithId, Customer, PppSecret, RouterConfigWithId, SaleRecord } from '../../types.ts';

type PaymentProps = React.ComponentProps<typeof import('../../components/PaymentModal.tsx').PaymentModal>;
type PaymentResult = Awaited<ReturnType<typeof processPppPayment>>;
type PaymentInput = {
    sale: Omit<SaleRecord, 'id' | 'date' | 'routerName'>;
    payment: {
        plan: BillingPlanWithId; nonPaymentProfile: string; discountDays: number; paymentDate: string;
        coveredMonth?: string; creditApplied?: number; overpaymentCredit?: number;
    };
};
const data = vi.hoisted(() => ({
    customers: [] as Customer[], plans: [] as any[],
    paymentProps: null as PaymentProps | null, paymentInput: null as PaymentInput | null,
}));
vi.mock('../../services/mikrotikService.ts', () => ({
    getPppSecrets: vi.fn(), getPppProfiles: vi.fn(), savePppUser: vi.fn(),
    processPppPayment: vi.fn(), deletePppSecret: vi.fn(),
}));
vi.mock('../../services/databaseService.ts', () => ({
    dbApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../services/applicationService.ts', () => ({
    generateApplicationForm: vi.fn(), deleteApplication: vi.fn().mockResolvedValue(undefined),
}));
// Keep the real useCustomers hook to verify its automatic initial read is not duplicated.
vi.mock('../../hooks/useBillingPlans.ts', () => ({ useBillingPlans: () => ({ plans: data.plans }) }));
vi.mock('../../hooks/useBillingSettings.ts', () => ({ useBillingSettings: () => ({ settings: {} }) }));
vi.mock('../../hooks/useCompanySettings.ts', () => ({ useCompanySettings: () => ({ settings: {} }) }));
vi.mock('../../contexts/AuthContext.tsx', () => ({ useAuth: () => ({ hasPermission: () => true, user: null }) }));
vi.mock('../../contexts/LocalizationContext.tsx', () => ({
    useLocalization: () => ({ t: (key: string) => key, formatCurrency: (value: number) => `PHP ${value}` }),
}));
vi.mock('../../components/chart.tsx', () => ({ TrafficChart: () => null }));
vi.mock('../../components/Loader.tsx', () => ({ Loader: () => <div>Loading users</div> }));
vi.mock('../../components/PaymentModal.tsx', () => ({
    PaymentModal: (props: PaymentProps) => {
        data.paymentProps = props;
        return props.isOpen ? <button onClick={() => props.onSave(data.paymentInput!)}>Confirm payment</button> : null;
    },
}));
vi.mock('../../components/GracePeriodModal.tsx', () => ({ GracePeriodModal: () => null }));
vi.mock('../../components/BillingLedgerModal.tsx', () => ({ BillingLedgerModal: () => null }));
vi.mock('../../components/PrintableReceipt.tsx', () => ({ PrintableReceipt: () => null }));

const router: RouterConfigWithId = { id: 'router-a', name: 'Router A', host: 'mock', user: 'mock', port: 8728 };
const plan: BillingPlanWithId = {
    id: 'plan-15', routerId: router.id, name: '15 Mbps', price: 500, cycle: 'Monthly', cycle_days: 30,
    pppoeProfile: 'default', description: '', currency: 'PHP',
};
const secretName = 'LimpotDanteA.15mb+8/253';
const billingUsername = 'Portal.Dante+253/billing?';
const linkedCustomer: Customer = {
    id: 'customer-253', routerId: router.id, username: billingUsername, pppoeSecret: secretName,
    fullName: 'Dante Limpot', accountNumber: 'ACC-253',
};
const addSale = vi.fn().mockResolvedValue(undefined);
const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
const secret = (name = 'alice', comment = '{}'): PppSecret => ({
    id: `*${name}`, name, comment, service: 'pppoe', profile: 'default', disabled: 'false',
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const response = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value }) as Response;
const tableRow = (name: string) => within(screen.getByRole('table')).getByText(name).closest('tr')!;
const customerReads = () => vi.mocked(dbApi.get).mock.calls.filter(([path]) => path.startsWith('/customers')).length;
const field = (label: string) => screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('input')!;
async function openPayment() {
    await screen.findByText('Total Users: 1');
    fireEvent.click(within(tableRow('alice')).getByRole('button', { name: 'Pay' }));
}
async function pay() {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm payment' })); });
}

beforeEach(() => {
    vi.clearAllMocks();
    data.customers = [];
    data.plans = [];
    data.paymentProps = null;
    data.paymentInput = {
        sale: { clientName: 'alice', planName: plan.name, planPrice: plan.price, finalAmount: 500, discountAmount: 0, currency: 'PHP' },
        payment: { plan, nonPaymentProfile: 'non-payment', discountDays: 0, paymentDate: '2026-10-01' },
    };
    addSale.mockReset().mockResolvedValue(undefined);
    vi.mocked(processPppPayment).mockReset().mockResolvedValue({ secrets: [secret()] });
    vi.mocked(getPppSecrets).mockReset().mockResolvedValue([secret()]);
    vi.mocked(getPppProfiles).mockReset().mockResolvedValue([]);
    vi.mocked(savePppUser).mockReset().mockResolvedValue(undefined);
    vi.mocked(dbApi.get).mockReset().mockImplementation(async () => data.customers as any);
    vi.mocked(dbApi.patch).mockReset().mockResolvedValue({});
    vi.mocked(dbApi.post).mockReset().mockResolvedValue({});
    vi.mocked(generateApplicationForm).mockReset().mockResolvedValue({ id: 'application-new' } as any);
    vi.stubGlobal('fetch', fetchMock.mockReset().mockImplementation(async (url) => response(
        String(url).includes('/client-balances/') ? {} : String(url).includes('check-account') ? { exists: true } : [],
    )));
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('PPPoE independent refresh', () => {
    it('shows secrets without waiting for profiles, customers or balances and loads customers once', async () => {
        const users = deferred<PppSecret[]>();
        const customers = deferred<any[]>();
        vi.mocked(getPppSecrets).mockReturnValue(users.promise);
        vi.mocked(getPppProfiles).mockReturnValue(new Promise(() => {}));
        vi.mocked(dbApi.get).mockReturnValue(customers.promise);
        fetchMock.mockReturnValue(new Promise(() => {}));
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        expect(screen.getByText('Loading users')).toBeInTheDocument();
        expect(customerReads()).toBe(1);
        expect(getPppProfiles).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith('/api/client-balances/router-a', expect.objectContaining({ signal: expect.any(AbortSignal) }));
        await act(async () => { users.resolve([secret()]); });
        expect(tableRow('alice')).toBeInTheDocument();
        expect(screen.queryByText('Loading users')).not.toBeInTheDocument();
        await act(async () => { customers.resolve([{ id: 'c1', username: 'alice', routerId: router.id, fullName: 'Alice Long Full Name' }]); });
        expect(within(tableRow('alice')).getByText('Alice Long Full Name')).toBeInTheDocument();
        expect(customerReads()).toBe(1);
    });

    it('keeps rows visible when ancillary reads fail and reports HTTP balance failures', async () => {
        vi.mocked(getPppProfiles).mockRejectedValue(new Error('Profiles offline'));
        vi.mocked(dbApi.get).mockRejectedValue(new Error('Customers offline'));
        fetchMock.mockResolvedValue(response({}, 503));
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await screen.findByText('Total Users: 1');
        expect(tableRow('alice')).toBeInTheDocument();
        expect(screen.getByText(/Could not refresh PPPoE profiles: Profiles offline/)).toBeInTheDocument();
        expect(screen.getByText(/Could not refresh client balances: Request failed \(503\)/)).toBeInTheDocument();
        expect(screen.getByText('Customers offline')).toBeInTheDocument();
    });

    it('bounds the balance read with a 10-second abort signal', async () => {
        const controller = new AbortController();
        const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
        fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
            options!.signal!.addEventListener('abort', () => reject(new Error('Balance timeout')));
        }));
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await screen.findByText('Total Users: 1');
        expect(timeout).toHaveBeenCalledWith(10000);
        await act(async () => { controller.abort(); });
        expect(screen.getByText(/Could not refresh client balances: Balance timeout/)).toBeInTheDocument();
        expect(tableRow('alice')).toBeInTheDocument();
    });

    it('retains rows on mutation refresh and failure, and refreshes customers', async () => {
        const refreshed = deferred<PppSecret[]>();
        vi.mocked(getPppSecrets).mockResolvedValueOnce([secret()]).mockReturnValueOnce(refreshed.promise);
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await openPayment();
        await pay();
        expect(getPppSecrets).toHaveBeenCalledTimes(2);
        expect(customerReads()).toBe(2);
        expect(tableRow('alice')).toBeInTheDocument();
        expect(screen.queryByText('Loading users')).not.toBeInTheDocument();
        await act(async () => { refreshed.reject(new Error('Router offline')); });
        expect(screen.getByRole('alert')).toHaveTextContent('Router offline');
        expect(tableRow('alice')).toBeInTheDocument();
        await pay();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('coalesces overlapping mutation refreshes without blocking on a hung profile read', async () => {
        const refreshed = deferred<PppSecret[]>();
        const latest = deferred<PppSecret[]>();
        vi.mocked(getPppSecrets).mockResolvedValueOnce([secret()])
            .mockReturnValueOnce(refreshed.promise).mockReturnValueOnce(latest.promise);
        vi.mocked(getPppProfiles).mockReturnValue(new Promise(() => {}));
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await openPayment();
        await pay();
        await pay();
        await pay();
        expect(getPppSecrets).toHaveBeenCalledTimes(2);
        expect(getPppProfiles).toHaveBeenCalledTimes(1);
        await act(async () => { refreshed.resolve([secret('outdated')]); });
        expect(getPppSecrets).toHaveBeenCalledTimes(3);
        expect(screen.queryByText('outdated')).not.toBeInTheDocument();
        expect(tableRow('alice')).toBeInTheDocument();
        await act(async () => { latest.resolve([secret('latest')]); });
        expect(tableRow('latest')).toBeInTheDocument();
        expect(getPppSecrets).toHaveBeenCalledTimes(3);
    });

    it('ignores old router secrets, customer data and ancillary results after switching routers', async () => {
        const oldUsers = deferred<PppSecret[]>();
        const oldCustomers = deferred<any[]>();
        const oldProfiles = deferred<any[]>();
        const oldBalances = deferred<Response>();
        vi.mocked(getPppSecrets).mockReturnValueOnce(oldUsers.promise).mockResolvedValueOnce([secret('bob')]);
        vi.mocked(getPppProfiles).mockReturnValueOnce(oldProfiles.promise);
        vi.mocked(dbApi.get).mockReturnValueOnce(oldCustomers.promise);
        fetchMock.mockReturnValueOnce(oldBalances.promise);
        const view = render(<Pppoe selectedRouter={router} addSale={addSale} />);
        view.rerender(<Pppoe selectedRouter={{ ...router, id: 'router-b' }} addSale={addSale} />);
        await screen.findByText('Total Users: 1');
        expect(tableRow('bob')).toBeInTheDocument();
        await act(async () => {
            oldUsers.resolve([secret('alice')]);
            oldCustomers.resolve([{ id: 'old', username: 'bob', routerId: router.id, fullName: 'Wrong Customer' }]);
            oldProfiles.reject(new Error('Old router failure'));
            oldBalances.resolve(response({ bob: -999 }));
        });
        expect(tableRow('bob')).toBeInTheDocument();
        expect(screen.queryByText('alice')).not.toBeInTheDocument();
        expect(screen.queryByText('Wrong Customer')).not.toBeInTheDocument();
        expect(screen.queryByText(/Old router failure|999/)).not.toBeInTheDocument();
    });

    it('does not start a queued refresh after unmount', async () => {
        const refreshed = deferred<PppSecret[]>();
        vi.mocked(getPppSecrets).mockResolvedValueOnce([secret()]).mockReturnValueOnce(refreshed.promise);
        const view = render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await openPayment();
        await pay();
        await pay();
        view.unmount();
        await act(async () => { refreshed.resolve([secret('obsolete')]); });
        expect(getPppSecrets).toHaveBeenCalledTimes(2);
    });

    it('shows a first-load error without leaving an endless loader', async () => {
        vi.mocked(getPppSecrets).mockRejectedValue(new Error('Cannot connect'));
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Cannot connect');
        expect(screen.queryByText('Loading users')).not.toBeInTheDocument();
    });
});

describe('PPPoE payment billing identity', () => {
    it('shows a due-date warning only after the sale succeeds and preserves it through refresh without repeating payment or sale', async () => {
        const warning = 'Payment succeeded, but the customer due date could not be saved. Update the customer due date; do not pay again.';
        const processing = deferred<PaymentResult>();
        const recording = deferred<void>();
        const refreshed = deferred<PppSecret[]>();
        vi.mocked(processPppPayment).mockReturnValue(processing.promise);
        addSale.mockReturnValue(recording.promise);
        vi.mocked(getPppSecrets).mockResolvedValueOnce([secret()]).mockReturnValueOnce(refreshed.promise);
        const view = render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await openPayment();
        let saved!: Promise<boolean>;
        act(() => { saved = data.paymentProps!.onSave(data.paymentInput!); });
        expect(processPppPayment).toHaveBeenCalledTimes(1);
        expect(addSale).not.toHaveBeenCalled();
        await act(async () => { processing.resolve({ secrets: [secret()], warning }); });
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(warning)).not.toBeInTheDocument();
        expect(getPppSecrets).toHaveBeenCalledTimes(1);

        await act(async () => { recording.resolve(); expect(await saved).toBe(true); });
        expect(screen.getByRole('status')).toHaveTextContent(warning);
        expect(getPppSecrets).toHaveBeenCalledTimes(2);
        expect(tableRow('alice')).toBeInTheDocument();
        act(() => { data.paymentProps!.onClose(); });
        await act(async () => { refreshed.resolve([secret('refreshed-user')]); });
        view.rerender(<Pppoe selectedRouter={router} addSale={addSale} />);
        expect(tableRow('refreshed-user')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(warning);
        expect(screen.queryByRole('button', { name: 'Confirm payment' })).not.toBeInTheDocument();
        expect(processPppPayment).toHaveBeenCalledTimes(1);
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(addSale).toHaveBeenCalledWith(expect.objectContaining(data.paymentInput!.sale));
        expect(getPppSecrets).toHaveBeenCalledTimes(2);
        expect(customerReads()).toBe(2);
        expect(dbApi.patch).not.toHaveBeenCalled();
        expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(window.alert).not.toHaveBeenCalled();
    });

    it.each(['linked customer', 'no customer', 'empty billing username'])('keeps router identity separate from ledger and both credit writes (%s)', async kind => {
        const customer = kind === 'no customer' ? undefined : {
            ...linkedCustomer, username: kind === 'empty billing username' ? '' : billingUsername,
        };
        data.customers = customer ? [customer] : [];
        data.plans = [plan];
        const actual = secret(secretName, JSON.stringify({ planType: 'postpaid', planId: plan.id, accountNumber: 'ACC-253' }));
        vi.mocked(getPppSecrets).mockResolvedValue([actual]);
        addSale.mockResolvedValue({ id: 'sale-253' });
        data.paymentInput = {
            sale: {
                clientName: customer?.fullName || secretName, planName: plan.name, planPrice: plan.price,
                finalAmount: 425, discountAmount: 0, currency: 'PHP', invoiceId: 'invoice/billing-253',
            },
            payment: {
                plan, nonPaymentProfile: 'non-payment', discountDays: 0, paymentDate: '2026-10-01',
                coveredMonth: '2026-09', creditApplied: 100, overpaymentCredit: 25,
            },
        };
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await screen.findByText('Total Users: 1');
        fireEvent.click(within(tableRow(secretName)).getByRole('button', { name: 'Pay' }));
        expect(data.paymentProps!.secret).toMatchObject({ ...actual, customer });
        expect(processPppPayment).not.toHaveBeenCalled();
        expect(addSale).not.toHaveBeenCalled();
        await act(async () => { expect(await data.paymentProps!.onSave(data.paymentInput!)).toBe(true); });
        expect(processPppPayment).toHaveBeenCalledTimes(1);
        expect(processPppPayment).toHaveBeenCalledWith(router, expect.objectContaining({
            secret: expect.objectContaining({ ...actual, customer }), ...data.paymentInput.payment,
        }));
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(addSale).toHaveBeenCalledWith(expect.objectContaining({ ...data.paymentInput.sale, routerName: router.name }));
        const posts = fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST');
        const identity = customer?.username || secretName;
        expect(posts.map(([path, options]) => ({ path, body: JSON.parse(String(options?.body)) }))).toEqual([
            { path: '/api/billing-ledger', body: {
                routerId: router.id, username: identity, accountNumber: 'ACC-253', month: '2026-09',
                status: 'paid', planName: plan.name, planPrice: 500, paidAmount: 425,
                saleId: 'sale-253', paymentDate: '2026-10-01',
            } },
            { path: '/api/client-balance', body: { routerId: router.id, username: identity, amount: 100 } },
            { path: '/api/client-balance', body: { routerId: router.id, username: identity, amount: -25 } },
        ]);
        expect(dbApi.patch).toHaveBeenCalledTimes(1);
        expect(dbApi.patch).toHaveBeenCalledWith('/client-invoices/invoice%2Fbilling-253', { status: 'PAID' });
        expect(dbApi.post).not.toHaveBeenCalled();
        expect(data.customers).toEqual(customer ? [customer] : []);
    });
});

describe('PPPoE explicit links exclude heuristic matches', () => {
    it.each([
        ['username', billingUsername, {}],
        ['account number', 'unrelated-account-secret', { accountNumber: linkedCustomer.accountNumber }],
        ['customerName', 'unrelated-name-secret', { customerName: linkedCustomer.fullName }],
        ['fullName', 'unrelated-full-name-secret', { fullName: linkedCustomer.fullName }],
    ] as const)('does not attach an explicitly linked customer to a second secret by %s', async (_kind, otherName, comment) => {
        data.customers = [linkedCustomer];
        vi.mocked(getPppSecrets).mockResolvedValue([secret(secretName), secret(otherName, JSON.stringify(comment))]);
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await screen.findByText('Total Users: 2');
        expect(within(tableRow(secretName)).getByText(linkedCustomer.fullName!)).toBeInTheDocument();
        expect(within(tableRow(otherName)).queryByText(linkedCustomer.fullName!)).not.toBeInTheDocument();
        fireEvent.click(within(tableRow(secretName)).getByRole('button', { name: 'Pay' }));
        expect(data.paymentProps!.secret!.customer).toBe(linkedCustomer);
        fireEvent.click(within(tableRow(otherName)).getByRole('button', { name: 'Pay' }));
        expect(data.paymentProps!.secret!.name).toBe(otherName);
        expect(data.paymentProps!.secret!.customer).toBeUndefined();
        expect(processPppPayment).not.toHaveBeenCalled();
        expect(addSale).not.toHaveBeenCalled();
        expect(dbApi.patch).not.toHaveBeenCalled();
    });

    it('does not fall back through any heuristic when an explicit link is unavailable', async () => {
        data.customers = [linkedCustomer];
        vi.mocked(getPppSecrets).mockResolvedValue([secret(billingUsername, JSON.stringify({
            accountNumber: linkedCustomer.accountNumber, customerName: linkedCustomer.fullName,
        }))]);
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await screen.findByText('Total Users: 1');
        fireEvent.click(within(tableRow(billingUsername)).getByRole('button', { name: 'Pay' }));
        expect(data.paymentProps!.secret!.customer).toBeUndefined();
        expect(within(tableRow(billingUsername)).queryByText(linkedCustomer.fullName!)).not.toBeInTheDocument();
        expect(processPppPayment).not.toHaveBeenCalled();
        expect(dbApi.patch).not.toHaveBeenCalled();
    });
});

describe('PPPoE identity and PDF attachment', () => {
    it('preserves exact link/username/account/name and first-plan-match precedence', async () => {
        data.customers = [
            { id: 'foreign', routerId: 'other', username: 'foreign', pppoeSecret: 'alice', fullName: 'Foreign Link' },
            { id: 'username', routerId: router.id, username: 'alice', fullName: 'Username Match', accountNumber: 'ACC-U' },
            { id: 'linked', routerId: router.id, username: 'panel-login', pppoeSecret: 'alice', fullName: 'Linked Customer With A Complete Name', accountNumber: 'ACC-L' },
            { id: 'bob', routerId: router.id, username: 'bob', fullName: 'Bob Username', accountNumber: 'ACC-B' },
            { id: 'account', routerId: router.id, username: 'panel-account', fullName: 'Account Match', accountNumber: 'ACC-C' },
            { id: 'name', routerId: router.id, username: 'panel-name', fullName: 'Full Name With Spaces', accountNumber: 'ACC-N' },
            { id: 'duplicate', routerId: router.id, username: 'duplicate', fullName: 'Full Name With Spaces', accountNumber: 'ACC-D' },
        ];
        data.plans = [
            { id: 'first', name: 'By Name First', price: 10, cycle: 'Monthly' },
            { id: 'second', name: 'By ID Second', price: 20, cycle: 'Monthly' },
        ];
        vi.mocked(getPppSecrets).mockResolvedValue([
            secret('alice', JSON.stringify({ planId: 'second', planName: 'By Name First' })),
            secret('bob', JSON.stringify({ accountNumber: 'ACC-C', fullName: 'Full Name With Spaces' })),
            secret('account-user', JSON.stringify({ accountNumber: 'ACC-C', fullName: 'Full Name With Spaces' })),
            secret('name-user', JSON.stringify({ customerName: 'Full Name With Spaces' })),
            secret('Full Name With Spaces', 'not json'),
            secret('id-first', JSON.stringify({ planId: 'first', planName: 'By ID Second' })),
        ]);
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await screen.findByText('Total Users: 6');
        expect(within(tableRow('alice')).getByText('Linked Customer With A Complete Name')).toBeInTheDocument();
        expect(within(tableRow('alice')).getByText('By Name First')).toBeInTheDocument();
        expect(within(tableRow('bob')).getByText('Bob Username')).toBeInTheDocument();
        expect(within(tableRow('account-user')).getByText('Account Match')).toBeInTheDocument();
        expect(within(tableRow('name-user')).getByText('ACC-N')).toBeInTheDocument();
        const unlinkedRow = within(screen.getByRole('table')).getAllByRole('row').find(row => within(row).queryByText('Full Name With Spaces') && !within(row).queryByText('name-user'))!;
        expect(within(unlinkedRow).queryByText('ACC-N')).not.toBeInTheDocument();
        expect(within(tableRow('id-first')).getByText('By Name First')).toBeInTheDocument();
        expect(dbApi.patch).not.toHaveBeenCalled();
    });

    it('does not reset edited fields when independent customer/profile reads arrive', async () => {
        const customers = deferred<any[]>();
        const profiles = deferred<any[]>();
        vi.mocked(dbApi.get).mockReturnValueOnce(customers.promise);
        vi.mocked(getPppProfiles).mockReturnValueOnce(profiles.promise);
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await screen.findByText('Total Users: 1');
        fireEvent.click(within(tableRow('alice')).getByRole('button', { name: 'Edit' }));
        fireEvent.change(field('Full Name'), { target: { value: 'Unsaved Complete Name' } });
        await act(async () => {
            customers.resolve([{ id: 'c1', routerId: router.id, username: 'alice', fullName: 'Database Name' }]);
            profiles.resolve([{ id: '*1', name: 'default' }]);
        });
        expect(field('Full Name')).toHaveValue('Unsaved Complete Name');
    });

    it('patches only applicationId on an explicitly linked customer without refetching or overwriting the save', async () => {
        const application = deferred<any>();
        vi.mocked(generateApplicationForm).mockReturnValue(application.promise);
        data.customers = [{ id: 'linked/id', routerId: router.id, username: 'panel-login', pppoeSecret: 'alice', fullName: 'Old Name', accountNumber: 'ACC-1' }];
        vi.mocked(getPppSecrets).mockResolvedValue([secret('alice', JSON.stringify({ accountNumber: 'ACC-1', customer: { fullName: 'Old Name' } }))]);
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await screen.findByText('Total Users: 1');
        fireEvent.click(within(tableRow('alice')).getByRole('button', { name: 'Edit' }));
        await waitFor(() => expect(screen.getByText('Client portal account exists. Check to update the portal password.')).toBeInTheDocument());
        fireEvent.change(field('Full Name'), { target: { value: 'Fresh Complete Name' } });
        await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!); });
        expect(savePppUser).toHaveBeenCalledWith(router, expect.objectContaining({ customerData: expect.objectContaining({ pppoeSecret: 'alice' }) }));
        expect(dbApi.patch).toHaveBeenCalledWith('/customers/linked/id', expect.objectContaining({ fullName: 'Fresh Complete Name', username: 'panel-login' }));
        const readsBeforePdf = customerReads();
        await act(async () => { application.resolve({ id: 'pdf-1' }); });
        expect(dbApi.patch).toHaveBeenLastCalledWith('/customers/linked%2Fid', { applicationId: 'pdf-1' });
        expect(customerReads()).toBe(readsBeforePdf);
    });

    it('attaches a new customer PDF to the ID returned by creation, without inferring an identity link', async () => {
        const application = deferred<any>();
        vi.mocked(generateApplicationForm).mockReturnValue(application.promise);
        render(<Pppoe selectedRouter={router} addSale={addSale} />);
        await screen.findByText('Total Users: 1');
        fireEvent.click(screen.getByRole('button', { name: 'Add New User' }));
        fireEvent.change(field('Username'), { target: { value: 'new-user' } });
        fireEvent.change(field('Password'), { target: { value: 'test-password' } });
        fireEvent.change(field('Full Name'), { target: { value: 'New Complete Name' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Create client portal account for this client.' }));
        await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!); });
        const created = vi.mocked(dbApi.post).mock.calls.find(([path]) => path === '/customers')![1];
        expect(created.id).toBeTruthy();
        expect(created.username).toBe('new-user');
        expect(created).not.toHaveProperty('pppoeSecret');
        const readsBeforePdf = customerReads();
        await act(async () => { application.resolve({ id: 'pdf-new' }); });
        expect(dbApi.patch).toHaveBeenLastCalledWith(`/customers/${encodeURIComponent(created.id)}`, { applicationId: 'pdf-new' });
        expect(customerReads()).toBe(readsBeforePdf);
    });
});
