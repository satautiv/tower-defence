/**
 * Platform contracts.
 *
 * Everything a browser and an Android WebView do differently is expressed here
 * as an interface, so game code depends on the interface and never on the
 * platform. The Android port (#54) then supplies new implementations rather
 * than threading conditionals through the codebase.
 *
 * Every save operation is async even where the underlying store is synchronous.
 * localStorage is synchronous, IndexedDB and Capacitor Preferences are not, and
 * a synchronous interface could not accommodate them without rewriting every
 * call site later.
 */

export type PlatformName = 'web' | 'capacitor';

/* ---------------------------------------------------------------- storage */

export type SaveFailure =
  /** No store at all: private browsing, disabled site data, a sandboxed frame. */
  | 'unavailable'
  /** The store is full. Recoverable by deleting something. */
  | 'quota'
  /** Present but rejected the operation. */
  | 'failed';

export class SaveError extends Error {
  readonly reason: SaveFailure;
  readonly key: string | undefined;

  constructor(reason: SaveFailure, message: string, key?: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SaveError';
    this.reason = reason;
    this.key = key;
  }
}

/**
 * A string key-value store.
 *
 * Values are strings rather than objects on purpose: serialisation, schema
 * versioning and migration belong to the save system (#39), which needs to see
 * the raw text to migrate an old shape. An adapter that parsed JSON would have
 * to guess at the shape it was parsing.
 */
export interface SaveAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Every key this adapter owns. Used by save export and management UI. */
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/* -------------------------------------------------------------- lifecycle */

/**
 * `pause` fires when the game stops being visible — a tab switch, the home
 * button, an incoming call. It is the last reliable moment to write a snapshot,
 * because a backgrounded mobile page may never run code again.
 */
export type LifecycleEvent = 'pause' | 'resume';

export type LifecycleHandler = (event: LifecycleEvent) => void;

export interface Lifecycle {
  /** Returns an unsubscribe function. */
  subscribe(handler: LifecycleHandler): () => void;
  /** Whether the game is currently visible. */
  readonly visible: boolean;
  dispose(): void;
}

/* ---------------------------------------------------------------- haptics */

export type HapticIntensity = 'light' | 'medium' | 'heavy';

export interface Haptics {
  impact(intensity: HapticIntensity): void;
  setEnabled(enabled: boolean): void;
  readonly enabled: boolean;
}

/* -------------------------------------------------------------- analytics */

/**
 * Opt-in by design, and disabled until the player says otherwise
 * (docs/GAME_DESIGN.md §19). The game must be fully functional with it off,
 * which is why this is a fire-and-forget interface with no return value to
 * await and nothing that can fail.
 */
export interface Analytics {
  track(event: string, properties?: Readonly<Record<string, unknown>>): void;
  setEnabled(enabled: boolean): void;
  readonly enabled: boolean;
}

/* --------------------------------------------------------------- platform */

export interface Platform {
  readonly name: PlatformName;
  /**
   * Stars, talents, unlocks, settings. Small and written often, so it lives in
   * the fastest store available.
   */
  readonly profile: SaveAdapter;
  /**
   * A serialised world snapshot. Large and written rarely — on backgrounding —
   * so it goes somewhere with real capacity.
   */
  readonly session: SaveAdapter;
  readonly lifecycle: Lifecycle;
  readonly haptics: Haptics;
  readonly analytics: Analytics;
  dispose(): void;
}
