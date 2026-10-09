# @qsd/video

The 20-second product video, rendered from the site's own parts rather than
generated: the quantum stack (`@qsd/scene/stack`), the hero dial, the
blueprint callouts and the terminal panels from the home page, on the site's
palette and fonts.

```
pnpm --filter @qsd/video render                      # out/qsd-product-video.mp4 (1920×1080, 30 fps, 20 s)
VIDEO_FPS=60 pnpm --filter @qsd/video render         # smoother, twice the render time
VIDEO_STILLS=0,5.5,9,12,15,19 pnpm --filter @qsd/video render   # PNG stills in out/stills/
pnpm --filter @qsd/video dev                         # the page in a browser (window.__seek(t) scrubs it)
```

`src/main.tsx` is the page: one 1920×1080 stage whose every element is laid
out for a virtual time `t` by `window.__seek(t)`. `scripts/render.ts` builds
it with Vite, opens it in headless Chromium (software GL), freezes the page
clock, steps `t` one frame at a time and pipes each screenshot into ffmpeg
(libx264, crf 17). Every frame is a pure function of `t`, so the render is
deterministic apart from the real XMSS run the page computes on load.

Like the site, nothing in the video poses as live data: the identity panel is
a real WOTS+/XMSS key, signature and verification computed in the page; the
decay and resolver panels print protocol constants; the stack is labelled an
illustration. The fonts under `public/fonts/` are fetched from Google Fonts
and not committed.
