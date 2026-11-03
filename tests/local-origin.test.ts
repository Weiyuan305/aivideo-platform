import { it, expect } from "vitest";
import { matchesLocalOrigin } from "../packages/server/src/origin";
it.each([
  [
    "http://127.0.0.1:3000/api/jobs",
    "127.0.0.1:3000",
    "http://127.0.0.1:3000",
    true,
  ],
  [
    "http://localhost:3000/api/jobs",
    "127.0.0.1:3000",
    "http://127.0.0.1:3000",
    true,
  ],
  [
    "http://localhost:3000/api/jobs",
    "evil.invalid:3000",
    "http://127.0.0.1:3000",
    false,
  ],
  [
    "http://localhost:3001/api/jobs",
    "127.0.0.1:3000",
    "http://127.0.0.1:3000",
    false,
  ],
  [
    "https://localhost:3000/api/jobs",
    "127.0.0.1:3000",
    "http://127.0.0.1:3000",
    false,
  ],
  [
    "http://evil.invalid:3000/api/jobs",
    "127.0.0.1:3000",
    "http://127.0.0.1:3000",
    false,
  ],
  [
    "http://localhost:3000/api/jobs",
    "example.com",
    "https://example.com",
    false,
  ],
] as const)(
  "checks normalized loopback URLs against the original Host: %s %s",
  (url, host, origin, expected) => {
    expect(
      matchesLocalOrigin(new Request(url, { headers: { Host: host } }), origin),
    ).toBe(expected);
  },
);
