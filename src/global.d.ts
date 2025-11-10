// Declaraciones globales para evitar errores de TS por APIs del host (ej: window.storage)
declare global {
  interface WindowStorage {
    get(key: string): Promise<{ value: string } | undefined>;
    set(key: string, value: string): Promise<void>;
    list(): Promise<{ keys: string[] }>;
  }

  interface Window {
    storage: WindowStorage;
  }
}

export {};
