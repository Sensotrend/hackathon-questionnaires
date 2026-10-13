import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOURCE_DIR } from "./paths.ts";

describe("SOURCE_DIR", () => {
  it("points at the 15 source exports", () => {
    const files = readdirSync(SOURCE_DIR).filter((name) => name.endsWith(".json"));
    expect(files).toHaveLength(15);
  });
});
