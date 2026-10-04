import type { VideoMeta } from "./types";
import { thumbnailUrl, watchUrl } from "./youtube";

/** Public metadata only — transcripts are fetched live, never mocked. */
export const SAMPLE_VIDEOS: VideoMeta[] = [
  {
    id: "aircAruvnKk",
    url: watchUrl("aircAruvnKk"),
    title: "But what is a neural network? | Chapter 1, Deep learning",
    channelName: "3Blue1Brown",
    channelUrl: "https://www.youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw",
    thumbnailUrl: thumbnailUrl("aircAruvnKk"),
    durationSeconds: 1153,
    description: "",
  },
  {
    id: "fNk_zzaMoSs",
    url: watchUrl("fNk_zzaMoSs"),
    title: "Vectors | Chapter 1, Essence of linear algebra",
    channelName: "3Blue1Brown",
    channelUrl: "https://www.youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw",
    thumbnailUrl: thumbnailUrl("fNk_zzaMoSs"),
    durationSeconds: 988,
    description: "",
  },
  {
    id: "eIho2S0ZahI",
    url: watchUrl("eIho2S0ZahI"),
    title: "How to speak so that people want to listen",
    channelName: "TED",
    channelUrl: "https://www.youtube.com/ted",
    thumbnailUrl: thumbnailUrl("eIho2S0ZahI"),
    durationSeconds: 598,
    description: "",
  },
];
