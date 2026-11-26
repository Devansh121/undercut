# Race UI fixes

Browser captures from the production build with software WebGL and the browser tests' light
rendering preset, at the browser test sizes: desktop 1440×900 and landscape phone 844×390 (phone
captures scaled from 2× to 1266 px wide). They prove the interface, not the scene.

| Frame | What |
| --- | --- |
| `desktop-race-options.jpg` | Championship on Monza. Session settings carry a Race distance row (5 laps, 15 laps, 53 laps), and the footer summary reads "5 laps". |
| `phone-race-options.jpg` | The same on a phone: the summary card reads "5 laps · Afternoon · Keyboard assists", and the labelled Race options control opens the dialog. |
| `desktop-reference-tyres.jpg`, `phone-reference-tyres.jpg` | Time Trial out lap: the tyre panel shows fresh softs at the reference temperature, with no empty-data note. |
| `desktop-race-lap2.jpg` | Quick Race, lap 2 of 2: LAST and BEST read the race timer (1:27.138), and the 20-car tower gaps rise down the order. |
| `phone-lap1-pit-call.jpg` | Phone, lap 1 with a pit call open: the pit wall instruction shows and the first-lap hint is hidden. |
