export {};
declare global {
  interface Window {
    __modulo?: { ready: boolean; game?: unknown; errors: string[]; bench?: unknown };
  }
}
