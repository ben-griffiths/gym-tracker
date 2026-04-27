# LiftLog - Mobile Gym Tracker

LiftLog is a mobile-first gym tracker built with Next.js and shadcn/ui.

Core functionality:
- Camera recognizer that suggests likely exercise + weight from an image using OpenAI Vision.
- Chat interface that parses natural text into variable sets/reps/weights.
- Split layout for current workout and chat input.
- One-tap quick chips for common rep and weight values.
- Workout grouping with flexible per-set variability.

## Tech Stack

- Next.js App Router + TypeScript
- shadcn/ui + Tailwind CSS
- Supabase Postgres + Supabase Auth (RLS)
- OpenAI API (vision + chat parsing)
- React Query for async state

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env file and configure values:

```bash
cp .env.example .env
```

3. Provision Supabase:

```bash
# create a Supabase project, then set:
# - NEXT_PUBLIC_SUPABASE_URL
# - NEXT_PUBLIC_SUPABASE_ANON_KEY
```

4. Apply SQL migrations to Supabase (pick one):

```bash
# Option A — Supabase CLI (requires supabase login + link):
# npx supabase db push

# Option B — run migration SQL in the Supabase SQL editor (in order under supabase/migrations/).
```

5. Run development server:

```bash
npm run dev
```

## Progressive Web App (LiftLog)

LiftLog ships as an **installable PWA** ([Next.js PWA guide](https://nextjs.org/docs/app/guides/progressive-web-apps)): [`app/manifest.ts`](app/manifest.ts), icons under [`public/`](public/), and [`app/icon.png`](app/icon.png) / [`app/apple-icon.png`](app/apple-icon.png) for the tab and “Add to Home Screen” artwork.

- **Production:** the app must be served over **HTTPS** (e.g. Vercel) for browsers to offer install / add to home screen.
- **Local install testing:** run `npx next dev --experimental-https` so the secure context matches what install prompts expect.
- **iOS:** use **Share → Add to Home Screen** when the browser does not show its own install affordance.

## Available Scripts

- `npm run dev` - start dev server
- `npm run lint` - run ESLint
- `npm run test` - run unit tests
- `npm run build` - production build validation

## API Endpoints

- `POST /api/vision/recognize` - two steps: a vision model describes the image and names plausible exercises in plain English, then a text model maps that output to catalog `slug`s. JSON includes `description`, `suggestedInNaturalLanguage`, and ranked `candidates` (see [`lib/types/workout.ts`](lib/types/workout.ts)).
- `GET /api/workouts` - list recent workout groups/sessions
- `POST /api/workouts` - create workout group and active session
- `POST /api/sets` - log one or multiple set entries

## Notes

- **Workout text chat** runs in the browser via [WebLLM](https://webllm.mlc.ai/) (`@mlc-ai/web-llm`) and WebGPU. Optional `NEXT_PUBLIC_WEBLLM_MODEL` overrides the default (`Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC`, one of WebLLM’s function-calling models). Without WebGPU, chat still uses **deterministic local parsing** (same fallback as when the model fails to parse a turn).
- If `OPENAI_API_KEY` is missing, the **camera** route falls back to deterministic local candidates; the chat **LLM** does not use OpenAI.
- Optional: `OPENAI_VISION_DESCRIBE_MODEL` (default `gpt-5.4`) and `OPENAI_VISION_MATCH_MODEL` (default `gpt-4.1-mini`) in [`lib/ai.ts`](lib/ai.ts) as `OPENAI_VISION_MODEL` / `OPENAI_VISION_MATCH_MODEL`.
- The workout screen may auto-log a camera pick when the API reports a strong catalog match; otherwise the user picks from the list.
- Workout/set/vision routes require a Supabase bearer token; the client auto-creates an anonymous session when needed.
