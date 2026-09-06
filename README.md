TODO

- If hand reaches end of deck, nothing happens

Updated todo list

Read , lines 1 to 200

No — it's not "move everything in `<script>` into a `.js` file." It's splitting the script into two different kinds of code that currently live together:

## Stays in `App.svelte` (Svelte-specific / UI glue)

- The `$state()` and `$effect()` declarations themselves
- DOM-related things: `knockModalRef`, `showModal()`/`close()`, drag-and-drop handlers (`handleDndConsider`/`handleDndFinalize`), `isDragging`
- Anything that exists only because of _how the UI is built_ — event handlers wired to buttons, the modal open/close effect, etc.

## Moves to a plain `game.js` (game rules / data logic)

Functions that take state in and return new state out, with no knowledge of Svelte or the DOM:

- `makeDeck`, `newHand`, `drawCard`, `addCardToHandFromDeck`, `addCardToHandFromDiscardPile`, `discardCard`, `switchPlayer`

For example, `discardCard` today directly mutates `gameState.playerHand = ...`. In `game.js` it would instead look like:

```js
// game.js
export function discardCard(gameState, card) {
  // same validation + filtering logic, but working on a plain object
  // returns updated state instead of assuming $state exists
}
```

`App.svelte` would then just call it and assign the result:

```js
function handleDiscard(card) {
  gameState = discardCard(gameState, card); // still triggers Svelte reactivity
}
```

## Why split it this way

The `fetch` calls to the Deck of Cards API and the win/discard/knock rules have nothing to do with Svelte — they're just data transformations. Keeping them in a plain module means:

- You can unit-test them without spinning up a component.
- When you swap local state for Firestore later, you change _what calls these functions and where the result gets stored_ (a Firestore write/listener instead of a local variable), not the rules themselves.
- `App.svelte`'s `<script>` shrinks down to state declarations + thin wrapper functions that call into `game.js` and handle UI-only concerns (modal, drag state).

So it's a logic/UI split, not a "cut the whole script tag and paste it" move. I haven't made this change yet — let me know if you'd like me to do the extraction now.
