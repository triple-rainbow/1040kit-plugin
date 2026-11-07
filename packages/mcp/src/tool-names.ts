/** The 1040kit MCP tools (spec §3.1). Skills and docs may reference only these. */
export const TOOL_NAMES = [
  'workspace_init',
  'docs_scan',
  'docs_extract',
  'profile_get',
  'profile_set',
  'interview_next',
  'calc_return',
  'explain_line',
  'deductions_find',
  'expenses_import',
  'scenario_compare',
  'review_checks',
  'forms_fill',
  'filing_prepare',
  'kb_search',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
