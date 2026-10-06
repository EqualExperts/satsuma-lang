/** Type declarations for harness-ports.cjs; see that file for the contract. */
export declare const HARNESS_PORT_ENV: "SATSUMA_HARNESS_PORT";
export declare const PLAYGROUND_PORT_ENV: "SATSUMA_PLAYGROUND_PORT";
export declare const DEFAULT_HARNESS_PORT: number;
export declare const DEFAULT_PLAYGROUND_PORT: number;
export declare function portFromEnv(
  name: string,
  fallback: number,
  env?: Record<string, string | undefined>,
): number;
export declare function findFreePortsSync(count: number): number[];
