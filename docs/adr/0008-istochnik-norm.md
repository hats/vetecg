# 0008. Norms follow the Tilley reference source, not the previous documentation

## Context

The project's previous documentation already had norm tables for dogs and cats. The owner asked for them to be independently re-checked against the sources and for discrepancies to be fixed (G05).

## Decision

- **The reference source** is the norm table of Tilley & Smith (Electrocardiography) and Tilley 1992. Discrepancies between sources are described in `docs/normy-ekg.md`.
- **The code** gets one value per parameter; each row states its source.
- **Borderline zones absent from the literature** (QRS +0.01 s, S in cats, ST) are marked with the source «ПРОЕКТ» ("PROJECT").
- **The beat detector range** (40–320 bpm) is kept separate from the clinical norm.

## Why

- **Keeping the previous values** is rejected: the review found errors in them. Among them: P duration in large dogs, splitting PQ by size, QT limits for dogs and cats, P amplitude in large dogs, and swapped VPC/APC expansions. In addition, norms for QRS, R, Q and S were missing.
- **Setting lower limits for P, T and R** is rejected: a low P and a flat T are normal, and a lower limit would produce false deviations.
- **Treating sinus arrhythmia in a cat as unconditional pathology** (literally per AXIS-03) is rejected: the sources do not call it that. The classification "deviation" is kept, with the wording «для кошки в клинике нехарактерна, требует внимания» ("uncharacteristic for a cat in the clinic, requires attention").
- **QTc for cats** is rejected: there is no correction standard for cats, so QT is shown together with HR.

## Consequences

- There is no consensus on HR in cats: 140–220 is taken from the reference source, with a note in the document.
- «ПРОЕКТ» zones are project conventions, not literature. The veterinarian must know this.
- Changing the reference source would require revising the table, the borderline zones, the arrhythmia thresholds and the conclusion dictionary.
- There are no breed-specific norms (V2-02). Clinical acceptance of the norms by the veterinarian is still ahead.
