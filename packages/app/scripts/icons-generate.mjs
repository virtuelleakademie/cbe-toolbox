import { generateIcons } from "./icon-pipeline.mjs";

try {
  await generateIcons();
  console.log("Generated the committed CBE Toolbox icon set from the approved SVG.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
