// Stub: API Key removed in Apex
export interface QwenAuthState {
  deviceAuth: unknown;
  authStatus: string | null;
  authMessage: string | null;
  isQwenAuthenticating: boolean;
}

export function useQwenAuth(..._args: unknown[]) {
  const qwenAuthState: QwenAuthState = {
    deviceAuth: null,
    authStatus: null,
    authMessage: null,
    isQwenAuthenticating: false,
  };
  return {
    ...qwenAuthState,
    qwenAuthState,
    startQwenAuth: (..._args: unknown[]) => {},
    cancelQwenAuth: () => {},
  };
}
