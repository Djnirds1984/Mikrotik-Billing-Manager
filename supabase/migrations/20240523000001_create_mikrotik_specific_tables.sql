-- Create table specifically for Mikrotik Billing Manager Licenses
CREATE TABLE IF NOT EXISTS public.mikrotik_licenses (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    license_key text NOT NULL UNIQUE,
    hardware_id text, -- The Host Board ID / Machine ID
    owner_name text,
    contact_info text,
    is_active boolean DEFAULT true,
    status text DEFAULT 'active', -- active, suspended, expired
    plan_type text, -- e.g., 'monthly', 'lifetime', 'premium'
    max_routers integer DEFAULT 1,
    notes text,
    expires_at timestamptz,
    activated_at timestamptz,
    last_check_in timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add comments
COMMENT ON TABLE public.mikrotik_licenses IS 'Licenses specifically for the Mikrotik Billing Manager software';

-- Create table for Mikrotik Routers (synced from local)
CREATE TABLE IF NOT EXISTS public.mikrotik_routers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid REFERENCES public.mikrotik_licenses(id),
    router_name text,
    router_ip text,
    router_model text,
    router_serial text,
    router_version text,
    last_seen timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.mikrotik_routers IS 'Registered Mikrotik routers under a license';

-- Create table for Mikrotik Sales Logs (optional sync)
CREATE TABLE IF NOT EXISTS public.mikrotik_sales_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    license_id uuid REFERENCES public.mikrotik_licenses(id),
    router_id uuid REFERENCES public.mikrotik_routers(id),
    amount numeric,
    currency text DEFAULT 'PHP',
    transaction_type text,
    created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.mikrotik_sales_logs IS 'Synced sales logs from Mikrotik Billing Manager';

-- Enable RLS
ALTER TABLE public.mikrotik_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mikrotik_routers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mikrotik_sales_logs ENABLE ROW LEVEL SECURITY;
