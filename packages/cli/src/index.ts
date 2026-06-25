import { Command } from "commander";
import { registerIndexCommand } from "./commands/index-cmd.js";
import { registerQueryCommands } from "./commands/query-cmd.js";
import { registerIssueCommands } from "./commands/issue-cmd.js";
import { registerTraceCommand } from "./commands/trace-cmd.js";
import { registerMcpCommand } from "./commands/mcp-cmd.js";
import { registerContextCommand } from "./commands/context-cmd.js";
import { registerDiagnoseCommand } from "./commands/diagnose-cmd.js";
import { registerForumCommands } from "./commands/forum-cmd.js";
import { registerSkillCommands } from "./commands/skill-cmd.js";
import { registerPipelineCommand } from "./commands/pipeline-cmd.js";
import { registerExperienceCommands } from "./commands/experience-cmd.js";
import { registerVersionCommands } from "./commands/version-cmd.js";
import { registerShaderCommand } from "./commands/shader-cmd.js";
import { registerDiagnoseReasonCommand } from "./commands/diagnose-reason-cmd.js";

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
registerDiagnoseCommand(program);
registerForumCommands(program);
registerSkillCommands(program);
registerPipelineCommand(program);
registerExperienceCommands(program);
registerVersionCommands(program);
registerShaderCommand(program);
registerDiagnoseReasonCommand(program);

program.parse();
