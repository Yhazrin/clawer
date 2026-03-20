// Ambient declarations for cross-platform utilities.
// setTimeout/clearTimeout exist in both Node.js and browser runtimes,
// but neither "dom" nor "@types/node" is included in the base tsconfig.

declare function setTimeout(callback: (...args: never[]) => void, ms: number): unknown;
declare function clearTimeout(id: unknown): void;
