
create table if not exists mikrotik_pppoe_users (
    id text primary key,
    username text unique,
    router_id text,
    full_name text,
    address text,
    contact_number text,
    email text,
    account_number text,
    gps text,
    application_id text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS (Row Level Security) if needed, but for now I'll just leave it open or simple.
-- It's better to enable RLS by default.
alter table mikrotik_pppoe_users enable row level security;

create policy "Enable read access for all users" on mikrotik_pppoe_users for select using (true);
create policy "Enable insert access for service role" on mikrotik_pppoe_users for insert with check (true);
create policy "Enable update access for service role" on mikrotik_pppoe_users for update using (true);
create policy "Enable delete access for service role" on mikrotik_pppoe_users for delete using (true);
