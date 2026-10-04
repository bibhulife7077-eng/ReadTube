import { createFileRoute } from "@tanstack/react-router";
import SettingsPage from "@/pages/settings-screen";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});
