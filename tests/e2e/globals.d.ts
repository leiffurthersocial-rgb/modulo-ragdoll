export {};
declare global {
  interface Window {
    __modulo?: { ready: boolean; bodies: number; errors: string[] };
  }
}
