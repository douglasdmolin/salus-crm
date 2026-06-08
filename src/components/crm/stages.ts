import type { StageConfig } from "../../config/project";
import { STAGES_FALLBACK } from "../../config/project";

export type Stage = StageConfig;

/** Fallback para skeleton de loading */
export const STAGES_SKELETON: Stage[] = STAGES_FALLBACK;
