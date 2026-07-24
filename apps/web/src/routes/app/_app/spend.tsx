import { createFileRoute } from "@tanstack/react-router";
import { SpendScreen } from "@/features/spend";

export const Route = createFileRoute("/app/_app/spend")({
  component: () => <SpendScreen />,
});
