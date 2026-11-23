"use client";

import { useParams } from "next/navigation";
import { VideoEditor } from "@/components/editor/VideoEditor";

export default function ProjectEditorPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";

  return <VideoEditor key={id} projectId={id} />;
}
