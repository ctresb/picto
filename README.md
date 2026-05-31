<p align="center">
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/logo.png" alt="picto" width="340" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/latte.gif" width="92" alt="Latte dancing" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/kiwi.gif" width="92" alt="Kiwi dancing" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/goose.gif" width="92" alt="Goose dancing" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/waffle.gif" width="92" alt="Waffle dancing" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/mango.gif" width="92" alt="Mango dancing" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/udon.gif" width="92" alt="Udon dancing" />
</p>

<p align="center">
  <strong>Give it a name. Get a little guy.</strong><br/>
  Tiny React library for procedural SVG characters (I call them <em>pictos</em>).
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.1-ff69b4" alt="version" />
  <img src="https://img.shields.io/badge/TypeScript-ready-3178c6?logo=typescript&logoColor=white" alt="typescript" />
  <img src="https://img.shields.io/badge/React-%E2%89%A5%2017-61dafb?logo=react&logoColor=white" alt="react" />
  <img src="https://img.shields.io/badge/runtime%20deps-0-22c55e" alt="zero deps" />
  <img src="https://img.shields.io/badge/license-MIT-22c55e" alt="license" />
  <img src="https://img.shields.io/badge/pictos-%E2%88%9E-8b5cf6" alt="infinite pictos" />
</p>

---

## What is this?

`pictoguys` makes cute little SVG characters out of thin air.

You hand it a number or a word. It hands you back a character: a colored body,
some eyes, eyebrows, and (if you want one) a background tile. The same word
always makes the exact same character, so "Bloop" is always Bloop, on every
device, forever.

Think of it like a profile-picture generator, except:

- the art is real vector SVG (crisp at any size, never blurry),
- there are no image files to download (the parts are baked into the library),
- and the little guys can blink, hop, breathe, and dance.

No design skills needed. You do not draw anything. You just pick a seed.

## What is a "picto"?

A **picto** is one character. That is the whole vocabulary you need.

Every picto is built from a few parts that get mixed and recolored:

| Part        | Choices                                  |
| ----------- | ---------------------------------------- |
| body color  | 10 hand-picked colors, plus blended ones |
| body shape  | 4 shapes                                 |
| eyes        | single, double, or triple                |
| eye coloring| plain, two-tone, or rainbow              |
| background  | 5 tiles                                  |

Pick those yourself, or let a seed pick them for you. Either way you get a picto.

## Install

```bash
npm install pictoguys
```

For React components, bring your own `react` (version 17 or newer). For SVG-only
usage, import from `pictoguys/core` and React is not loaded. There are zero
runtime dependencies.

| Import path | Use it for |
| ----------- | ---------- |
| `pictoguys` | React projects that want `<Picto />` plus the core helpers |
| `pictoguys/react` | Only the React component and its props |
| `pictoguys/core` | SVG strings, characters, presets, and catalog helpers without React |
| `pictoguys/rng` | The tiny deterministic RNG only |

## Your first picto

Drop this into any React component:

```tsx
import { Picto } from 'pictoguys'

export default function App() {
  return <Picto seed="Bloop" size={120} />
}
```

That is it. You just rendered Bloop.

`seed` can be a word (`"Bloop"`) or a number (`7`). Same seed, same picto, every
single time. Change the word, get a different friend.

## Meet some pictos

Here is what a handful of names look like. Try your own.

|  |  |  |  |  |  |
|:-:|:-:|:-:|:-:|:-:|:-:|
| <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/bloop.svg" width="76" alt="Bloop"/> | <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/mochi.svg" width="76" alt="Mochi"/> | <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/zorp.svg" width="76" alt="Zorp"/> | <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/waffle.svg" width="76" alt="Waffle"/> | <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/gizmo.svg" width="76" alt="Gizmo"/> | <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/noodle.svg" width="76" alt="Noodle"/> |
| `"Bloop"` | `"Mochi"` | `"Zorp"` | `"Waffle"` | `"Gizmo"` | `"Noodle"` |
| <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/tofu.svg" width="76" alt="Tofu"/> | <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/bubbles.svg" width="76" alt="Bubbles"/> | <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/sprocket.svg" width="76" alt="Sprocket"/> | <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/pickle.svg" width="76" alt="Pickle"/> | <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/goose.svg" width="76" alt="Goose"/> | <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/wizard.svg" width="76" alt="Wizard"/> |
| `"Tofu"` | `"Bubbles"` | `"Sprocket"` | `"Pickle"` | `"Goose"` | `"Wizard"` |

Waffle and Bubbles got fancy multi-colored eyes. Lucky.

