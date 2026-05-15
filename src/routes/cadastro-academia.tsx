import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { slugify } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/cadastro-academia")({
  component: CadastroPage,
  head: () => ({
    meta: [{ title: "Cadastrar academia — JJ Manager" }],
  }),
});

const schema = z.object({
  academy_name: z.string().trim().min(2, "Nome da academia obrigatório").max(120),
  full_name: z.string().trim().min(2, "Nome do responsável obrigatório").max(120),
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres").max(72),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
});

function CadastroPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  // If user already has a profile, send to dashboard
  const completeMode = !!user && !profile;

  const [form, setForm] = useState({
    academy_name: "",
    full_name: "",
    email: "",
    password: "",
    phone: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user && profile) {
      navigate({ to: "/dashboard" });
    }
    if (user && !profile) {
      setForm((f) => ({
        ...f,
        email: user.email ?? f.email,
        full_name:
          (user.user_metadata?.full_name as string | undefined) ?? f.full_name,
        password: f.password || "ja-cadastrado",
      }));
    }
  }, [user, profile, navigate]);

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    try {
      let userId: string | undefined = user?.id;

      if (!completeMode) {
        // 1. signUp
        const { data: signUpData, error: signUpErr } =
          await supabase.auth.signUp({
            email: parsed.data.email,
            password: parsed.data.password,
            options: {
              emailRedirectTo: window.location.origin,
              data: { full_name: parsed.data.full_name },
            },
          });
        if (signUpErr) throw signUpErr;
        userId = signUpData.user?.id;
        if (!userId) throw new Error("Usuário não criado");

        if (!signUpData.session) {
          const { error: siErr } = await supabase.auth.signInWithPassword({
            email: parsed.data.email,
            password: parsed.data.password,
          });
          if (siErr) {
            throw new Error(
              "Conta criada, mas é necessário confirmar o e-mail. Desative a confirmação no Supabase ou confirme pelo link enviado.",
            );
          }
        }
      }

      if (!userId) throw new Error("Sessão inválida");

      // 2. organizations
      const slug =
        slugify(parsed.data.academy_name) + "-" + Date.now().toString(36);
      const { data: org, error: orgErr } = await supabase
        .from("organizations")
        .insert({
          name: parsed.data.academy_name,
          slug,
          email: parsed.data.email,
          phone: parsed.data.phone || null,
        })
        .select()
        .single();
      if (orgErr) throw orgErr;

      // 3. profiles
      const { error: profErr } = await supabase.from("profiles").insert({
        id: userId,
        organization_id: org.id,
        full_name: parsed.data.full_name,
        role: "admin",
      });
      if (profErr) throw profErr;

      // 4. organization_settings
      const { error: settErr } = await supabase
        .from("organization_settings")
        .insert({
          organization_id: org.id,
          monthly_fee_default: 200,
          due_day: 10,
          whatsapp_enabled: false,
          notify_d_minus_3: false,
          notify_d_zero: false,
          notify_d_plus_3: false,
        });
      if (settErr) throw settErr;

      await refreshProfile();
      toast.success("Academia cadastrada com sucesso!");
      navigate({ to: "/dashboard" });
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Erro ao cadastrar";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground text-lg font-bold">
            JJ
          </div>
          <h1 className="text-xl font-semibold">
            {completeMode ? "Completar cadastro" : "Cadastrar nova academia"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {completeMode
              ? "Sua conta existe — agora vincule a uma academia"
              : "Crie sua conta e comece a gerenciar sua academia"}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="academy_name">Nome da academia</Label>
            <Input
              id="academy_name"
              value={form.academy_name}
              onChange={(e) => update("academy_name", e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Nome do responsável</Label>
            <Input
              id="full_name"
              value={form.full_name}
              onChange={(e) => update("full_name", e.target.value)}
              required
            />
          </div>
          {!completeMode && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  value={form.password}
                  onChange={(e) => update("password", e.target.value)}
                  required
                />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="phone">Telefone</Label>
            <Input
              id="phone"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="(11) 99999-9999"
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {completeMode ? "Vincular academia" : "Cadastrar academia"}
          </Button>
        </form>

        {!completeMode && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Já tem conta?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Entrar
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
