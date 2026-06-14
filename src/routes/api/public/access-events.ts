import { createFileRoute } from "@tanstack/react-router";
import { getAdminClient } from "@/lib/supabase-server";
import { getProvider } from "@/lib/access/providers";

/**
 * Webhook público para receber eventos de catracas/leitores.
 *
 * Body esperado:
 *   {
 *     "device_id": "<uuid>",
 *     "token": "<api_token do dispositivo>",
 *     "method": "qr" | "rfid" | "biometric" | "face" | "code" | "pin",
 *     "value": "<credencial>",
 *     "payload": { ... }            // opcional, dados brutos do equipamento
 *   }
 */
export const Route = createFileRoute("/api/public/access-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const deviceId = typeof body.device_id === "string" ? body.device_id : null;
        const token = typeof body.token === "string" ? body.token : null;
        if (!deviceId || !token) return new Response("Missing credentials", { status: 401 });

        const admin = getAdminClient();
        const { data: device } = await admin
          .from("access_devices")
          .select("*")
          .eq("id", deviceId)
          .maybeSingle();
        if (!device || device.api_token !== token || !device.active)
          return new Response("Unauthorized", { status: 401 });

        const method = typeof body.method === "string" ? body.method : "gate";
        const value = typeof body.value === "string" ? body.value : "";

        // Resolve via provider (futuramente normaliza payloads específicos)
        const provider = getProvider({
          id: device.id,
          manufacturer: device.manufacturer,
          name: device.name,
          ipAddress: device.ip_address,
          port: device.port,
          apiToken: device.api_token,
        });
        const event = await provider.receiveEvent(body.payload ?? body);

        // Localiza aluno pela credencial enviada
        let studentId: string | null = null;
        if (value) {
          const field =
            method === "qr"
              ? "qr_code"
              : method === "rfid"
                ? "rfid_uid"
                : method === "biometric"
                  ? "biometric_id"
                  : method === "face"
                    ? "face_id"
                    : method === "pin"
                      ? "pin_code"
                      : "access_code";
          const { data: cred } = await admin
            .from("student_access_credentials")
            .select("student_id")
            .eq("organization_id", device.organization_id)
            .eq("active", true)
            .eq(field, value)
            .maybeSingle();
          studentId = cred?.student_id ?? null;
        }

        let status: "granted" | "denied" = "denied";
        let reason: string | null = "Credencial não encontrada";

        if (studentId) {
          const today = new Date().toISOString().slice(0, 10);
          const { data: student } = await admin
            .from("students")
            .select("status, deleted_at, blocked_at")
            .eq("id", studentId)
            .eq("organization_id", device.organization_id)
            .maybeSingle();
          const s = student as Record<string, unknown> | null;
          if (!s) {
            reason = "Aluno não encontrado";
          } else if (s.deleted_at) {
            reason = "Aluno removido";
          } else if (s.blocked_at) {
            reason = "Bloqueio administrativo";
          } else if (s.status !== "active") {
            reason = "Aluno inativo";
          } else {
            const { count } = await admin
              .from("financial_records")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", device.organization_id)
              .eq("student_id", studentId)
              .lt("due_date", today)
              .in("status", ["pending", "overdue"]);
            if ((count ?? 0) > 0) {
              reason = "Mensalidade vencida";
            } else {
              status = "granted";
              reason = null;
              await admin.from("attendance_records").insert({
                organization_id: device.organization_id,
                student_id: studentId,
                device_id: device.id,
                access_method: method,
              });
            }
          }
        }

        await admin.from("access_logs").insert({
          organization_id: device.organization_id,
          student_id: studentId,
          device_id: device.id,
          access_method: method,
          status,
          reason,
          raw_input: value.slice(0, 64),
        });
        await admin
          .from("access_devices")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", device.id);

        return Response.json({
          status,
          reason,
          student_id: studentId,
          event: event.status ? event : undefined,
        });
      },

      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400",
          },
        });
      },
    },
  },
});
