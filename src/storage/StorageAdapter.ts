import type { PGlite } from '@electric-sql/pglite'

/**
 * Storage adapter interface for database persistence.
 * Different implementations handle web (IndexedDB) vs desktop (filesystem) storage.
 */
export interface DBStorage {
  /**
   * Save the database state to persistent storage.
   * @param db - The PGlite instance to save
   */
  save(db: PGlite): Promise<void>

  /**
   * Load the database state from persistent storage.
   * @returns The database snapshot as a Blob, or null if no snapshot exists
   */
  load(): Promise<Blob | null>
}

