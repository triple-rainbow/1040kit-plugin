import { engine, type EngineApi } from '@1040kit/engine';

/** Everything a tool handler may reach outside its own inputs. Tests inject fakes. */
export interface Deps {
  engine: EngineApi;
  now(): Date;
  kbFetch: typeof fetch;
}

export function defaultDeps(): Deps {
  return {
    engine,
    now: () => new Date(),
    kbFetch: (...args) => fetch(...args),
  };
}
