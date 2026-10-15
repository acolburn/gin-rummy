# Gin Rummy

A two-player Gin Rummy game built with Svelte 5 and Vite. Players can share a game
across browsers using Firebase Authentication and Firestore. Cards are dealt and
drawn through the Deck of Cards API.

## Getting started

Install dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

Create a production build with `npm run build`, or serve the build locally with
`npm run preview`. Firebase anonymous authentication and Firestore access must be
configured for multiplayer syncing.

## Playing

- Choose **Non-Dealer** (Player 1) or **Dealer** (Player 2) to take a seat. Seats
  can be reassigned by anyone; this is a casual shared game, not an account system.
- **New Hand** deals a fresh hand and keeps the scores. Either seated player can
  start it; Player 1 starts the hand.
- **New Game** deals a fresh hand, resets both scores, and has Player 1 start.
- Draw from the deck or the top of the discard pile, then discard one card.
  A player with 10 or fewer deadwood points after discarding can knock or continue.
- Knocking opens the result for both players. The opponent lays off cards where
  possible (except against gin); the result awards points for a knock, gin, or
  undercut. The knocking player can start the next hand, which is led by the
  player who did not win the previous hand.
- If the deck runs out, drawing from it displays an alert and does not add a card.

## Developer guide

This guide explains how the game logic, Firebase syncing, and UI fit together.

## The big picture: one shared document

There is no game server. **Both browsers read and write a single Firestore document**:
`games/gin-rummy`. Every part of the design follows from that fact:

- The shared gameplay state lives in one local object, `gameState`, which mirrors the
  gameplay fields in the Firestore document. The document also stores the player seat ids.
- When a player does something, their browser updates its local `gameState` **and**
  writes the changed fields to Firestore (`syncGameState`).
- The other browser has a live listener (`onSnapshot`) that fires whenever the doc
  changes, and copies the new values into its own `gameState`.
- The UI re-renders automatically from `gameState` (Svelte reactivity). Neither browser
  ever directly tells the other what to do — they just keep the shared doc in sync.

**Debugging rule #1:** if the two browsers disagree, the question is always
"which write to Firestore was wrong, missing, late, or clobbered?"

## File layout

The main files are:

- `src/App.svelte` — shared state, Firestore synchronization, game actions, and UI.
- `src/EvaluateHand.js` — Gin Rummy meld, deadwood, layoff, and scoring logic.
- `src/Card.svelte` and `src/cards.js` — card rendering and card-code mapping.
- `src/firebase.js` — Firebase app, anonymous auth, and Firestore initialization.

The **New Game** control is available to either seated player. It resets both
players' scores and starts Player 1.

## Identity and seats

Each browser invents a random id once and stores it in `localStorage`
(`getOrCreateMyId`). Firebase anonymous authentication is used separately to access
Firestore; the local id distinguishes which player seat this browser occupies.

The two seats are called `player1` (Non-Dealer) and `player2` (Dealer). Clicking a seat
button calls `claimSeat`, which writes your id into the doc's `player1` or `player2`
field. The listener then compares the doc's seat ids against your id and sets the local
variable `playerNumber` to `1`, `2`, or `undefined` (spectator).

Game actions require a seat and, where appropriate, the active turn. If
`playerNumber` is `undefined`, the status says "Choose a seat to play" and the
deal actions are unavailable. If seat claiming fails, the error is shown in the
status area and logged as "Could not claim seat".

## gameState: the source of truth

```js
let gameState = $state({
  player1Hand: [], // array of { id, code } card objects, e.g. { id: "5H", code: "5H" }
  player2Hand: [],
  discardPile: [], // last element is the top of the pile
  deckId: "", // id of the deck at the Deck of Cards API
  currentPlayer: "player1",
  canKnock: false,
  knockedByPlayerNumber: null,
  player1Score: 0,
  player2Score: 0,
});
```

Key facts:

