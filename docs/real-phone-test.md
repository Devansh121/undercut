# Real-phone test

What emulation cannot prove, checked by hand on an actual iPhone and an actual Android phone. It
takes about 30 minutes per phone. Everything here that can be checked without a phone already is,
in `tests/browser/phone-device.spec.ts` (iPhone 15 on WebKit, Pixel 8 on Chromium) and the
ten-minute soak in `tests/browser/phone-soak.spec.ts`; this list is the remainder.

## Before you start

- Use the deployed HTTPS address (`docs/DEPLOY.md`). Sound needs a secure page, and an iPhone will
  not trust the self-signed certificate `./start.sh` serves on the local network without a profile
  install.
- Phone charged above 50 %, not in Low Power Mode, brightness at your normal level, ringer on
  (iPhone: the side switch mutes web audio; that is the platform, not a fault).
- Frame times and heap (step 6) are read through the phone's inspector. On Android that is
  `chrome://inspect` in desktop Chrome or Chromium (Linux works) with the phone on USB and USB
  debugging on. On an iPhone it is Safari > Develop > (the iPhone) on a **Mac**; there is no other
  way to reach an iPhone page's console. Without a Mac, do the iPhone's step 6 for heat, battery
  and visible stutter only, and take the numbers from the Android phone. Add `?debug=1` to the
  address for step 6 only.
- Note the phone model, OS version and browser version at the top of your results.

## 1. Home screen (iPhone)

1. Open the address in Safari. On the launch screen a hint explains Add to Home Screen.
2. Share > Add to Home Screen. **Pass:** the icon is the two orange bars on near-black, not a
   screenshot of the page; the name under it is the game's name.
3. Open it from the home screen, holding the phone on its side. **Pass:** a near-black launch image
   with the two bars shows while it loads (not white, not stretched); no Safari address bar or
   toolbar; the status bar area is dark.
4. Turn the phone upright in the menus. **Pass:** the top bar (the game's name and the Controls
   button) sits fully below the Dynamic Island and the status bar, and nothing at the bottom is
   under the home bar. Turn it back on its side: nothing is cut off or doubled.
5. Start a Time Trial and turn the phone upright while driving. **Pass:** the session pauses and a
   prompt at the top asks you to turn the phone, its heading below the Dynamic Island; the pause
   menu under it reaches the bottom without going under the home bar. Turn it back and resume.

Android (Chrome): menu > Install app or Add to Home screen. **Pass:** the icon is the same mark
(on a round or squircle mask, with nothing clipped); opened from the home screen it runs full
screen with no browser bars.

## 2. Side bars and the notch (landscape)

Hold the phone on its side, notch or camera on the left, then turn it so it is on the right.

1. Launch screen, main menu, session settings, circuit select. **Pass:** no text or button sits
   under the notch, the camera island or the rounded corners; the home bar at the bottom covers
   nothing you need to press.
2. Start a Time Trial. **Pass:** steering area, pedals and buttons are all reachable with thumbs and
   none sits under the notch side; the HUD (speed, gear, lap timer, tower) is fully visible on both
   sides.
3. Pause. **Pass:** every pause-menu button, including Quit to menu, is fully visible and pressable.

## 3. Touch behaviour

1. Double-tap quickly on a menu button and on the empty background. **Pass:** the page never zooms.
2. While driving, steer and press throttle with two thumbs at once, then pinch. **Pass:** no zoom,
   no page movement, no browser gesture.
3. Long-press a button and some menu text. **Pass:** no text selection, magnifier, or the
   copy/share callout. (The room-code field in Online may select; that is intended.)
4. Tap buttons. **Pass:** no grey flash over them.
5. Swipe from the left edge while driving (iPhone Safari, not from the home screen). Record what
   happens; going back a page is a platform gesture the game cannot block.

## 4. Sound

1. Fresh load. Go to the main menu and press Start without touching anything else first.
   **Pass:** engine sound is there as the session starts (no extra tap needed).
2. Pause and resume. **Pass:** sound stops and comes back.
3. Mid-session, lock the phone for ten seconds, unlock and resume. **Pass:** sound returns at the
   latest at your first touch on the controls.
4. iPhone: during a session, trigger Siri or take a call, then return. **Pass:** as step 3.
5. Listen for crackles or drop-outs over a full lap, especially in the first lap and with the field
   close by in a Quick Race. Record any.

## 5. Vibration

- **Android, touch controls:** the buttons give a short tick; running over a kerb gives quick pulses;
  hitting a wall or a car gives one stronger pulse. Pause > Vibration > Off stops all of it, and it
  stays off after a reload.
- **iPhone:** Safari has no vibration for web pages; expect none. Pass if nothing else breaks.
- **Gamepad (either phone, Bluetooth pad):** kerbs buzz, impacts thump, Vibration Off stops it.

## 6. Sustained frame rate, heat, battery (10 minutes)

1. Note the battery percentage. Start a Quick Race at Monza, Graphics: Mobile (Pause > Graphics),
   full field, on the `?debug=1` page.
2. In the inspector console, paste this once. It makes the car drive itself and, for ten minutes,
   keeps each minute's frame times (and the heap on Android), then prints minutes 2 to 4 against
   minutes 8 to 10: minute 1 is left out because it includes loading and warm-up, as in the
   emulated soak (`tests/browser/phone-soak.spec.ts`).

   ```js
   (() => {
     const u = __undercut;
     u.raceDriver(true);
     u.resetFrameTimes();
     const rows = [];
     let minute = 0;
     const timer = setInterval(() => {
       const f = u.frameTimes().sort((a, b) => a - b);
       u.resetFrameTimes();
       const heap = performance.memory ? performance.memory.usedJSHeapSize / 2 ** 20 : NaN;
       rows.push({
         minute: ++minute,
         frames: f.length,
         mean: f.reduce((a, b) => a + b, 0) / f.length,
         p95: f[Math.floor(0.95 * f.length)],
         heapMB: heap,
       });
       if (minute < 10) return;
       clearInterval(timer);
       const avg = (from, to, k) =>
         (rows.slice(from - 1, to).reduce((a, r) => a + r[k], 0) / (to - from + 1)).toFixed(1);
       console.table(rows);
       console.log('minutes 2-4 vs 8-10', {
         mean: [avg(2, 4, 'mean'), avg(8, 10, 'mean')],
         p95: [avg(2, 4, 'p95'), avg(8, 10, 'p95')],
         heapMB: [avg(2, 4, 'heapMB'), avg(8, 10, 'heapMB')],
       });
     }, 60_000);
   })();
   ```

3. Leave the phone in your hand or on the table, screen on, for the ten minutes. Watch for a
   stutter that repeats, and feel the back of the phone.
4. **Pass:** each minute has at least 1,800 frames, the 30 fps floor (about 3,600, 60 fps, is the
   target on a recent mid-range phone; record the count either way, and below 1,800 record a
   fail); p95 for minutes 8 to 10 within 25 % of minutes 2
   to 4 (throttling shows as a steady climb); heap (Android) for minutes 8 to 10 within 15 % of
   minutes 2 to 4; no stutter pattern; the phone warm but not too hot to hold; battery drop
   recorded.
5. Audio cost: open the page with `?debug=1&audioProfile=1`, run a lap, then
   `__undercut.audioProfile()`. **Pass:** `processMs / audioMs` under 0.10 (10 % of one core).

## Recording results

Add a dated section to `docs/STATUS.md` (Try this or Known gaps) with the phone, OS and browser,
each step's pass or fail, the table step 6 prints, the battery drop, and screenshots of
anything that failed (`docs/evidence/m6-phone/`).
