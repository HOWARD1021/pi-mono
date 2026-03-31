#!/usr/bin/env node
import { orchestrate } from "./src/index.js";

const specPath = process.argv[2];

if (!specPath) {
  console.error("Usage: orchestrate <spec.md>");
  process.exit(1);
}

orchestrate(specPath).catch((e) => {
  console.error("[Orchestrator] Fatal error:", e.message);
  process.exit(1);
});
