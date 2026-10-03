# 0003. Browser only: no server, no neural networks, recognition in workers

## Context

The previous documentation required a fully client-side application (TECH-01), and the "no ML" question stayed open until the change of approach (R12i). Where the veterinarian will open the application is not decided yet: publishing was postponed (Q12).

## Decision

The application builds into a static `dist/` folder and works without a server part. Recognition is built on classical deterministic image-processing methods; there are no neural networks. Sheets are recognized in a Web Worker; for a multi-sheet case a pool of up to three workers runs. Case state is kept in the tab's memory.

## Why

- **A backend** is rejected. It is outside v1 per the previous documentation, and the owner decided to deal with publishing later. The static build opens both locally and from any static hosting, so the choice of hosting does not block the work.
- **A neural network in the browser** is rejected by the answer to Q4: the owner chose option 1, the classical approach. Caveat: if the approach hits a measurable problem, it will be resolved together with the owner, not silently.
- **Recognition on the main thread** is rejected: the UI would freeze while a sheet is processed, which violates TECH-05.
- **A single worker** is rejected: the sheets of a case would wait for each other in the queue.

## Consequences

- Reloading the tab loses the case; the browser only warns on close. There is no saving of cases and no user accounts.
- Speed and memory are limited by the veterinarian's machine: no more than 6 s per sheet (target 2 s), no more than 200 MB of memory for a 5-sheet case. A 30-sheet case fits this budget only if just the grayscale image and the results are kept.
- In a browser without Web Worker or OffscreenCanvas the application does not work and shows the message «нужен современный браузер» ("a modern browser is required").
- The clipboard works only over HTTPS or on localhost. Otherwise the text is shown in a window for manual copying.
- If a worker crashes, the sheet goes back to the queue, but is retried no more than twice.
- Any machine-learning model in the future is a revision of this decision with the owner, not a technical detail.
