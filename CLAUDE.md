# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run lint      # ESLint
npm run preview   # Preview production build locally
```

No test suite exists.

## Architecture

**Stack:** React 19 + React Router 7 + Vite 8 + Supabase (PostgreSQL, Auth, RLS)

**No backend/API layer** — all DB queries go through the Supabase JS client directly from the browser. All data access lives in `src/lib/db.js`.

### Routing (`src/App.jsx`)

| Path | Component | Auth |
|------|-----------|------|
| `/` | Dashboard | Private |
| `/tournament/:id` | Visualizer | Private |
| `/study/results` | Visualizer (via `location.state.studyHands`) | Private |
| `/share/:token` | Visualizer | Public |
| `/hand-share/:handToken` | Visualizer | Public |
| `/login`, `/reset-password` | Auth forms | Public |

### Database Tables

- **tournaments** — one per upload, `user_id` owner, optional `share_token` for public links
- **hands** — `raw` JSONB stores full parsed hand; `share_token` for single-hand sharing; CASCADE from tournaments
- **actions** — denormalized street actions for analytics; CASCADE from hands
- **hand_notes** — `(hand_id, user_id)` unique, RLS per user
- **hand_reviews** — `(hand_id, user_id)` composite PK, marks hands for review, RLS per user

### Visualizer data loading (`src/pages/Visualizer.jsx`)

Three load paths all converge on `setHands(...)`:
1. **`location.state?.studyHands`** — array passed from Dashboard study search
2. **`handToken`** — single public hand via `fetchHandByShareToken()`
3. **Normal / share token** — `supabase.from('hands').select('id, raw')`

After loading hands, notes and review marks are fetched in parallel with `Promise.all`.

Hand objects in state: `{ ...row.raw, _dbId: row.id }` — `_dbId` is the DB UUID; `id` inside `raw` is the poker room hand ID (e.g. `"G123456789"`). Never confuse the two.

### Hand parsing pipeline (`src/lib/parser.js`)

Supports GGPoker, Winamax, iPoker, 888poker, CoinPoker, PokerStars. Entry point: `parseFile(text)` auto-detects platform. `groupByTournament(hands)` groups into tournaments. `saveTournament()` in `db.js` batches inserts (hands: 200/batch, actions: 1000/batch).

### Study search (`src/pages/Dashboard.jsx` → `handleStudySearch`)

When `reviewOnly=true`: fetches marked hand IDs via `fetchUserReviewMarks()` then loads those hands directly with `fetchHandsByIds()` — bypasses `fetchAllUserHands()` which only returns hands from the current user's own tournaments. All other filters (position, potType, players) apply on top.

### Key patterns

- **DB chunking**: `fetchAllUserHands` chunks by 20 tournament IDs; `fetchHandsByIds` chunks by 100 hand IDs — Supabase URL length limit
- **Autosave with debounce**: hand notes debounce 800ms via `noteDebounceRef`; always upsert, never delete empty notes
- **Keyboard shortcuts in Visualizer**: guarded by `['SELECT','INPUT','TEXTAREA'].includes(e.target.tagName)` — add `TEXTAREA` if adding new text inputs
- **Shared views**: authenticated users can add notes and review marks on any hand regardless of who owns the tournament
- **Style objects**: all inline styles defined as const objects at the bottom of each page file (`hdr`, `ta`, `rp`, `modal`, `noteStyle`, etc.)
