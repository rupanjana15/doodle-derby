# Doodle Derby

Draw a car, turn it into 3D with [Vi3W](https://app.vi3w.in), and race it around a sketchbook circuit against up to seven crayon rivals, alone or with a friend in split screen.

Plain HTML + ES modules + Three.js from a CDN. There's no build step.

## Run

```bash
python3 serve.py
```

Then open http://localhost:5173.

## Controls

| | Drive | Drift | Boost | Back on track |
|---|---|---|---|---|
| One player | ↑↓←→ or WASD | Space | Shift | R |
| Two players: P1 | WASD | Space | Left Shift | R |
| Two players: P2 | Arrows | / | Right Shift | . |

On phones, on-screen buttons appear (one player only). A car stuck against a wall for a few seconds is put back on the road automatically.

**Boost:** the meter fills slowly by itself. Hold a drift for more than about half a second and let go to earn a chunk of boost.

## Garage

- **Players:** click **+ Player 2** for split screen on one keyboard, or ✕ on the P2 tab to remove them. Each player picks their own car, paint and handling.
- **Paint:** recolour the doodle cars. Vi3W cars keep their own texture.
- **Handling:** split 12 points across Top speed, Acceleration, Grip and Steering (1–5 each). The presets (Balanced / Heavy / Light / Drifty) fill these in for you.
- **Race:** 0–7 opponents, 1–9 laps, and Easy / Normal / Hard rivals.

## Getting your Vi3W car in

1. In the garage, click **✏️ Draw a car** and save the sketch PNG (or draw on paper and take a photo).
2. Upload the sketch to Vi3W and export the model as **.glb**.
3. Drop the .glb, plus the sketch image if you have it, onto the garage. The game scales and centres the model and adds ink outlines. If the car faces the wrong way, press **↻ Rotate model**.
4. Set up its paint and handling, then race. Your sketch is shown in the corner while you drive.

To ship cars with the build, put the files in `cars/` and list them in `cars/cars.json`:

```json
[
  { "name": "Banana Bolt", "model": "cars/banana.glb", "sketch": "cars/banana.png", "preset": "drifty", "turns": 0 }
]
```

`turns` is the number of quarter turns to rotate the model (0–3). Leave it out and the game guesses.

`extras` adds parts that are drawn in code, for things the export left out. The options are in `EXTRAS` in `src/models.js`. For example, `"extras": ["crystals"]` puts glass crystal peaks on the Crystal Drill's roof, because Vi3W's mesh didn't include them.

## Code map

- `src/track.js`: spline circuit, road, kerbs, tyre walls, scenery
- `src/car.js`: arcade physics, tuning stats and presets, boost, AI driver, car-to-car collisions
- `src/models.js`: placeholder doodle cars, GLB loading and normalising
- `src/toon.js`: cel shading and the ink-outline effect
- `src/main.js`: garage, players and opponents, race flow, laps, split-screen HUD and cameras
- `serve.py`: dev server that turns off browser caching
