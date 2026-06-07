-- ============================================================
-- WhatsApp message logs (cobranças individuais e automáticas)
-- Rode este SQL no Lovable Cloud → SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_message_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  financial_record_id uuid REFERENCES public.financial_records(id) ON DELETE SET NULL,
  phone text NOT NULL,
  message text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent','failed')),
  provider_response text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_message_logs_org_idx
  ON public.whatsapp_message_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_message_logs_student_idx
  ON public.whatsapp_message_logs (student_id, created_at DESC);

GRANT SELECT, INSERT ON public.whatsapp_message_logs TO authenticated;
GRANT ALL ON public.whatsapp_message_logs TO service_role;

ALTER TABLE public.whatsapp_message_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_message_logs_select" ON public.whatsapp_message_logs;
CREATE POLICY "whatsapp_message_logs_select"
  ON public.whatsapp_message_logs FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "whatsapp_message_logs_insert" ON public.whatsapp_message_logs;
CREATE POLICY "whatsapp_message_logs_insert"
  ON public.whatsapp_message_logs FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

NOTIFY pgrst, 'reload schema';
