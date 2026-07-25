/**
 * Import result shape, in its own module.
 *
 * A `"use server"` file may only export async functions, so the state type and
 * its empty value live here where both the action and the client form can
 * import them.
 */
export interface ImportState {
  error: string | null;
  imported: number;
  skipped: number;
  /** Rows resolved day-first from an ambiguous date — surfaced, never hidden. */
  ambiguousDates: Array<{ row: number; holder: string; raw: string; resolved: string }>;
  problems: Array<{ row: number; message: string }>;
  createdHolders: number;
  done: boolean;
}

export const emptyImportState: ImportState = {
  error: null,
  imported: 0,
  skipped: 0,
  ambiguousDates: [],
  problems: [],
  createdHolders: 0,
  done: false,
};
