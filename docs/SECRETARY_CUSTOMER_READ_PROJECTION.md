# Customer read projection: semantic role correction

## Proven cause

Golden v5 GF05 produced a correct customer.read with target_name=Célia Prado and requested_fields=[name,phone,email]. The published schema allowed this operation and list. The customer adapter nevertheless rejected every nonempty requested_fields list on reads as OPERATION_MISMATCH, before accepting the target or querying the catalog. The same conditional exists in the preserved pre-Front source; the failure was latent rather than introduced by the current conversational changes.

The raw provider response is resp_0533339860018088016ab84709258887d2b8a602a3fa0270de. Source bytes and runtime before correction are archived in .demo/gf05-read-before/manifest.json. Original Golden messages, expected values, provider output and result are unchanged.

## Contract

- Operation determines the role of requested_fields. For customer.read/search, it selects presentation fields from name, phone and email. For customer.create/change, it remains the existing mutation collection mask.
- CustomerState.read_fields stores accepted read selection independently of requested. An omitted selection preserves the accepted read selection while a target is being resolved. A new read without a selection retains the full-profile default.
- Read projection is bounded and whitelisted before catalog IO. Read operations still reject every patch value and clear_fields entry. They cannot enter prepare, proposal or the customer executor.
- T01/T02 retain their original tenant and role checks and fixed SQL/Prisma selects. No caller-controlled database projection, additional DTO field or permission was added. The existing minimum T02 DTO remains id/name/phone/email; only the displayed message selects the requested fields.
- The effective ActionPlan projection carries read_fields back as requested_fields only for read/search. It does not turn returned customer data into an edit patch.

## Evidence

- .demo/gf05-customer-read-diagnosis.json preserves the before failure with original provider argument and line hashes.
- .demo/gf05-customer-read-replay.json reuses the exact original provider arguments through the actual SDK normalization, adapter, fixed catalog selection and UI projection. Before: OPERATION_MISMATCH with zero catalog calls. After: DONE, target and read selection retained, no draft/proposal/operation writes. Catalog IO is mocked and the fixture record is synthetic; this is not PostgreSQL evidence.
- secretary-customer-read-projection.test.ts adds 22 permanent cases: subset/full reads, omitted projection, target completion, ambiguity selection, read/search, forbidden patch and clears, unknown fields, duplicate labels, permission and tenant checks.
- Existing customer mutation and conversational regressions continue unchanged. Focused run .demo/gf05-read-focused.json: 55/55 PASS across four files. Global TypeScript and lint with zero warnings passed.
- One additional case in secretary-customers.integration.test.ts is prepared for the coordinator's isolated PostgreSQL run. It verifies fixed DTO, unchanged xmin/revision, no SECRETARY_CUSTOMERS draft/audit, cross-tenant invisibility and clear rejection. It was not executed by this agent.

No network, paid model call, Production access, PostgreSQL operation or holdout inspection was performed for this correction. These results do not replace the next complete Golden/holdout and release gates.
