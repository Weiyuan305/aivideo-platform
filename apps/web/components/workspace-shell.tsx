"use client";
// Adapted from nextjs/saas-starter dashboard/layout.tsx; MIT notice retained.
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Aperture,
  ImageIcon,
  Video,
  AudioLines,
  Workflow,
  FolderOpen,
  Library,
  Clock3,
  History,
  Settings,
  Menu,
  X,
  ArrowUpRight,
} from "lucide-react";
import { workspaceBackend } from "@aivideo/core/workspace-client";
import { Button } from "@/components/ui/button";
const nav = [
  { href: "/projects", icon: Library, label: "短剧项目" },
  { href: "/studio/image", icon: ImageIcon, label: "图片生成" },
  { href: "/studio/video", icon: Video, label: "视频生成" },
  { href: "/studio/voice", icon: AudioLines, label: "语音克隆" },
  { href: "/workflows", icon: Workflow, label: "工作流" },
  { href: "/assets", icon: FolderOpen, label: "素材库" },
  { href: "/voices", icon: Library, label: "声音库" },
  { href: "/jobs", icon: Clock3, label: "任务中心" },
  { href: "/history", icon: History, label: "生成历史" },
  { href: "/settings", icon: Settings, label: "接口配置" },
];
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [backend, setBackend] = useState<"browser" | "server">("browser");
  useEffect(() => {
    void workspaceBackend()
      .then(setBackend)
      .catch(() => {});
  }, []);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const compact = window.matchMedia(
      "(max-width: 760px), (max-width: 1000px) and (max-height: 500px)",
    );
    const resized = () => {
      if (!compact.matches) setOpen(false);
    };
    compact.addEventListener("change", resized);
    return () => {
      document.body.style.overflow = previousOverflow;
      compact.removeEventListener("change", resized);
      if (dialog.open) dialog.close();
    };
  }, [open]);
  function navigation() {
    return (
      <>
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <span>
            <Aperture size={23} />
          </span>
          <div>
            AIvideo<small>创作工作台</small>
          </div>
        </Link>
        <nav aria-label="主导航">
          {nav.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={`nav-item ${index === 4 ? "section-start" : ""} ${pathname === item.href ? "active" : ""}`}
              onClick={() => setOpen(false)}
            >
              <item.icon size={18} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <i />
            {backend === "server" ? "服务端工作区" : "本地工作区"}
          </div>
          <p>
            {backend === "server"
              ? "任务与素材保存在服务端"
              : "草稿与素材保存在当前浏览器"}
          </p>
          {backend === "server" && (
            <Link href="/sign-in" onClick={() => setOpen(false)}>
              账号登录
            </Link>
          )}
          <Link href="/settings" onClick={() => setOpen(false)}>
            配置云端服务 <ArrowUpRight size={14} />
          </Link>
        </div>
      </>
    );
  }
  return (
    <div className="workspace">
      <header className="mobile-header">
        <Link href="/">AIvideo</Link>
        <Button
          aria-label="打开导航"
          aria-expanded={open}
          aria-controls="workspace-mobile-nav"
          aria-haspopup="dialog"
          variant="ghost"
          onClick={() => setOpen(true)}
        >
          <Menu />
        </Button>
      </header>
      <aside className="sidebar">{navigation()}</aside>
      <dialog
        ref={dialogRef}
        id="workspace-mobile-nav"
        className="mobile-nav-dialog"
        aria-label="主导航"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <div className="mobile-nav-panel">
          <div className="mobile-nav-heading">
            <span>导航</span>
            <Button
              aria-label="关闭导航"
              variant="ghost"
              autoFocus
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </div>
          {navigation()}
        </div>
      </dialog>
      <main className="main-content">{children}</main>
    </div>
  );
}
