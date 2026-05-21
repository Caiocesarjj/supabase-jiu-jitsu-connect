
## Visão geral

4 frentes em uma entrega. Tudo no frontend + utilitários puros, exceto o SQL que **você roda manualmente** no Supabase (listado no fim).

---

## 1) Categorias de peso (FBJJ)

**Novo módulo** `src/lib/weight-category.ts` com:
- `AGE_GROUPS`: KIDS 1 (4-5), KIDS 2 (6-7), KIDS 3 (8-9), INFANTIL (10-11), JÚNIOR (12-13), ADOLESCENTES (14-15), JUVENIL (16-17), ADULTO (18-29), MASTER 1/2/3/4.
- `MALE_WEIGHTS` e `FEMALE_WEIGHTS`: tabela oficial FBJJ (limites superiores por divisão; o último é "acima de" → "Pesadíssimo").
- `getAgeGroup(birthDate)` → grupo etário.
- `getWeightCategory({ birthDate, sex, weightKg })` → `{ ageGroup, categoryLabel }` (ex: "JÚNIOR — Leve (até 45 kg)").
- Retorna `null` se faltar peso/sexo/nascimento.

**Cadastro de aluno** (`alunos.novo.tsx` e `alunos.$alunoId.tsx`):
- Adicionar campo **Sexo** (masc/fem) — usar `sex` na tabela `students`.
- Peso já existe (`weight_kg`).
- Exibir badge "Categoria FBJJ" calculada ao vivo.

**Ficha do aluno** (`alunos.$alunoId.tsx`): mostrar a categoria no cabeçalho perto da faixa.

**Dashboard** (`dashboard.tsx`): novo card "Alunos por categoria de peso" — agrupar alunos ativos por `categoryLabel` (lista com contagem). Reuso do `BeltBadge` existente para visual consistente.

---

## 2) Afiliações — limpeza de cards de receita

Em `src/routes/_authenticated/afiliacoes.tsx`:
- Remover os 2 cards "Recebido no mês (matriz)" e "Inadimplentes (matriz)" da seção "Rede consolidada".
- Manter apenas o card "Alunos ativos".
- Remover as colunas "Recebido (mês)" e "Inadimplentes" da tabela.
- Manter botão "Ver alunos" (já existe) que mostra nome/idade/peso/graduação.

---

## 3) Cores de faixa e categoria nas listagens

- `alunos.index.tsx`: garantir que cada linha renderiza `<BeltBadge belt={...} stripes={...} />` (cores já existem em `BeltBadge.tsx`) + nova coluna "Categoria FBJJ".
- Dashboard "Graduações pendentes": também usar `BeltBadge` em vez de texto.
- Dialog "Ver alunos" em afiliações: trocar texto da graduação por `BeltBadge`.

---

## 4) Financeiro — reformulação completa em sub-rotas

### Sidebar (`AppSidebar.tsx`)
- "Financeiro" vira **grupo colapsável** (usando `Collapsible` + `SidebarMenuSub`) com 5 sub-itens: Visão Geral, Mensalidades, Recorrentes, Formas de Pagamento, Crescimento.
- Abre automático quando `pathname` começa com `/financeiro`.

### Layout pai
Renomear `src/routes/_authenticated/financeiro.tsx` (que hoje é a página) para layout pai com:
- Header "Financeiro" + subtítulo.
- Sub-navegação horizontal (`Tabs` linkando para sub-rotas).
- `<Outlet />`.

### Rotas (5 novos arquivos em `src/routes/_authenticated/financeiro.*.tsx`)
- `financeiro.index.tsx` → redirect para `/financeiro/dashboard`.
- `financeiro.dashboard.tsx` — abas internas (Geral / Receitas / Despesas / Fluxo de Caixa / Alunos) usando `Tabs`. Cards comparativos com % variação vs período anterior, "Resumo de Tendências" (badges altas/queda/estáveis). Gráficos com `recharts` (já no projeto via `chart.tsx`).
- `financeiro.mensalidades.tsx` — gráfico anual BarChart empilhado (recebido/a receber/vencido), 4 cards de resumo, filtro de mês, tabela de pagamentos (extrai a tabela atual do `financeiro.tsx`).
- `financeiro.recorrentes.tsx` — usa `subscription_records` + `subscription_plans` (que **você criará no SQL**). 4 cards de status, barras de progresso por status, tabela de assinaturas com ações (pausar/reativar/cancelar), modal "Gerenciar Planos" (CRUD).
- `financeiro.formas-pagamento.tsx` — grid de `payment_methods` com toggle ativo/inativo; configuração de PIX integra com `organization_settings.pix_key`.
- `financeiro.crescimento.tsx` — cards YTD, LineChart receita vs a receber com projeção pontilhada, botão exportar CSV.

### Bibliotecas necessárias
- `recharts` (verificar `package.json`; instalar se ausente).

---

## SQL para você rodar no Supabase

```sql
-- 1) Sexo no aluno
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS sex text CHECK (sex IN ('male','female'));

-- 2) Planos de assinatura
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric(10,2) NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('monthly','quarterly','semiannual','annual')),
  description text,
  modality text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read plans" ON public.subscription_plans
  FOR SELECT USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "org admin write plans" ON public.subscription_plans
  FOR ALL USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- 3) Assinaturas ativas
CREATE TABLE IF NOT EXISTS public.subscription_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','canceled','expired')),
  last_paid_at date,
  next_due_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscription_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members read subs" ON public.subscription_records
  FOR SELECT USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "org admin write subs" ON public.subscription_records
  FOR ALL USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- 4) Métodos de pagamento
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,  -- 'pix' | 'credit' | 'debit' | 'boleto' | 'cash' | 'custom'
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, type, name)
);
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members payment_methods" ON public.payment_methods
  FOR ALL USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

-- 5) Coluna payment_method já existe em financial_records (verificar)
```

---

## Pontos não cobertos (assumindo)

- "Despesas" fica como placeholder "Em breve" — não criei tabela `expenses` no SQL pois você indicou que rodaria o SQL próprio; se quiser, posso adicionar.
- "Sexo" no cadastro existente: alunos antigos ficam `null` → categoria mostra "—" até preencher.
- Sub-itens do sidebar usam `Collapsible` do shadcn já presente (`collapsible.tsx`).

---

## Ordem de implementação

1. Utilitários (`weight-category.ts`).
2. Cadastro de aluno (campo sexo + preview categoria).
3. Dashboard (card categorias + BeltBadge nas graduações).
4. Listagem alunos (BeltBadge + categoria).
5. Afiliações (remover cards/colunas, BeltBadge no dialog).
6. Sidebar colapsável + layout pai do financeiro.
7. 5 sub-rotas do financeiro (dashboard, mensalidades, recorrentes, formas-pagamento, crescimento).
