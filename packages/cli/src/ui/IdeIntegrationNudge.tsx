/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IdeInfo } from '@google/gemini-cli-core';
import { Box, Text } from 'ink';
import {
  RadioButtonSelect,
  type RadioSelectItem,
} from './components/shared/RadioButtonSelect.js';
import { useKeypress } from './hooks/useKeypress.js';
import { theme } from './semantic-colors.js';

export type IdeIntegrationNudgeResult = {
  userSelection: 'yes' | 'no' | 'dismiss';
  isExtensionPreInstalled: boolean;
};

interface IdeIntegrationNudgeProps {
  ide: IdeInfo;
  onComplete: (result: IdeIntegrationNudgeResult) => void;
}

export function IdeIntegrationNudge({
  ide,
  onComplete,
}: IdeIntegrationNudgeProps) {
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onComplete({
          userSelection: 'no',
          isExtensionPreInstalled: false,
        });
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  const { displayName: ideName } = ide;
  // Assume extension is already installed if the env variables are set.
  const isExtensionPreInstalled =
    !!process.env['APEX_IDE_SERVER_PORT'] &&
    !!process.env['APEX_IDE_WORKSPACE_PATH'];

  const OPTIONS: Array<RadioSelectItem<IdeIntegrationNudgeResult>> = [
    {
      label: 'Yes',
      value: {
        userSelection: 'yes',
        isExtensionPreInstalled,
      },
      key: 'Yes',
    },
    {
      label: 'No (esc)',
      value: {
        userSelection: 'no',
        isExtensionPreInstalled,
      },
      key: 'No (esc)',
    },
    {
      label: "No, don't ask again",
      value: {
        userSelection: 'dismiss',
        isExtensionPreInstalled,
      },
      key: "No, don't ask again",
    },
  ];

  const installText = isInSandbox
    ? `Note: In sandbox environments, IDE integration requires manual setup on the host system. If you select Yes, you'll receive instructions on how to set this up.`
    : isExtensionPreInstalled
      ? `If you select Yes, the CLI will connect to your ${
          ideName ?? 'editor'
        } for session viewing and file navigation.`
      : `If you select Yes, we'll install a companion extension for ${
          ideName ?? 'your editor'
        } that provides a session viewer, chat history browser, and file navigation panel.`;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.status.warning}
      padding={1}
      width="100%"
      marginLeft={1}
    >
      <Box marginBottom={1} flexDirection="column">
        <Text>
          <Text color={theme.status.warning}>{'> '}</Text>
          {`Do you want to connect ${ideName ?? 'your editor'} to Gemini CLI?`}
        </Text>
        <Text color={theme.text.secondary}>{installText}</Text>
      </Box>
      <RadioButtonSelect items={OPTIONS} onSelect={onComplete} />
    </Box>
  );
}
