"use client";
import { useEffect, useState } from "react";
import { startLocalTaskRunner } from "@aivideo/core/task-client";
export function TaskRuntime() {
  const [error, setError] = useState("");
  useEffect(() => startLocalTaskRunner(setError), []);
  return error ? (
    <p className="error-message runtime-error" role="alert">
      本地任务调度：{error}
    </p>
  ) : null;
}
