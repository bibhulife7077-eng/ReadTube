import { createFileRoute } from "@tanstack/react-router";
import TranscriptPage from "@/pages/read-screen";

export const Route = createFileRoute("/read/$videoId")({
  component: TranscriptPage,
});
