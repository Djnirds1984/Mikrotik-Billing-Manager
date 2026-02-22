-- Create table for Mikrotik Billing Manager Licenses
-- This table stores license keys, their status, and the hardware ID they are bound to.

CREATE TABLE IF NOT EXISTS public.licenses (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    license_key text NOT NULL UNIQUE,
    hardware_id text,
    is_active boolean DEFAULT true,
    status text DEFAULT 'active',
    notes text,
    expires_at timestamptz,
    activated_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    -- Optional: If you want to track which user created the license (admin)
    -- created_by uuid REFERENCES auth.users(id), 
    -- Note: We make this nullable or comment it out if local admin users don't map 1:1 to Supabase auth users
    created_by uuid
);

-- Add comments for clarity
COMMENT ON TABLE public.licenses IS 'Licenses for Mikrotik Billing Manager software';
COMMENT ON COLUMN public.licenses.license_key IS 'Unique license key string';
COMMENT ON COLUMN public.licenses.hardware_id IS 'Hardware ID of the machine where the license is activated';
COMMENT ON COLUMN public.licenses.is_active IS 'Whether the license is currently valid/active';

-- Enable Row Level Security
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

-- Create policies
-- Allow service role full access (default behavior, but explicit policies can be added if needed for other roles)
-- For now, we rely on the backend using the SERVICE_ROLE_KEY which bypasses RLS.
