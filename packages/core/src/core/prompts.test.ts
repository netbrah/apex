/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCoreSystemPrompt } from './prompts.js';
import { resolvePathFromEnv } from '../prompts/utils.js';
import { isGitRepository } from '../utils/gitUtils.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../config/config.js';
import type { AgentDefinition } from '../agents/types.js';
import { CodebaseInvestigatorAgent } from '../agents/codebase-investigator.js';
import { APEX_DIR } from '../utils/paths.js';
import { debugLogger } from '../utils/debugLogger.js';
import {
  PREVIEW_GEMINI_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL_AUTO,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
} from '../config/models.js';
import { ApprovalMode } from '../policy/types.js';
import { DiscoveredMCPTool } from '../tools/mcp-tool.js';
import type { AnyDeclarativeTool } from '../tools/tools.js';
import type { CallableTool } from '@google/genai';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

// Mock tool names if they are dynamically generated or complex
vi.mock('../tools/ls', () => ({ LSTool: { Name: 'list_directory' } }));
vi.mock('../tools/edit', () => ({ EditTool: { Name: 'edit' } }));
vi.mock('../tools/glob', () => ({ GlobTool: { Name: 'glob' } }));
vi.mock('../tools/grep', () => ({ GrepTool: { Name: 'grep_search' } }));
vi.mock('../tools/read-file', () => ({ ReadFileTool: { Name: 'read_file' } }));
vi.mock('../tools/read-many-files', () => ({
  ReadManyFilesTool: { Name: 'read_many_files' },
}));
vi.mock('../tools/shell', () => ({
  ShellTool: class {
    static readonly Name = 'run_shell_command';
    name = 'run_shell_command';
  },
}));
vi.mock('../tools/write-file', () => ({
  WriteFileTool: { Name: 'write_file' },
}));
vi.mock('../agents/codebase-investigator.js', () => ({
  CodebaseInvestigatorAgent: { name: 'codebase_investigator' },
}));
vi.mock('../utils/gitUtils', () => ({
  isGitRepository: vi.fn().mockReturnValue(false),
}));
vi.mock('node:fs');
vi.mock('../config/models.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
  };
});

