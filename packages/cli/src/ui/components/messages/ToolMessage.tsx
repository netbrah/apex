/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box } from 'ink';
import type { IndividualToolCallDisplay } from '../../types.js';
import { StickyHeader } from '../StickyHeader.js';
import { ToolResultDisplay } from './ToolResultDisplay.js';
import {
  ToolStatusIndicator,
  ToolInfo,
  TrailingIndicator,
  McpProgressIndicator,
  type TextEmphasis,
  STATUS_INDICATOR_WIDTH,
  isThisShellFocusable as checkIsShellFocusable,
  isThisShellFocused as checkIsShellFocused,
  useFocusHint,
  FocusHint,
} from './ToolShared.js';
import { type Config, CoreToolCallStatus, Kind } from '@google/gemini-cli-core';
import { ShellInputPrompt } from '../ShellInputPrompt.js';
import { SUBAGENT_MAX_LINES } from '../../constants.js';

export type { TextEmphasis };

type DisplayRendererResult =
  | { type: 'none' }
  | { type: 'todo'; data: TodoResultDisplay }
  | { type: 'plan'; data: PlanResultDisplay }
  | { type: 'string'; data: string }
  | { type: 'diff'; data: { fileDiff: string; fileName: string } }
  | { type: 'task'; data: AgentResultDisplay }
  | { type: 'ansi'; data: AnsiOutput };

/**
 * Custom hook to determine the type of result display and return appropriate rendering info
 */
const useResultDisplayRenderer = (
  resultDisplay: unknown,
): DisplayRendererResult =>
  React.useMemo(() => {
    if (!resultDisplay) {
      return { type: 'none' };
    }

    // Check for TodoResultDisplay
    if (
      typeof resultDisplay === 'object' &&
      resultDisplay !== null &&
      'type' in resultDisplay &&
      resultDisplay.type === 'todo_list'
    ) {
      return {
        type: 'todo',
        data: resultDisplay as TodoResultDisplay,
      };
    }

    if (
      typeof resultDisplay === 'object' &&
      resultDisplay !== null &&
      'type' in resultDisplay &&
      resultDisplay.type === 'plan_summary'
    ) {
      return {
        type: 'plan',
        data: resultDisplay as PlanResultDisplay,
      };
    }

    // Check for SubagentExecutionResultDisplay (for non-task tools)
    if (
      typeof resultDisplay === 'object' &&
      resultDisplay !== null &&
      'type' in resultDisplay &&
      resultDisplay.type === 'task_execution'
    ) {
      return {
        type: 'task',
        data: resultDisplay as AgentResultDisplay,
      };
    }

    // Check for FileDiff
    if (
      typeof resultDisplay === 'object' &&
      resultDisplay !== null &&
      'fileDiff' in resultDisplay
    ) {
      return {
        type: 'diff',
        data: resultDisplay as { fileDiff: string; fileName: string },
      };
    }

    // Check for McpToolProgressData
    if (
      typeof resultDisplay === 'object' &&
      resultDisplay !== null &&
      'type' in resultDisplay &&
      resultDisplay.type === 'mcp_tool_progress'
    ) {
      const progress = resultDisplay as McpToolProgressData;
      const msg = progress.message ?? `Progress: ${progress.progress}`;
      const totalStr = progress.total != null ? `/${progress.total}` : '';
      return {
        type: 'string',
        data: `⏳ [${progress.progress}${totalStr}] ${msg}`,
      };
    }

    // Check for AnsiOutput
    if (
      typeof resultDisplay === 'object' &&
      resultDisplay !== null &&
      'ansiOutput' in resultDisplay
    ) {
      return { type: 'ansi', data: resultDisplay.ansiOutput as AnsiOutput };
    }

    // Default to string
    return {
      type: 'string',
      data: resultDisplay as string,
    };
  }, [resultDisplay]);

/**
 * Component to render todo list results
 */
const TodoResultRenderer: React.FC<{ data: TodoResultDisplay }> = ({
  data,
}) => <TodoDisplay todos={data.todos} />;

const PlanResultRenderer: React.FC<{
  data: PlanResultDisplay;
  availableHeight?: number;
  childWidth: number;
}> = ({ data, availableHeight, childWidth }) => (
  <PlanSummaryDisplay
    data={data}
    availableHeight={availableHeight}
    childWidth={childWidth}
  />
);

/**
 * Component to render subagent execution results
 */
const SubagentExecutionRenderer: React.FC<{
  data: AgentResultDisplay;
  availableHeight?: number;
  childWidth: number;
  config: Config;
}> = ({ data, availableHeight, childWidth, config }) => (
  <AgentExecutionDisplay
    data={data}
    availableHeight={availableHeight}
    childWidth={childWidth}
    config={config}
  />
);

/**
 * Component to render string results (markdown or plain text)
 */
