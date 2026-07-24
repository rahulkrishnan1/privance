import { createFileRoute } from "@tanstack/react-router";
import { InvestScreen } from "@/features/invest";

export const Route = createFileRoute("/app/_app/accounts")({
  component: () => <InvestScreen view="accounts" />,
});
