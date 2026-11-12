import type { FeedKey } from '@siaga/core';
import { collectApi } from './api.js';
import { collectBanjir } from './banjir.js';
import { collectGempa } from './gempa.js';
import { collectGunung } from './gunung.js';
import { collectCuaca, collectUdara } from './openmeteo.js';
import type { RunResult } from './types.js';

export const COLLECTORS: Record<FeedKey, () => Promise<RunResult>> = {
  gempa: collectGempa,
  banjir: collectBanjir,
  cuaca: collectCuaca,
  udara: collectUdara,
  api: collectApi,
  gunung: collectGunung,
};

export type { RunResult };