## Three ways to make a picto

**1. By name (a word).** Great for usernames, emails, anything text.

```tsx
<Picto seed="ada@example.com" />
```

**2. By number.** Great when you just want "give me number 42".

```tsx
<Picto seed={42} />
```

**3. By hand.** Want an exact look? Spell it out. Anything you leave out gets
filled in for you.

```tsx
<Picto
  config={{
    color: 'pink',     // 'blue' 'cian' 'gray' 'green' 'lime'
                       // 'orange' 'pink' 'purple' 'red' 'yellow'
    shape: 2,          // 1, 2, 3, or 4
    eyes: 'triple',    // 'single' | 'double' | 'triple'
    mode: 'triad',     // 'mono' (plain) | 'hetero' (two-tone) | 'triad' (rainbow)
    bg: 4,             // 1 to 5
  }}
/>
```

<p align="center">
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/custom.svg" width="120" alt="custom pink triple-eye picto" />
</p>

Using TypeScript? Import the config type for full autocomplete:

```ts
import type { CharConfig } from 'pictoguys'

const cfg: CharConfig = { color: 'blue', eyes: 'double' }
```

## Constraints and branding (the fun part)

Here is the one rule that gives you total control. For **every** setting:

| You write          | You get                          |
| ------------------ | -------------------------------- |
| nothing (omit it)  | fully random (picked by the seed)|
| one value          | locked to that value             |
| an array of values | random, but only from that set   |

Mix and match freely. Add a `seed` (like a user id) and the random parts become
stable per person.

### "Use my brand color on every avatar"

Set your brand once with `picto.preset(...)`, then stamp out users. Each person
keeps your color but gets their own body and face. You can pass a brand **hex**
straight in, and a matching darker shade is generated for the gradient.

```tsx
import { picto, Picto } from 'pictoguys'

const brand = picto.preset({ color: '#19c37d' }) // your green

function Avatar({ userId }) {
  const me = React.useMemo(() => brand.character(userId), [userId])
  return <Picto char={me} size={96} />
}
```

<p align="center">
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/brand-1.svg" width="84" alt="" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/brand-2.svg" width="84" alt="" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/brand-3.svg" width="84" alt="" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/brand-4.svg" width="84" alt="" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/brand-5.svg" width="84" alt="" />
</p>

<p align="center"><em>Same brand green. Different bodies and faces. One per user.</em></p>

### "Always this body, random colors, no random face"

Lock the shape and the face, let the color come from the seed:

```tsx
<Picto
  config={{
    seed: userId,
    shape: 2,          // always this body
    eyes: 'double',    // always this face
    brow: 'double_1',  //   "
    mode: 'mono',      // always plain eyes
    // color is left out, so it is the only thing that changes per user
  }}
/>
```

<p align="center">
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/shapelock-1.svg" width="84" alt="" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/shapelock-2.svg" width="84" alt="" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/shapelock-3.svg" width="84" alt="" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/shapelock-4.svg" width="84" alt="" />
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/shapelock-5.svg" width="84" alt="" />
</p>

<p align="center"><em>Same shape, same plain face. Only the color rolls.</em></p>

### Random, but only from a set

Want variety, but inside guardrails? Pass arrays:

```tsx
// only ever shapes 1 or 3, only double or triple eyes, only your two greens
<Picto
  config={{
    seed: userId,
    shape: [1, 3],
    eyes: ['double', 'triple'],
    color: ['green', 'lime'],
  }}
/>
```

### Brand colors, spelled out

`color` accepts an anchor name (`'blue'`), a brand hex (`'#19c37d'`, auto-gradient),
or an array of either. For full manual control, set both gradient stops yourself
with `light` and `dark`. Want to preview the gradient a hex would make?

```ts
import { picto } from 'pictoguys'

picto.gradient('#19c37d') // { light: '#19c37d', dark: '#003329' }
picto.gradient(140)       // a gradient for hue 140 degrees
```

> **Tip:** pass something stable as the `seed` (a user id, an email, a username)
> so the same person always lands on the same picto.

## Make them move

Two ways, pick whichever feels easier.

**The easy way: just ask for an animation.**

```tsx
<Picto seed="Gizmo" animate="breath" />
```

Animations available: `"blink"`, `"jump"`, `"breath"`, `"dance"`, `"sleeping"`.
`breath`, `dance`, and `sleeping` loop forever. `blink` and `jump` play once.

**The hands-on way: tell a specific picto to do something.**

First make a picto with `picto.character(...)`, then call methods on it:

