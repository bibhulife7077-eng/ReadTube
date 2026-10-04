import { createFileRoute } from "@tanstack/react-router";
import HistoryPage from "@/pages/history-screen";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
});
