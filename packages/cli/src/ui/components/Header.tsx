/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box } from 'ink';
import { ThemedGradient } from './ThemedGradient.js';
import { shortAsciiLogo, longAsciiLogo, tinyAsciiLogo } from './AsciiArt.js';
import { getAsciiArtWidth } from '../utils/textUtils.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useSnowfall } from '../hooks/useSnowfall.js';

/**
 * Auth display type for the Header component.
 * Simplified representation of authentication method shown to users.
 */
export enum AuthDisplayType {
  CODING_PLAN = 'Coding Plan',
  API_KEY = 'API Key',
  UNKNOWN = 'Unknown',
}

interface HeaderProps {
  customAsciiArt?: string; // For user-defined ASCII art
  version: string;
  authDisplayType?: AuthDisplayType;
  model: string;
  workingDirectory: string;
}

export const Header: React.FC<HeaderProps> = ({
  customAsciiArt,
  version,
  authDisplayType,
  model,
  workingDirectory,
}) => {
  const { columns: terminalWidth } = useTerminalSize();

  const displayLogo = customAsciiArt ?? shortAsciiLogo;
  const logoWidth = getAsciiArtWidth(displayLogo);
  const formattedAuthType = authDisplayType ?? AuthDisplayType.UNKNOWN;

  const artWidth = getAsciiArtWidth(displayTitle);
  const title = useSnowfall(displayTitle);

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      marginX={containerMarginX}
      width={availableTerminalWidth}
    >
      <ThemedGradient>{title}</ThemedGradient>
      {nightly && (
        <Box width="100%" flexDirection="row" justifyContent="flex-end">
          <ThemedGradient>v{version}</ThemedGradient>
        </Box>
      )}

      {/* Right side: Info panel (flexible width, max 60 in two-column layout) */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={theme.border.default}
        paddingX={infoPanelPaddingX}
        flexGrow={showLogo ? 0 : 1}
        width={showLogo ? availableInfoPanelWidth : undefined}
      >
        {/* Title line: >_ Brand (v{version}) */}
        <Text>
          <Text bold color={theme.prompt?.prefix ?? theme.text.accent}>
            &gt;_ {'Apex'}
          </Text>
          <Text color={theme.text.secondary}> (v{version})</Text>
        </Text>
        {/* Empty line for spacing */}
        <Text> </Text>
        {/* Auth and Model line */}
        <Text>
          <Text color={theme.text.secondary}>{authModelText}</Text>
          {showModelHint && (
            <Text color={theme.text.secondary}>{modelHintText}</Text>
          )}
        </Text>
        {/* Directory line */}
        <Text color={theme.text.secondary}>{displayPath}</Text>
      </Box>
    </Box>
  );
};
