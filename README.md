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

# Option B — run the SQL in the dashboard SQL editor:
# supabase/migrations/20260423193000_init.sql
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

- `POST /api/vision/recognize` - image analysis to ranked exercise/weight candidates
- `POST /api/chat` - natural language workout parsing and suggestion output
- `GET /api/workouts` - list recent workout groups/sessions
- `POST /api/workouts` - create workout group and active session
- `POST /api/sets` - log one or multiple set entries

## Notes

- If `OPENAI_API_KEY` is missing, chat and camera routes fall back to deterministic local parsing/candidates.
- During image recognition, the app always requires user confirmation before logging.
- Workout/set/vision routes require a Supabase bearer token; the client auto-creates an anonymous session when needed.
