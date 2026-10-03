# 0007. Honest confidence instead of unreliable numbers

## Context

The previous application showed a green «качество хорошее» ("quality good") while the numbers were wrong. Question Q6 offered a choice: always output numbers, or show honest confidence that blocks measurements and give the veterinarian manual correction. The owner chose the latter.

## Decision

- **Confidence** is a number 0..1 and a list of reasons at three levels: lead, beat, measurement. The "unreliable" threshold is 0.6; all thresholds are kept in one place.
- **A value below the threshold** is not output as a number. Instead it shows «ненадёжно, проверьте разметку» ("unreliable, check the markup") with the reason.
- **An unreliable lead II** blocks wave measurements. HR and arrhythmias are then computed from the other leads, with a note.
- **Manual edits.** The veterinarian edits the baseline, labels, lead separators and wave markers directly on the sheet. Edits take precedence over automation; after them everything is recomputed, and the conclusion gets a note about manual correction.
- **Self-check.** The program compares the intervals it found with the printed HR values.

## Why

- **Always output numbers** is rejected: that is exactly how the previous application produced wrong measurements that could not be used (R04).
- **One overall sheet quality score**, as in the previous application, is rejected: it does not show which lead, beat or number cannot be trusted. The veterinarian needs to know what to check.
- **Only a warning without blocking the number** is rejected: a displayed number ends up in the patient record anyway.

## Consequences

- The veterinarian sometimes gets no numbers at all and has to edit the markup. The table may consist entirely of "unreliable", and the conclusion may reduce to «Автоматический анализ невозможен: …» ("Automatic analysis is impossible: …").
- Every new module must return confidence with reasons. A module that returns only a value violates the contract.
- The 0.6 threshold is set by the specification. There is no clinical validation against the veterinarian's reference yet.
- If the HR digits were not read, the self-check is unavailable: confidence neither rises nor falls because of it.
