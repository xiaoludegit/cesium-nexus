import type { Command } from "commander";
import {
  loadRenderStages,
  buildRenderPipelineGraph,
  validatePipelineDAG,
  getStageDependencies,
  getDownstreamStages,
} from "@cesium-nexus/diagnosis";

export function registerPipelineCommand(program: Command): void {
  program
    .command("pipeline [stage_id]")
    .description("Display the render pipeline graph or a specific stage's dependencies")
    .action(async (stageId?: string) => {
      const stages = await loadRenderStages();
      const graph = buildRenderPipelineGraph(stages);

      if (!validatePipelineDAG(graph)) {
        console.error("Error: Pipeline graph contains cycles!");
        process.exit(1);
      }

      if (stageId) {
        const stage = stages.find((s) => s.id === stageId);
        if (!stage) {
          console.log(`Stage "${stageId}" not found.`);
          return;
        }

        const flags = [
          stage.perfHotspot ? "perf" : null,
          stage.isOptional ? "optional" : null,
        ]
          .filter(Boolean)
          .join(", ");

        console.log(`\n${stage.order}. ${stage.name}${flags ? ` [${flags}]` : ""}`);
        console.log(`   ${stage.description}`);
        console.log(`   key symbols: ${stage.keySymbols.join(", ")}`);

        const deps = getStageDependencies(stageId, stages);
        if (deps.length > 0) {
          console.log(`\n   Upstream dependencies:`);
          for (const d of deps) {
            console.log(`     <- ${d.name} (${d.id})`);
          }
        }

        const downstream = getDownstreamStages(stageId, stages);
        if (downstream.length > 0) {
          console.log(`\n   Downstream dependents:`);
          for (const d of downstream) {
            console.log(`     -> ${d.name} (${d.id})`);
          }
        }

        return;
      }

      console.log("Cesium Render Pipeline:\n");
      for (const stage of stages) {
        const flags = [
          stage.perfHotspot ? "perf" : null,
          stage.isOptional ? "optional" : null,
        ]
          .filter(Boolean)
          .join(", ");

        const depNames = stage.dependsOn.length > 0
          ? `dependsOn: <- ${stage.dependsOn.join(", ")}`
          : "dependsOn: —";

        console.log(
          `  ${stage.order}. ${stage.name}${flags ? ` [${flags}]` : ""}`,
        );
        console.log(`     ${depNames}`);
        console.log(`     keySymbols: ${stage.keySymbols.slice(0, 3).join(", ")}${stage.keySymbols.length > 3 ? "..." : ""}`);
      }

      console.log(`\n  Total: ${stages.length} stages, ${graph.edges.length} edges`);
      console.log(`  DAG valid: ${validatePipelineDAG(graph)}`);
    });
}
