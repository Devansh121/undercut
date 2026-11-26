# Online screens

Before: master `334c16d`. After: this branch. Screenshots captured from the production build with Playwright at 1440×900 (desktop) and 844×390 (landscape phone), and inspected directly.

| Screen | Before | After |
| --- | --- | --- |
| Desktop lobby | [Before](before-lobby-desktop.png) | [After](after-lobby-desktop.png) |
| Phone lobby | [Before](before-lobby-phone.png) | [After](after-lobby-phone.png) |
| Desktop results | [Before](before-results-desktop.png) | [After](after-results-desktop.png) |
| Phone results | [Before](before-results-phone.png) | [After](after-results-phone.png) |

The existing online acceptance test supplies the two named players, invite, one-lap finish, rematch and host migration. Its race timing floor is shortened for the acceptance segment; the screenshots' lap times are test data, not circuit performance evidence.

The lobby regression tests traverse every enabled control using keyboard arrows and an injected standard gamepad at both sizes, activate controls through Enter/A, adjust a number with the pad, preserve focus across settings changes, and check that Ready and Leave remain in view after scrolling. The original name-selection regression is retained. Touch joining, readiness and leaving are exercised by the existing two-context online test.

Validation on this branch:

- Final production build: passed; JS 0.57 MiB, largest first-race transfer 11.34 MiB.
- Final online + lobby browser run: 6 passed, 2 intentionally skipped, 50.7 s.
- Broader online and local race-display run: 18 passed, 2 intentionally skipped, 6.6 min. This covers every circuit, AI fill, takeover, latency/loss, contact, and local classification at both viewports.
- Targeted classification and online unit tests: 12 files passed, 78 passed, 3 skipped.
- Lint and typecheck: passed.

The first CI rooms-soak run exceeded its unchanged 3 m maximum interpolation bound (3.635 m, p99 4.13 cm). A local diagnostic run did not reproduce it (maximum 0.937 m, p99 4.09 cm). The soak now prints the worst sample’s mode and timing offsets; no assertions, tolerances, or protocol behaviour changed. See the PR checks for the final head’s result.
