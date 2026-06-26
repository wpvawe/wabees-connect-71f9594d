
CREATE TABLE public.whatsapp_config (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number_id TEXT,
  waba_id TEXT,
  display_phone TEXT,
  business_name TEXT,
  quality_rating TEXT,
  access_token_encrypted TEXT,
  token_iv TEXT,
  token_tag TEXT,
  method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('embedded_signup','manual')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.whatsapp_config TO authenticated;
GRANT ALL ON public.whatsapp_config TO service_role;
ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own wa config" ON public.whatsapp_config
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own wa config" ON public.whatsapp_config
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER whatsapp_config_set_updated_at BEFORE UPDATE ON public.whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
