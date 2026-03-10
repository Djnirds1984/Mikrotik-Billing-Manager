
-- Add new columns for subscription details
alter table mikrotik_pppoe_users add column if not exists due_date text;
alter table mikrotik_pppoe_users add column if not exists plan_name text;
alter table mikrotik_pppoe_users add column if not exists plan_type text;
