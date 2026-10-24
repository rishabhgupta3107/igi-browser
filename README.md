# Project I.G.I. in your browser and on your desktop

Play your own copy of **Project I.G.I.: I'm Going In** (2000) in a web browser, or as an app on a Mac or a
Windows PC. It's the original game, translated from its Windows program into code that runs anywhere, with
no emulator. On top of it: widescreen, sharper graphics, controller support, aiming, a Max Payne-style dive
in slow motion, and cheat codes.

You need the game itself: this project doesn't include any of its files.

![A mission in widescreen](screenshots/mission.jpg)

## Play

**In your browser:** [rishabhgupta3107.github.io/igi-browser](https://rishabhgupta3107.github.io/igi-browser/)
in a current Chrome, Edge or Safari on a computer (the game needs WebGPU).

**Or download the app:**

- **Mac with Apple chip (M1 or later):** [Project-IGI-Mac-Apple-Chip.zip](https://github.com/rishabhgupta3107/igi-browser/releases/latest/download/Project-IGI-Mac-Apple-Chip.zip)
- **Mac with Intel:** [Project-IGI-Mac-Intel.zip](https://github.com/rishabhgupta3107/igi-browser/releases/latest/download/Project-IGI-Mac-Intel.zip)
- **Windows (64-bit):** [Project-IGI-Windows.zip](https://github.com/rishabhgupta3107/igi-browser/releases/latest/download/Project-IGI-Windows.zip)

Not sure which Mac you have? Apple menu > **About This Mac**: "Chip: Apple M…" is an Apple chip, "Processor: …
Intel" is Intel.

Every version and what changed: [Releases](https://github.com/rishabhgupta3107/igi-browser/releases).

## Install

The apps aren't registered with Apple or Microsoft, so the first launch asks you to confirm.

**Mac**

1. Double-click the zip, then drag **Project IGI** into your Applications folder.
2. Double-click it. macOS says it can't check the app: click **Done**.
3. Open **System Settings > Privacy & Security**, scroll down to "Project IGI was blocked", and click
   **Open Anyway**, then **Open**. From then on it opens normally.

If macOS says the app "is damaged", open Terminal and run
`xattr -dr com.apple.quarantine "/Applications/Project IGI.app"`, then open it again.

**Windows**

1. Right-click the zip, **Extract All…**, and open the **Project IGI** folder.
2. Double-click **Project IGI.exe**. If "Windows protected your PC" appears, click **More info**, then
   **Run anyway**.

## First run

The first time, the game asks for your IGI folder: the one with `IGI.exe` in it. If you installed from the CD,
copy `YMBE.AFP`, `ANYS.AFP` and `MPZM.AFP` from the CD's top folder into that folder first. The files are copied
into the app's (or the browser's) own storage once; next time it starts straight away.

Your saves stay on your computer, in that storage: the browser's saves are separate from the app's.

## Playing

| | Keyboard and mouse | Controller |
|---|---|---|
| Move | Arrow keys | Left stick |
| Look | Mouse | Right stick |
| Fire | Left button | RT |
| Aim (hold) | Right button | LT |
| Dive in slow motion | Middle or thumb button | LB |
| Next / previous weapon | Mouse wheel | Y |
| Jump | Numpad 0 | A |
| Crouch | Right Ctrl | B |
| Reload | Enter | X |
| Use / activate | Right Shift | RB |
| Binoculars | Space | D-pad right |
| Map | C | Back |
| Quick save / quick load | F5 / F9 | |
| Menu, skip a cutscene | Esc | Start |

Any controller works: Xbox, PlayStation, Switch Pro and most others. Plug it in and press a button.

**The dive:** while moving, press the dive button. You jump that way and everything slows down until just after
you land, while your aim stays quick. It uses the meter at the bottom of the screen, which refills by itself.

**Cheats:** type them during a mission, as in GTA (no need to pause). Type one again to turn it off.

| Code | Effect |
|---|---|
| `HEALTHY` | You take no damage |
| `BULLETS` | Infinite ammo and grenades |
| `NEVEREMPTY` | No reloading |
| `MATRIX` | More bullet time: **B** slows everything while the meter lasts, and every kill slows the game for a moment |
| `TERMINATE` | All of them |

## Updates

The website is always the latest version. The apps tell you when a new one is out (and **Help > Check for
Updates…**): download it and replace the old app. Your game files and saves stay where they are.

## Privacy

The website counts visits and games started with [GoatCounter](https://www.goatcounter.com): no cookies, nothing
that identifies you. The apps only ask GitHub whether there's a newer version. Your game files never leave your
computer.

## Credits

Built on [cricket07-browser](https://github.com/Dhaiwat10/cricket07-browser) by Dhaiwat Pandya, which showed how
to translate a Windows game to run in a browser, and in the spirit of
[cricket07-desktop](https://github.com/udeshvirk/cricket07-desktop) by Udesh Kumar.

![The intro: Jones lands on the train](screenshots/intro.jpg)

![The main menu](screenshots/menu.jpg)

![Diving in slow motion](screenshots/dive.jpg)

## Legal

Project I.G.I. was made by Innerloop Studios and published by Eidos Interactive; its name is a trademark of its
current owner. This is a fan project, not affiliated with or endorsed by them. It doesn't include or distribute
the game's files: you play with your own copy.
