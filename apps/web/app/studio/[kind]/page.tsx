import { notFound } from "next/navigation";
import { StudioPage } from "@/features/studio/studio-page";
export default async function Page({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  if (!["image", "video", "voice"].includes(kind)) notFound();
  return <StudioPage key={kind} kind={kind as "image" | "video" | "voice"} />;
}
