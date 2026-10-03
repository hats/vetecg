# 0002. Rewrite the whole application from scratch

## Context

The previous application drew the curve off the printed one, understated waves by 2–4×, lost beats, and still showed «качество хорошее» ("quality good"). The owner allowed starting from scratch (R06) and said he does not trust the other parts either (G02).

## Decision

The whole application is written anew; the scope is the full list of v1 requirements from `.planning/REQUIREMENTS.md` (answer Q3b "B"). The old `src/` is deleted; its history stays in git. OpenCV.js, pdfjs-dist and fili are removed; filters are written in-house. TypeScript and Vite stay.

## Why

- **Improving the current algorithm** (the first branch of R05) is rejected. The defects turned out to be in the approach to the trace itself, not in the settings, and "patching is pointless".
- **Rewriting only the "image → signal" stage** as a new module and adapting the rest was the recommendation for Q3. Rejected by the owner's answer "I don't trust the other parts either". The lower stages of the previous pipeline (beats, measurements, table) had not been checked on real sheets either.
- **Rewriting only what exists now** (up to the lead II measurement table) is rejected by answer Q3b. Manual wave correction, axis and rhythm across six leads, arrhythmias and the conclusion are in scope.
- **Keeping OpenCV.js** is rejected: in the old code the library was never initialized and was 10.9 MB of dead weight. pdfjs is rejected because PDF input is out of scope. fili is rejected because the needed filters take tens of lines, while the library adds an extra contract.
- **Replacing TypeScript and Vite** is pointless: the owner already has them installed, tests and build work.

## Consequences

- Nothing from the previous code is reused as "verified". Every capability of the previous application is proven again by a test (R08i).
- The scope is large: 51 v1 requirements plus the briefing requirements. Clinical acceptance of measurements, axis, arrhythmias and the conclusion can only happen after delivery, against the veterinarian's reference results.
- PDF input is not supported: the veterinarian gets the message «сохраните как изображение» ("save as an image").
- `.planning/` remains an archive of the previous process. Decisions from there do not apply unless carried over into the specification.