const StringResultRenderer: React.FC<{
  data: string;
  renderAsMarkdown: boolean;
  availableHeight?: number;
  childWidth: number;
}> = ({ data, renderAsMarkdown, availableHeight, childWidth }) => {
  let displayData = data;

  // Truncate if too long
  if (displayData.length > MAXIMUM_RESULT_DISPLAY_CHARACTERS) {
    displayData = '...' + displayData.slice(-MAXIMUM_RESULT_DISPLAY_CHARACTERS);
  }

  if (renderAsMarkdown) {
    return (
      <Box flexDirection="column">
        <MarkdownDisplay
          text={displayData}
          isPending={false}
          availableTerminalHeight={availableHeight}
          contentWidth={childWidth}
        />
      </Box>
    );
  }

  return (
    <MaxSizedBox maxHeight={availableHeight} maxWidth={childWidth}>
      <Box>
        <Text wrap="wrap" color={theme.text.primary}>
          {displayData}
        </Text>
      </Box>
    </MaxSizedBox>
  );
};

/**
 * Component to render diff results
 */
const DiffResultRenderer: React.FC<{
  data: { fileDiff: string; fileName: string };
  availableHeight?: number;
  childWidth: number;
  settings?: LoadedSettings;
}> = ({ data, availableHeight, childWidth, settings }) => (
  <DiffRenderer
    diffContent={data.fileDiff}
    filename={data.fileName}
    availableTerminalHeight={availableHeight}
    contentWidth={childWidth}
    settings={settings}
  />
);

export interface ToolMessageProps extends IndividualToolCallDisplay {
  availableTerminalHeight?: number;
  contentWidth: number;
  emphasis?: TextEmphasis;
  renderOutputAsMarkdown?: boolean;
  isFirst: boolean;
  borderColor: string;
  borderDimColor: boolean;
  activeShellPtyId?: number | null;
  embeddedShellFocused?: boolean;
  ptyId?: number;
  config?: Config;
}

export const ToolMessage: React.FC<ToolMessageProps> = ({
  name,
  description,
  resultDisplay,
  status,
  kind,
  availableTerminalHeight,
  contentWidth,
  emphasis = 'medium',
  renderOutputAsMarkdown = true,
  isFirst,
  borderColor,
  borderDimColor,
  activeShellPtyId,
  embeddedShellFocused,
  ptyId,
  config,
  progressMessage,
  originalRequestName,
  progress,
  progressTotal,
}) => {
  const isThisShellFocused = checkIsShellFocused(
    name,
    status,
    ptyId,
    activeShellPtyId,
    embeddedShellFocused,
  );

  const isThisShellFocusable = checkIsShellFocusable(name, status, config);

  const { shouldShowFocusHint } = useFocusHint(
    isThisShellFocusable,
    isThisShellFocused,
    resultDisplay,
  );

  return (
    // It is crucial we don't replace this <> with a Box because otherwise the
    // sticky header inside it would be sticky to that box rather than to the
    // parent component of this ToolMessage.
    <>
      <StickyHeader
        width={terminalWidth}
        isFirst={isFirst}
        borderColor={borderColor}
        borderDimColor={borderDimColor}
      >
        <ToolStatusIndicator
          status={status}
          name={name}
          isFocused={isThisShellFocused}
        />
        <ToolInfo
          name={name}
          status={status}
          description={description}
          emphasis={emphasis}
          progressMessage={progressMessage}
          originalRequestName={originalRequestName}
        />
        <FocusHint
          shouldShowFocusHint={shouldShowFocusHint}
          isThisShellFocused={isThisShellFocused}
        />
        {shouldShowFocusHint && (
          <Box marginLeft={1} flexShrink={0}>
            <Text color={theme.text.accent}>
              {isThisShellFocused ? '(Focused)' : '(ctrl+f to focus)'}
            </Text>
          </Box>
        )}
        {emphasis === 'high' && <TrailingIndicator />}
      </StickyHeader>
      <Box
        width={terminalWidth}
        borderStyle="round"
        borderColor={borderColor}
        borderDimColor={borderDimColor}
        borderTop={false}
        borderBottom={false}
        borderLeft={true}
        borderRight={true}
        paddingX={1}
        flexDirection="column"
      >
        {status === CoreToolCallStatus.Executing && progress !== undefined && (
          <McpProgressIndicator
            progress={progress}
            total={progressTotal}
            message={progressMessage}
            barWidth={20}
          />
        )}
        <ToolResultDisplay
          resultDisplay={resultDisplay}
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={terminalWidth}
          renderOutputAsMarkdown={renderOutputAsMarkdown}
          hasFocus={isThisShellFocused}
          maxLines={
            kind === Kind.Agent && availableTerminalHeight !== undefined
              ? SUBAGENT_MAX_LINES
              : undefined
          }
          overflowDirection={kind === Kind.Agent ? 'bottom' : 'top'}
        />
        {isThisShellFocused && config && (
          <Box paddingLeft={STATUS_INDICATOR_WIDTH} marginTop={1}>
            <ShellInputPrompt
              activeShellPtyId={activeShellPtyId ?? null}
              focus={embeddedShellFocused}
            />
          </Box>
        )}
      </Box>
    </>
  );
};