- **`$state(...)`** is Svelte 5's reactivity. Any assignment like
  `gameState.discardPile = [...]` automatically updates the UI. Note you must
  _reassign_ (or use array methods through the reactive proxy) — the code always
  reassigns, e.g. `gameState.player1Hand = [...gameState.player1Hand, newCard]`.
- **Cards are tiny objects**: `{ id, code }`. `code` is the Deck of Cards API code —
  rank letter + suit letter, e.g. `"5H"`, `"QD"`, `"0S"` (ten is `0`), `"BK"` (card
  back). `id` equals `code` and exists only because the drag-and-drop library requires
  unique ids. This only works because a standard deck has no duplicate codes.
- **`deckId` is a pointer to server state elsewhere.** The Deck of Cards API remembers
  which cards have been drawn from each deck id. If two browsers disagree about
  `deckId`, or if a `deckId` is swapped after cards were dealt from the old deck, you
  get duplicate cards (see "Hard-won lessons" below).
- **`isMyTurn`** is a `$derived` value: true when `currentPlayer` matches your seat.
  Turn-based draw and discard actions check it before acting.

## Syncing: syncGameState and the listener

### Writing: `syncGameState(fields)`

```js
await syncGameState({
  player1Hand: gameState.player1Hand,
  discardPile: gameState.discardPile,
});
```

Uses `setDoc(gameRef, fields, { merge: true })`. Two rules:

1. **Prefer passing only the fields you changed.** The helper defaults to syncing
   the full local state if called without fields; avoid that when the local copy
   could be stale, or you can overwrite a change the other player just made.
2. **`setDoc` + merge, never `updateDoc`.** `updateDoc` throws when the doc doesn't
   exist yet (fresh database). This was a real bug: seat claiming silently failed,
   leaving players seat-less with every tap ignored.

### Reading: the `onSnapshot` listener (in `onMount`)

This runs on startup and then **every time the doc changes** — including changes this
same browser just wrote (Firestore echoes your own writes back).

- If the doc exists and has a `deckId`: copy every known `gameState` field from the
  snapshot into local `gameState`, then figure out which seat (if any) is yours.
- If the doc is missing (or has no `deckId` yet): one browser creates a deck via
  `makeDeck()`. `claimBootstrap()` uses a short-lived `localStorage` lock so two tabs
  in the same browser don't both create decks. It can't prevent two different
  browsers from racing; if `localStorage` is unavailable, bootstrap proceeds without
  the lock.

Subtle but important: the listener overwrites **all** local `gameState` fields from the
snapshot. That's normally fine because your own writes echo back identical values. But
during a drag (see below), local state is intentionally ahead of Firestore.

## The UI and drag-and-drop

Both hands use `svelte-dnd-action` (`use:dndzone`). DnD has two events:

- `onconsider` fires repeatedly _while_ dragging. The handler updates local
  `gameState` and sets `isDragging = true`, but deliberately does **not** sync — the
  arrangement isn't final yet.
- `onfinalize` fires when the card is dropped. It syncs the rearranged hand to
  Firestore, then clears `isDragging` after a 50 ms timeout.

**Why `isDragging` exists:** dropping a card also fires a click event, which would
otherwise be interpreted as "discard this card". `discardCard` ignores clicks while
`isDragging` is true.

Card visibility is controlled in the markup: each hand is rendered face-up only if it
belongs to you; otherwise the cards display as backs. Both browsers receive both
hands in the shared document. The seated player can reorder their hand, and clicking
one of their face-up cards discards it.

## The turn cycle

A normal turn is:

1. **Draw** — click the deck (`addCardToHandFromDeck`) or the discard pile
   (`addCardToHandFromDiscardPile`). Hand goes from 10 to 11 cards. A draw from the
   deck is an HTTP call to the Deck of Cards API using `deckId`; the discard-pile
   draw is pure local array surgery. Both sync only the fields they touched.
2. **Discard** — click a card in your hand (`discardCard`). It moves the card to
   `discardPile`, computes `canKnock` (best possible deadwood ≤ 10 via
   `bestDeadwood`), and syncs hand + discard pile + `canKnock` together.
