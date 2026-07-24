import { createFileRoute } from "@tanstack/react-router";
import { PlanScreen } from "@/features/plan";

export const Route = createFileRoute("/app/_app/plan")({
  component: () => <PlanScreen />,
});
