-- Drop trigger on auth.users if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Drop functions
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;
DROP FUNCTION IF EXISTS public.check_rate_limit(text, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;

-- Drop tables
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.whatsapp_config CASCADE;
DROP TABLE IF EXISTS public.rate_limits CASCADE;

-- Drop enum
DROP TYPE IF EXISTS public.app_role CASCADE;