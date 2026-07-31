-- Migration: v2.2.0 SMS Management
-- Description: Adds SMS template storage and SMS delivery logs used by the
-- Admin APK native SMS sender. Templates support placeholder substitution
-- ({clientName}, {dueDate}, {planName}, {amount}, {companyName}) and both
-- tables are scoped per router via router_id.

-- Reusable SMS message templates
CREATE TABLE IF NOT EXISTS sms_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'custom', -- due_reminder | payment_confirm | disconnection | custom
    body TEXT NOT NULL,
    router_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Per-message delivery log (queued by the panel, sent by the Admin APK)
CREATE TABLE IF NOT EXISTS sms_logs (
    id TEXT PRIMARY KEY,
    template_id TEXT,
    client_id TEXT,
    client_phone TEXT,
    message_text TEXT,
    status TEXT DEFAULT 'QUEUED', -- QUEUED | SENT | FAILED
    error_message TEXT,
    router_id TEXT,
    sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_router ON sms_logs(router_id);
CREATE INDEX IF NOT EXISTS idx_sms_templates_router ON sms_templates(router_id);

-- Default templates (global — router_id NULL means available to every router)
INSERT OR IGNORE INTO sms_templates (id, name, type, body, router_id, created_at) VALUES
    ('tpl_default_due_reminder', 'Due Reminder', 'due_reminder',
     'Hi {clientName}, your internet plan {planName} is due on {dueDate}. Amount: {amount}. Please settle to avoid disconnection. - {companyName}',
     NULL, datetime('now')),
    ('tpl_default_payment_confirm', 'Payment Confirmation', 'payment_confirm',
     'Hi {clientName}, we received your payment of {amount} for {planName}. Your next due date is {dueDate}. Thank you! - {companyName}',
     NULL, datetime('now')),
    ('tpl_default_disconnection', 'Disconnection Notice', 'disconnection',
     'Hi {clientName}, your internet service for {planName} has been disconnected due to an unpaid balance of {amount} due on {dueDate}. Please settle to restore your connection. - {companyName}',
     NULL, datetime('now')),
    ('tpl_default_custom', 'Custom Message', 'custom',
     'Hi {clientName}, this is a message from {companyName} regarding your account.',
     NULL, datetime('now'));
