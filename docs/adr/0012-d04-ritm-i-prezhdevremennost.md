# 0012. D04: rhythm and prematurity rules adjusted for resolution and arrhythmia

## Context

The plan assumed simple rules:

- a beat is premature if RR < (1 − threshold) × median RR;
- the rhythm is sinus if P precedes at least 90 % of QRS with a constant PQ, otherwise "non-sinus";
- HR is checked against the footer with a ±3 tolerance.

## Decision

Task 07 proved something else in code.

- **Prematurity during sinus arrhythmia** is assessed with an adjustment for RR variability.
- **The PQ constancy tolerance** is at least 4 px of the sheet's precision ceiling.
- **"Non-sinus"** is set only if at least 2 complexes deviate.
- **The P share** is computed only over complexes where P was assessed. If there are fewer than 10 such complexes, the "P ≥ 90 %" rule is not applied: the rhythm is `undetermined` or is assessed from the visible complexes. This is the implementer's decision, and it is recorded.
- **The "±3 to the footer" criterion** is replaced by "mean ±4 to the printed row" on all 10 sheets.

## Why

- **A bare prematurity threshold** is rejected: on `b-01` two sinus beats with P and a normal PQ were classified as SVPCs.
- **A PQ tolerance below 4 px** is rejected. It is below the sheet's precision ceiling, and a constant PQ would look variable.
- **"Non-sinus" on a single deviation and the P share over all complexes** are rejected: cats with HR 224–257 came out as "non-sinus". At HR above 230, P in cats is honestly "not found", and such complexes would count as complexes without P.
- **Checking against the footer HR** is rejected: on `a-07`, `b-01` and `b-02` the footer HR cannot be derived from the visible sheet.

## Consequences

- An SVPC with a PQ close to sinus within a sinus arrhythmia may be missed. This is the price of avoiding false SVPCs.
- In a short case where P is assessed in fewer than 10 complexes, the rhythm type may remain undetermined.
- Open specification debts:
  - an RR pause ≥ 2 × median must not be interpreted as «синусовая аритмия — вариант нормы» ("sinus arrhythmia — a normal variant");
  - the coupling interval for the second and subsequent beats of a run must be measured from the last non-ectopic beat.
- These rules have not yet been clinically validated against the veterinarian's reference conclusions.
