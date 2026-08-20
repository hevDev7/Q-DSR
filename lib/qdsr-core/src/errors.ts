/**
 * Rejection raised when an evidence bundle cannot support an honest verdict.
 *
 * Two intake layers throw this: the structural validator (wrong shape, too few
 * observations, a series that is not among the declared trials) and the
 * plausibility layer (values that are not shaped like trading returns, or a
 * search space forged from duplicate columns). `field` names the offending part
 * so the API can return a specific 422 rather than a generic failure.
 */
export class EvidenceValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'EvidenceValidationError';
    this.field = field;
  }
}
