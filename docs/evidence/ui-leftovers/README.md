# Interface leftovers

Browser captures from the production build, software WebGL, at the browser test sizes: desktop
1440×900 and landscape phone 844×390 (phone captures scaled from 2× to 1266 px wide).

| Before | After | What |
| --- | --- | --- |
| `before-pause-update-desktop.jpg` | `after-pause-update-desktop.jpg` | Pause on a desktop with the "new version" bar up. Before: the bar covers the card and Quit is 330 px below the card's bottom edge. After: the settings scroll inside the card, Quit and the controls list are in view, the card ends above the bar. |
| `before-pause-update-phone.jpg` | `after-pause-update-phone.jpg` | The same on a landscape phone. Before: the bar covers the card's foot. After: the card ends above the bar. |
| `before-offline-medium-desktop.jpg`, `before-offline-medium-phone.jpg` | `after-offline-medium-desktop.jpg`, `after-offline-medium-phone.jpg` | Offline, Time Trial with Medium chosen in the pause menu (not Auto). Before: a download error with Try again, which cannot work offline. After: the session runs on Mobile, with a HUD note. |
| | `result-desktop.jpg`, `result-phone.jpg` | Quick Race result after the player retires: names and "Retired", no car codes or status ids (fixed in #52, pinned by `quick-race.spec.ts`). |

Measured on the desktop pause card before the change: card 846 px tall, content 1201 px,
Quit at y 1148 to 1204. After: content 846 px, Quit at y 793 to 849.
