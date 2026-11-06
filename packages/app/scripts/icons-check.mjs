import { checkIcons } from "./icon-pipeline.mjs";

try {
  await checkIcons();
  console.log("CBE Toolbox icon outputs are complete, valid and byte-fresh.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