```tsx
import { picto, Picto } from 'pictoguys'

function Mascot() {
  const guy = React.useMemo(() => picto.character('Gizmo'), [])

  return (
    <>
      <Picto char={guy} size={140} />
      <button onClick={() => guy.blink()}>blink</button>
      <button onClick={() => guy.dance()}>dance</button>
      <button onClick={() => guy.sleep()}>sleep</button>
      <button onClick={() => guy.stop()}>chill</button>
    </>
  )
}
```

```ts
guy.blink()    // one blink
guy.jump()     // one hop
guy.breath()   // breathe (loops)
guy.dance()    // dance (loops)
guy.sleep()    // sleep with Zs (loops)
guy.stop()     // freeze
```

> **Heads up for beginners:** `guy.blink()` works by poking the `<Picto char={guy} />`
> on screen. If that picto is not currently rendered, the call simply does
> nothing (no crash, no error, just a no-op). So render it first, then animate it.

## All the props

`<Picto>` accepts these. Everything is optional.

| Prop         | Type                                   | Default | What it does                              |
| ------------ | -------------------------------------- | ------- | ----------------------------------------- |
| `seed`       | `number \| string`                     | `0`     | Build a picto from a number or a word.    |
| `config`     | `CharConfig`                           | none    | Build a picto from exact settings.        |
| `char`       | `Character`                            | none    | Use a picto you already made (wins).      |
| `size`       | `number`                               | `120`   | Width and height, in pixels.              |
| `background` | `boolean`                              | `false` | Set `true` to add a background tile.      |
| `animate`    | `"blink" \| "jump" \| "breath" \| "dance" \| "sleeping"` | none | Play an animation on loop or once.      |

Any normal `<span>` prop works too (`className`, `style`, `onClick`, and so on),
because that is what `<Picto>` renders into.

Pictos are see-through by default, so they sit nicely on top of anything. Want a
colored tile behind one instead? Flip one switch:

```tsx
<Picto seed="Bloop" />              {/* bare, the default */}
<Picto seed="Bloop" background />   {/* with a background tile */}
```

<p align="center">
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/bloop.svg" width="120" alt="Bloop, bare" />
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/ctresb/picto/main/assets/bloop-bg.svg" width="120" alt="Bloop with a background tile" />
</p>

## Using it outside React

A picto is just an SVG string under the hood, so you can grab that string and do
whatever you want with it (emails, server rendering, saving to a file).

```ts
import { picto } from 'pictoguys/core'

const svg      = picto.character('Bloop').svg()                  // bare (default)
// -> "<svg viewBox=\"0 0 40 40\" ...>...</svg>"

const withTile = picto.character('Bloop').svg({ background: true }) // add a tile
const prefixed = picto.character('Bloop').svg({ uid: 'a_' })     // custom id prefix
```

You can also read what a picto turned out to be:

```ts
const guy = picto.character('Bloop')
guy.config
// { color: 'gen319', shape: '4', eyes: 'single', mode: 'mono', ... }
```

The `svg()` output is deterministic, and every id inside is prefixed, so you can
drop many pictos into one page without their gradients or filters fighting.

## Bonus: just the random number maker

The seeded randomness that powers picto lives on its own tiny path, with **none**
of the character art attached. Handy if you only want stable, repeatable random
numbers:

```ts
import { mulberry32, hashSeed } from 'pictoguys/rng'

const random = mulberry32(hashSeed('any-string'))
random() // a number 0..1, the same every time for that string
```

Importing `pictoguys/rng` pulls in well under 1 KB. Importing the full library
includes the character art (that art is the whole point, so it ships with it).

## How it works (the 20 second version)

1. Your seed goes through a small, predictable shuffler.
2. The shuffle picks a color, a shape, eyes, eyebrows, and a background.
3. Those SVG parts get recolored in OKLCH color space (so the colors always look
   nice together, not muddy) and stitched into one SVG.
4. React drops that SVG on the page. Animations are just smooth CSS transforms on
   the body or the eyes.

Same seed in means same picto out. No randomness leaks, no surprises.

## FAQ

**Is it really the same picto every time?**
Yes. "Bloop" is Bloop on your laptop, your phone, and your friend's machine.

**Do I need to download or host any images?**
No. The parts are inside the package. One `npm install` and you are done.

**Can I get a totally specific look?**
Yes, use `config={{ ... }}` and set exactly what you want.

**How big is it?**
The art data is around 120 KB before gzip. It compresses well, and it is the
actual content of the library, so there is nothing to fetch separately.

## License

MIT. Go make a thousand little guys.
