export type PublicConfig = {
  apiUrl: string;
  region: string;
  userPoolId: string;
  userPoolClientId: string;
};

type ConfigWindow = Window & { __FX_CONFIG__?: Partial<PublicConfig> };

export function publicConfig(): PublicConfig {
  const injected = typeof window === "undefined" ? undefined : (window as ConfigWindow).__FX_CONFIG__;
  return {
    apiUrl: import.meta.env.VITE_API_URL || injected?.apiUrl || "",
    region: import.meta.env.VITE_REGION || injected?.region || "eu-west-1",
    userPoolId: import.meta.env.VITE_USER_POOL_ID || injected?.userPoolId || "",
    userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || injected?.userPoolClientId || "",
  };
}

export function isDemoMode(): boolean {
  return publicConfig().apiUrl.length === 0;
}
