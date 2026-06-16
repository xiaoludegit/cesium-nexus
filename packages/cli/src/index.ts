import { Command } from "commander";
import { registerIndexCommand } from "./commands/index-cmd.js";
import { registerQueryCommands } from "./commands/query-cmd.js";
import { registerIssueCommands } from "./commands/issue-cmd.js";
import { registerTraceCommand } from "./commands/trace-cmd.js";
import { registerMcpCommand } from "./commands/mcp-cmd.js";
import { registerContextCommand } from "./commands/context-cmd.js";

const program = new Command();

program
  .name("cesium")
  .description("Cesium AI Expert — knowledge-base CLI and MCP server")
  .version("0.1.0");

registerIndexCommand(program);
registerQueryCommands(program);
registerIssueCommands(program);
registerTraceCommand(program);
registerMcpCommand(program);
registerContextCommand(program);

program.parse();
