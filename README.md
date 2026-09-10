TODO

- If hand reaches end of deck, nothing happens
- When player knocks or gins, something should happen ... person who knocks should become dealer (playerNumber===2), and other player should become non-dealer (playerNumber===1)
- AND hands should be scored? Use algorithm to calculate score for unsorted hands?
- Should probably have something visual to indicate player accepted as dealer or non-dealer

---

# Developer's Guide to App.svelte

This guide explains how `src/App.svelte` works — the single file containing all game
logic, Firebase syncing, and UI. Read this before fixing bugs or adding features.

## The big picture: one shared document

This is a two-player game played in two different browsers. There is no game server.
Instead, **both browsers read and write a single Firestore document**:
`games/gin-rummy`. Every part of the design follows from that fact:

- The whole game lives in one local object, `gameState`, which mirrors the Firestore doc.
- When a player does something, their browser updates its local `gameState` **and**
  writes the changed fields to Firestore (`syncGameState`).
- The other browser has a live listener (`onSnapshot`) that fires whenever the doc
  changes, and copies the new values into its own `gameState`.
- The UI re-renders automatically from `gameState` (Svelte reactivity). Neither browser
  ever directly tells the other what to do — they just keep the shared doc in sync.

**Debugging rule #1:** if the two browsers disagree, the question is always
"which write to Firestore was wrong, missing, late, or clobbered?"

## File layout (top to bottom)

`App.svelte` is organized as:

1. **Imports & identity** — Svelte helpers, Firebase, and `getOrCreateMyId()`.
2. **`onMount` block** — signs into Firebase and starts the Firestore listener.
3. **Sync helpers** — `claimSeat`, `syncGameState`, `claimBootstrap`.
4. **`gameState` and derived state** — the shared data object.
5. **Drag-and-drop handlers** — rearranging cards in your hand.
6. **Game actions** — `makeDeck`, `newHand`, `drawCard`, `addCardToHandFromDeck`,
   `addCardToHandFromDiscardPile`, `discardCard`, `switchPlayer`.
7. **Markup (HTML)** — opponent hand, deck/discard piles, your hand, knock modal.
8. **Styles (CSS)** — purely visual; safe to change.

## Identity and seats

Each browser invents a random id once and stores it in `localStorage`
(`getOrCreateMyId`). This is **not** a login — it just distinguishes "browser A" from
"browser B".

The two seats are called `player1` (Non-Dealer) and `player2` (Dealer). Clicking a seat
button calls `claimSeat`, which writes your id into the doc's `player1` or `player2`
field. The listener then compares the doc's seat ids against your id and sets the local
variable `playerNumber` to `1`, `2`, or `undefined` (spectator).

**Almost every interaction checks `playerNumber` or `isMyTurn`.** If `playerNumber` is
`undefined`, buttons are disabled and clicks are ignored. So when "nothing responds",
the first thing to check is whether seat claiming worked (see the console for
"Could not claim seat").

## gameState: the source of truth

```js
let gameState = $state({
  player1Hand: [], // array of { id, code } card objects, e.g. { id: "5H", code: "5H" }
  player2Hand: [],
  discardPile: [], // last element is the top of the pile
  deckId: "", // id of the deck at deckofcardsapi.com
  currentPlayer: "player1",
  canKnock: false,
});
```

Key facts:

- **`$state(...)`** is Svelte 5's reactivity. Any assignment like
  `gameState.discardPile = [...]` automatically updates the UI. Note you must
  _reassign_ (or use array methods through the reactive proxy) — the code always
  reassigns, e.g. `gameState.player1Hand = [...gameState.player1Hand, newCard]`.
- **Cards are tiny objects**: `{ id, code }`. `code` is the deckofcardsapi code —
  rank letter + suit letter, e.g. `"5H"`, `"QD"`, `"0S"` (ten is `0`), `"BK"` (card
  back). `id` equals `code` and exists only because the drag-and-drop library requires
  unique ids. This only works because a standard deck has no duplicate codes.
- **`deckId` is a pointer to server state elsewhere.** deckofcardsapi.com remembers
  which cards have been drawn from each deck id. If two browsers disagree about
  `deckId`, or if a `deckId` is swapped after cards were dealt from the old deck, you
  get duplicate cards (see "Hard-won lessons" below).
- **`isMyTurn`** is a `$derived` value: true when `currentPlayer` matches your seat.
  Every game action starts with `if (!isMyTurn) return;`.

## Syncing: syncGameState and the listener

### Writing: `syncGameState(fields)`

```js
await syncGameState({
  player1Hand: gameState.player1Hand,
  discardPile: gameState.discardPile,
});
```

