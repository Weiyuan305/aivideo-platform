import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Page } from "@playwright/test";
import type { LocalTask } from "@aivideo/contracts";
import { createTask, transitionTask } from "../../packages/core/src/tasks";
import { createTemplate } from "../../packages/core/src/workflow";
import { performWorkflowStep } from "../../packages/core/src/execution";
const evidence = path.join(os.tmpdir(), "aivideo-qa");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
  "base64",
);
function wav() {
  const data = Buffer.alloc(44 + 16000);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(16000, 40);
  return data;
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error" && !e.text().includes("503 (Service Unavailable)"))
      errors.push(e.text());
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      ["127.0.0.1", "localhost"].includes(url.hostname) ||
      ["blob:", "data:"].includes(url.protocol)
    )
      return route.fallback();
    external.push(url.origin);
    return route.abort();
  });
  test.info().annotations.push({
    type: "browser",
    description:
      "Browser plugin not available; installed Chrome via Playwright",
  });
  await fs.mkdir(evidence, { recursive: true });
  (
    page as typeof page & { _qaErrors: string[]; _external: string[] }
  )._qaErrors = errors;
  (page as typeof page & { _external: string[] })._external = external;
});
test.afterEach(async ({ page }) => {
  expect((page as typeof page & { _qaErrors: string[] })._qaErrors).toEqual([]);
  expect((page as typeof page & { _external: string[] })._external).toEqual([]);
});
test("all entry pages render meaningful content without framework errors", async ({
  page,
}) => {
  for (const [route, title] of [
    ["/studio/image", "图片生成"],
    ["/studio/video", "视频生成"],
    ["/studio/voice", "语音克隆"],
    ["/assets", "素材库"],
    ["/voices", "声音库"],
    ["/workflows", "工作流"],
    ["/settings", "服务配置"],
    ["/jobs", "任务中心"],
    ["/history", "生成历史"],
    ["/sign-in", "登录账号"],
  ]) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/AIvideo/);
    await expect(page.locator("body")).not.toContainText("Application error");
  }
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeDisabled();
});
test("image and video drafts persist while generation is explicitly unavailable", async ({
  page,
}) => {
  for (const kind of ["image", "video"]) {
    await page.goto(`/studio/${kind}`);
    const prompt = page.locator("textarea").first();
    await prompt.fill(`测试${kind}草稿`);
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/jobs") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "生成", exact: true }).click();
    expect((await response).status()).toBe(503);
    await expect(page.locator("main [role=alert]")).toContainText(
      "生成接口未配置",
    );
    await expect
      .poll(() => page.evaluate(() => Object.values(localStorage).join(" ")))
      .toContain(`测试${kind}草稿`);
    await page.reload();
    await expect(page.locator("textarea").first()).toHaveValue(
      `测试${kind}草稿`,
    );
  }
  await page.screenshot({
    path: path.join(evidence, "video-desktop.png"),
    fullPage: true,
  });
});
test("mainstream models support text/reference forms, model-specific duration and workflow selection", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/assets");
  await page.getByLabel("上传素材").setInputFiles({
    name: "model-reference.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.getByRole("heading", { name: "model-reference.png", exact: true }),
  ).toBeVisible();
  for (const model of [
    {
      kind: "image",
      name: "Nano Banana 2",
      prefix: "image.nano-banana-2",
      text: "t2i",
      reference: "edit",
    },
    {
      kind: "image",
      name: "Nano Banana Pro",
      prefix: "image.nano-banana-pro",
      text: "t2i",
      reference: "edit",
    },
    {
      kind: "video",
      name: "Seedance 2.0",
      prefix: "video.seedance-2",
      text: "t2v",
      reference: "i2v",
      defaultDuration: "5",
      duration: "15",
    },
    {
      kind: "video",
      name: "MiniMax Hailuo 2.3",
      prefix: "video.hailuo-2.3",
      text: "t2v",
      reference: "i2v",
      defaultDuration: "6",
      duration: "10",
    },
  ]) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`/studio/${model.kind}`);
    await page
      .getByRole("button", {
        name: model.kind === "image" ? /FLUX.2/ : /Kling O3/,
      })
      .click();
    await page.getByText(model.name, { exact: true }).click();
    if (model.duration) {
      await page
        .getByRole("button", { name: `${model.defaultDuration}s`, exact: true })
        .click();
      await page
        .getByRole("menuitemradio", { name: `${model.duration}s`, exact: true })
        .click();
    }
    if (model.name.startsWith("MiniMax"))
      await expect(
        page.getByRole("button", { name: "16:9", exact: true }),
      ).toHaveCount(0);
    await page.locator("textarea").first().fill("测试主流模型表单");
    for (const mode of [model.text, model.reference]) {
      if (mode === model.reference) {
        await page
          .getByLabel("从素材库选择参考图片")
          .selectOption({ label: "model-reference.png" });
        await expect(
          page.locator(".studio-surface img[src^='blob:']").first(),
        ).toBeVisible();
        // Switching to the reference endpoint must keep the same model family.
        await expect(
          page.getByRole("button", { name: new RegExp(model.name) }),
        ).toBeVisible();
        if (model.duration) {
          const durationButton = page.getByRole("button", {
            name: `${model.duration}s`,
            exact: true,
          });
          if (!(await durationButton.count())) {
            await page
              .getByRole("button", {
                name: `${model.defaultDuration}s`,
                exact: true,
              })
              .click();
            await page
              .getByRole("menuitemradio", {
                name: `${model.duration}s`,
                exact: true,
              })
              .click();
          }
        }
      }
      if (model.name === "Seedance 2.0") {
        await page.getByRole("button", { name: "16:9", exact: true }).click();
        await page
          .getByRole("menuitemradio", { name: "9:16", exact: true })
          .click();
      }
      const submitted = page.waitForRequest(
        (r) => r.url().endsWith("/api/jobs") && r.method() === "POST",
      );
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/api/jobs") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "生成", exact: true }).click();
      const payload = (await submitted).postDataJSON();
      expect(payload.modelKey).toBe(`${model.prefix}.${mode}.v1`);
      expect(payload.assetIds).toHaveLength(mode === model.reference ? 1 : 0);
      if (model.duration)
        expect(payload.parameters.durationSeconds).toBe(Number(model.duration));
      if (model.name === "Seedance 2.0")
        expect(payload.parameters.aspectRatio).toBe("9:16");
      expect((await response).status()).toBe(503);
    }
    await page.reload();
    await expect(
      page.getByRole("button", { name: new RegExp(model.name) }),
    ).toBeVisible();
    await expect(
      page.locator(".studio-surface img[src^='blob:']").first(),
    ).toBeVisible();
    if (model.duration)
      await expect(
        page.getByRole("button", { name: `${model.duration}s`, exact: true }),
      ).toBeVisible();
    if (model.name === "Seedance 2.0")
      await expect(
        page.getByRole("button", { name: "9:16", exact: true }),
      ).toBeVisible();
  }
  await page.screenshot({
    path: path.join(evidence, "mainstream-video-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sidebar")).not.toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(evidence, "mainstream-video-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/workflows");
  await page
    .getByTestId("rf__node-image")
    .getByLabel("生成图片模型")
    .selectOption("image.nano-banana-2.t2i.v1");
  for (const key of ["video.seedance-2.i2v.v1", "video.hailuo-2.3.i2v.v1"]) {
    await page
      .getByTestId("rf__node-video")
      .getByLabel("生成视频模型")
      .selectOption(key);
    await page.getByRole("button", { name: "校验", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("校验通过");
  }
  await page.goto("/settings");
  for (const name of [
    "Nano Banana 2",
    "Nano Banana Pro",
    "Seedance 2.0",
    "MiniMax Hailuo 2.3",
  ])
    await expect(
      page.getByRole("heading", {
        name: new RegExp(
          `${name} · ${name.includes("Banana") ? "文生图" : "文生视频"}`,
        ),
      }),
    ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});
test("uploads, voice drafts, previews and reference protection survive reload", async ({
  page,
}) => {
  await page.goto("/voices");
  await page.getByLabel("上传参考录音").setInputFiles({
    name: "sample.wav",
    mimeType: "audio/wav",
    buffer: wav(),
  });
  await page.getByLabel("声音名称", { exact: true }).fill("我的测试声音");
  await expect(page.getByLabel("参考录音", { exact: true })).not.toHaveValue(
    "",
  );
  await page.getByRole("button", { name: "保存声音", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的测试声音", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "我的测试声音", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((a: HTMLAudioElement) => a.duration),
    )
    .toBe(1);
  await page.goto("/studio/voice");
  await page.getByLabel("从声音库选择").selectOption({ label: "我的测试声音" });
  await page.locator("textarea").first().fill("这是新的克隆文本");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/jobs") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "生成音轨", exact: true }).click();
  expect((await response).status()).toBe(503);
  await expect(page.locator("main [role=alert]")).toContainText(
    "生成接口未配置",
  );
  await page.goto("/assets");
  await page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: "sample.wav", exact: true }),
    })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await expect(page.locator("main [role=alert]")).toContainText(
    "仍被声音或工作流引用",
  );
  await page.getByLabel("上传素材").setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "reference.png", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "assets-desktop.png"),
    fullPage: true,
  });
  for (const [kind, expectedModel] of [
    ["image", "image.flux2.edit.v1"],
    ["video", "video.kling-o3.i2v.v1"],
  ]) {
    await page.goto(`/studio/${kind}`);
    await page
      .getByLabel("从素材库选择参考图片")
      .selectOption({ label: "reference.png" });
    await page.locator("textarea").first().fill("使用参考图片生成");
    await expect(
      page.locator(".studio-surface img[src^='blob:']").first(),
    ).toBeVisible();
    const submitted = page.waitForRequest(
      (r) => r.url().endsWith("/api/jobs") && r.method() === "POST",
    );
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/jobs") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "生成", exact: true }).click();
    expect((await submitted).postDataJSON().modelKey).toBe(expectedModel);
    expect((await response).status()).toBe(503);
    await page.reload();
    await expect(
      page.locator(".studio-surface img[src^='blob:']").first(),
    ).toBeVisible();
  }
  await page.goto("/assets");
  await expect(page.locator("article")).toHaveCount(2);
});
test("workflow editing, validation, versions and JSON import/export work", async ({
  page,
}) => {
  await page.goto("/workflows");
  await expect(page.getByTestId("rf__node-prompt")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page
    .getByTestId("rf__node-prompt")
    .getByRole("textbox")
    .fill("工作流保存测试");
  await page.getByLabel("工作流名称", { exact: true }).fill("我的工作流");
  await page.getByRole("button", { name: "校验", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("校验通过");
  await page.getByRole("button", { name: "保存版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存版本 1");
  await page
    .getByTestId("rf__node-prompt")
    .getByRole("textbox")
    .fill("版本二文本");
  await page.getByRole("button", { name: "保存版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存版本 2");
  await page.getByLabel("恢复历史版本").selectOption("1");
  await expect(
    page.getByTestId("rf__node-prompt").getByRole("textbox"),
  ).toHaveValue("工作流保存测试");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("aivideo-workflow-draft-v1")),
    )
    .toContain("工作流保存测试");
  await page.reload();
  await expect(
    page.getByTestId("rf__node-prompt").getByRole("textbox"),
  ).toHaveValue("工作流保存测试");
  await page.getByTestId("rf__node-image").getByLabel("节点操作").click();
  await page.getByRole("button", { name: "复制节点", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON", exact: true }).click();
  const file = await download;
  const filepath = path.join(evidence, "workflow-export.json");
  await file.saveAs(filepath);
  const exported = JSON.parse(await fs.readFile(filepath, "utf8"));
  expect(exported.nodes).toHaveLength(4);
  expect(exported.nodes[0].data.text).toBe("工作流保存测试");
  await page.getByLabel("导入工作流", { exact: true }).setInputFiles(filepath);
  await expect(page.getByLabel("工作流名称", { exact: true })).toHaveValue(
    "我的工作流 导入",
  );
  await expect(page.getByRole("status")).toContainText("导入成功");
  await page
    .getByRole("button", { name: "图片 → 视频模板", exact: true })
    .click();
  await page.screenshot({
    path: path.join(evidence, "workflow-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "语音克隆模板", exact: true }).click();
  await page.getByRole("button", { name: "校验", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("请选择声音");
  await page.getByRole("button", { name: "新建空白", exact: true }).click();
  await page.getByLabel("添加节点类型").selectOption("input.text");
  await page.getByLabel("添加节点类型").selectOption("generate.image");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await page
    .locator(".react-flow__node")
    .filter({ has: page.getByText("文本输入", { exact: true }) })
    .getByRole("textbox")
    .fill("通过连线输入提示词");
  await page.locator(".react-flow__controls-fitview").click();
  const source = await page
    .locator(".react-flow__handle.source[data-handleid=text]")
    .boundingBox();
  const target = await page
    .locator(".react-flow__handle.target[data-handleid=prompt]")
    .boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(
    source!.x + source!.width / 2,
    source!.y + source!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 15 },
  );
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByRole("button", { name: "校验", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("校验通过 · 2 个节点");
});
test("API validation and configuration never produce fake jobs or expose secrets", async ({
  request,
}) => {
  const config = await request.get("/api/config");
  expect(config.ok()).toBe(true);
  const json = await config.json();
  expect(json.generationEnabled).toBe(false);
  expect(
    json.services.every(
      (s: Record<string, unknown>) => !Object.hasOwn(s, "value"),
    ),
  ).toBe(true);
  expect(
    (
      await request.post("/api/jobs", {
        data: { modelKey: "arbitrary", prompt: "hello" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/jobs", {
        data: { modelKey: "image.flux2.t2i.v1", prompt: "hello" },
      })
    ).status(),
  ).toBe(503);
  expect((await request.get("/api/jobs")).ok()).toBe(true);
  expect((await (await request.get("/api/jobs")).json()).items).toEqual([]);
  expect(
    (
      await request.post("/api/workflows/validate", {
        data: { schemaVersion: 99 },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        data: { email: "test@example.com", password: "anything" },
      })
    ).status(),
  ).toBe(503);
});
test("mobile navigation and media studio fit within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio/image");
  await expect(page.locator("textarea")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.getByRole("link", { name: "工作流", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "工作流", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("rf__node-prompt")).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "workflow-mobile.png"),
    fullPage: true,
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

async function readTasks(page: Page): Promise<LocalTask[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("aivideo-local-workspace-v1", 2);
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction("tasks"),
            read = tx.objectStore("tasks").getAll();
          read.onsuccess = () => resolve(read.result);
          tx.oncomplete = () => db.close();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}
async function seedTask(page: Page, task: LocalTask) {
  await page.waitForFunction(async () =>
    (await indexedDB.databases()).some(
      (db) => db.name === "aivideo-local-workspace-v1" && db.version === 2,
    ),
  );
  await page.evaluate(
    (task) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("aivideo-local-workspace-v1", 2);
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction("tasks", "readwrite");
          tx.objectStore("tasks").put(task);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    task,
  );
}

test("task history persists all three studios and restores model, parameters and references", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/voices");
  await page.getByLabel("上传参考录音").setInputFiles({
    name: "history.wav",
    mimeType: "audio/wav",
    buffer: wav(),
  });
  await page.getByLabel("声音名称", { exact: true }).fill("历史声音");
  await expect(page.getByLabel("参考录音", { exact: true })).not.toHaveValue(
    "",
  );
  await page.getByRole("button", { name: "保存声音", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "历史声音", exact: true }),
  ).toBeVisible();
  for (const kind of ["image", "video", "voice"]) {
    await page.goto(`/studio/${kind}`);
    if (kind === "image") {
      await page.getByRole("button", { name: /FLUX.2/ }).click();
      await page.getByText("Nano Banana 2", { exact: true }).click();
    } else if (kind === "video") {
      await page.getByRole("button", { name: /Kling O3/ }).click();
      await page.getByText("Seedance 2.0", { exact: true }).click();
      await page.getByRole("button", { name: "5s", exact: true }).click();
      await page
        .getByRole("menuitemradio", { name: "15s", exact: true })
        .click();
    } else
      await page.getByLabel("从声音库选择").selectOption({ label: "历史声音" });
    await page.locator("textarea").first().fill(`历史测试 ${kind}`);
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/jobs") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", {
        name: kind === "voice" ? "生成音轨" : "生成",
        exact: true,
      })
      .click();
    expect((await response).status()).toBe(503);
    await expect(page.locator("main [role=alert]")).toContainText(
      "已保存到任务中心",
    );
    await page.goto("/history");
    await page.getByLabel("任务类型").selectOption(kind);
    await expect(page.locator(".task-row")).toHaveCount(1);
    await expect(page.locator(".task-row .task-badge")).toHaveText(
      "待接入 API",
    );
    await page
      .locator(".task-row")
      .getByRole("link", { name: "查看详情" })
      .click();
    await expect(
      page.getByRole("heading", { name: "任务详情", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "尚无生成结果。任务接通并归档完成后，可在这里预览和下载。",
        { exact: true },
      ),
    ).toBeVisible();
    const id = page.url().split("/").at(-1)!;
    await page.reload();
    await expect(page.locator(".task-prompt")).toHaveText(`历史测试 ${kind}`);
    await page.getByRole("button", { name: "复用参数", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/studio/${kind}$`));
    await expect(page.locator("textarea").first()).toHaveValue(
      `历史测试 ${kind}`,
    );
    if (kind === "image")
      await expect(
        page.getByRole("button", { name: /Nano Banana 2/ }),
      ).toBeVisible();
    if (kind === "video") {
      await expect(
        page.getByRole("button", { name: /Seedance 2.0/ }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "15s", exact: true }),
      ).toBeVisible();
    }
    if (kind === "voice")
      await expect(
        page.getByText("history.wav", { exact: true }),
      ).toBeVisible();
    await page.goto(`/jobs/${id}`);
    if (kind === "video") {
      await page.getByRole("button", { name: "重新尝试", exact: true }).click();
      await expect(page).not.toHaveURL(new RegExp(`${id}$`));
      await expect(page.locator(".page-heading .task-badge")).toHaveText(
        "待接入 API",
      );
      const tasks = await readTasks(page);
      const attempts = tasks.filter((t) => t.kind === "video");
      expect(attempts.map((t) => t.attempt).sort()).toEqual([1, 2]);
      expect(new Set(attempts.map((t) => t.groupId)).size).toBe(1);
      expect(attempts[0].request).toEqual(attempts[1].request);
    }
  }
  await page.goto("/jobs");
  await page.getByLabel("搜索任务").fill("历史测试 video");
  await expect(page.locator(".task-row")).toHaveCount(2);
  await page.screenshot({
    path: path.join(evidence, "tasks-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: path.join(evidence, "tasks-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("workflow dry run records DAG checkpoints and frozen snapshots without generated media", async ({
  page,
}) => {
  await page.goto("/workflows");
  await page.getByLabel("工作流名称", { exact: true }).fill("运行测试");
  await page
    .getByLabel("生成图片模型")
    .selectOption("image.nano-banana-2.t2i.v1");
  await page.getByLabel("生成视频模型").selectOption("video.seedance-2.i2v.v1");
  await page.getByLabel("生成视频时长").selectOption("15");
  await page.getByRole("button", { name: "保存版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存版本 1");
  let apiCalls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/jobs") && r.method() === "POST") apiCalls++;
  });
  await page
    .getByRole("button", { name: "试运行（不生成媒体）", exact: true })
    .click();
  await expect(page.locator(".task-row .task-badge")).toHaveText("试运行通过");
  expect(apiCalls).toBe(0);
  await page
    .getByTestId("rf__node-prompt")
    .getByRole("textbox")
    .fill("运行后修改的草稿");
  await page
    .locator(".task-row")
    .getByRole("link", { name: "查看详情" })
    .click();
  await expect(page.locator(".node-runs .task-badge")).toHaveText([
    "检查通过",
    "检查通过",
    "检查通过",
  ]);
  await expect(page.locator(".node-values").last()).toContainText("未生成文件");
  await expect(page.locator(".task-metadata")).toContainText("工作流版本 1");
  await expect(page.locator(".node-values").nth(1)).toContainText(
    "窗边的陶瓷花瓶，自然光",
  );
  await expect(page.locator(".task-detail")).not.toContainText(
    "运行后修改的草稿",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出运行记录", exact: true }).click();
  const file = await download,
    filepath = path.join(evidence, "task-export.json");
  await file.saveAs(filepath);
  const exported = JSON.parse(await fs.readFile(filepath, "utf8"));
  expect(exported.outputAssetIds).toEqual([]);
  expect(exported.nodes[2].inputs.image.planned).toBe(true);
  expect(exported.graph.nodes[2].data.parameters.durationSeconds).toBe(15);
  await page.screenshot({
    path: path.join(evidence, "workflow-run-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: path.join(evidence, "task-detail-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/workflows");
  await page.getByRole("button", { name: "提交生成任务", exact: true }).click();
  await expect(page.locator(".task-row .task-badge").first()).toHaveText(
    "待接入 API",
  );
  expect(apiCalls).toBe(1);
  await page
    .locator(".task-row")
    .first()
    .getByRole("link", { name: "查看详情" })
    .click();
  await expect(page.locator(".node-runs .task-badge")).toHaveText([
    "已完成",
    "等待 API",
    "未执行",
  ]);
});

test("cancellation wins over late response and task references protect local assets", async ({
  page,
}) => {
  await page.goto("/assets");
  await page.getByLabel("上传素材").setInputFiles({
    name: "protected.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.getByRole("heading", { name: "protected.png", exact: true }),
  ).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await gate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "PROVIDER_NOT_CONFIGURED", message: "未配置" },
      }),
    });
  });
  await page.goto("/studio/image");
  await page
    .getByLabel("从素材库选择参考图片")
    .selectOption({ label: "protected.png" });
  await page.locator("textarea").first().fill("取消测试");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect
    .poll(async () => (await readTasks(page))[0]?.status)
    .toBe("running");
  const [task] = await readTasks(page);
  await page.getByRole("link", { name: "任务中心", exact: true }).click();
  await page
    .locator(".task-row")
    .getByRole("link", { name: "查看详情" })
    .click();
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await expect(page.locator(".page-heading .task-badge")).toHaveText("已取消");
  release();
  await expect
    .poll(async () => (await readTasks(page))[0]?.status)
    .toBe("cancelled");
  await page.goto("/assets");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("用于任务记录");
  await page.goto(`/jobs/${task.id}`);
  await page.getByRole("button", { name: "删除记录", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  await page.goto("/assets");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "protected.png", exact: true }),
  ).toHaveCount(0);
});

test("interrupted dry runs resume checkpoints and uncertain provider submissions cannot retry", async ({
  page,
}) => {
  await page.goto("/jobs");
  let task = transitionTask(
    createTask({ graph: createTemplate("image-video"), mode: "dry-run" }),
    "running",
    "开始",
  );
  task = await performWorkflowStep(
    task,
    { assets: [], voices: [] },
    async () => {
      throw new Error("must not call");
    },
  );
  const first = structuredClone(task.nodes[0]);
  await seedTask(page, task);
  await page.goto(`/jobs/${task.id}`);
  await expect(page.locator(".page-heading .task-badge")).toHaveText("已中断");
  await page.getByRole("button", { name: "继续试运行", exact: true }).click();
  await expect(page.locator(".page-heading .task-badge")).toHaveText(
    "试运行通过",
  );
  expect(
    (await readTasks(page)).find((t) => t.id === task.id)?.nodes[0],
  ).toEqual(first);
  const uncertain = transitionTask(
    createTask({
      request: {
        modelKey: "image.flux2.t2i.v1",
        prompt: "未知状态",
        assetIds: [],
        parameters: {},
      },
    }),
    "running",
    "提交中",
  );
  await seedTask(page, uncertain);
  await page.goto(`/jobs/${uncertain.id}`);
  await expect(page.locator(".page-heading .task-badge")).toHaveText(
    "提交待核对",
  );
  await expect(
    page.getByRole("button", { name: "重新尝试", exact: true }),
  ).toHaveCount(0);
});

test("multiple tabs share task changes and execute a queued submission once", async ({
  page,
  context,
}) => {
  await page.goto("/jobs");
  const other = await context.newPage();
  await other.goto("/jobs");
  let count = 0;
  await context.route("**/api/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    count++;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "PROVIDER_NOT_CONFIGURED", message: "未配置" },
      }),
    });
  });
  const task = createTask({
    request: {
      modelKey: "image.flux2.t2i.v1",
      prompt: "跨页面任务",
      assetIds: [],
      parameters: {},
    },
  });
  await seedTask(page, task);
  await page.reload();
  await other.reload();
  await expect(
    page.getByTestId(`task-${task.id}`).locator(".task-badge"),
  ).toHaveText("待接入 API");
  await expect(
    other.getByTestId(`task-${task.id}`).locator(".task-badge"),
  ).toHaveText("待接入 API");
  expect(count).toBe(1);
  await page
    .getByTestId(`task-${task.id}`)
    .getByRole("link", { name: "查看详情" })
    .click();
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await expect(
    other.getByTestId(`task-${task.id}`).locator(".task-badge"),
  ).toHaveText("已取消");
  await other.close();
});

test("IndexedDB version one assets survive the task-store upgrade", async ({
  page,
}) => {
  await page.goto("/api/health");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("aivideo-local-workspace-v1", 1);
        req.onupgradeneeded = () => {
          for (const name of ["assets", "voices", "workflows"])
            req.result.createObjectStore(name, { keyPath: "id" });
        };
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction("assets", "readwrite");
          tx.objectStore("assets").put({
            id: crypto.randomUUID(),
            name: "legacy.txt.wav",
            kind: "audio",
            mime: "audio/wav",
            bytes: 1,
            createdAt: new Date().toISOString(),
            blob: new Blob(["a"], { type: "audio/wav" }),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
        req.onerror = () => reject(req.error);
      }),
  );
  await page.goto("/assets");
  await expect(
    page.getByRole("heading", { name: "legacy.txt.wav", exact: true }),
  ).toBeVisible();
  await page.goto("/jobs");
  await expect(
    page.getByRole("heading", { name: "还没有任务记录", exact: true }),
  ).toBeVisible();
  expect(await readTasks(page)).toEqual([]);
});
