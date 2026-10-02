export const SKIP_PATHS: readonly string[];
export function isSafeToSkip(file: string): boolean;
export function shouldSkipPreview(files: readonly string[]): boolean;
export interface Decision { skip: boolean; reason: string }
export function decide(input: {
  env: Record<string, string | undefined>;
  git: (args: string[]) => string;
}): Decision;
