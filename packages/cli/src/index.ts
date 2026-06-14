import { Command } from "commander";
import { registerIndexCommand } from "./commands/index-cmd.js";

const program = new Command();

program
  .name("cesium")
  .description("Cesium AI Expert — knowledge-base CLI and MCP server")
  .version("0.1.0");

registerIndexCommand(program);

program.parse();
