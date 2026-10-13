import { readdirSync } from "node:fs";
import { SOURCE_DIR } from "./paths.ts";

// Placeholder until milestone 2: list what would be converted.
const files = readdirSync(SOURCE_DIR).filter((name) => name.endsWith(".json"));
console.log(`${files.length} source files in ${SOURCE_DIR}`);
console.log("Conversion is not implemented yet (milestones 1–5).");
