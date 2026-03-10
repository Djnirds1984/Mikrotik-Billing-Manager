
-- Add password column for PPPoE users
alter table mikrotik_pppoe_users add column if not exists password text;