Uses `setDoc(gameRef, fields, { merge: true })`. Two rules:

1. **Always pass exactly the fields you changed.** If you sync the whole state while
   your local copy is momentarily stale, you can overwrite a change the other player
   just made (e.g. their discard reappears).
2. **`setDoc` + merge, never `updateDoc`.** `updateDoc` throws when the doc doesn't
   exist yet (fresh database). This was a real bug: seat claiming silently failed,
   leaving players seat-less with every tap ignored.

### Reading: the `onSnapshot` listener (in `onMount`)

This runs on startup and then **every time the doc changes** — including changes this
same browser just wrote (Firestore echoes your own writes back).

- If the doc exists and has a `deckId`: copy every known `gameState` field from the
  snapshot into local `gameState`, then figure out which seat (if any) is yours.
- If the doc is missing (or has no `deckId` yet): one browser creates a deck via
  `makeDeck()`. `claimBootstrap()` is a small `localStorage` lock so two tabs of the
  same browser don't both create decks. Note it can't prevent two _different_ browsers
  from racing — that's an accepted limitation.

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
belongs to you (`playerNumber === 1 ? card.code : "BK"`). The _data_ for both hands is
on both browsers; only the display differs.

## The turn cycle

A normal turn is:

1. **Draw** — click the deck (`addCardToHandFromDeck`) or the discard pile
   (`addCardToHandFromDiscardPile`). Hand goes from 10 to 11 cards. Note the draw from
   the deck is an HTTP call to deckofcardsapi using `deckId`; the discard-pile draw is
   pure local array surgery. Both sync only the fields they touched.
2. **Discard** — click a card in your hand (`discardCard`). It moves the card to
   `discardPile`, computes `canKnock` (deadwood ≤ 10 via `calculateDeadwood`), and syncs
   hand + discard pile + `canKnock` together.
3. **End turn** — if you can't knock, `discardCard` calls `switchPlayer()`, which flips
   `currentPlayer` and resets `canKnock` (owned by `switchPlayer` — don't reset it at
   call sites). If you _can_ knock, you choose: "Knock" (opens the modal) or "Continue"
   (calls `switchPlayer()` yourself).

Guards in each action enforce the rules: not your turn → ignore; hand already has 11
cards → can't draw; fewer than 11 cards → can't discard; clicking a card that isn't in
the current player's hand → ignore.

## newHand and makeDeck: the trickiest code in the file

`newHand()` (Dealer only) deals a fresh round:

1. `await makeDeck(false)` — creates a **new** shuffled deck at deckofcardsapi and
   stores its `deckId` locally, **without** syncing yet.
2. Draws 10 + 10 + 1 cards _from that new deck id_ (three sequential HTTP calls).
3. Syncs `deckId`, both hands, the discard pile, and `canKnock` in **one**
   `syncGameState` call.

Both details exist because of a real bug (the "same card in a hand and the discard
pile" bug):

- **`await` matters.** Without it, the draws used the _old_ `deckId` while the _new_
  one was synced — afterwards every draw came from a fresh 52-card deck that still
  contained cards already in play.
- **Atomic sync matters.** If `deckId` were synced before the hands, other browsers
  would briefly hold the new deck id alongside old cards.

`makeDeck(true)` (sync immediately) is only for the bootstrap case: creating the very
first deck also has to create the Firestore doc.

## Hard-won lessons (past bugs — don't reintroduce them)

1. **Never `updateDoc`** — it throws when the doc doesn't exist, which broke seat
   claiming on a fresh database. Everything uses `setDoc(..., { merge: true })`.
2. **Sync only changed fields** — full-state writes clobber concurrent changes from the
   other player.
3. **Always `await makeDeck()` before drawing** — see above.
4. **`deckId`, hands, and discard pile are one atomic unit** — sync them together.
5. **Only the Dealer deals** — both "New Hand" buttons are disabled unless
   `playerNumber === 2`, so two players can't deal simultaneously and mix two decks.
6. **Don't reset `canKnock` at call sites** — `switchPlayer()` owns that.
7. **Firestore values must be plain JSON** — no class instances, functions, or Dates in
   `gameState`.

## How to add a feature (recipe)

Say you want to track the score. The pattern is always the same:

1. **Add a field** to the `gameState` initializer (e.g. `score: { player1: 0, player2: 0 }`).
   Keep it plain JSON.
2. **The listener picks it up for free** — it copies any key that exists in `gameState`.
3. **Update it where the logic happens** (e.g. in the knock handler), then call
   `syncGameState({ score: gameState.score })` — or fold it into an existing sync if
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