describe('Core System Prompt (prompts.ts)', () => {
  const mockPlatform = (platform: string) => {
    vi.stubGlobal(
      'process',
      Object.create(process, {
        platform: {
          get: () => platform,
        },
      }),
    );
  };

  let mockConfig: Config;
  beforeEach(() => {
    vi.resetAllMocks();
    // Stub process.platform to 'linux' by default for deterministic snapshots across OSes
    mockPlatform('linux');

    vi.stubEnv('SANDBOX', undefined);
    vi.stubEnv('GEMINI_SYSTEM_MD', undefined);
    vi.stubEnv('GEMINI_WRITE_SYSTEM_MD', undefined);
    const mockRegistry = {
      getAllToolNames: vi.fn().mockReturnValue(['grep_search', 'glob']),
      getAllTools: vi.fn().mockReturnValue([]),
    };
    mockConfig = {
      getToolRegistry: vi.fn().mockReturnValue(mockRegistry),
      getEnableShellOutputEfficiency: vi.fn().mockReturnValue(true),
      getSandboxEnabled: vi.fn().mockReturnValue(false),
      storage: {
        getProjectTempDir: vi.fn().mockReturnValue('/tmp/project-temp'),
        getPlansDir: vi.fn().mockReturnValue('/tmp/project-temp/plans'),
        getProjectTempTrackerDir: vi
          .fn()
          .mockReturnValue('/mock/.apex/tmp/session/tracker'),
      },
      isInteractive: vi.fn().mockReturnValue(true),
      isInteractiveShellEnabled: vi.fn().mockReturnValue(true),
      isTopicUpdateNarrationEnabled: vi.fn().mockReturnValue(false),
      isMemoryManagerEnabled: vi.fn().mockReturnValue(false),
      isAgentsEnabled: vi.fn().mockReturnValue(false),
      getPreviewFeatures: vi.fn().mockReturnValue(true),
      getModel: vi.fn().mockReturnValue(DEFAULT_GEMINI_MODEL_AUTO),
      getActiveModel: vi.fn().mockReturnValue(DEFAULT_GEMINI_MODEL),
      getMessageBus: vi.fn(),
      getAgentRegistry: vi.fn().mockReturnValue({
        getDirectoryContext: vi.fn().mockReturnValue('Mock Agent Directory'),
        getAllDefinitions: vi.fn().mockReturnValue([
          {
            name: 'mock-agent',
            description: 'Mock Agent Description',
          },
        ]),
      }),
      getSkillManager: vi.fn().mockReturnValue({
        getSkills: vi.fn().mockReturnValue([]),
      }),
      getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
      getApprovedPlanPath: vi.fn().mockReturnValue(undefined),
      isTrackerEnabled: vi.fn().mockReturnValue(false),
      get config() {
        return this;
      },
      get toolRegistry() {
        return mockRegistry;
      },
    } as unknown as Config;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should include available_skills when provided in config', () => {
    const skills = [
      {
        name: 'test-skill',
        description: 'A test skill description',
        location: '/path/to/test-skill/SKILL.md',
        body: 'Skill content',
      },
    ];
    vi.mocked(mockConfig.getSkillManager().getSkills).mockReturnValue(skills);
    const prompt = getCoreSystemPrompt(mockConfig);

    expect(prompt).toContain('# Available Agent Skills');
    expect(prompt).toContain(
      "To activate a skill and receive its detailed instructions, you can call the `activate_skill` tool with the skill's name.",
    );
    expect(prompt).toContain('Skill Guidance');
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('<skill>');
    expect(prompt).toContain('<name>test-skill</name>');
    expect(prompt).toContain(
      '<description>A test skill description</description>',
    );
    expect(prompt).toContain(
      '<location>/path/to/test-skill/SKILL.md</location>',
    );
    expect(prompt).toContain('</skill>');
    expect(prompt).toContain('</available_skills>');
    expect(prompt).toMatchSnapshot();
  });

  it('should include available_skills with updated verbiage for preview models', () => {
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(PREVIEW_GEMINI_MODEL);
    const skills = [
      {
        name: 'test-skill',
        description: 'A test skill description',
        location: '/path/to/test-skill/SKILL.md',
        body: 'Skill content',
      },
    ];
    vi.mocked(mockConfig.getSkillManager().getSkills).mockReturnValue(skills);
    const prompt = getCoreSystemPrompt(mockConfig);

    expect(prompt).toContain('# Available Agent Skills');
    expect(prompt).toContain(
      "To activate a skill and receive its detailed instructions, call the `activate_skill` tool with the skill's name.",
    );
    expect(prompt).toMatchSnapshot();
  });

  it('should NOT include skill guidance or available_skills when NO skills are provided', () => {
    vi.mocked(mockConfig.getSkillManager().getSkills).mockReturnValue([]);
    const prompt = getCoreSystemPrompt(mockConfig);

    expect(prompt).not.toContain('# Available Agent Skills');
    expect(prompt).not.toContain('Skill Guidance');
    expect(prompt).not.toContain('activate_skill');
  });

  it('should include sub-agents in XML for preview models', () => {
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(PREVIEW_GEMINI_MODEL);
    const agents = [
      {
        name: 'test-agent',
        displayName: 'Test Agent',
        description: 'A test agent description',
      },
    ];
    vi.mocked(mockConfig.getAgentRegistry().getAllDefinitions).mockReturnValue(
      agents as unknown as AgentDefinition[],
    );
    const prompt = getCoreSystemPrompt(mockConfig);

    expect(prompt).toContain('# Available Sub-Agents');
    expect(prompt).toContain('<available_subagents>');
    expect(prompt).toContain('<subagent>');
    expect(prompt).toContain('<name>test-agent</name>');
    expect(prompt).toContain(
      '<description>A test agent description</description>',
    );
    expect(prompt).toContain('</subagent>');
    expect(prompt).toContain('</available_subagents>');
    expect(prompt).toMatchSnapshot();
  });

  it('should use legacy system prompt for non-preview model', () => {
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(
      DEFAULT_GEMINI_FLASH_LITE_MODEL,
    );
    const prompt = getCoreSystemPrompt(mockConfig);
    expect(prompt).toContain(
      'You are an interactive CLI agent specializing in software engineering tasks.',
    );
    expect(prompt).not.toContain('No sub-agents are currently available.');
    expect(prompt).toContain('# Core Mandates');
    expect(prompt).toContain('- **Conventions:**');
    expect(prompt).toContain('- **User Hints:**');
    expect(prompt).toContain('# Outside of Sandbox');
    expect(prompt).toContain('# Final Reminder');
    expect(prompt).toMatchSnapshot();
  });

  it('should include the TASK MANAGEMENT PROTOCOL in legacy prompt when task tracker is enabled', () => {
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(
      DEFAULT_GEMINI_FLASH_LITE_MODEL,
    );
    vi.mocked(mockConfig.isTrackerEnabled).mockReturnValue(true);
    const prompt = getCoreSystemPrompt(mockConfig);
    expect(prompt).toContain('# TASK MANAGEMENT PROTOCOL');
    expect(prompt).toContain(
      '**PLAN MODE INTEGRATION**: If an approved plan exists, you MUST use the `tracker_create_task` tool',
    );
    expect(prompt).toMatchSnapshot();
  });

  it('should include the TASK MANAGEMENT PROTOCOL when task tracker is enabled', () => {
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(PREVIEW_GEMINI_MODEL);
    vi.mocked(mockConfig.isTrackerEnabled).mockReturnValue(true);
    const prompt = getCoreSystemPrompt(mockConfig);
    expect(prompt).toContain('# TASK MANAGEMENT PROTOCOL');
    expect(prompt).toContain(
      '**PLAN MODE INTEGRATION**: If an approved plan exists, you MUST use the `tracker_create_task` tool to decompose it into discrete tasks before writing any code',
    );
    expect(prompt).toMatchSnapshot();
  });

  it('should use chatty system prompt for preview model', () => {
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(PREVIEW_GEMINI_MODEL);
    const prompt = getCoreSystemPrompt(mockConfig);
    expect(prompt).toContain('You are Gemini CLI, an interactive CLI agent'); // Check for core content
    expect(prompt).toContain('- **User Hints:**');
    expect(prompt).toContain('No Chitchat:');
    expect(prompt).toMatchSnapshot();
  });

  it('should use chatty system prompt for preview flash model', () => {
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(
      PREVIEW_GEMINI_FLASH_MODEL,
    );
    const prompt = getCoreSystemPrompt(mockConfig);
    expect(prompt).toContain('You are Gemini CLI, an interactive CLI agent'); // Check for core content
    expect(prompt).toContain('No Chitchat:');
    expect(prompt).toMatchSnapshot();
  });

  it('should include mandate to distinguish between Directives and Inquiries', () => {
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(PREVIEW_GEMINI_MODEL);
    const prompt = getCoreSystemPrompt(mockConfig);

    expect(prompt).toContain('Distinguish between **Directives**');
    expect(prompt).toContain('and **Inquiries**');
    expect(prompt).toContain(
      'Assume all requests are Inquiries unless they contain an explicit instruction to perform a task.',
    );
    expect(prompt).toMatchSnapshot();
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   \n  \t '],
  ])('should return the base prompt when userMemory is %s', (_, userMemory) => {
    vi.stubEnv('SANDBOX', undefined);
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(PREVIEW_GEMINI_MODEL);
    const prompt = getCoreSystemPrompt(mockConfig, userMemory);
    expect(prompt).not.toContain('---\n\n'); // Separator should not be present
    expect(prompt).toContain('You are Gemini CLI, an interactive CLI agent'); // Check for core content
    expect(prompt).toContain('No Chitchat:');
    expect(prompt).toMatchSnapshot(); // Use snapshot for base prompt structure
  });

  it('should append userMemory with separator when provided', () => {
    vi.stubEnv('SANDBOX', undefined);
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(PREVIEW_GEMINI_MODEL);
    const memory = 'This is custom user memory.\nBe extra polite.';
    const prompt = getCoreSystemPrompt(mockConfig, memory);

    expect(prompt).toContain('# Contextual Instructions (APEX.md)');
    expect(prompt).toContain('<loaded_context>');
    expect(prompt).toContain(memory);
    expect(prompt).toContain('You are Gemini CLI, an interactive CLI agent'); // Ensure base prompt follows
    expect(prompt).toMatchSnapshot(); // Snapshot the combined prompt
  });

  it('should render hierarchical memory with XML tags', () => {
    vi.stubEnv('SANDBOX', undefined);
    const memory = {
      global: 'global context',
      extension: 'extension context',
      project: 'project context',
    };
    const prompt = getCoreSystemPrompt(mockConfig, memory);

    expect(prompt).toContain(
      '<global_context>\nglobal context\n</global_context>',
    );
    expect(prompt).toContain(
      '<extension_context>\nextension context\n</extension_context>',
    );
    expect(prompt).toContain(
      '<project_context>\nproject context\n</project_context>',
    );
    expect(prompt).toMatchSnapshot();
    // Should also include conflict resolution rules when hierarchical memory is present
    expect(prompt).toContain('Conflict Resolution:');
  });

  it('should match snapshot on Windows', () => {
    mockPlatform('win32');
    vi.stubEnv('SANDBOX', undefined);
    const prompt = getCoreSystemPrompt(mockConfig);
    expect(prompt).toMatchSnapshot();
  });

  it.each([
    ['true', '# Sandbox', ['# macOS Seatbelt', '# Outside of Sandbox']],
    ['sandbox-exec', '# macOS Seatbelt', ['# Sandbox', '# Outside of Sandbox']],
    [
      undefined,
      'You are Gemini CLI, an interactive CLI agent',
      ['# Sandbox', '# macOS Seatbelt'],
    ],
  ])(
    'should include correct sandbox instructions for SANDBOX=%s',
    (sandboxValue, expectedContains, expectedNotContains) => {
      vi.stubEnv('SANDBOX', sandboxValue);
      vi.mocked(mockConfig.getActiveModel).mockReturnValue(
        PREVIEW_GEMINI_MODEL,
      );
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).toContain(expectedContains);

      // modern snippets should NOT contain outside
      expect(prompt).not.toContain('# Outside of Sandbox');

      expectedNotContains.forEach((text) => expect(prompt).not.toContain(text));
      expect(prompt).toMatchSnapshot();
    },
  );

  it.each([
    [true, true],
    [false, false],
  ])(
    'should handle git instructions when isGitRepository=%s',
    (isGitRepo, shouldContainGit) => {
      vi.stubEnv('SANDBOX', undefined);
      vi.mocked(isGitRepository).mockReturnValue(isGitRepo);
      const prompt = getCoreSystemPrompt(mockConfig);
      shouldContainGit
        ? expect(prompt).toContain('# Git Repository')
        : expect(prompt).not.toContain('# Git Repository');
      expect(prompt).toMatchSnapshot();
    },
  );

  it('should return the interactive avoidance prompt when in non-interactive mode', () => {
    vi.stubEnv('SANDBOX', undefined);
    mockConfig.isInteractive = vi.fn().mockReturnValue(false);
    const prompt = getCoreSystemPrompt(mockConfig, '');
    expect(prompt).toContain('**Interactive Commands:**'); // Check for interactive prompt
    expect(prompt).toMatchSnapshot(); // Use snapshot for base prompt structure
  });

  it('should redact grep and glob from the system prompt when they are disabled', () => {
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(PREVIEW_GEMINI_MODEL);
    vi.mocked(mockConfig.toolRegistry.getAllToolNames).mockReturnValue([]);
    const prompt = getCoreSystemPrompt(mockConfig);

    expect(prompt).not.toContain('`grep_search`');
    expect(prompt).not.toContain('`glob`');
    expect(prompt).toContain(
      'Use search tools extensively to understand file structures, existing code patterns, and conventions.',
    );
  });

  it.each([
    [[CodebaseInvestigatorAgent.name, 'grep_search', 'glob'], true],
    [['grep_search', 'glob'], false],
  ])(
    'should handle CodebaseInvestigator with tools=%s',
    (toolNames, expectCodebaseInvestigator) => {
      const mockToolRegistry = {
        getAllToolNames: vi.fn().mockReturnValue(toolNames),
      };
      const testConfig = {
        getToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
        getEnableShellOutputEfficiency: vi.fn().mockReturnValue(true),
        getSandboxEnabled: vi.fn().mockReturnValue(false),
        storage: {
          getProjectTempDir: vi.fn().mockReturnValue('/tmp/project-temp'),
        },
        isInteractive: vi.fn().mockReturnValue(false),
        isInteractiveShellEnabled: vi.fn().mockReturnValue(false),
        isTopicUpdateNarrationEnabled: vi.fn().mockReturnValue(false),
        isMemoryManagerEnabled: vi.fn().mockReturnValue(false),
        isAgentsEnabled: vi.fn().mockReturnValue(false),
        getModel: vi.fn().mockReturnValue('auto'),
        getActiveModel: vi.fn().mockReturnValue(PREVIEW_GEMINI_MODEL),
        getPreviewFeatures: vi.fn().mockReturnValue(true),
        getAgentRegistry: vi.fn().mockReturnValue({
          getDirectoryContext: vi.fn().mockReturnValue('Mock Agent Directory'),
          getAllDefinitions: vi.fn().mockReturnValue([]),
        }),
        getSkillManager: vi.fn().mockReturnValue({
          getSkills: vi.fn().mockReturnValue([]),
        }),
        getApprovedPlanPath: vi.fn().mockReturnValue(undefined),
        isTrackerEnabled: vi.fn().mockReturnValue(false),
        get config() {
          return this;
        },
        get toolRegistry() {
          return mockToolRegistry;
        },
      } as unknown as Config;

      const prompt = getCoreSystemPrompt(testConfig);
      if (expectCodebaseInvestigator) {
        expect(prompt).toContain(
          `Utilize specialized sub-agents (e.g., \`codebase_investigator\`) as the primary mechanism for initial discovery`,
        );
        expect(prompt).not.toContain(
          'Use `grep_search` and `glob` search tools extensively',
        );
      } else {
        expect(prompt).not.toContain(
          `Utilize specialized sub-agents (e.g., \`codebase_investigator\`) as the primary mechanism for initial discovery`,
        );
        expect(prompt).toContain(
          'Use `grep_search` and `glob` search tools extensively',
        );
      }
      expect(prompt).toMatchSnapshot();
    },
  );

  describe('ApprovalMode in System Prompt', () => {
    // Shared plan mode test fixtures
    const readOnlyMcpTool = new DiscoveredMCPTool(
      {} as CallableTool,
      'readonly-server',
      'read_data',
      'A read-only MCP tool',
      {},
      {} as MessageBus,
      false,
      true, // isReadOnly
    );

    // Represents the full set of tools allowed by plan.toml policy
    // (including a read-only MCP tool that passes annotation matching).
    // Non-read-only MCP tools are excluded by the policy engine and
    // never appear in getAllTools().
    const planModeTools = [
      { name: 'glob' },
      { name: 'grep_search' },
      { name: 'read_file' },
      { name: 'ask_user' },
      { name: 'exit_plan_mode' },
      { name: 'write_file' },
      { name: 'replace' },
      readOnlyMcpTool,
    ] as unknown as AnyDeclarativeTool[];

    const setupPlanMode = () => {
      vi.mocked(mockConfig.getActiveModel).mockReturnValue(
        PREVIEW_GEMINI_MODEL,
      );
      vi.mocked(mockConfig.getApprovalMode).mockReturnValue(ApprovalMode.PLAN);
      vi.mocked(mockConfig.toolRegistry.getAllTools).mockReturnValue(
        planModeTools,
      );
    };

    it('should include PLAN mode instructions', () => {
      setupPlanMode();
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).toContain('# Active Approval Mode: Plan');
      // Read-only MCP tool should appear with server name
      expect(prompt).toContain(
        '`mcp_readonly-server_read_data` (readonly-server)',
      );
      // Non-read-only MCP tool should not appear (excluded by policy)
      expect(prompt).not.toContain(
        '`mcp_nonreadonly-server_write_data` (nonreadonly-server)',
      );
      expect(prompt).toMatchSnapshot();
    });

    it('should NOT include approval mode instructions for DEFAULT mode', () => {
      vi.mocked(mockConfig.getApprovalMode).mockReturnValue(
        ApprovalMode.DEFAULT,
      );
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).not.toContain('# Active Approval Mode: Plan');
      expect(prompt).toMatchSnapshot();
    });

    it('should include read-only MCP tools but not non-read-only MCP tools in PLAN mode', () => {
      setupPlanMode();

      const prompt = getCoreSystemPrompt(mockConfig);

      expect(prompt).toContain(
        '`mcp_readonly-server_read_data` (readonly-server)',
      );
      expect(prompt).not.toContain(
        '`mcp_nonreadonly-server_write_data` (nonreadonly-server)',
      );
    });

    it('should only list available tools in PLAN mode', () => {
      // Use a smaller subset than the full planModeTools to verify
      // that only tools returned by getAllTools() appear in the prompt.
      const subsetTools = [
        { name: 'glob' },
        { name: 'read_file' },
        { name: 'ask_user' },
      ] as unknown as AnyDeclarativeTool[];
      vi.mocked(mockConfig.getActiveModel).mockReturnValue(
        PREVIEW_GEMINI_MODEL,
      );
      vi.mocked(mockConfig.getApprovalMode).mockReturnValue(ApprovalMode.PLAN);
      vi.mocked(mockConfig.toolRegistry.getAllTools).mockReturnValue(
        subsetTools,
      );

      const prompt = getCoreSystemPrompt(mockConfig);

      // Should include enabled tools
      expect(prompt).toContain('`glob`');
      expect(prompt).toContain('`read_file`');
      expect(prompt).toContain('`ask_user`');

      // Should NOT include tools not in getAllTools()
      expect(prompt).not.toContain('`google_web_search`');
      expect(prompt).not.toContain('`list_directory`');
      expect(prompt).not.toContain('`grep_search`');
    });

    describe('Approved Plan in Plan Mode', () => {
      beforeEach(() => {
        setupPlanMode();
        vi.mocked(mockConfig.storage.getPlansDir).mockReturnValue('/tmp/plans');
      });

      it('should include approved plan path when set in config', () => {
        const planPath = '/tmp/plans/feature-x.md';
        vi.mocked(mockConfig.getApprovedPlanPath).mockReturnValue(planPath);

        const prompt = getCoreSystemPrompt(mockConfig);
        expect(prompt).toMatchSnapshot();
      });

      it('should NOT include approved plan section if no plan is set in config', () => {
        vi.mocked(mockConfig.getApprovedPlanPath).mockReturnValue(undefined);

        const prompt = getCoreSystemPrompt(mockConfig);
        expect(prompt).toMatchSnapshot();
      });
    });

    it('should include YOLO mode instructions in interactive mode', () => {
      vi.mocked(mockConfig.getApprovalMode).mockReturnValue(ApprovalMode.YOLO);
      vi.mocked(mockConfig.isInteractive).mockReturnValue(true);
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).toContain('# Autonomous Mode (YOLO)');
      expect(prompt).toContain('Only use the `ask_user` tool if');
    });

    it('should NOT include YOLO mode instructions in non-interactive mode', () => {
      vi.mocked(mockConfig.getApprovalMode).mockReturnValue(ApprovalMode.YOLO);
      vi.mocked(mockConfig.isInteractive).mockReturnValue(false);
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).not.toContain('# Autonomous Mode (YOLO)');
    });

    it('should NOT include YOLO mode instructions for DEFAULT mode', () => {
      vi.mocked(mockConfig.getApprovalMode).mockReturnValue(
        ApprovalMode.DEFAULT,
      );
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).not.toContain('# Autonomous Mode (YOLO)');
    });
  });

  describe('Platform-specific and Background Process instructions', () => {
    it('should include Windows-specific shell efficiency commands on win32', () => {
      mockPlatform('win32');
      vi.mocked(mockConfig.getActiveModel).mockReturnValue(
        DEFAULT_GEMINI_FLASH_LITE_MODEL,
      );
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).toContain(
        "using commands like 'type' or 'findstr' (on CMD) and 'Get-Content' or 'Select-String' (on PowerShell)",
      );
      expect(prompt).not.toContain(
        "using commands like 'grep', 'tail', 'head'",
      );
    });

    it('should include generic shell efficiency commands on non-Windows', () => {
      mockPlatform('linux');
      vi.mocked(mockConfig.getActiveModel).mockReturnValue(
        DEFAULT_GEMINI_FLASH_LITE_MODEL,
      );
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).toContain("using commands like 'grep', 'tail', 'head'");
      expect(prompt).not.toContain(
        "using commands like 'type' or 'findstr' (on CMD) and 'Get-Content' or 'Select-String' (on PowerShell)",
      );
    });

    it('should use is_background parameter in background process instructions', () => {
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).toContain(
        'To run a command in the background, set the `is_background` parameter to true.',
      );
      expect(prompt).not.toContain('via `&`');
    });

    it("should include 'tab' instructions when interactive shell is enabled", () => {
      vi.mocked(mockConfig.getActiveModel).mockReturnValue(
        PREVIEW_GEMINI_MODEL,
      );
      vi.mocked(mockConfig.isInteractive).mockReturnValue(true);
      vi.mocked(mockConfig.isInteractiveShellEnabled).mockReturnValue(true);
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).toContain('tab');
    });

    it("should NOT include 'tab' instructions when interactive shell is disabled", () => {
      vi.mocked(mockConfig.getActiveModel).mockReturnValue(
        PREVIEW_GEMINI_MODEL,
      );
      vi.mocked(mockConfig.isInteractive).mockReturnValue(true);
      vi.mocked(mockConfig.isInteractiveShellEnabled).mockReturnValue(false);
      const prompt = getCoreSystemPrompt(mockConfig);
      expect(prompt).not.toContain('`tab`');
    });
  });

  it('should include approved plan instructions when approvedPlanPath is set', () => {
    const planPath = '/path/to/approved/plan.md';
    vi.mocked(mockConfig.getApprovedPlanPath).mockReturnValue(planPath);
    const prompt = getCoreSystemPrompt(mockConfig);

    expect(prompt).toMatchSnapshot();
  });

  it('should include modern approved plan instructions with completion in DEFAULT mode when approvedPlanPath is set', () => {
    const planPath = '/tmp/plans/feature-x.md';
    vi.mocked(mockConfig.getApprovedPlanPath).mockReturnValue(planPath);
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(PREVIEW_GEMINI_MODEL);
    vi.mocked(mockConfig.getApprovalMode).mockReturnValue(ApprovalMode.DEFAULT);

    const prompt = getCoreSystemPrompt(mockConfig);
    expect(prompt).toContain(
      '2. **Strategy:** An approved plan is available for this task',
    );
    expect(prompt).toContain(
      'provide a **final summary** of the work completed against the plan',
    );
    expect(prompt).toMatchSnapshot();
  });

  it('should include planning phase suggestion when enter_plan_mode tool is enabled', () => {
    vi.mocked(mockConfig.getActiveModel).mockReturnValue(PREVIEW_GEMINI_MODEL);
    vi.mocked(mockConfig.toolRegistry.getAllToolNames).mockReturnValue([
      'enter_plan_mode',
    ]);
    const prompt = getCoreSystemPrompt(mockConfig);

    expect(prompt).toContain(
      'If the request is ambiguous, broad in scope, or involves architectural decisions or cross-cutting changes, use the `enter_plan_mode` tool to safely research and design your strategy. Do NOT use Plan Mode for straightforward bug fixes, answering questions, or simple inquiries.',
    );
    expect(prompt).toMatchSnapshot();
  });

  describe('GEMINI_SYSTEM_MD environment variable', () => {
    it.each(['false', '0'])(
      'should use default prompt when GEMINI_SYSTEM_MD is "%s"',
      (value) => {
        vi.stubEnv('GEMINI_SYSTEM_MD', value);
        const prompt = getCoreSystemPrompt(mockConfig);
        expect(fs.readFileSync).not.toHaveBeenCalled();
        expect(prompt).not.toContain('custom system prompt');
      },
    );

    it('should throw error if APEX_SYSTEM_MD points to a non-existent file', () => {
      const customPath = '/non/existent/path/system.md';
      vi.stubEnv('APEX_SYSTEM_MD', customPath);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(() => getCoreSystemPrompt(mockConfig)).toThrow(
        `missing system prompt file '${path.resolve(customPath)}'`,
      );
    });

    it.each(['true', '1'])(
      'should read from default path when GEMINI_SYSTEM_MD is "%s"',
      (value) => {
        const defaultPath = path.resolve(path.join(APEX_DIR, 'system.md'));
        vi.stubEnv('GEMINI_SYSTEM_MD', value);
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('custom system prompt');

        const prompt = getCoreSystemPrompt(mockConfig);
        expect(fs.readFileSync).toHaveBeenCalledWith(defaultPath, 'utf8');
        expect(prompt).toBe('custom system prompt');
      },
    );

    it('should read from custom path when APEX_SYSTEM_MD provides one, preserving case', () => {
      const customPath = path.resolve('/custom/path/SyStEm.Md');
      vi.stubEnv('APEX_SYSTEM_MD', customPath);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('custom system prompt');

      const prompt = getCoreSystemPrompt(mockConfig);
      expect(fs.readFileSync).toHaveBeenCalledWith(customPath, 'utf8');
      expect(prompt).toBe('custom system prompt');
    });

    it('should expand tilde in custom path when APEX_SYSTEM_MD is set', () => {
      const homeDir = '/Users/test';
      vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
      const customPath = '~/custom/system.md';
      const expectedPath = path.join(homeDir, 'custom/system.md');
      vi.stubEnv('APEX_SYSTEM_MD', customPath);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('custom system prompt');

      const prompt = getCoreSystemPrompt(mockConfig);
      expect(fs.readFileSync).toHaveBeenCalledWith(
        path.resolve(expectedPath),
        'utf8',
      );
      expect(prompt).toBe('custom system prompt');
    });
  });

  describe('GEMINI_WRITE_SYSTEM_MD environment variable', () => {
    it.each(['false', '0'])(
      'should not write to file when GEMINI_WRITE_SYSTEM_MD is "%s"',
      (value) => {
        vi.stubEnv('GEMINI_WRITE_SYSTEM_MD', value);
        getCoreSystemPrompt(mockConfig);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
      },
    );

    it.each(['true', '1'])(
      'should write to default path when GEMINI_WRITE_SYSTEM_MD is "%s"',
      (value) => {
        const defaultPath = path.resolve(path.join(APEX_DIR, 'system.md'));
        vi.stubEnv('GEMINI_WRITE_SYSTEM_MD', value);
        getCoreSystemPrompt(mockConfig);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          defaultPath,
          expect.any(String),
        );
      },
    );

    it('should write to custom path when APEX_WRITE_SYSTEM_MD provides one', () => {
      const customPath = path.resolve('/custom/path/system.md');
      vi.stubEnv('GEMINI_WRITE_SYSTEM_MD', customPath);
      getCoreSystemPrompt(mockConfig);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        customPath,
        expect.any(String),
      );
    });

    it.each([
      ['~/custom/system.md', 'custom/system.md'],
      ['~', ''],
    ])(
      'should expand tilde in custom path when GEMINI_WRITE_SYSTEM_MD is "%s"',
      (customPath, relativePath) => {
        const homeDir = '/Users/test';
        vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
        const expectedPath = relativePath
          ? path.join(homeDir, relativePath)
          : homeDir;
        vi.stubEnv('GEMINI_WRITE_SYSTEM_MD', customPath);
        getCoreSystemPrompt(mockConfig);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          path.resolve(expectedPath),
          expect.any(String),
        );
      },
    );
  });
});

