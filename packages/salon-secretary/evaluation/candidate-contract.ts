/** Contract part of a candidate freeze manifest, read from the live package (kept apart from candidate-freeze.ts so the
 * manifest logic stays free of runtime imports): the C2 examples contract tag the candidate's flags produce (null when
 * examples are off), the example render version and the bank hash that tag carries. */
import { EXAMPLES_RENDER_VERSION, exampleBank } from '../src/examples/bank';
import { examplesContractTag } from '../src/examples/select';
import type { CandidateContract } from './candidate-freeze';

export function liveCandidateContract(flags: Record<string, string>): CandidateContract {
  return { examplesTag: examplesContractTag(flags), examplesRenderVersion: EXAMPLES_RENDER_VERSION, bankSha256: exampleBank().sha256 };
}
