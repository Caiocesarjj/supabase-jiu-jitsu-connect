
# Plano: JJ Manager (gestão de academia de Jiu-Jitsu)

## Conexão com seu Supabase externo

Você quer usar seu próprio projeto Supabase (`zufxbprezjsolrtxcvlb`), não Lovable Cloud. Vou configurar o cliente do Supabase apontando diretamente para suas credenciais:

- `VITE_SUPABASE_URL = https://zufxbprezjsolrtxcvlb.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY = sb_publishable_yfraGhFuTshgKMRHFKyUcw_hEs-gMC9`

**Importante:** antes de testar, você precisa rodar o `01_supabase_setup.sql` no SQL Editor do seu projeto Supabase. Sem isso, nenhuma query vai funcionar (tabelas `organizations`, `profiles`, `students`, `classes`, `attendance`, `financial_records`, `organization_settings` não existem).

Como é Supabase externo, eu **não tenho acesso para inspecionar o schema nem aplicar migrations** — você gerencia o banco. Se houver divergência entre o SQL e o que o app espera, vamos depurar a partir dos erros.

## Escopo é grande — proposta de fases

O prompt mestre é extenso (auth multi-tenant, 8 páginas, JWT customizado com `organization_id`/`user_role`, geração de cobranças, integrações WhatsApp/Asaas via Edge Functions). Construir tudo de uma vez quase certamente quebra. Recomendo dividir:

### Fase 1 (este passo) — Fundação
- Cliente Supabase configurado para o projeto externo
- Tipos TypeScript das 7 tabelas (`/src/types`)
- Hook `useAuth` (sessão + claims `organization_id`/`user_role` do JWT)
- Contexto `OrgContext`
- Layout protegido com Sidebar (rotas via `_authenticated/`)
- Rotas `/login` e `/cadastro-academia` funcionais
- Dashboard placeholder com KPIs simples (contagem de alunos, recebido no mês)
- Tema verde escuro `#0F6E56`, tokens em `src/styles.css`
- Componentes compartilhados: `BeltBadge`, `StatusBadge`, `Avatar`, `EmptyState`, `ConfirmModal`, `LoadingSpinner`

### Fase 2 — Alunos
- `/alunos` (lista com busca, filtros por faixa/status)
- `/alunos/novo` (cadastro)
- `/alunos/:id` (ficha com abas: dados, graduações, presença, financeiro)

### Fase 3 — Turmas e Presença
- `/turmas` (CRUD de turmas)
- `/presenca` (chamada por turma e data)

### Fase 4 — Financeiro
- `/financeiro` (lista + filtros por mês/status)
- Botão "Gerar cobranças do mês" (criação local idempotente)
- Marcar como pago, cancelar, ver recibo

### Fase 5 — Configurações + integrações externas
- `/configuracoes` (academia, financeiro, PIX, WhatsApp, alterar senha)
- Edge Functions Asaas/WhatsApp ficam **fora** desta plataforma — seriam configuradas no seu próprio Supabase (Lovable não gerencia Edge Functions de projetos externos)

## Detalhes técnicos

- **Stack:** TanStack Start (já configurado), não vou trocar por Vite SPA simples. Rotas em `src/routes/` no padrão flat (`alunos.tsx`, `alunos.novo.tsx`, `alunos.$id.tsx`, etc.) sob layout `_authenticated.tsx`.
- **Roteamento:** TanStack Router (`@tanstack/react-router`). Não React Router DOM — o prompt mestre cita React Router mas vou adaptar para a stack do template.
- **Auth:** `supabase.auth.signInWithPassword` + `onAuthStateChange` no root para invalidar queries. Email/senha apenas, sem Google.
- **Multi-tenant:** leio `organization_id` e `user_role` do JWT (claims customizados que seu trigger SQL deve injetar via hook `auth.jwt()`). Toda query inclui `.eq('organization_id', orgId)` mesmo com RLS.
- **Cadastro de academia:** `signUp` → insert em `organizations`, `profiles`, `organization_settings` (sequencial, sem transação porque não temos RPC). Se o seu SQL tiver função RPC para isso, me avise e uso ela.
- **Validação:** Zod em todos os formulários.
- **Datas/moeda:** `Intl.DateTimeFormat('pt-BR')` e `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
- **Toasts:** Sonner (já no template).
- **Sem Edge Functions:** geração de PIX real via Asaas e envio WhatsApp ficam como TODO — apenas crio os registros locais.

## Decisões que preciso confirmar antes de partir para o código

1. **Fase 1 só, ou tudo de uma vez?** Recomendo Fase 1. Você confirma e eu sigo só com fundação + login + cadastro + dashboard básico.
2. **Como o `organization_id` chega no JWT?** Seu `01_supabase_setup.sql` configura um Auth Hook (custom_access_token_hook) ou eu leio de `profiles` após o login? (a segunda opção é mais simples se você não tiver o hook)
3. Confirma que **não quer** login com Google, só email/senha?

Responda essas 3 e eu já parto para implementar a Fase 1.
