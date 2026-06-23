-- Migration: v2.0.0 Initial Schema
-- Description: Establishes the v2.0.0 baseline schema. All tables use CREATE TABLE IF NOT EXISTS
-- so this is safe to run on existing databases. Adds schema_version tracking to settings.

-- Core settings table (add schema_version column if not exists)
ALTER TABLE settings ADD COLUMN schema_version TEXT DEFAULT '2.0.0';

-- Ensure all core business tables exist (idempotent)
CREATE TABLE IF NOT EXISTS routers (
    id TEXT PRIMARY KEY,
    name TEXT,
    host TEXT,
    user TEXT,
    password TEXT,
    port INTEGER,
    api_type TEXT
);

CREATE TABLE IF NOT EXISTS billing_plans (
    id TEXT PRIMARY KEY,
    routerId TEXT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    cycle TEXT NOT NULL,
    pppoeProfile TEXT,
    description TEXT,
    currency TEXT
);

CREATE TABLE IF NOT EXISTS sales_records (
    id TEXT PRIMARY KEY,
    routerId TEXT,
    date TEXT NOT NULL,
    clientName TEXT NOT NULL,
    planName TEXT NOT NULL,
    planPrice REAL NOT NULL,
    discountAmount REAL DEFAULT 0,
    finalAmount REAL NOT NULL,
    routerName TEXT,
    currency TEXT,
    clientAddress TEXT,
    clientContact TEXT,
    clientEmail TEXT,
    invoiceId TEXT,
    coveredMonth TEXT,
    processedBy TEXT DEFAULT 'admin',
    payment_method TEXT DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS client_invoices (
    id TEXT PRIMARY KEY,
    routerId TEXT,
    username TEXT,
    accountNumber TEXT,
    source TEXT,
    planName TEXT,
    planId TEXT,
    amount REAL,
    currency TEXT,
    dueDateTime TEXT,
    issueDate TEXT,
    status TEXT DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    quantity INTEGER DEFAULT 0,
    price REAL,
    serialNumber TEXT,
    dateAdded TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT,
    description TEXT,
    amount REAL NOT NULL,
    routerId TEXT
);

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    routerId TEXT,
    fullName TEXT,
    address TEXT,
    contactNumber TEXT,
    email TEXT,
    accountNumber TEXT,
    gps TEXT,
    applicationId TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT,
    message TEXT,
    is_read INTEGER DEFAULT 0,
    timestamp TEXT,
    link_to TEXT,
    context_json TEXT
);

CREATE TABLE IF NOT EXISTS dhcp_billing_plans (
    id TEXT PRIMARY KEY,
    routerId TEXT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    cycle_days INTEGER NOT NULL,
    speedLimit TEXT,
    currency TEXT
);

CREATE TABLE IF NOT EXISTS dhcp_clients (
    id TEXT PRIMARY KEY,
    routerId TEXT,
    macAddress TEXT,
    customerInfo TEXT,
    contactNumber TEXT,
    email TEXT,
    speedLimit TEXT,
    lastSeen TEXT,
    UNIQUE(routerId, macAddress)
);

CREATE TABLE IF NOT EXISTS client_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    router_id TEXT,
    pppoe_username TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    message TEXT,
    planName TEXT,
    pdfPath TEXT,
    createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repair_tickets (
    id TEXT PRIMARY KEY,
    client_user_id TEXT,
    username TEXT NOT NULL,
    client_type TEXT DEFAULT 'pppoe',
    category TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'open',
    priority TEXT DEFAULT 'normal',
    admin_notes TEXT,
    created_by TEXT DEFAULT 'client',
    assigned_to TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS paymongo_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    invoice_no TEXT NOT NULL UNIQUE,
    pppoe_username TEXT NOT NULL,
    router_id TEXT,
    plan_name TEXT,
    amount REAL,
    status TEXT DEFAULT 'pending',
    processed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS xendit_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    invoice_no TEXT NOT NULL UNIQUE,
    pppoe_username TEXT NOT NULL,
    router_id TEXT,
    plan_name TEXT,
    amount REAL,
    base_amount REAL,
    convenience_fee REAL,
    total_amount REAL,
    payment_method TEXT,
    status TEXT DEFAULT 'pending',
    processed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wan_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    connection_type TEXT NOT NULL DEFAULT 'dhcp',
    wan_interface TEXT NOT NULL DEFAULT 'eth0',
    static_ip TEXT,
    static_gateway TEXT,
    static_dns TEXT,
    pppoe_username TEXT,
    pppoe_password TEXT,
    pppoe_interface_name TEXT,
    last_applied_at TEXT,
    status TEXT DEFAULT 'pending',
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS manual_payment_requests (
    id TEXT PRIMARY KEY,
    customer_account_number TEXT NOT NULL,
    customer_username TEXT,
    customer_full_name TEXT,
    customer_facebook_psid TEXT,
    customer_router_id TEXT,
    plan_name TEXT,
    plan_price REAL NOT NULL,
    gcash_reference_number TEXT NOT NULL,
    customer_mobile_number TEXT NOT NULL,
    customer_name_on_gcash TEXT,
    payment_screenshot_url TEXT,
    status TEXT DEFAULT 'pending',
    admin_notes TEXT,
    approved_by TEXT,
    approved_at TEXT,
    rejected_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Roles & Permissions
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT,
    permission_id TEXT,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role_id TEXT,
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- Payroll
CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    fullName TEXT NOT NULL,
    role TEXT,
    hireDate TEXT,
    salaryType TEXT,
    rate REAL
);

CREATE TABLE IF NOT EXISTS employee_benefits (
    id TEXT PRIMARY KEY,
    employeeId TEXT,
    sss BOOLEAN,
    philhealth BOOLEAN,
    pagibig BOOLEAN,
    FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS time_records (
    id TEXT PRIMARY KEY,
    employeeId TEXT,
    date TEXT,
    timeIn TEXT,
    timeOut TEXT,
    FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
);

-- PisoWifi
CREATE TABLE IF NOT EXISTS pisowifi_income (
    id TEXT PRIMARY KEY,
    resellerId TEXT,
    resellerName TEXT,
    vendoLocation TEXT,
    percentage REAL,
    grossSales REAL,
    expenses REAL,
    netTotal REAL,
    createdAt TEXT
);

CREATE TABLE IF NOT EXISTS pisowifi_resellers (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    contactNumber TEXT,
    notes TEXT,
    createdAt TEXT
);
