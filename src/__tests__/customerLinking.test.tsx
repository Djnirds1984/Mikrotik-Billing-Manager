import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Customers, resolveCustomerPppSecret } from '../../components/Customers.tsx';
import { getPppSecrets, processPppPayment } from '../../services/mikrotikService.ts';
import { dbApi } from '../../services/databaseService.ts';
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
    customers: [] as Customer[],
    plans: [] as BillingPlanWithId[],
    paymentProps: null as PaymentProps | null,
    addCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    deleteCustomer: vi.fn(),
    fetchCustomers: vi.fn(),
}));

vi.mock('../../hooks/useCustomers.ts', () => ({
    useCustomers: () => ({
        customers: data.customers, addCustomer: data.addCustomer, updateCustomer: data.updateCustomer,
        deleteCustomer: data.deleteCustomer, fetchCustomers: data.fetchCustomers, isLoading: false, error: null,
    }),
}));
vi.mock('../../hooks/useBillingPlans.ts', () => ({ useBillingPlans: () => ({ plans: data.plans }) }));
vi.mock('../../hooks/useBillingSettings.ts', () => ({ useBillingSettings: () => ({ settings: { nonPaymentProfile: 'non-payment' } }) }));
vi.mock('../../hooks/useCompanySettings.ts', () => ({ useCompanySettings: () => ({ settings: { companyName: 'Test ISP' } }) }));
vi.mock('../../contexts/AuthContext.tsx', () => ({
    useAuth: () => ({ hasPermission: () => true, user: { username: 'cashier', role: { name: 'Staff' } } }),
}));
vi.mock('../../contexts/LocalizationContext.tsx', () => ({
    useLocalization: () => ({ t: (key: string) => key, formatCurrency: (value: number) => `PHP ${value}` }),
}));
vi.mock('../../services/mikrotikService.ts', () => ({ getPppSecrets: vi.fn(), processPppPayment: vi.fn() }));
vi.mock('../../services/databaseService.ts', () => ({
    dbApi: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../components/CustomInvoiceModal.tsx', () => ({ CustomInvoiceModal: () => null }));
vi.mock('../../components/BillingStatement.tsx', () => ({ BillingStatement: () => null }));
vi.mock('../../components/PrintableReceipt.tsx', () => ({ PrintableReceipt: () => null }));
// Exercise Customers' actual onSave callback without running payment-modal API effects.
vi.mock('../../components/PaymentModal.tsx', () => ({
    PaymentModal: (props: PaymentProps) => {
        data.paymentProps = props;
        return props.isOpen && props.secret ? (
            <section role="dialog" aria-label="Process payment">
                <span data-testid="payment-secret">{props.secret.name}</span>
                <span data-testid="payment-customer">{props.secret.customer?.fullName}</span>
                <button onClick={props.onClose}>Cancel payment</button>
            </section>
        ) : null;
    },
}));

const username = 'LimpotDanteA.15mb8.253';
const fullName = 'LimpotDanteA';
const router: RouterConfigWithId = { id: 'router-a', name: 'Router A', host: 'mock', user: 'mock', port: 8728 };
const otherRouter: RouterConfigWithId = { ...router, id: 'router-b', name: 'Router B' };
const plan: BillingPlanWithId = {
    id: 'plan-15', name: '15 Mbps', price: 500, cycle: 'Monthly', cycle_days: 30,
    pppoeProfile: '15mb', description: '', currency: 'PHP', routerId: router.id,
};
const customer = (overrides: Partial<Customer> = {}): Customer => ({
    id: 'customer-1', routerId: router.id, username, fullName, accountNumber: 'ACC-253',
    address: 'Original address', contactNumber: '09123456789', email: 'customer@example.test', gps: '',
    applicationId: 'application-1', dueDate: '2026-10-25', planName: plan.name, planType: 'prepaid',
    ...overrides,
});
const secret = (name = username, comment = '{}'): PppSecret => ({
    id: `*${name}`, name, comment, service: 'pppoe', profile: '15mb', disabled: 'false',
});
const addSale = vi.fn<Parameters<React.ComponentProps<typeof Customers>['addSale']>, Promise<void>>();
const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
const paymentInput = (): PaymentInput => ({
    sale: {
        clientName: fullName, planName: plan.name, planPrice: plan.price, finalAmount: plan.price,
        discountAmount: 0, currency: 'PHP', clientAddress: 'Original address',
    },
    payment: { plan, nonPaymentProfile: 'non-payment', discountDays: 0, paymentDate: '2026-10-01' },
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const paymentDialog = () => screen.queryByRole('dialog', { name: 'Process payment' });
const secretSelect = () => screen.getByRole('combobox', { name: 'PPPoE Secret' });
const rowFor = (name = username) => within(screen.getByRole('table')).getByText(name, { normalizer: text => text }).closest('tr')!;
const clickPay = (name = username) => fireEvent.click(within(rowFor(name)).getByRole('button', { name: 'Pay' }));
function expectNoWrites() {
    expect(processPppPayment).not.toHaveBeenCalled();
    expect(addSale).not.toHaveBeenCalled();
    expect(dbApi.patch).not.toHaveBeenCalled();
    expect(dbApi.post).not.toHaveBeenCalled();
    expect(dbApi.delete).not.toHaveBeenCalled();
    expect(data.addCustomer).not.toHaveBeenCalled();
    expect(data.updateCustomer).not.toHaveBeenCalled();
    expect(data.deleteCustomer).not.toHaveBeenCalled();
}
async function openPayment(name = username) {
    clickPay(name);
    await screen.findByRole('dialog', { name: 'Process payment' });
}
async function openEdit() {
    fireEvent.click(within(rowFor()).getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(secretSelect()).toBeEnabled());
}
async function saveForm() {
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!); });
}
async function submitPayment() {
    let result: boolean | undefined;
    await act(async () => { result = await data.paymentProps!.onSave(paymentInput()); });
    return result;
}

let expectedBillingPosts: Array<{ path: string; body: Record<string, unknown> }> = [];
const originalAbortAny = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
beforeEach(() => {
    vi.resetAllMocks();
    expectedBillingPosts = [];
    // jsdom 24 lacks AbortSignal.any; keep cancellation behavior in this file only.
    if (!AbortSignal.any) Object.defineProperty(AbortSignal, 'any', {
        configurable: true,
        value: (signals: AbortSignal[]) => {
            const controller = new AbortController();
            for (const signal of signals) {
                if (signal.aborted) { controller.abort(signal.reason); break; }
                signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
            }
            return controller.signal;
        },
    });
    data.customers = [customer()];
    data.plans = [plan];
    data.paymentProps = null;
    data.addCustomer.mockResolvedValue(undefined);
    data.updateCustomer.mockResolvedValue(undefined);
    data.deleteCustomer.mockResolvedValue(undefined);
    data.fetchCustomers.mockResolvedValue(undefined);
    addSale.mockResolvedValue(undefined);
    vi.mocked(getPppSecrets).mockResolvedValue([secret()]);
    vi.mocked(processPppPayment).mockResolvedValue({ secrets: [secret()] });
    vi.mocked(dbApi.get).mockResolvedValue([router, otherRouter]);
    vi.mocked(dbApi.patch).mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue({ ok: true, json: async () => [] } as Response));
});
afterEach(() => {
    cleanup();
    // Resolver/form work needs no HTTP; payment tests explicitly enumerate mocked billing writes.
    expect(fetch).toHaveBeenCalledTimes(expectedBillingPosts.length);
    expectedBillingPosts.forEach(({ path, body }, index) => {
        const [url, options] = fetchMock.mock.calls[index];
        expect(url).toBe(path);
        expect(options?.method).toBe('POST');
        expect(JSON.parse(String(options?.body))).toEqual(body);
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (!originalAbortAny) Reflect.deleteProperty(AbortSignal, 'any');
});

describe('resolveCustomerPppSecret', () => {
    it('prefers the exact explicit link over an exact username, account match and full name', () => {
        const linked = secret('different.account+15/253');
        const result = resolveCustomerPppSecret(customer({ pppoeSecret: linked.name }), [
            secret(username), secret(fullName), secret('account-match', '{"accountNumber":"ACC-253"}'), linked,
        ]);
        expect(result).toEqual({ secret: linked });
        expect(result.secret).toBe(linked);
    });

    it.each([false, true])('prefers the entire exact username to the shorter full-name account (reverse=%s)', reverse => {
        const exact = secret();
        const candidates = [secret(fullName), secret(username.toLowerCase()), exact];
        expect(resolveCustomerPppSecret(customer(), reverse ? candidates.reverse() : candidates)).toEqual({ secret: exact });
    });

    it.each(['deleted-secret', username.toUpperCase(), ` ${username} `])('blocks stale explicit link %j without falling back', pppoeSecret => {
        const result = resolveCustomerPppSecret(customer({ pppoeSecret }), [
            secret(), secret(fullName), secret('account-match', '{"accountNumber":"ACC-253"}'),
        ]);
        expect(result.secret).toBeUndefined();
        expect(result.needsConfirmation).toBeUndefined();
        expect(result.error).toMatch(/linked PPPoE secret is not available/);
    });

    it('requires confirmation for a unique case/space-normalized username and returns the untouched secret', () => {
        const candidate = secret(` ${username.toUpperCase()} `);
        expect(resolveCustomerPppSecret(customer({ username: ` ${username.toLowerCase()} ` }), [candidate])).toEqual({
            secret: candidate, needsConfirmation: true,
        });
    });

    it('blocks case-variant ambiguity before considering account-number or prefix matches', () => {
        const result = resolveCustomerPppSecret(customer({ username: ` ${username} ` }), [
            secret(username), secret(username.toLowerCase()), secret(fullName),
            secret('account-match', '{"accountNumber":"ACC-253"}'),
        ]);
        expect(result.secret).toBeUndefined();
        expect(result.error).toMatch(/Multiple PPPoE secrets match/);
    });

    it.each([undefined, username])('blocks duplicate exact names rather than choosing the first (link=%s)', pppoeSecret => {
        const result = resolveCustomerPppSecret(customer({ pppoeSecret }), [secret(), { ...secret(), id: '*duplicate' }]);
        expect(result.secret).toBeUndefined();
        expect(result.error).toBeTruthy();
    });

    it.each([
        ['top-level', { accountNumber: 'ACC-253' }],
        ['nested', { customer: { accountNumber: 'ACC-253' } }],
    ])('requires confirmation for a unique %s account-number match before a prefix suggestion', (_location, comment) => {
        const candidate = secret('different.account', JSON.stringify(comment));
        expect(resolveCustomerPppSecret(customer(), [
            secret('bad-comment', '{broken'), secret('null-comment', 'null'), secret(fullName), candidate,
        ])).toEqual({ secret: candidate, needsConfirmation: true });
    });

    it('blocks duplicate account numbers across top-level and nested comments before prefix fallback', () => {
        const result = resolveCustomerPppSecret(customer(), [
            secret('first', '{"accountNumber":"ACC-253"}'),
            secret('second', '{"customer":{"accountNumber":"ACC-253"}}'), secret(fullName),
        ]);
        expect(result.secret).toBeUndefined();
        expect(result.error).toMatch(/Multiple PPPoE secrets share this account number/);
    });

    it.each(['{broken', 'null', '[]', '42', '"ACC-253"', '{"customer":null}', '{"accountNumber":"acc-253"}', '{"accountNumber":" ACC-253 "}'])(
        'ignores malformed/nonmatching comments %j without inferring a full-name link', comment => {
            const result = resolveCustomerPppSecret(customer({ username: 'portal-login' }), [secret(fullName, comment)]);
            expect(result.secret).toBeUndefined();
            expect(result.error).toMatch(/No unambiguous PPPoE match/);
        },
    );

    it.each([
        [username, fullName],
        [fullName, username],
    ])('only suggests prefix %s -> %s with confirmation', (customerName, secretName) => {
        const candidate = secret(secretName);
        expect(resolveCustomerPppSecret(customer({ username: customerName }), [candidate])).toEqual({
            secret: candidate, needsConfirmation: true,
        });
    });

    it('blocks multiple prefix suggestions', () => {
        const result = resolveCustomerPppSecret(customer(), [secret(fullName), secret(`${username}.another`)]);
        expect(result.secret).toBeUndefined();
        expect(result.error).toMatch(/No unambiguous PPPoE match/);
    });

    it.each(['', 'unrelated-portal-login'])('never treats fullName as a secret when username is %j', login => {
        const result = resolveCustomerPppSecret(customer({ username: login }), [secret(fullName)]);
        expect(result.secret).toBeUndefined();
        expect(result.error).toBeTruthy();
    });
});

describe('Customers payment account lookup', () => {
    it('loads the real exact secret, attaches the customer and keeps punctuation and subscription data intact', async () => {
        const current = customer();
        data.customers = [current, customer({ id: 'shorter', username: fullName, fullName: 'Different shorter account' })];
        const actual = {
            ...secret(username, JSON.stringify({ planId: plan.id, planName: plan.name, planType: ' POSTPAID ', dueDateTime: '2026-10-25T14:35:00' })),
            id: '*actual-router-id', password: 'mock-only', 'last-logged-out': '2026-10-01 09:00:00',
            customer: customer({ id: 'obsolete', fullName: 'Wrong embedded customer' }),
        };
        vi.mocked(getPppSecrets).mockResolvedValue([secret(fullName), actual]);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        expect(getPppSecrets).not.toHaveBeenCalled();
        await openPayment();
        expect(getPppSecrets).toHaveBeenCalledWith(router, expect.any(AbortSignal));
        expect(getPppSecrets).toHaveBeenCalledTimes(1);
        expect(data.paymentProps).toMatchObject({ routerId: router.id, plans: [plan], nonPaymentProfile: 'non-payment' });
        expect(data.paymentProps!.secret).toEqual({
            ...actual, customer: current, billingPlan: plan,
            subscription: { plan: plan.name, planId: plan.id, planType: 'postpaid', dueDate: '2026-10-25 14:35' },
        });
        expect(data.paymentProps!.secret!.customer).toBe(current);
        expect(screen.getByTestId('payment-secret').textContent).toBe(username);
        expect(screen.getByTestId('payment-customer').textContent).toBe(fullName);
        expect(window.confirm).not.toHaveBeenCalled();
        expectNoWrites();
    });

    it('uses an explicitly linked different secret, not username or fullName', async () => {
        const linked = secret('other.account+15/253');
        data.customers = [customer({ pppoeSecret: linked.name })];
        vi.mocked(getPppSecrets).mockResolvedValue([secret(), secret(fullName), linked]);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        await openPayment();
        expect(data.paymentProps!.secret).toMatchObject(linked);
        expect(window.confirm).not.toHaveBeenCalled();
        expectNoWrites();
    });

    it.each([
        ['normalized username', secret(username.toLowerCase())],
        ['top-level account number', secret('account-linked', '{"accountNumber":"ACC-253"}')],
        ['nested account number', secret('nested-linked', '{"customer":{"accountNumber":"ACC-253"}}')],
        ['shorter prefix', secret(fullName)],
    ])('lets the user reject and then confirm a %s suggestion without saving a link', async (_kind, candidate) => {
        vi.mocked(getPppSecrets).mockResolvedValue([candidate]);
        vi.mocked(window.confirm).mockReturnValueOnce(false).mockReturnValueOnce(true);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        clickPay();
        await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(`PPPoE secret: ${candidate.name}`));
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(`Customer username: ${username}`));
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(`Router: ${router.name}`));
        expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(fullName));
        expect(paymentDialog()).not.toBeInTheDocument();
        expectNoWrites();
        await openPayment();
        expect(data.paymentProps!.secret).toMatchObject(candidate);
        expect(window.confirm).toHaveBeenCalledTimes(2);
        expectNoWrites();
    });

    it.each([
        ['stale explicit link', customer({ pppoeSecret: 'deleted' }), [secret()], /linked PPPoE secret is not available/],
        ['case ambiguity', customer({ username: ` ${username} ` }), [secret(), secret(username.toLowerCase())], /Multiple PPPoE secrets match/],
        ['prefix ambiguity', customer(), [secret(fullName), secret(`${username}.other`)], /No unambiguous PPPoE match/],
        ['account ambiguity', customer(), [secret('a', '{"accountNumber":"ACC-253"}'), secret('b', '{"customer":{"accountNumber":"ACC-253"}}')], /share this account number/],
        ['full name alone', customer({ username: 'portal-login' }), [secret(fullName, '{broken')], /full name is not a secret name/],
        ['empty router result', customer(), [], /No PPPoE secrets returned by Router A/],
    ] as const)('visibly blocks %s without opening payment or changing records', async (_kind, current, candidates, message) => {
        data.customers = [current];
        vi.mocked(getPppSecrets).mockResolvedValue([...candidates]);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        clickPay(current.username);
        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(paymentDialog()).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(window.confirm).not.toHaveBeenCalled();
        expectNoWrites();
    });

    it('opens an exact secret even when its comment is malformed, using safe subscription defaults', async () => {
        vi.mocked(getPppSecrets).mockResolvedValue([secret(username, '{broken')]);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        await openPayment();
        expect(data.paymentProps!.secret).toMatchObject({
            name: username, comment: '{broken', billingPlan: null,
            subscription: { plan: 'N/A', dueDate: 'No Info', planType: 'prepaid' },
        });
        expectNoWrites();
    });

    it.each(['explicit link', 'username'])('blocks another record owning the same exact secret by %s', async kind => {
        data.customers.push(customer({
            id: 'duplicate', fullName: 'Other customer',
            username: kind === 'username' ? username : 'other-login',
            pppoeSecret: kind === 'explicit link' ? username : undefined,
        }));
        render(<Customers selectedRouter={router} addSale={addSale} />);
        fireEvent.click(within(screen.getByText(fullName).closest('tr')!).getByRole('button', { name: 'Pay' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/belongs to another customer record/);
        expect(paymentDialog()).not.toBeInTheDocument();
        expectNoWrites();
    });

    it('does not treat a foreign-router link or another record explicitly linked elsewhere as a duplicate', async () => {
        data.customers.push(
            customer({ id: 'foreign', routerId: otherRouter.id, username: 'foreign-login', pppoeSecret: username }),
            customer({ id: 'elsewhere', username, pppoeSecret: 'different-secret', fullName: 'Other customer' }),
        );
        render(<Customers selectedRouter={router} addSale={addSale} />);
        fireEvent.click(within(screen.getAllByText(fullName)[0].closest('tr')!).getByRole('button', { name: 'Pay' }));
        await screen.findByRole('dialog', { name: 'Process payment' });
        expect(data.paymentProps!.secret!.name).toBe(username);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expectNoWrites();
    });

    it('reports a lookup error and allows Pay to retry with the error cleared', async () => {
        vi.mocked(getPppSecrets).mockRejectedValueOnce(new Error('Router offline')).mockResolvedValueOnce([secret()]);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        clickPay();
        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load PPPoE user: Router offline');
        expect(paymentDialog()).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expectNoWrites();
        await openPayment();
        expect(getPppSecrets).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expectNoWrites();
    });

    it.each(['resolve', 'reject'])('cancels a pending lookup, ignores its late %s and leaves a retry in progress', async outcome => {
        const old = deferred<PppSecret[]>();
        const retry = deferred<PppSecret[]>();
        vi.mocked(getPppSecrets).mockReturnValueOnce(old.promise).mockReturnValueOnce(retry.promise);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        clickPay();
        const signal = vi.mocked(getPppSecrets).mock.calls[0][1]!;
        expect(screen.getByRole('status')).toHaveTextContent('Loading payment account');
        expect(screen.getByTitle('Pay')).toBeDisabled();
        fireEvent.click(screen.getByTitle('Pay'));
        expect(getPppSecrets).toHaveBeenCalledTimes(1);
        fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Cancel' }));
        expect(signal.aborted).toBe(true);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        clickPay();
        await act(async () => {
            if (outcome === 'resolve') old.resolve([secret(fullName)]);
            else old.reject(new Error('Cancelled request failed late'));
        });
        expect(screen.getByRole('status')).toHaveTextContent('Loading payment account');
        expect(screen.getByTitle('Pay')).toBeDisabled();
        expect(paymentDialog()).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(window.confirm).not.toHaveBeenCalled();
        await act(async () => { retry.resolve([secret()]); });
        expect(data.paymentProps!.secret!.name).toBe(username);
        expect(paymentDialog()).toBeInTheDocument();
        expectNoWrites();
    });

    it.each(['resolve', 'reject'])('discards an old router lookup that later %ss while the new router is loading', async outcome => {
        const old = deferred<PppSecret[]>();
        const current = deferred<PppSecret[]>();
        vi.mocked(getPppSecrets).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        const view = render(<Customers selectedRouter={router} addSale={addSale} />);
        clickPay();
        const oldSignal = vi.mocked(getPppSecrets).mock.calls[0][1]!;
        data.customers = [customer({ id: 'customer-b', routerId: otherRouter.id, username: 'router-b.account', fullName: 'Router B customer' })];
        view.rerender(<Customers selectedRouter={otherRouter} addSale={addSale} />);
        expect(oldSignal.aborted).toBe(true);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        clickPay('router-b.account');
        await act(async () => {
            if (outcome === 'resolve') old.resolve([secret()]);
            else old.reject(new Error('Old router offline'));
        });
        expect(paymentDialog()).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Loading payment account');
        await act(async () => { current.resolve([secret('router-b.account')]); });
        expect(data.paymentProps!.routerId).toBe(otherRouter.id);
        expect(data.paymentProps!.secret!.customer).toBe(data.customers[0]);
        expect(data.paymentProps!.secret!.name).toBe('router-b.account');
        expectNoWrites();
    });

    it('lets the user close the payment modal without linking or paying', async () => {
        render(<Customers selectedRouter={router} addSale={addSale} />);
        await openPayment();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel payment' }));
        expect(paymentDialog()).not.toBeInTheDocument();
        expect(data.paymentProps!.secret).toBeNull();
        expectNoWrites();
    });
});

describe('Customers PPPoE dropdown and identity-preserving saves', () => {
    it('loads live names, searches case-insensitively and saves an explicit selection without renaming the history identity', async () => {
        const pending = deferred<PppSecret[]>();
        const original = customer({ pppoeSecret: username });
        data.customers = [original];
        vi.mocked(getPppSecrets).mockReturnValue(pending.promise);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        fireEvent.click(within(rowFor()).getByRole('button', { name: 'Edit' }));
        expect(secretSelect()).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('Loading PPPoE secrets');
        expect(getPppSecrets).toHaveBeenCalledWith(router, expect.any(AbortSignal));
        await act(async () => { pending.resolve([secret(), secret('Other.Account+20/5'), secret('unrelated')]); });
        expect(secretSelect()).toBeEnabled();
        expect(within(secretSelect()).getByRole('option', { name: username })).toBeInTheDocument();
        expect(within(secretSelect()).queryByRole('option', { name: fullName })).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText('pppoe_username')).toBeDisabled();
        fireEvent.change(screen.getByRole('textbox', { name: 'Search PPPoE secrets' }), { target: { value: 'OTHER.account+' } });
        expect(within(secretSelect()).getByRole('option', { name: 'Other.Account+20/5' })).toBeInTheDocument();
        expect(within(secretSelect()).queryByRole('option', { name: 'unrelated' })).not.toBeInTheDocument();
        expect(within(secretSelect()).getByRole('option', { name: username })).toBeInTheDocument();
        fireEvent.change(secretSelect(), { target: { value: 'Other.Account+20/5' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Search PPPoE secrets' }), { target: { value: 'no-match' } });
        expect(secretSelect()).toHaveValue('Other.Account+20/5');
        expect(within(secretSelect()).getByRole('option', { name: 'Other.Account+20/5' })).toBeInTheDocument();
        expect(screen.getByPlaceholderText('pppoe_username')).toHaveValue(username);
        expect(screen.getByPlaceholderText('Juan Dela Cruz')).toHaveValue(fullName);
        await saveForm();
        // The full original record, ID and username remain the payment-history identity.
        expect(data.updateCustomer).toHaveBeenCalledTimes(1);
        expect(data.updateCustomer).toHaveBeenCalledWith({ ...original, pppoeSecret: 'Other.Account+20/5' });
        expect(original.pppoeSecret).toBe(username);
        expect(data.addCustomer).not.toHaveBeenCalled();
        expect(data.deleteCustomer).not.toHaveBeenCalled();
        expect(processPppPayment).not.toHaveBeenCalled();
        expect(addSale).not.toHaveBeenCalled();
        expect(dbApi.patch).not.toHaveBeenCalled();
    });

    it('fills a new customer username from the selected exact secret, not their full name', async () => {
        render(<Customers selectedRouter={router} addSale={addSale} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add Customer' }));
        await waitFor(() => expect(secretSelect()).toBeEnabled());
        fireEvent.change(screen.getByPlaceholderText('Juan Dela Cruz'), { target: { value: 'New customer full name' } });
        fireEvent.change(screen.getByPlaceholderText('pppoe_username'), { target: { value: 'typed-portal-login' } });
        fireEvent.change(secretSelect(), { target: { value: username } });
        expect(screen.getByPlaceholderText('pppoe_username')).toHaveValue(username);
        expect(screen.getByPlaceholderText('Juan Dela Cruz')).toHaveValue('New customer full name');
        await saveForm();
        expect(data.addCustomer).toHaveBeenCalledWith(expect.objectContaining({
            routerId: router.id, username, pppoeSecret: username, fullName: 'New customer full name',
        }));
        expect(data.updateCustomer).not.toHaveBeenCalled();
        expect(processPppPayment).not.toHaveBeenCalled();
        expect(addSale).not.toHaveBeenCalled();
    });

    it.each(['', username])('does not infer a new link by saving a full name and username %j', async typedUsername => {
        vi.mocked(getPppSecrets).mockResolvedValue([secret(), secret(fullName)]);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add Customer' }));
        await waitFor(() => expect(secretSelect()).toBeEnabled());
        fireEvent.change(screen.getByPlaceholderText('Juan Dela Cruz'), { target: { value: fullName } });
        if (typedUsername) fireEvent.change(screen.getByPlaceholderText('pppoe_username'), { target: { value: typedUsername } });
        expect(secretSelect()).toHaveValue('');
        await saveForm();
        expect(data.addCustomer).toHaveBeenCalledWith(expect.objectContaining({
            fullName, username: typedUsername || expect.stringMatching(/^cust_/), pppoeSecret: '',
        }));
        expect(dbApi.patch).not.toHaveBeenCalled();
        expect(processPppPayment).not.toHaveBeenCalled();
    });

    it('does not infer a link or rename an existing username when only the full name is edited', async () => {
        const original = data.customers[0];
        vi.mocked(getPppSecrets).mockResolvedValue([secret(), secret('Changed Full Name')]);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        await openEdit();
        fireEvent.change(screen.getByPlaceholderText('Juan Dela Cruz'), { target: { value: 'Changed Full Name' } });
        await saveForm();
        expect(data.updateCustomer).toHaveBeenCalledTimes(1);
        expect(data.updateCustomer).toHaveBeenCalledWith({ ...original, fullName: 'Changed Full Name', pppoeSecret: '' });
        expect(dbApi.patch).not.toHaveBeenCalled();
        expect(addSale).not.toHaveBeenCalled();
    });

    it.each(['empty list', 'case-only variant', 'lookup failure'])('preserves the unavailable stored link on save after %s', async outcome => {
        const original = customer({ pppoeSecret: 'Stored.Account+15/253' });
        data.customers = [original];
        if (outcome === 'lookup failure') vi.mocked(getPppSecrets).mockRejectedValue(new Error('Offline'));
        else vi.mocked(getPppSecrets).mockResolvedValue(outcome === 'empty list' ? [] : [secret('stored.account+15/253')]);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        fireEvent.click(within(rowFor()).getByRole('button', { name: 'Edit' }));
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
        expect(secretSelect()).toHaveValue(original.pppoeSecret);
        expect(within(secretSelect()).getByRole('option', { name: `${original.pppoeSecret} (unavailable)` })).toBeInTheDocument();
        if (outcome === 'lookup failure') {
            expect(screen.getByRole('alert')).toHaveTextContent('Unable to load PPPoE secrets: Offline');
            expect(secretSelect()).toBeDisabled();
        }
        await saveForm();
        expect(data.updateCustomer).toHaveBeenCalledTimes(1);
        expect(data.updateCustomer).toHaveBeenCalledWith(original);
        expect(processPppPayment).not.toHaveBeenCalled();
        expect(addSale).not.toHaveBeenCalled();
    });

    it('retries dropdown loading without losing edits, and cancellation does not save them', async () => {
        vi.mocked(getPppSecrets).mockRejectedValueOnce(new Error('Router offline')).mockResolvedValueOnce([secret()]);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        fireEvent.click(within(rowFor()).getByRole('button', { name: 'Edit' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load PPPoE secrets: Router offline');
        expect(secretSelect()).toBeDisabled();
        fireEvent.change(screen.getByPlaceholderText('Juan Dela Cruz'), { target: { value: 'Unsaved name' } });
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(secretSelect()).toBeEnabled());
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText('Juan Dela Cruz')).toHaveValue('Unsaved name');
        fireEvent.change(secretSelect(), { target: { value: username } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('combobox', { name: 'PPPoE Secret' })).not.toBeInTheDocument();
        expect(getPppSecrets).toHaveBeenCalledTimes(2);
        expectNoWrites();
    });

    it('discards delayed dropdown names after a router change and loads only the new router on reopen', async () => {
        const old = deferred<PppSecret[]>();
        vi.mocked(getPppSecrets).mockImplementation(selected => selected.id === router.id
            ? old.promise : Promise.resolve([secret('router-b.account')]));
        const view = render(<Customers selectedRouter={router} addSale={addSale} />);
        fireEvent.click(within(rowFor()).getByRole('button', { name: 'Edit' }));
        const signal = vi.mocked(getPppSecrets).mock.calls[0][1]!;
        data.customers = [];
        view.rerender(<Customers selectedRouter={otherRouter} addSale={addSale} />);
        expect(signal.aborted).toBe(true);
        expect(screen.queryByRole('combobox', { name: 'PPPoE Secret' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Add Customer' }));
        await waitFor(() => expect(secretSelect()).toBeEnabled());
        await act(async () => { old.resolve([secret('old-router-only')]); });
        expect(within(secretSelect()).getByRole('option', { name: 'router-b.account' })).toBeInTheDocument();
        expect(within(secretSelect()).queryByRole('option', { name: 'old-router-only' })).not.toBeInTheDocument();
        expect(getPppSecrets).toHaveBeenLastCalledWith(otherRouter, expect.any(AbortSignal));
        expectNoWrites();
    });
});

describe('Customers payment billing identity', () => {
    it.each(['Portal.Dante+253/billing?', ''])('writes ledger and both credit adjustments for billing username %j without renaming the router secret', async billingUsername => {
        const current = customer({ username: billingUsername, pppoeSecret: username });
        data.customers = [current];
        const actual = secret(username, JSON.stringify({ planType: 'postpaid', accountNumber: current.accountNumber }));
        vi.mocked(getPppSecrets).mockResolvedValue([actual]);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        fireEvent.click(within(screen.getByText(fullName).closest('tr')!).getByRole('button', { name: 'Pay' }));
        await screen.findByRole('dialog', { name: 'Process payment' });
        expect(data.paymentProps!.secret).toMatchObject({ ...actual, customer: current });
        expectNoWrites();

        const input = paymentInput();
        input.sale.finalAmount = 425;
        input.sale.invoiceId = 'invoice/billing-253';
        Object.assign(input.payment, { coveredMonth: '2026-09', creditApplied: 100, overpaymentCredit: 25 });
        const billingIdentity = billingUsername || username;
        expectedBillingPosts = [
            { path: '/api/billing-ledger', body: {
                routerId: router.id, username: billingIdentity, accountNumber: current.accountNumber,
                month: '2026-09', status: 'paid', planName: plan.name, planPrice: plan.price,
                paidAmount: 425, saleId: null, paymentDate: input.payment.paymentDate,
            } },
            { path: '/api/client-balance', body: { routerId: router.id, username: billingIdentity, amount: 100 } },
            { path: '/api/client-balance', body: { routerId: router.id, username: billingIdentity, amount: -25 } },
        ];
        await act(async () => { expect(await data.paymentProps!.onSave(input)).toBe(true); });
        expect(processPppPayment).toHaveBeenCalledTimes(1);
        expect(processPppPayment).toHaveBeenCalledWith(router, expect.objectContaining({
            secret: expect.objectContaining({ ...actual, customer: current }), ...input.payment,
        }));
        const routerPayload = vi.mocked(processPppPayment).mock.calls[0][1];
        // Accept the optional backend identity field, but never a different customer's ID.
        if ('customerId' in routerPayload) expect(routerPayload.customerId).toBe(current.id);
        expect(addSale).toHaveBeenCalledWith(expect.objectContaining({ ...input.sale, routerName: router.name }));
        expect(dbApi.patch).toHaveBeenCalledTimes(1);
        expect(dbApi.patch).toHaveBeenCalledWith('/client-invoices/invoice%2Fbilling-253', { status: 'PAID' });
        expect(data.updateCustomer).not.toHaveBeenCalled();
        expect(current.username).toBe(billingUsername);
        expect(current.pppoeSecret).toBe(username);
    });
});

describe('Customers payment auto-link persistence', () => {
    it('patches only the exact link after BOTH router payment and sale succeed, then refreshes after the patch', async () => {
        const processing = deferred<PaymentResult>();
        const recording = deferred<void>();
        const linking = deferred<unknown>();
        const original = Object.freeze(customer({ id: 'customer/253?record' }));
        data.customers = [original];
        vi.mocked(processPppPayment).mockReturnValue(processing.promise);
        addSale.mockReturnValue(recording.promise);
        vi.mocked(dbApi.patch).mockReturnValue(linking.promise);
        render(<Customers selectedRouter={router} addSale={addSale} />);
        await openPayment();
        expectNoWrites();
        let saved!: Promise<boolean>;
        act(() => { saved = data.paymentProps!.onSave(paymentInput()); });
        expect(processPppPayment).toHaveBeenCalledTimes(1);
        // The backend may also receive an explicit customerId for billing identity.
        expect(processPppPayment).toHaveBeenCalledWith(router, expect.objectContaining({
            secret: data.paymentProps!.secret, ...paymentInput().payment,
        }));
        expect(addSale).not.toHaveBeenCalled();
        expect(dbApi.patch).not.toHaveBeenCalled();
        await act(async () => { processing.resolve({ secrets: [secret()] }); });
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(addSale).toHaveBeenCalledWith({
            ...paymentInput().sale, routerName: router.name, date: expect.any(String), processedBy: 'cashier',
        });
        expect(dbApi.patch).not.toHaveBeenCalled();
        expect(data.fetchCustomers).not.toHaveBeenCalled();
        await act(async () => { recording.resolve(); expect(await saved).toBe(true); });
        expect(dbApi.patch).toHaveBeenCalledTimes(1);
        expect(dbApi.patch).toHaveBeenCalledWith('/customers/customer%2F253%3Frecord?routerId=router-a&expectedPppoeSecret=', { pppoeSecret: username });
        expect(data.fetchCustomers).not.toHaveBeenCalled();
        await act(async () => { linking.resolve({}); });
        expect(data.fetchCustomers).toHaveBeenCalledTimes(1);
        expect(original).toEqual(customer({ id: 'customer/253?record' }));
        expect(data.updateCustomer).not.toHaveBeenCalled();
        expect(data.addCustomer).not.toHaveBeenCalled();
        expect(data.deleteCustomer).not.toHaveBeenCalled();
        expect(dbApi.post).not.toHaveBeenCalled();
        expect(dbApi.delete).not.toHaveBeenCalled();
    });

    it.each([undefined, username])('shows a due-date warning only after the sale succeeds without repeating payment or sale (link=%s)', async pppoeSecret => {
        const warning = 'Payment succeeded, but the customer due date could not be saved. Update the customer due date; do not pay again.';
        const recording = deferred<void>();
        data.customers = [customer({ pppoeSecret })];
        vi.mocked(processPppPayment).mockResolvedValue({ secrets: [secret()], warning });
        addSale.mockReturnValue(recording.promise);
        const view = render(<Customers selectedRouter={router} addSale={addSale} />);
        await openPayment();
        let saved!: Promise<boolean>;
        await act(async () => { saved = data.paymentProps!.onSave(paymentInput()); });
        expect(processPppPayment).toHaveBeenCalledTimes(1);
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(dbApi.patch).not.toHaveBeenCalled();

        await act(async () => { recording.resolve(); expect(await saved).toBe(true); });
        expect(screen.getByRole('alert')).toHaveTextContent(warning);
        act(() => { data.paymentProps!.onClose(); });
        view.rerender(<Customers selectedRouter={router} addSale={addSale} />);
        expect(paymentDialog()).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(warning);
        expect(processPppPayment).toHaveBeenCalledTimes(1);
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(addSale).toHaveBeenCalledWith(expect.objectContaining(paymentInput().sale));
        expect(getPppSecrets).toHaveBeenCalledTimes(1);
        expect(dbApi.patch).toHaveBeenCalledTimes(pppoeSecret ? 0 : 1);
        if (!pppoeSecret) {
            expect(dbApi.patch).toHaveBeenCalledWith('/customers/customer-1?routerId=router-a&expectedPppoeSecret=', { pppoeSecret: username });
        }
        expect(data.fetchCustomers).toHaveBeenCalledTimes(pppoeSecret ? 0 : 1);
        expect(data.updateCustomer).not.toHaveBeenCalled();
        expect(window.alert).not.toHaveBeenCalled();
    });

    it('does not rewrite an already exact explicit link after successful payment', async () => {
        data.customers = [customer({ pppoeSecret: username })];
        render(<Customers selectedRouter={router} addSale={addSale} />);
        await openPayment();
        expect(await submitPayment()).toBe(true);
        expect(processPppPayment).toHaveBeenCalledTimes(1);
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(dbApi.patch).not.toHaveBeenCalled();
        expect(data.fetchCustomers).not.toHaveBeenCalled();
        expect(data.updateCustomer).not.toHaveBeenCalled();
    });

    it('does not link a failed router payment, reports failure, and links only after a successful retry', async () => {
        const actual = secret(username.toLowerCase());
        vi.mocked(getPppSecrets).mockResolvedValue([actual]);
        vi.mocked(processPppPayment).mockRejectedValueOnce(new Error('Payment router offline')).mockResolvedValueOnce({ secrets: [actual] });
        render(<Customers selectedRouter={router} addSale={addSale} />);
        await openPayment();
        expect(await submitPayment()).toBe(false);
        expect(window.alert).toHaveBeenCalledWith('Payment failed: Payment router offline');
        expect(addSale).not.toHaveBeenCalled();
        expect(dbApi.patch).not.toHaveBeenCalled();
        expect(data.fetchCustomers).not.toHaveBeenCalled();
        expect(data.updateCustomer).not.toHaveBeenCalled();
        expect(data.paymentProps!.secret!.name).toBe(actual.name);
        expect(await submitPayment()).toBe(true);
        expect(processPppPayment).toHaveBeenCalledTimes(2);
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(dbApi.patch).toHaveBeenCalledTimes(1);
        expect(dbApi.patch).toHaveBeenCalledWith('/customers/customer-1?routerId=router-a&expectedPppoeSecret=', { pppoeSecret: actual.name });
        expect(data.fetchCustomers).toHaveBeenCalledTimes(1);
        expect(data.customers[0].username).toBe(username);
        expect(data.customers[0].pppoeSecret).toBeUndefined();
    });

    it('does not auto-link if recording the sale fails after the router payment', async () => {
        addSale.mockRejectedValue(new Error('Sale could not be recorded'));
        render(<Customers selectedRouter={router} addSale={addSale} />);
        await openPayment();
        expect(await submitPayment()).toBe(false);
        expect(processPppPayment).toHaveBeenCalledTimes(1);
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(window.alert).toHaveBeenCalledWith('Payment failed: Sale could not be recorded');
        expect(dbApi.patch).not.toHaveBeenCalled();
        expect(data.fetchCustomers).not.toHaveBeenCalled();
        expect(data.updateCustomer).not.toHaveBeenCalled();
    });

    it.each([undefined, ''])('guards the observed link/router and treats a conflicting link save as successful payment without retry (link=%j)', async pppoeSecret => {
        const selectedRouter = { ...router, id: 'router/a +1?&' };
        const original = Object.freeze(customer({ id: 'customer/253?record', routerId: selectedRouter.id, pppoeSecret }));
        const actual = secret(` ${username.toLowerCase()}+extra/253?& `, JSON.stringify({ accountNumber: original.accountNumber }));
        const processing = deferred<PaymentResult>();
        const linking = deferred<unknown>();
        data.customers = [original];
        vi.mocked(getPppSecrets).mockResolvedValue([actual]);
        vi.mocked(processPppPayment).mockReturnValue(processing.promise);
        vi.mocked(dbApi.patch).mockReturnValue(linking.promise);
        const view = render(<Customers selectedRouter={selectedRouter} addSale={addSale} />);
        await openPayment();
        expect(window.confirm).toHaveBeenCalledTimes(1);
        let saved!: Promise<boolean>;
        act(() => { saved = data.paymentProps!.onSave(paymentInput()); });
        expect(dbApi.patch).not.toHaveBeenCalled();
        // A concurrent edit must not change the guard captured when payment opened.
        const relinked = Object.freeze({ ...original, pppoeSecret: 'newer-link/retained' });
        data.customers = [relinked];
        view.rerender(<Customers selectedRouter={selectedRouter} addSale={addSale} />);
        await act(async () => { processing.resolve({ secrets: [actual] }); expect(await saved).toBe(true); });
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(dbApi.patch).toHaveBeenCalledTimes(1);
        const [path, body] = vi.mocked(dbApi.patch).mock.calls[0];
        expect(path).toBe('/customers/customer%2F253%3Frecord?routerId=router%2Fa+%2B1%3F%26&expectedPppoeSecret=');
        expect(Object.fromEntries(new URL(path, 'http://test.invalid').searchParams)).toEqual({
            routerId: selectedRouter.id, expectedPppoeSecret: original.pppoeSecret || '',
        });
        expect(body).toEqual({ pppoeSecret: actual.name });
        expect(data.fetchCustomers).not.toHaveBeenCalled();

        act(() => { data.paymentProps!.onClose(); });
        await act(async () => { linking.reject(Object.assign(new Error('Customer link changed'), { status: 409 })); });
        expect(screen.getByRole('alert')).toHaveTextContent('Payment succeeded, but the PPPoE link could not be saved. Save the link in Edit Customer; do not pay again.');
        view.rerender(<Customers selectedRouter={selectedRouter} addSale={addSale} />);
        expect(paymentDialog()).not.toBeInTheDocument();
        expect(processPppPayment).toHaveBeenCalledTimes(1);
        expect(processPppPayment).toHaveBeenCalledWith(selectedRouter, expect.objectContaining({
            secret: expect.objectContaining({ name: actual.name, customer: original }), customerId: original.id,
        }));
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(addSale).toHaveBeenCalledWith(expect.objectContaining(paymentInput().sale));
        expect(dbApi.patch).toHaveBeenCalledTimes(1);
        expect(getPppSecrets).toHaveBeenCalledTimes(1);
        expect(data.fetchCustomers).not.toHaveBeenCalled();
        expect(data.updateCustomer).not.toHaveBeenCalled();
        expect(data.customers).toEqual([relinked]);
        expect(original.pppoeSecret).toBe(pppoeSecret);
        expect(window.alert).not.toHaveBeenCalled();
    });

    it('reports a post-payment link failure as payment success and warns not to pay again', async () => {
        vi.mocked(dbApi.patch).mockRejectedValue(new Error('Customer link write failed'));
        render(<Customers selectedRouter={router} addSale={addSale} />);
        await openPayment();
        expect(await submitPayment()).toBe(true);
        expect(await screen.findByRole('alert')).toHaveTextContent('Payment succeeded, but the PPPoE link could not be saved. Save the link in Edit Customer; do not pay again.');
        expect(processPppPayment).toHaveBeenCalledTimes(1);
        expect(addSale).toHaveBeenCalledTimes(1);
        expect(dbApi.patch).toHaveBeenCalledTimes(1);
        expect(dbApi.patch).toHaveBeenCalledWith('/customers/customer-1?routerId=router-a&expectedPppoeSecret=', { pppoeSecret: username });
        expect(data.fetchCustomers).not.toHaveBeenCalled();
        expect(data.updateCustomer).not.toHaveBeenCalled();
        expect(window.alert).not.toHaveBeenCalled();
    });
});
