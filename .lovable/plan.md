# Módulo de Recepção e Controle de Acesso

Construir um módulo completo e escalável de controle de acesso para academias, preparado para integração futura com Control iD, Henry e TopData — sem quebrar nada do que já existe.

## 1. Banco de Dados (migration)

Novas tabelas (todas com RLS por `organization_id` + GRANTs):

- **student_access_credentials** — código único, PIN, QR code, RFID, biometric_id, face_id, active.
- **access_devices** — name, manufacturer (control_id | henry | topdata | other), model, ip_address, port, api_token, active.
- **attendance_records** — student_id, access_method, checkin_at, device_id. (Coexiste com `attendance` atual de chamada por turma; este é o registro de catraca/recepção.)
- **access_logs** — student_id, device_id, access_method, status (granted/denied), reason.
- **student_face_profiles** — face_reference (apenas estrutura, sem ML local).

Trigger para gerar `access_code`, `pin_code` e `qr_code` automaticamente quando um aluno é criado (via função SQL chamada do server fn de criação).

Função SQL `validate_student_access(p_student_id, p_org_id)` que retorna `{ allowed, reason }` checando: aluno ativo, matrícula ativa, plano ativo, mensalidade em dia, bloqueios.

## 2. Camada de providers (arquitetura)

`src/lib/access/providers/` com interface `AccessProvider`:

```text
AccessProvider
├── connect()
├── validateAccess(credential)
├── openGate()
├── receiveEvent(payload)
├── syncUsers(students)
└── syncCredentials(credentials)
```

Implementações iniciais (stubs prontos para uso real):
- `ControlIdProvider`
- `HenryProvider`
- `TopDataProvider`
- `MockProvider` (para operação manual via recepção)

Factory `getProvider(device)` seleciona por `manufacturer`.

## 3. Server functions (`src/lib/access.functions.ts`)

- `validateAccessAttempt({ method, value, deviceId? })` — resolve credencial → aluno → chama `validate_student_access` → grava `access_logs` + (se liberado) `attendance_records`.
- `listTodayAttendance()`, `listAccessLogs(filters)`.
- `upsertCredential(studentId, patch)`.
- `regenerateQrCode(studentId)`, `regeneratePin(studentId)`.
- `syncStudentAccess(studentId)` — dispara `provider.syncUsers/syncCredentials` para todos os devices ativos (best-effort, não bloqueia).
- CRUD de `access_devices`.

Webhook público `src/routes/api/public/access-events.ts` para receber eventos das catracas (com verificação de token do device).

## 4. Telas

**Sidebar:** novo grupo **Recepção** com item **Controle de Acesso**.

- `/_authenticated/recepcao/controle-acesso` — tela operacional:
  - Tabs: QR Code (scanner via webcam, biblioteca leve), Código, PIN.
  - Resultado grande em tela cheia: ✅ verde com foto/nome/faixa/horário, ou ❌ vermelho com motivo + botão "Enviar Cobrança WhatsApp" (reusa fluxo existente).
  - Feed lateral dos últimos acessos do dia.

- `/_authenticated/recepcao/presencas` — histórico de attendance_records + filtros.

- `/_authenticated/configuracoes/dispositivos` (nova aba em Configurações) — CRUD de `access_devices`.

- Em `alunos.$alunoId.tsx`: nova seção "Credenciais de Acesso" exibindo código, PIN, QR code (renderizado), botões de regenerar e histórico de últimos acessos.

- Em `dashboard.tsx`: cards "Presentes hoje", "Entradas do dia", "Acessos negados", "Mensalidades bloqueadas", "Alunos ativos".

## 5. Portal do aluno

Já existe área autenticada? Vamos adicionar dentro da própria página do aluno (visualização administrativa) os blocos: Meu QR Code, Meu Código, Histórico de Presenças, Últimos Acessos. (Se houver portal público de aluno futuramente, os componentes já estarão prontos para reuso.)

## 6. Automações

- Após `attendance_records` inserir: trigger atualiza `students.last_checkin_at` e incrementa contador de frequência.
- `syncStudentAccess` chamado quando aluno é atualizado (status/plano).

## 7. Bibliotecas

- `qrcode` (geração SVG do QR no front e na página do aluno).
- `html5-qrcode` (leitura via webcam na recepção). Leve, sem dependências nativas, compatível com Worker (usado só no browser).

## 8. O que NÃO faremos agora

- Não implementar SDKs proprietários de Control iD/Henry/TopData — apenas a interface e os stubs HTTP.
- Não implementar reconhecimento facial local (apenas a tabela `student_face_profiles`).
- Não alterar o módulo de Presença por turma existente — convivem.

## Arquivos principais

```text
docs/sql/20260614_access_control.sql          (migration)
src/lib/access.functions.ts                   (server fns)
src/lib/access/providers/types.ts
src/lib/access/providers/index.ts             (factory)
src/lib/access/providers/control-id.ts
src/lib/access/providers/henry.ts
src/lib/access/providers/topdata.ts
src/lib/access/providers/mock.ts
src/routes/api/public/access-events.ts        (webhook)
src/routes/_authenticated/recepcao.tsx        (layout)
src/routes/_authenticated/recepcao.controle-acesso.tsx
src/routes/_authenticated/recepcao.presencas.tsx
src/routes/_authenticated/configuracoes.tsx   (+ aba Dispositivos)
src/components/access/AccessResultCard.tsx
src/components/access/QrScanner.tsx
src/components/access/StudentCredentialsPanel.tsx
src/components/AppSidebar.tsx                 (+ grupo Recepção)
src/routes/_authenticated/alunos.$alunoId.tsx (+ painel credenciais)
src/routes/_authenticated/dashboard.tsx       (+ cards)
```

Posso seguir com a implementação?
