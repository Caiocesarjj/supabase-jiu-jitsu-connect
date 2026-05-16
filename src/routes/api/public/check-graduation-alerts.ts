import { createFileRoute } from "@tanstack/react-router";
import { checkGraduationAlerts } from "@/lib/graduation-alerts.functions";

export const Route = createFileRoute("/api/public/check-graduation-alerts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cronSecret = process.env.CRON_SECRET ?? "";
        const authHeader = request.headers.get("authorization") ?? "";

        if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const result = await checkGraduationAlerts();
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          console.error("check-graduation-alerts endpoint error:", err);
          return new Response(
            JSON.stringify({ error: "Internal server error" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});
