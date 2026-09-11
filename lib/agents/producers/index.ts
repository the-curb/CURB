import type { ProducerTable } from '../runtime.ts';
import { bellProducer } from './bell.ts';
import { registrarProducer } from './registrar.ts';
import { pillarProducer } from './pillar.ts';
import { surveyorProducer } from './surveyor.ts';
import { wardenProducer } from './warden.ts';
import { archivistProducer } from './archivist.ts';
import { tallyProducer } from './tally.ts';
import { counselProducer } from './counsel.ts';
import { heraldProducer } from './herald.ts';

/**
 * The producers that exist. An agent absent from this table is described in the
 * registry but is not running — and `tick()` reports it as NOT_IMPLEMENTED by
 * name rather than letting it look like an agent that simply had a quiet run.
 */
export const PRODUCERS: ProducerTable = {
  bell: bellProducer,
  registrar: registrarProducer,
  pillar: pillarProducer,
  surveyor: surveyorProducer,
  warden: wardenProducer,
  archivist: archivistProducer,
  tally: tallyProducer,
  counsel: counselProducer,
  herald: heraldProducer,
};
