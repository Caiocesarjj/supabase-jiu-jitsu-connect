import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/Avatar";
import { BeltBadge } from "@/components/BeltBadge";
import type { Belt } from "@/types/database";

interface ResultStudent {
  id: string;
  full_name: string | null;
  belt: string | null;
  photo_url: string | null;
}

export function AccessResultCard({
  allowed,
  reason,
  student,
  checkinAt,
  onSendCharge,
  onReset,
}: {
  allowed: boolean;
  reason: string | null;
  student: ResultStudent | null;
  checkinAt: string | null;
  onSendCharge?: () => void;
  onReset: () => void;
}) {
  const name = student?.full_name ?? "Aluno não identificado";
  const belt = (student?.belt as Belt | undefined) ?? "branca";

  return (
    <div
      className={`rounded-2xl border-2 p-6 sm:p-8 text-center space-y-4 ${
        allowed
          ? "border-emerald-300 bg-emerald-50"
          : "border-red-300 bg-red-50"
      }`}
    >
      <div className="flex justify-center">
        {allowed ? (
          <CheckCircle2 className="h-20 w-20 text-emerald-600" />
        ) : (
          <XCircle className="h-20 w-20 text-red-600" />
        )}
      </div>
      <h2
        className={`text-3xl font-bold ${
          allowed ? "text-emerald-700" : "text-red-700"
        }`}
      >
        {allowed ? "Acesso Liberado" : "Acesso Negado"}
      </h2>
      {!allowed && reason && (
        <p className="text-base text-red-700 font-medium">{reason}</p>
      )}

      {student && (
        <div className="flex flex-col items-center gap-3 pt-2">
          {student.photo_url ? (
            <img
              src={student.photo_url}
              alt={name}
              className="h-24 w-24 rounded-full object-cover border-2 border-white shadow"
            />
          ) : (
            <Avatar name={name} size={96} />
          )}
          <div className="text-lg font-semibold text-foreground">{name}</div>
          <BeltBadge belt={belt} size="sm" />
          {checkinAt && (
            <div className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {new Date(checkinAt).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-2 pt-2">
        {!allowed && student && onSendCharge && (
          <Button variant="outline" onClick={onSendCharge}>
            Enviar Cobrança WhatsApp
          </Button>
        )}
        <Button onClick={onReset}>Próximo</Button>
      </div>
    </div>
  );
}