describe('resolvePathFromEnv helper function', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('when envVar is undefined, empty, or whitespace', () => {
    it.each([
      ['undefined', undefined],
      ['empty string', ''],
      ['whitespace only', '   \n\t  '],
    ])('should return null for %s', (_, input) => {
      const result = resolvePathFromEnv(input);
      expect(result).toEqual({
        isSwitch: false,
        value: null,
        isDisabled: false,
      });
    });
  });

  describe('when envVar is a boolean-like string', () => {
    it.each([
      ['"0" as disabled switch', '0', '0', true],
      ['"false" as disabled switch', 'false', 'false', true],
      ['"1" as enabled switch', '1', '1', false],
      ['"true" as enabled switch', 'true', 'true', false],
      ['"FALSE" (case-insensitive)', 'FALSE', 'false', true],
      ['"TRUE" (case-insensitive)', 'TRUE', 'true', false],
    ])('should handle %s', (_, input, expectedValue, isDisabled) => {
      const result = resolvePathFromEnv(input);
      expect(result).toEqual({
        isSwitch: true,
        value: expectedValue,
        isDisabled,
      });
    });
  });

  describe('when envVar is a file path', () => {
    it.each([['/absolute/path/file.txt'], ['relative/path/file.txt']])(
      'should resolve path: %s',
      (input) => {
        const result = resolvePathFromEnv(input);
        expect(result).toEqual({
          isSwitch: false,
          value: path.resolve(input),
          isDisabled: false,
        });
      },
    );

    it.each([
      ['~/documents/file.txt', 'documents/file.txt'],
      ['~', ''],
    ])('should expand tilde path: %s', (input, homeRelativePath) => {
      const homeDir = '/Users/test';
      vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
      const result = resolvePathFromEnv(input);
      expect(result).toEqual({
        isSwitch: false,
        value: path.resolve(
          homeRelativePath ? path.join(homeDir, homeRelativePath) : homeDir,
        ),
        isDisabled: false,
      });
    });

    it('should handle os.homedir() errors gracefully', () => {
      vi.spyOn(os, 'homedir').mockImplementation(() => {
        throw new Error('Cannot resolve home directory');
      });
      const consoleSpy = vi
        .spyOn(debugLogger, 'warn')
        .mockImplementation(() => {});

      const result = resolvePathFromEnv('~/documents/file.txt');
      expect(result).toEqual({
        isSwitch: false,
        value: null,
        isDisabled: false,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Could not resolve home directory for path: ~/documents/file.txt',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });
});

describe('Model-specific tool call formats', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('SANDBOX', undefined);
  });

  it('should use XML format for qwen3-coder model', () => {
    vi.mocked(isGitRepository).mockReturnValue(false);
    const prompt = getCoreSystemPrompt(undefined, 'qwen3-coder-7b');

    // Should contain XML-style tool calls
    expect(prompt).toContain('<tool_call>');
    expect(prompt).toContain('<function=run_shell_command>');
    expect(prompt).toContain('<parameter=command>');
    expect(prompt).toContain('</function>');
    expect(prompt).toContain('</tool_call>');

    // Should NOT contain bracket-style tool calls
    expect(prompt).not.toContain('[tool_call: run_shell_command for');

    // Should NOT contain JSON-style tool calls
    expect(prompt).not.toContain('{"name": "run_shell_command"');

    expect(prompt).toMatchSnapshot();
  });

  it('should use JSON format for qwen-vl model', () => {
    vi.mocked(isGitRepository).mockReturnValue(false);
    const prompt = getCoreSystemPrompt(undefined, 'qwen-vl-max');

    // Should contain JSON-style tool calls
    expect(prompt).toContain('<tool_call>');
    expect(prompt).toContain('{"name": "run_shell_command"');
    expect(prompt).toContain(
      '"arguments": {"command": "node server.js &", "is_background": true}',
    );
    expect(prompt).toContain('</tool_call>');

    // Should NOT contain bracket-style tool calls
    expect(prompt).not.toContain('[tool_call: run_shell_command for');

    // Should NOT contain XML-style tool calls with parameters
    expect(prompt).not.toContain('<function=run_shell_command>');
    expect(prompt).not.toContain('<parameter=command>');

    expect(prompt).toMatchSnapshot();
  });

  it('should use bracket format for generic models', () => {
    vi.mocked(isGitRepository).mockReturnValue(false);
    const prompt = getCoreSystemPrompt(undefined, 'gpt-4');

    // Should contain bracket-style tool calls
    expect(prompt).toContain('[tool_call: run_shell_command for');
    expect(prompt).toContain('because it must run in the background]');

    // Should NOT contain XML-style tool calls
    expect(prompt).not.toContain('<function=run_shell_command>');
    expect(prompt).not.toContain('<parameter=command>');

    // Should NOT contain JSON-style tool calls
    expect(prompt).not.toContain('{"name": "run_shell_command"');

    expect(prompt).toMatchSnapshot();
  });

  it('should use bracket format when no model is specified', () => {
    vi.mocked(isGitRepository).mockReturnValue(false);
    const prompt = getCoreSystemPrompt();

    // Should contain bracket-style tool calls (default behavior)
    expect(prompt).toContain('[tool_call: run_shell_command for');
    expect(prompt).toContain('because it must run in the background]');

    // Should NOT contain XML or JSON formats
    expect(prompt).not.toContain('<function=run_shell_command>');
    expect(prompt).not.toContain('{"name": "run_shell_command"');

    expect(prompt).toMatchSnapshot();
  });

  it('should preserve model-specific formats with user memory', () => {
    vi.mocked(isGitRepository).mockReturnValue(false);
    const userMemory = 'User prefers concise responses.';
    const prompt = getCoreSystemPrompt(userMemory, 'qwen3-coder-14b');

    // Should contain XML-style tool calls
    expect(prompt).toContain('<tool_call>');
    expect(prompt).toContain('<function=run_shell_command>');

    // Should contain user memory with separator
    expect(prompt).toContain('---');
    expect(prompt).toContain('User prefers concise responses.');

    expect(prompt).toMatchSnapshot();
  });

  it('should preserve model-specific formats with sandbox environment', () => {
    vi.stubEnv('SANDBOX', 'true');
    vi.mocked(isGitRepository).mockReturnValue(false);
    const prompt = getCoreSystemPrompt(undefined, 'qwen-vl-plus');

    // Should contain JSON-style tool calls
    expect(prompt).toContain('{"name": "run_shell_command"');

    // Should contain sandbox instructions
    expect(prompt).toContain('# Sandbox');

    expect(prompt).toMatchSnapshot();
  });
});

describe('getCustomSystemPrompt', () => {
  it('should handle string custom instruction without user memory', () => {
    const customInstruction =
      'You are a helpful assistant specialized in code review.';
    const result = getCustomSystemPrompt(customInstruction);

    expect(result).toBe(
      'You are a helpful assistant specialized in code review.',
    );
    expect(result).not.toContain('---');
  });

  it('should handle string custom instruction with user memory', () => {
    const customInstruction =
      'You are a helpful assistant specialized in code review.';
    const userMemory =
      'Remember to be extra thorough.\nFocus on security issues.';
    const result = getCustomSystemPrompt(customInstruction, userMemory);

    expect(result).toBe(
      'You are a helpful assistant specialized in code review.\n\n---\n\nRemember to be extra thorough.\nFocus on security issues.',
    );
    expect(result).toContain('---');
  });

  it('should handle Content object with parts array and user memory', () => {
    const customInstruction = {
      parts: [
        { text: 'You are a code assistant. ' },
        { text: 'Always provide examples.' },
      ],
    };
    const userMemory = 'User prefers TypeScript examples.';
    const result = getCustomSystemPrompt(customInstruction, userMemory);

    expect(result).toBe(
      'You are a code assistant. Always provide examples.\n\n---\n\nUser prefers TypeScript examples.',
    );
    expect(result).toContain('---');
  });
});

describe('getSubagentSystemReminder', () => {
  it('should format single agent type correctly', () => {
    const result = getSubagentSystemReminder(['python']);

    expect(result).toMatch(/^<system-reminder>.*<\/system-reminder>$/);
    expect(result).toContain('specialized subagents available: python');
    expect(result).toContain('delegated recon and relief assets');
    expect(result).toContain('PROACTIVELY use the');
  });

  it('should join multiple agent types with commas', () => {
    const result = getSubagentSystemReminder(['python', 'web', 'analysis']);

    expect(result).toContain(
      'specialized subagents available: python, web, analysis',
    );
  });

  it('should handle empty array', () => {
    const result = getSubagentSystemReminder([]);

    expect(result).toContain('specialized subagents available: ');
    expect(result).toContain('<system-reminder>');
  });
});

describe('getPlanModeSystemReminder', () => {
  it('should return plan mode system reminder with proper structure', () => {
    const result = getPlanModeSystemReminder();

    expect(result).toMatch(/^<system-reminder>[\s\S]*<\/system-reminder>$/);
    expect(result).toContain('Plan mode is active');
    expect(result).toContain('recon-only phase');
    expect(result).toContain('MUST NOT make edits');
  });

  it('should include workflow instructions', () => {
    const result = getPlanModeSystemReminder();

    expect(result).toContain('1. Build the operating picture');
    expect(result).toContain('2. Surface constraints, assumptions, risks');
    expect(result).toContain('ask_user_question');
    expect(result).toContain('exit_plan_mode tool');
  });

  it('should be deterministic', () => {
    const result1 = getPlanModeSystemReminder();
    const result2 = getPlanModeSystemReminder();

    expect(result1).toBe(result2);
  });
});

describe('resolvePathFromEnv helper function', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('when envVar is undefined, empty, or whitespace', () => {
    it('should return null for undefined', () => {
      const result = resolvePathFromEnv(undefined);
      expect(result).toEqual({
        isSwitch: false,
        value: null,
        isDisabled: false,
      });
    });

    it('should return null for empty string', () => {
      const result = resolvePathFromEnv('');
      expect(result).toEqual({
        isSwitch: false,
        value: null,
        isDisabled: false,
      });
    });

    it('should return null for whitespace only', () => {
      const result = resolvePathFromEnv('   \n\t  ');
      expect(result).toEqual({
        isSwitch: false,
        value: null,
        isDisabled: false,
      });
    });
  });

  describe('when envVar is a boolean-like string', () => {
    it('should handle "0" as disabled switch', () => {
      const result = resolvePathFromEnv('0');
      expect(result).toEqual({
        isSwitch: true,
        value: '0',
        isDisabled: true,
      });
    });

    it('should handle "false" as disabled switch', () => {
      const result = resolvePathFromEnv('false');
      expect(result).toEqual({
        isSwitch: true,
        value: 'false',
        isDisabled: true,
      });
    });

    it('should handle "1" as enabled switch', () => {
      const result = resolvePathFromEnv('1');
      expect(result).toEqual({
        isSwitch: true,
        value: '1',
        isDisabled: false,
      });
    });

    it('should handle "true" as enabled switch', () => {
      const result = resolvePathFromEnv('true');
      expect(result).toEqual({
        isSwitch: true,
        value: 'true',
        isDisabled: false,
      });
    });

    it('should be case-insensitive for boolean values', () => {
      expect(resolvePathFromEnv('FALSE')).toEqual({
        isSwitch: true,
        value: 'false',
        isDisabled: true,
      });
      expect(resolvePathFromEnv('TRUE')).toEqual({
        isSwitch: true,
        value: 'true',
        isDisabled: false,
      });
    });
  });

  describe('when envVar is a file path', () => {
    it('should resolve absolute paths', () => {
      const result = resolvePathFromEnv('/absolute/path/file.txt');
      expect(result).toEqual({
        isSwitch: false,
        value: path.resolve('/absolute/path/file.txt'),
        isDisabled: false,
      });
    });

    it('should resolve relative paths', () => {
      const result = resolvePathFromEnv('relative/path/file.txt');
      expect(result).toEqual({
        isSwitch: false,
        value: path.resolve('relative/path/file.txt'),
        isDisabled: false,
      });
    });

    it('should expand tilde to home directory', () => {
      const homeDir = '/Users/test';
      vi.spyOn(os, 'homedir').mockReturnValue(homeDir);

      const result = resolvePathFromEnv('~/documents/file.txt');
      expect(result).toEqual({
        isSwitch: false,
        value: path.resolve(path.join(homeDir, 'documents/file.txt')),
        isDisabled: false,
      });
    });

    it('should handle standalone tilde', () => {
      const homeDir = '/Users/test';
      vi.spyOn(os, 'homedir').mockReturnValue(homeDir);

      const result = resolvePathFromEnv('~');
      expect(result).toEqual({
        isSwitch: false,
        value: path.resolve(homeDir),
        isDisabled: false,
      });
    });

    it('should handle os.homedir() errors gracefully', () => {
      vi.spyOn(os, 'homedir').mockImplementation(() => {
        throw new Error('Cannot resolve home directory');
      });

      const result = resolvePathFromEnv('~/documents/file.txt');
      expect(result).toEqual({
        isSwitch: false,
        value: null,
        isDisabled: false,
      });
    });
  });
});

describe('getContextBudgetSystemReminder', () => {
  it('should return empty string when ratio is below 0.75 (GREEN)', () => {
    expect(getContextBudgetSystemReminder(0.0, false)).toBe('');
    expect(getContextBudgetSystemReminder(0.5, false)).toBe('');
    expect(getContextBudgetSystemReminder(0.74, false)).toBe('');
    expect(getContextBudgetSystemReminder(0.749, true)).toBe('');
  });

  it('should return BINGO reminder when ratio is >= 0.75 and < 0.90', () => {
    const result = getContextBudgetSystemReminder(0.75, false);
    expect(result).toContain('BINGO');
    expect(result).toContain('75%');
    expect(result).toContain('<system-reminder>');
    expect(result).toContain('</system-reminder>');
    // BINGO level — starts with BINGO, not WINCHESTER
    expect(result).toMatch(/^<system-reminder>\nBINGO/);
  });

  it('should return BINGO at 0.89 ratio', () => {
    const result = getContextBudgetSystemReminder(0.89, false);
    expect(result).toContain('BINGO');
    expect(result).toContain('89%');
    expect(result).toMatch(/^<system-reminder>\nBINGO/);
  });

  it('should return WINCHESTER reminder when ratio is >= 0.90', () => {
    const result = getContextBudgetSystemReminder(0.9, false);
    expect(result).toContain('WINCHESTER');
    expect(result).toContain('90%');
    expect(result).toContain('<system-reminder>');
    expect(result).not.toContain('BINGO');
  });

  it('should return WINCHESTER at ratio > 1.0', () => {
    const result = getContextBudgetSystemReminder(1.05, false);
    expect(result).toContain('WINCHESTER');
    expect(result).toContain('105%');
  });

  it('should include compaction note when isSummarized is true', () => {
    const bingo = getContextBudgetSystemReminder(0.8, true);
    expect(bingo).toContain('already been compacted once');

    const winchester = getContextBudgetSystemReminder(0.95, true);
    expect(winchester).toContain('already been compacted once');
  });

  it('should not include compaction note when isSummarized is false', () => {
    const bingo = getContextBudgetSystemReminder(0.8, false);
    expect(bingo).not.toContain('already been compacted');

    const winchester = getContextBudgetSystemReminder(0.95, false);
    expect(winchester).not.toContain('already been compacted');
  });

  it('should mention BROWNING and JOKER callouts in both levels', () => {
    const bingo = getContextBudgetSystemReminder(0.8, false);
    expect(bingo).toContain('BROWNING');
    expect(bingo).toContain('JOKER');

    const winchester = getContextBudgetSystemReminder(0.95, false);
    expect(winchester).toContain('BROWNING');
    expect(winchester).toContain('JOKER');
  });

  it('should round percentage correctly', () => {
    const result = getContextBudgetSystemReminder(0.777, false);
    expect(result).toContain('78%');
  });

  it('should be deterministic', () => {
    const r1 = getContextBudgetSystemReminder(0.85, true);
    const r2 = getContextBudgetSystemReminder(0.85, true);
    expect(r1).toBe(r2);
  });
});
