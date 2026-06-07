-- ============================================================
-- Fase 1 — Multi-tenant payment integrations
-- Rode este SQL no Lovable Cloud → SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('manual','link','asaas','mercadopago','pagseguro','infinitepay')),
  credentials_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS payment_integrations_org_idx
  ON public.payment_integrations (organization_id);

-- Apenas um provider ativo por organização
CREATE UNIQUE INDEX IF NOT EXISTS payment_integrations_one_active_per_org
  ON public.payment_integrations (organization_id)
  WHERE active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_integrations TO authenticated;
GRANT ALL ON public.payment_integrations TO service_role;

ALTER TABLE public.payment_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_integrations_select" ON public.payment_integrations;
CREATE POLICY "payment_integrations_select"
  ON public.payment_integrations FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "payment_integrations_insert" ON public.payment_integrations;
CREATE POLICY "payment_integrations_insert"
  ON public.payment_integrations FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "payment_integrations_update" ON public.payment_integrations;
CREATE POLICY "payment_integrations_update"
  ON public.payment_integrations FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "payment_integrations_delete" ON public.payment_integrations;
CREATE POLICY "payment_integrations_delete"
  ON public.payment_integrations FOR DELETE TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_payment_integrations_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS payment_integrations_set_updated_at ON public.payment_integrations;
CREATE TRIGGER payment_integrations_set_updated_at
  BEFORE UPDATE ON public.payment_integrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_integrations_set_updated_at();
