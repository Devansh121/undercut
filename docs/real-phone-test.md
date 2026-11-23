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
- For frame times and heap you need the phone's inspector: Safari > Develop > (the iPhone) on a Mac,
  or `chrome://inspect` on a desktop Chrome with the Android phone on USB. Add `?debug=1` to the
  address for those steps only.
- Note the phone model, OS version and browser version at the top of your results.

## 1. Home screen (iPhone)

1. Open the address in Safari. On the launch screen a hint explains Add to Home Screen.
2. Share > Add to Home Screen. **Pass:** the icon is the two orange bars on near-black, not a
   screenshot of the page; the name under it is the game's name.
3. Open it from the home screen, holding the phone on its side. **Pass:** a near-black launch image
   with the two bars shows while it loads (not white, not stretched); no Safari address bar or
   toolbar; the status bar area is dark.
4. Rotate to upright and back. **Pass:** the upright screen asks you to turn the phone; nothing is
   cut off or doubled when you return.

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
   full field.
2. In the inspector console run `__undercut.raceDriver(true)` so the car drives itself (debug page),
   or drive it yourself.
3. At minute 1 and minute 10, in the console:

   ```js
   (() => {
     const f = __undercut.frameTimes().slice(-1800).sort((a, b) => a - b);
     const at = (p) => f[Math.floor(p * f.length)].toFixed(1);
     return { mean: (f.reduce((a, b) => a + b, 0) / f.length).toFixed(1), p50: at(0.5), p95: at(0.95) };
   })();
   ```

   and, on Android Chrome only, `performance.memory.usedJSHeapSize / 2 ** 20` (MB).
4. **Pass:** p95 at minute 10 within 25 % of minute 1 (throttling shows as a steady climb); heap at
   minute 10 within 15 % of minute 1; no visible stutter pattern; the phone warm but not too hot to
   hold; battery drop recorded.
5. Audio cost: open the page with `?debug=1&audioProfile=1`, run a lap, then
   `__undercut.audioProfile()`. **Pass:** `processMs / audioMs` under 0.10 (10 % of one core).

## Recording results

Add a dated section to `docs/STATUS.md` (Try this or Known gaps) with the phone, OS and browser,
each step's pass or fail, the minute-1 and minute-10 numbers, the battery drop, and screenshots of
anything that failed (`docs/evidence/m6-phone/`).
