import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/financeiro/")({
  beforeLoad: () => {
    throw redirect({ to: "/financeiro/dashboard" });
  },
});
