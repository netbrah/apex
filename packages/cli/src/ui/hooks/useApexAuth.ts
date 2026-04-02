// Stub: API Key removed in Apex
export interface ApexAuthState {
  deviceAuth: unknown;
  authStatus: string | null;
  authMessage: string | null;
  isQwenAuthenticating: boolean;
}

export function useApexAuth(..._args: unknown[]) {
  const apexAuthState: ApexAuthState = {
    deviceAuth: null,
    authStatus: null,
    authMessage: null,
    isQwenAuthenticating: false,
  };
  return {
    ...apexAuthState,
    apexAuthState,
    startQwenAuth: (..._args: unknown[]) => {},
    cancelQwenAuth: () => {},
  };
}
