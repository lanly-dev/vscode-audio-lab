/* Shared domain types for the AudioLab extension. */

/**
 * Checkpoint locations for a model. `main` is the primary checkpoint, and
 * platform-specific caches (e.g. `npu_cache`) may be present depending on the
 * recipe and hardware.
 */
export interface ModelCheckpoints {
  main: string
  npu_cache?: string
  [key: string]: string | undefined
}

/**
 * A single model entry returned by the Lemonade `/v1/models` API.
 */
export interface LemonadeModel {
  checkpoint: string
  checkpoints: ModelCheckpoints
  components: unknown[]
  created: number
  downloaded: boolean
  id: string
  labels: string[]
  object: string // e.g. "model"
  owned_by: string // e.g. "lemonade"
  recipe: string // e.g. "whispercpp"
  recipe_options: Record<string, unknown>
  size: number
  suggested: boolean
  update_available: boolean
}

/** The aggregate result of a status/refresh against the Lemonade server. */
export interface LemonadeStatus {
  models: LemonadeModel[]
  url: string
  rawData: { models: LemonadeModel[] }
  isRunning: boolean
}
