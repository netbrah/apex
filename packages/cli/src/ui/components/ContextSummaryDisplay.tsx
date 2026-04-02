/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { type IdeContext, type MCPServerConfig } from '@apex-code/apex-core';

interface ContextSummaryDisplayProps {
  geminiMdFileCount: number;
  contextFileNames: string[];
  mcpServers?: Record<string, MCPServerConfig>;
  blockedMcpServers?: Array<{ name: string; extensionName: string }>;
  ideContext?: IdeContext;
  skillCount: number;
  backgroundProcessCount?: number;
}

export const ContextSummaryDisplay: React.FC<ContextSummaryDisplayProps> = ({
  geminiMdFileCount,
  contextFileNames,
  mcpServers,
  blockedMcpServers,
  ideContext,
  skillCount,
  backgroundProcessCount = 0,
}) => {
  const mcpServerCount = Object.keys(mcpServers || {}).length;
  const blockedMcpServerCount = blockedMcpServers?.length || 0;
  const openFileCount = ideContext?.workspaceState?.openFiles?.length ?? 0;

  if (
    geminiMdFileCount === 0 &&
    mcpServerCount === 0 &&
    blockedMcpServerCount === 0 &&
    openFileCount === 0 &&
    skillCount === 0 &&
    backgroundProcessCount === 0
  ) {
    return null;
  }

  const openFilesText = (() => {
    if (openFileCount === 0) {
      return '';
    }
    const fileText =
      openFileCount === 1
        ? t('{{count}} open file', { count: String(openFileCount) })
        : t('{{count}} open files', { count: String(openFileCount) });
    return `${fileText} ${t('(ctrl+g to view)')}`;
  })();

  const geminiMdText = (() => {
    if (geminiMdFileCount === 0) {
      return '';
    }
    const allNamesTheSame = new Set(contextFileNames).size < 2;
    const name = allNamesTheSame ? contextFileNames[0] : 'context';
    return geminiMdFileCount === 1
      ? t('{{count}} {{name}} file', {
          count: String(geminiMdFileCount),
          name,
        })
      : t('{{count}} {{name}} files', {
          count: String(geminiMdFileCount),
          name,
        });
  })();

  const mcpText = (() => {
    if (mcpServerCount === 0 && blockedMcpServerCount === 0) {
      return '';
    }

    const parts = [];
    if (mcpServerCount > 0) {
      const serverText =
        mcpServerCount === 1
          ? t('{{count}} MCP server', { count: String(mcpServerCount) })
          : t('{{count}} MCP servers', { count: String(mcpServerCount) });
      parts.push(serverText);
    }

    if (blockedMcpServerCount > 0) {
      let blockedText = t('{{count}} Blocked', {
        count: String(blockedMcpServerCount),
      });
      if (mcpServerCount === 0) {
        const serverText =
          blockedMcpServerCount === 1
            ? t('{{count}} MCP server', {
                count: String(blockedMcpServerCount),
              })
            : t('{{count}} MCP servers', {
                count: String(blockedMcpServerCount),
              });
        blockedText += ` ${serverText}`;
      }
      parts.push(blockedText);
    }
    return parts.join(', ');
  })();

  const skillText = (() => {
    if (skillCount === 0) {
      return '';
    }
    return `${skillCount} skill${skillCount > 1 ? 's' : ''}`;
  })();

  const backgroundText = (() => {
    if (backgroundProcessCount === 0) {
      return '';
    }
    return `${backgroundProcessCount} Background process${
      backgroundProcessCount > 1 ? 'es' : ''
    }`;
  })();

  const summaryParts = [
    openFilesText,
    geminiMdText,
    mcpText,
    skillText,
    backgroundText,
  ].filter(Boolean);

  return (
    <Box paddingX={1} flexDirection="row" flexWrap="wrap">
      {summaryParts.map((part, index) => (
        <Box key={index} flexDirection="row">
          {index > 0 && <Text color={theme.text.secondary}>{' · '}</Text>}
          <Text color={theme.text.secondary}>{part}</Text>
        </Box>
      ))}
    </Box>
  );
};