3. **End turn** — if you can't knock, `discardCard` calls `switchPlayer()`, which flips
   `currentPlayer` and resets `canKnock` (owned by `switchPlayer` — don't reset it at
   call sites). If you _can_ knock, you choose: "Knock" (opens the modal) or "Continue"
   (calls `switchPlayer()` yourself).

Guards in each action enforce the rules: not your turn → ignore; hand already has 11
cards → can't draw; fewer than 11 cards → can't discard; clicking a card that isn't in
the current player's hand → ignore. If the deck is empty, a draw displays an alert.

## Dealing hands and creating decks

`dealHand()` deals a fresh round:

1. `await makeDeck(false)` — creates a **new** shuffled deck at the Deck of Cards API and
   stores its `deckId` locally, **without** syncing yet.
2. Draws 10 + 10 + 1 cards _from that new deck id_ (three sequential HTTP calls).
3. Syncs `deckId`, both hands, the discard pile, and `canKnock` in **one**
   `syncGameState` call, along with the current player and knock state. A new game
   includes both reset scores in that write.

Both details exist because of a real bug (the "same card in a hand and the discard
pile" bug):

- **`await` matters.** Without it, the draws used the _old_ `deckId` while the _new_
  one was synced — afterwards every draw came from a fresh 52-card deck that still
  contained cards already in play.
- **Atomic sync matters.** If `deckId` were synced before the hands, other browsers
  would briefly hold the new deck id alongside old cards.

`makeDeck()` syncs immediately by default and is used when bootstrapping an empty
Firestore document. During a deal, it is called with `false` so the new deck id is
synced atomically with the new cards.

## Hard-won lessons (past bugs — don't reintroduce them)

1. **Never `updateDoc`** — it throws when the doc doesn't exist, which broke seat
   claiming on a fresh database. Everything uses `setDoc(..., { merge: true })`.
2. **Sync only changed fields** — full-state writes clobber concurrent changes from the
   other player.
3. **Always `await makeDeck()` before drawing** — see above.
4. **`deckId`, hands, and discard pile are one atomic unit** — sync them together.
5. **Only seated players can deal a hand.** Either seated player can start an
   ordinary New Hand or New Game; only the player who knocked can score the result
   and start the next hand from the knock dialog.
6. **Don't reset `canKnock` at call sites** — `switchPlayer()` owns that.
7. **Firestore values must be plain JSON** — no class instances, functions, or Dates in
   `gameState`.

## How to add a feature (recipe)

For a new shared field, the pattern is:

1. **Add the field** to the `gameState` initializer. Keep it plain JSON. Player
   scores are already tracked as `player1Score` and `player2Score`.
2. **The listener picks it up for free** — it copies any key that exists in `gameState`.
3. **Update it where the logic happens**, then call
   `syncGameState({ yourField: gameState.yourField })` — or fold it into an existing sync if
   it's changed by the same action.
4. **Render it** in the markup; Svelte reactivity handles updates from both your own
   writes and the other player's (via the listener).
5. **Decide who may change it** and guard with `isMyTurn` or `playerNumber`, like the
   existing actions.

Then test with **two browsers side by side** — most bugs in this codebase only appear
when two clients are live.

## Debugging checklist

When something looks wrong:

1. **Open the browser console** (F12) in both browsers. Sync failures are logged
   ("Could not sync game state", "Could not claim seat").
2. **Check the status pill** at the top: "Choose a seat" means `playerNumber` is
   `undefined` — nothing will respond until a seat claim succeeds.
3. **Inspect the actual doc**: Firebase console → Firestore → `games/gin-rummy`.
   Compare it to what each browser shows. The doc is the truth; a browser that
   disagrees has a sync bug.
4. **Check `deckId` consistency** when cards duplicate: does the doc's `deckId` match
   when the cards were dealt? Were hands and `deckId` synced in the same write?
5. **Reproduce with two browsers.** Single-browser testing hides every sync bug.
