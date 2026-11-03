import type { Metadata, Viewport } from "next";
import { WorkspaceShell } from "@/components/workspace-shell";
import { TaskRuntime } from "@/features/tasks/task-runtime";
import "./globals.css";
export const metadata: Metadata = {
  title: "创作工作台 · AIvideo",
  description: "图片、视频、语音克隆与 API 工作流",
  icons: { icon: "/media-placeholder.svg" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#11151d",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <WorkspaceShell>
          <TaskRuntime />
          {children}
        </WorkspaceShell>
      </body>
    </html>
  );
}
