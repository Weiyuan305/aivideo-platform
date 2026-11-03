import { TaskDetail } from "@/features/tasks/task-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TaskDetail id={id} />;
}
