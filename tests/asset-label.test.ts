import { expect, it } from "vitest";
import { assetOptionLabel } from "../packages/core/src/asset-label";

it("distinguishes same-name media archived in the same batch", () => {
  const first = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "result.png",
    createdAt: "2026-10-14T13:00:00.000Z",
  };
  const second = {
    ...first,
    id: "22222222-2222-4222-8222-222222222222",
  };
  expect(assetOptionLabel(first)).not.toBe(assetOptionLabel(second));
  expect(assetOptionLabel(first)).toContain(first.name);
  expect(assetOptionLabel(second)).toContain(second.name);
});
