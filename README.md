<h1 align="center">nightwire</h1>

<p align="center"><b>A night city you can fly through, in one 39 KB HTML file.</b><br/>
Every building is a host. Every light is a packet. Click a building to scan it.</p>

<p align="center">
  <a href="https://maulanawirawan.github.io/nightwire/"><b>▶ Fly it live</b></a>
  ·
  <a href="index.html">read the source</a>
</p>

<p align="center">
  <a href="https://maulanawirawan.github.io/nightwire/"><img src="media/preview.webp" width="100%" alt="Flying down a neon avenue between lit towers, then past a green spire spraying packets across the city. Scanned buildings turn green and fire a beam into the sky."/></a>
</p>

## What you're looking at

- **3,297 hosts.** Each tower is a procedurally generated building. They have lit windows, neon edges, and blinking aircraft lights.
- **Packets.** About 870 light streaks arc between rooftops. The green ones come from the core spire in the middle.
- **Traffic.** Headlights and tail lights run down every street.
- **A radar sweep.** It circles out from the core and lights up each building as it passes.
- **The evidence ladder.** Clicking a building scans it, and the scan climbs `L0 OBSERVED → L1 SUSPECTED → L2 REPRODUCED → L3 VERIFIED ✓`. The building only turns green and fires a beam once the finding is proven. It's the same rule as [secai](https://github.com/maulanawirawan/secai): a finding you can't prove is a lead, not a claim.
- **Sound.** The drone, the city hum, and the scan chimes are all synthesized live with the Web Audio API.

## Controls

| | |
|---|---|
| drag | look around |
| `W A S D` / arrows | fly |
| `E` / `Q` | up / down |
| `Shift` | boost |
| scroll | flight speed |
| click | scan a building |
| `C` | back to the cinematic tour |
| `H` | hide the HUD |
| `M` | sound on / off |
| two-finger hold (touch) | fly forward |

Until you touch anything, the camera runs a cinematic tour and scans buildings by itself.

## How it's built

There's one file, `index.html`. It has no libraries, no images, no models, and no audio files.

- **Rendering:** raw WebGL2, which runs on desktop and mobile browsers.
- **Buildings:** a single unit cube drawn 3,297 times with instancing. Windows, edges, the radar, and the verified state are all done in the fragment shader.
- **Packets:** camera-facing ribbons. Their position along each arc is computed in the vertex shader from time alone, so the CPU does no per-packet work.
- **Glow:** an HDR scene buffer, then a two-level bloom, then a tone map.
- **Camera tour:** a closed Catmull-Rom spline, reparameterised by arc length so the speed stays constant. It is checked so it never clips a building.
- **Scan picking:** the click is a ray marched across the city grid on the CPU.
- **Quality:** resolution scales down on its own when the frame rate drops. Add `?q=low` to force it lower.

## Run it locally

Open `index.html` in a browser. There's no build step.

## License

MIT
