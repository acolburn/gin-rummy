TODO

- If hand reaches end of deck, nothing happens
- Opponent hand should show only card backs
- Assign player id's at start, use instead of 'current' and 'opponent' players; store values in localStorage so page refresh doesn't wreck stuff
- addCardToHandFromDeck and addCardToHandFromDiscardPile should only recognize clicks from current player; it will require adding something like

```
async function addCardToHandFromDeck() {
  if (myPlayerId !== gameState.currentPlayer) {
    return; // not this client's turn
  }
  ...
}
```
