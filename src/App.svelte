<script>
  // ---------------------------------------------------------------------------
  // OVERVIEW
  // Two browsers share ONE game stored in a Firestore document ("games/gin-rummy").
  // Whenever someone changes the game we (1) update our local `gameState` and
  // (2) write the change to Firestore with syncGameState(). Firestore then
  // notifies every browser (onSnapshot, in onMount below), and each browser
  // copies the new data into its own `gameState`. Svelte re-draws the page
  // automatically whenever a `$state` variable changes.
  //
  // Svelte 5 terms used in this file:
  //   $state(x)    - a reactive variable: changing it updates the page
  //   $derived(x)  - a value recalculated automatically when the $state it uses changes
  //   $effect(fn)  - runs fn after the page updates and whenever its $state inputs change
  // ---------------------------------------------------------------------------

  // --- Imports: libraries and our own helper files ---
  import { dndzone } from "svelte-dnd-action"; // drag-and-drop for reordering cards
  import { flip } from "svelte/animate"; // smooth animation when cards move
  import Card from "./Card.svelte"; // component that draws one card
  import { auth, db } from "./firebase.js"; // our configured Firebase connections
  import { onMount } from "svelte"; // runs code once when the page first loads
  import { signInAnonymously } from "firebase/auth"; // log in without a username/password
  import { doc, onSnapshot, setDoc } from "firebase/firestore"; // database functions
  import { toHandCard } from "./cards.js"; // converts an API card into our card object
  import {
    bestDeadwood, // lowest possible deadwood total for a hand
    deadwoodAfterLayoff, // opponent's deadwood after adding cards to knocker's melds
    scoreHand, // works out who wins a hand and how many points
  } from "./EvaluateHand.js";

  // Which seat this browser occupies: 1 (non-dealer), 2 (dealer), or undefined (spectator)
  let playerNumber = $state();
  let isDrawing = false;

  // ---------------------------------------------------------------------------
  // Identify this browser with a simple random id stored locally, instead of
  // relying on Firebase Auth's uid (which was the source of the occasional
  // "stuck as spectator" bugs).
  // localStorage is a small key/value store in the browser that survives page reloads.
  function getOrCreateMyId() {
    const storageKey = "ginRummyPlayerId";
    let id = localStorage.getItem(storageKey); // null if we've never saved one
    if (!id) {
      // Math.random() -> number; toString(36) -> letters+digits text;
      // slice(2) drops the leading "0." so we keep only the random characters
      id = Math.random().toString(36).slice(2);
      localStorage.setItem(storageKey, id);
    }
    return id;
  }
  // Our id for this browser, computed once when the page loads
  const myId = getOrCreateMyId();

  function doNothing() {
    // This function intentionally does nothing
  }

  // Shown in the status bar when Firebase is unreachable or rejecting us.
  // Empty string = everything is fine. Previously these failures were only
  // console.error'd, which left the game silently dead (face-down cards,
  // unresponsive buttons) with no hint why.
  let firebaseError = $state("");

  // ---------------------------------------------------------------------------
  // onMount means runs this after the component is loaded in the browser/DOM
  // Firebase still needs an authenticated (anonymous) user for Firestore access
  onMount(async () => {
    // try/catch: if anything inside `try` throws an error, `catch` runs instead
    // of the whole app crashing. `await` pauses until the async step finishes.
    try {
      await signInAnonymously(auth);

      // A reference (pointer) to the one shared game document
      const gameRef = doc(db, "games", "gin-rummy");

      // onSnapshot: Firestore calls the first function every time the document
      // changes (and once right away with the current data). The second
      // function (further below) is called if the listener fails.
      onSnapshot(
        gameRef,
        async (snapshot) => {
          firebaseError = ""; // listener is alive; clear any earlier error
          const data = snapshot.data();
          console.log("Firestore snapshot:", data);
          // The game is "real" only if the document exists AND has a deck
          if (data?.deckId) {
            // Remember the old value so we can tell below whether a knock just happened
            const previousKnockedByPlayerNumber =
              gameState.knockedByPlayerNumber;

            // Pull any game-play fields that exist in Firestore into our local gameState
            // Objects.keys(gameState) returns an array of the keys in gameState,
            // e.g., ["player1Hand", "player2Hand", "discardPile", "deckId",
            // "currentPlayer"]
            Object.keys(gameState).forEach((key) => {
              if (data[key] === undefined) return;
              if (key === "player1Hand" || key === "player2Hand") {
                // Don't clobber a hand mid-drag (it holds dnd's shadow copy)
                if (isDragging) return;
                gameState[key] = uniqueCards(data[key]);
              } else {
                gameState[key] = data[key];
              }
            });

            // Show the knock popup only when the knock value CHANGED (so it
            // appears for both players when someone knocks, and hides when
            // it's reset to null).
            if (
              data.knockedByPlayerNumber !== undefined &&
              data.knockedByPlayerNumber !== previousKnockedByPlayerNumber
            ) {
              showKnockModal = data.knockedByPlayerNumber !== null;
            }

            // Work out which seat (if any) belongs to this browser
            if (data.player1 === myId) {
              playerNumber = 1;
            } else if (data.player2 === myId) {
              playerNumber = 2;
            } else {
              playerNumber = undefined;
            }
          } else {
            // Doc is missing entirely, or exists but has no deck yet (e.g. a
            // seat was claimed before any deck was created). Exactly one client
            // should bootstrap the deck, otherwise both browsers create
            // competing decks and the second deckId write clobbers the first.
            console.log("There is no current game.");
            if (claimBootstrap()) {
              await makeDeck();
            }
          }
        },
        // Firestore security rules can REJECT this listener entirely (e.g.
        // "permission-denied"). Without this error callback the app just
        // silently never updates.
        (error) => {
          console.error("Firestore listener error:", error);
          firebaseError = `Database error: ${error.code || error.message}. Check Firestore rules and that anonymous sign-in is enabled.`;
        },
      );
    } catch (error) {
      // The /** @type */ comment only tells the editor that `error` may have a .code
      const e = /** @type {any} */ (error);
      console.error("Firebase error:", e);
      firebaseError = `Sign-in failed: ${e.code || e.message}. Enable anonymous auth in the Firebase console.`;
    }
  });

  // Claim the Dealer (player2) or Non-Dealer (player1) seat by writing our id to
  // Firestore. This is a friendly game, so we don't check who currently holds
  // the seat -- clicking always (re)assigns it.
  // Uses setDoc + merge, NOT updateDoc: on a fresh database the game doc may
  // not exist yet, and updateDoc throws in that case, silently leaving the
  // player seat-less (which disables New Hand and ignores all taps).
  async function claimSeat(seatNumber) {
    // Ternary: condition ? valueIfTrue : valueIfFalse
    const field = seatNumber === 1 ? "player1" : "player2";
    const gameRef = doc(db, "games", "gin-rummy");

    try {
      // { [field]: myId } builds an object whose key is the VALUE of `field`,
      // e.g. { player1: "abc123" }. merge:true changes only that key and leaves
      // the rest of the document alone.
      await setDoc(gameRef, { [field]: myId }, { merge: true });
    } catch (error) {
      const e = /** @type {any} */ (error);
      console.error("Could not claim seat:", e);
      firebaseError = `Could not claim seat: ${e.code || e.message}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-tab guard so only one browser bootstraps the deck when the game
  // doc is missing. The lock auto-expires so a crashed tab can't wedge the
  // game, and is keyed by an epoch so a brand-new game (after the doc is
  // deleted) can be bootstrapped again.
  function claimBootstrap() {
    const lockKey = "ginRummyBootstrapLock";
    const now = Date.now(); // current time in milliseconds
    // Returns true if THIS tab may create the deck, false if another already is.
    try {
      const raw = localStorage.getItem(lockKey); // localStorage only stores text
      if (raw) {
        const lock = JSON.parse(raw); // text -> object, e.g. { time: 1700000000000 }
        if (now - lock.time < 15000) {
          return false; // Another tab is already creating the deck
        }
      }
      // No lock, or it's older than 15 seconds: take the lock (object -> text)
      localStorage.setItem(lockKey, JSON.stringify({ time: now }));
      return true;
    } catch {
      // localStorage unavailable (e.g. some private modes); fall back to
      // letting this client try. Worst case is the old double-deck race.
      return true;
    }
  }

  // ---------------------------------------------------------------------------
  // Sync only the given fields to Firestore (defaults to the full gameState).
  // Scoping updates to just what changed avoids one client's stale local copy
  // of unrelated fields clobbering another client's concurrent changes.
  // Uses setDoc + merge (not updateDoc) so this also works the first time,
  // when the game doc doesn't exist yet (e.g. makeDeck's bootstrap call).
  /** @param {Partial<typeof gameState>} fields */
  // `fields = { ...gameState }` is a default value: if no argument is passed,
  // `{ ...gameState }` copies every property of gameState into a new object.
  async function syncGameState(fields = { ...gameState }) {
    const gameRef = doc(db, "games", "gin-rummy");

    try {
      await setDoc(gameRef, fields, { merge: true });
    } catch (error) {
      const e = /** @type {any} */ (error);
      console.error("Could not sync game state:", e);
      firebaseError = `Could not save to database: ${e.code || e.message}`;
    }
  }

  // Holds the shared game data in one place; syncGameState writes changes to Firestore.
  let gameState = $state({
    /** @type {any[]} */
    player1Hand: [],
    /** @type {any[]} */
    player2Hand: [],
    /** @type {any[]} */
    discardPile: [],
    deckId: "",
    currentPlayer: "player1", // "player1" or "player2"
    canKnock: false, // Whether the current player can knock (i.e., has 10 or fewer deadwood points)
    knockedByPlayerNumber: null,
    player1Score: 0,
    player2Score: 0,
  });
  // Am I allowed to act right now? (i.e., is it my turn?)
  // Recalculates automatically whenever playerNumber or currentPlayer changes.
  let isMyTurn = $derived(
    (playerNumber === 1 && gameState.currentPlayer === "player1") ||
      (playerNumber === 2 && gameState.currentPlayer === "player2"),
  );

  // ---------------------------------------------------------------------------
  // Keys for the keyed {#each} blocks that render the hands. Normally each
  // card id is unique, so the key is just the id (which lets Svelte animate
  // reorders instead of remounting cards). But if Firestore data ever gets
  // corrupted with a duplicate card, a duplicate key makes Svelte THROW
  // mid-render (dev mode), freezing the whole UI -- including the "New Hand"
  // button you'd need to fix the data. Appending an occurrence counter keeps
  // keys unique so one bad document can never brick the app.
  /** @param {any[]} hand */
  function uniqueKeys(hand) {
    // `seen` is a Map (key -> value) counting how many times each card id appeared
    const seen = new Map();
    // map() builds a new array with one key per card, in the same order
    return hand.map((card) => {
      const count = seen.get(card.id) || 0; // 0 if this id hasn't been seen
      seen.set(card.id, count + 1);
      // first time: the plain id; repeats: id + "#dup1", "#dup2", ...
      return count === 0 ? card.id : `${card.id}#dup${count}`;
    });
  }
  let player1Keys = $derived(uniqueKeys(gameState.player1Hand));
  let player2Keys = $derived(uniqueKeys(gameState.player2Hand));

  // --- Knock popup (modal) and end-of-hand scoring ---
  let showKnockModal = $state(false); // is the popup open?
  let knockModalRef; // points at the <dialog> element (set via bind:this in the markup)
  // After a knock/gin both hands are face up; cleared when a new hand is dealt
  let handsRevealed = $derived(gameState.knockedByPlayerNumber !== null);
  // The player who discarded (the current player) is the one knocking
  let knockingPlayerNumber = $derived(
    gameState.currentPlayer === "player1" ? 1 : 2,
  );
  let knockingHand = $derived(
    gameState.currentPlayer === "player1"
      ? gameState.player1Hand
      : gameState.player2Hand,
  );
  // The player who did NOT knock
  let opponentHand = $derived(
    gameState.currentPlayer === "player1"
      ? gameState.player2Hand
      : gameState.player1Hand,
  );
  // Opponent's deadwood after laying off cards onto the knocker's melds
  let layoff = $derived(deadwoodAfterLayoff(knockingHand, opponentHand));
  // Result of the hand: { winner: "knocker"|"opponent", points, result: "gin"|"knock"|"undercut" }
  let handScore = $derived(scoreHand(layoff.knockerDeadwood, layoff.deadwood));
  // Which player ("player1"/"player2") wins this hand's points.
  // handScore only says "knocker" or "opponent", so translate that into a player:
  // the knocker is currentPlayer; the opponent is the other one.
  let handWinner = $derived(
    handScore.winner === "knocker"
      ? gameState.currentPlayer
      : gameState.currentPlayer === "player1"
        ? "player2"
        : "player1",
  );

  // Open/close the knock dialog when showKnockModal changes. show() keeps the
  // dialog non-modal so the shared New Game control remains available.
  $effect(() => {
    if (knockModalRef) {
      if (showKnockModal) {
        knockModalRef.show();
      } else {
        knockModalRef.close();
      }
    }
  });

  const flipDurationMs = 200; // Duration of the flip animation in milliseconds
  let isDragging = $state(false); // Track whether a card is being dragged

  // --- Drag and drop (svelte-dnd-action) ---
  // The library fires two events: "consider" (continuously while a card is being
  // dragged around; just update the preview order) and "finalize" (the card was
  // dropped; this is the final order, so save it). event.detail.items is the
  // hand in its new order.

  // ---------------------------------------------------------------------------
  // current player can drag and drop cards in their hand
  // Drops duplicate ids and svelte-dnd-action's temporary shadow placeholder
  // (which shares the dragged card's id) so a hand never shows a card twice.
  function uniqueCards(cards, keepShadow = false) {
    const seen = new Set();
    return cards.filter((c) => {
      if (!keepShadow && c.isDndShadowItem) return false;
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }

  function handleDndConsider(handField, event) {
    isDragging = true; //player started dragging a card, so ignore the click event that will fire when they release the card
    gameState[handField] = event.detail.items;
  }
  // ---------------------------------------------------------------------------
  function handleDndFinalize(handField, event) {
    gameState[handField] = uniqueCards(event.detail.items);
    syncGameState({ [handField]: gameState[handField] });
    setTimeout(() => {
      isDragging = false; // Brief delay before restting to the click event finishes getting ignored
    }, 50);
  }

  // ---------------------------------------------------------------------------
  // Ends the current player's turn: close the popup, hand the turn to the
  // other player, reset knock info, and save it all to Firestore.
  async function switchPlayer() {
    showKnockModal = false;
    gameState.currentPlayer =
      gameState.currentPlayer === "player1" ? "player2" : "player1";
    gameState.canKnock = false;
    gameState.knockedByPlayerNumber = null;
    await syncGameState({
      currentPlayer: gameState.currentPlayer,
      canKnock: gameState.canKnock,
      knockedByPlayerNumber: gameState.knockedByPlayerNumber,
    });
  }

  // ---------------------------------------------------------------------------
  // Records that a player knocked. Saving it to Firestore makes the snapshot
  // listener open the knock popup in BOTH browsers.
  // (This parameter shadows the outer playerNumber variable on purpose.)
  async function announceKnock(playerNumber) {
    showKnockModal = true;
    gameState.knockedByPlayerNumber = playerNumber;
    await syncGameState({
      knockedByPlayerNumber: gameState.knockedByPlayerNumber,
    });
  }

  // Retracts a knock (dialog Cancel): hides both hands again and leaves the
  // turn with the knocker, who still sees the Knock / Continue buttons.
  async function cancelKnock() {
    showKnockModal = false;
    gameState.knockedByPlayerNumber = null;
    await syncGameState({
      knockedByPlayerNumber: gameState.knockedByPlayerNumber,
    });
  }

  // ---------------------------------------------------------------------------
  // Creates a fresh shuffled deck. When sync is false, the caller is
  // responsible for syncing deckId (newHand does this atomically together
  // with the dealt hands, so no client ever sees a new deckId with old cards).
  async function makeDeck(sync = true) {
    // Fetch a new shuffled deck from the API
    const response = await fetch(
      "https://deckofcardsapi.com/api/deck/new/shuffle/",
    );
    const data = await response.json(); // response body (text) -> JavaScript object
    if (sync) {
      gameState.deckId = data.deck_id;
      await syncGameState({ deckId: data.deck_id }); // Sync the new deckId with Firestore
    }
    return data.deck_id;
  }

  // ---------------------------------------------------------------------------
  // Adds this hand's points to the winner's total, then deals a new hand.
  // Only called from the knock modal, so ordinary New Hand clicks don't score.
  async function scoreAndNewHand() {
    // Pick which score field to update; gameState[scoreField] looks up a
    // property by a name stored in a variable
    const scoreField =
      handWinner === "player1" ? "player1Score" : "player2Score";
    gameState[scoreField] += handScore.points; // += means "add to the current value"
    await syncGameState({ [scoreField]: gameState[scoreField] });
    await startNextHand();
  }

  // ---------------------------------------------------------------------------
  // Deals a fresh hand and saves it to Firestore. The options make it clear
  // whether this also resets scores and which player starts.
  async function dealHand({ resetScores, startingPlayer }) {
    showKnockModal = false;
    // MUST be awaited: otherwise the draws below use the OLD deckId while the
    // NEW deckId gets synced to Firestore, so future draws come from a full
    // 52-card deck and can duplicate cards already in hands/discard pile.
    // The new deck id is kept in a local variable (NOT gameState.deckId): a
    // Firestore snapshot arriving mid-deal overwrites gameState, which would
    // switch the later draws back to the old deck and deal duplicate cards.
    const newDeckId = await makeDeck(false);
    // Draw all 21 cards (10 + 10 + 1 discard) in one request so the deal is atomic.
    const dealResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${newDeckId}/draw/?count=21`,
    );
    const dealData = await dealResponse.json();
    if (!dealData.success || dealData.cards.length < 21) {
      alert("Could not deal a new hand. Please try again.");
      return;
    }
    const dealt = dealData.cards.map((card) => toHandCard(card));
    gameState.deckId = newDeckId;
    gameState.player1Hand = dealt.slice(0, 10);
    gameState.player2Hand = dealt.slice(10, 20);
    gameState.discardPile = dealt.slice(20);
    gameState.canKnock = false;
    gameState.knockedByPlayerNumber = null;
    if (resetScores) {
      gameState.player1Score = 0;
      gameState.player2Score = 0;
    }
    gameState.currentPlayer = startingPlayer;
    // Sync deckId together with the dealt cards so no client ever holds the
    // new deckId while the old hands/discard are still visible. A new game
    // resets both scores in the same shared update as the fresh deal.
    await syncGameState({
      deckId: gameState.deckId,
      player1Hand: gameState.player1Hand,
      player2Hand: gameState.player2Hand,
      discardPile: gameState.discardPile,
      canKnock: gameState.canKnock,
      knockedByPlayerNumber: gameState.knockedByPlayerNumber,
      currentPlayer: gameState.currentPlayer,
      ...(resetScores ? { player1Score: 0, player2Score: 0 } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // Starts an ordinary new hand with player 1 going first; scores are kept.
  async function startNewHand() {
    await dealHand({ resetScores: false, startingPlayer: "player1" });
  }

  // ---------------------------------------------------------------------------
  // Starts the next hand after scoring; the player who did not win starts.
  async function startNextHand() {
    const startingPlayer = handWinner === "player1" ? "player2" : "player1";
    await dealHand({ resetScores: false, startingPlayer });
  }

  // ---------------------------------------------------------------------------
  // Starts a new game with a fresh deal and resets both players' scores.
  async function startNewGame() {
    await dealHand({ resetScores: true, startingPlayer: "player1" });
  }

  // ---------------------------------------------------------------------------
  // Asks the API for one card from the deck. Returns our card object, or null
  // (after an alert) if the deck is empty. Does NOT change any hand itself.
  async function drawCard() {
    const inPlay = new Set(
      [
        ...gameState.player1Hand,
        ...gameState.player2Hand,
        ...gameState.discardPile,
      ].map((c) => c.id),
    );
    // Retry a few times in case the API hands back a card already in play
    for (let attempt = 0; attempt < 5; attempt++) {
      const drawResponse = await fetch(
        `https://deckofcardsapi.com/api/deck/${gameState.deckId}/draw/?count=1`,
      );
      const drawData = await drawResponse.json();
      if (!drawData.cards || drawData.cards.length === 0) {
        alert("No more cards in the deck.");
        return null;
      }
      const card = toHandCard(drawData.cards[0]);
      if (!inPlay.has(card.id)) return card;
    }
    return null;
  }

  function getCurrentHandFieldForDraw() {
    if (!isMyTurn) {
      return undefined; // Ignore the click event if it's not the player's turn
    }
    const handField =
      gameState.currentPlayer === "player1" ? "player1Hand" : "player2Hand";
    if (gameState[handField].length > 10) {
      alert("Your hand is full. Cannot draw more cards.");
      return undefined;
    }
    return handField;
  }

  async function addCardToCurrentHand(handField, card, extraFields = {}) {
    gameState[handField] = uniqueCards([...gameState[handField], card]);
    await syncGameState({
      [handField]: gameState[handField],
      ...extraFields,
    });
  }

  // ---------------------------------------------------------------------------
  // Click handler for the deck: get a card from the deck and add it to the
  // current player's hand. A hand has 10 cards normally and 11 right after
  // drawing, so more than 10 means you already drew this turn.
  async function addCardToHandFromDeck() {
    if (isDrawing) return; // ignore double clicks while a draw is in flight
    const handField = getCurrentHandFieldForDraw();
    if (!handField) return;
    isDrawing = true;
    let newCard;
    try {
      newCard = await drawCard(); // A card object, or null if the deck is empty
    } finally {
      isDrawing = false;
    }
    if (newCard && gameState[handField].length <= 10) {
      // [...hand, card] makes a NEW array with the card on the end; assigning a
      // new array (rather than push) is what makes Svelte notice the change
      await addCardToCurrentHand(handField, newCard);
    }
  }

  // ---------------------------------------------------------------------------
  // Click handler for the discard pile: take the top (last) card into your hand.
  async function addCardToHandFromDiscardPile() {
    const handField = getCurrentHandFieldForDraw();
    if (!handField) return;
    // Add the top card from the discard pile to the current player's hand
    if (gameState.discardPile.length > 0) {
      const newCard = gameState.discardPile[gameState.discardPile.length - 1];
      // Remove the card from the discard pile
      // (slice(0, -1) copies everything except the last item)
      gameState.discardPile = gameState.discardPile.slice(0, -1);
      await addCardToCurrentHand(handField, newCard, {
        discardPile: gameState.discardPile,
      });
    } else {
      alert("No cards in the discard pile.");
    }
  }

  // ---------------------------------------------------------------------------
  // Click handler for a card in a hand: discard it. After discarding, if the
  // player's deadwood is 10 or less they may knock (turn stays with them so
  // they can choose); otherwise the turn passes to the other player.
  async function discardCard(card) {
    if (!isMyTurn) {
      return; // Ignore the click event if it's not the player's turn
    }
    if (
      gameState.currentPlayer === "player1" &&
      gameState.player1Hand.length < 11
    ) {
      alert("You must select a card before discarding.");
      return;
    }
    if (
      gameState.currentPlayer === "player2" &&
      gameState.player2Hand.length < 11
    ) {
      alert("You must select a card before discarding.");
      return;
    }
    // Ignore the click event if a card is being dragged
    if (isDragging) {
      return;
    }
    // Only allow discarding a card from the hand whose turn it actually is,
    // regardless of which hand the click event happened to come from.
    // some() is true if at least one card in the hand has a matching id.
    const isFromCurrentPlayerHand =
      gameState.currentPlayer === "player1"
        ? gameState.player1Hand.some((c) => c.id === card.id)
        : gameState.player2Hand.some((c) => c.id === card.id);
    if (!isFromCurrentPlayerHand) {
      return;
    }
    // Remove the card from the current player's hand
    const handField =
      gameState.currentPlayer === "player1" ? "player1Hand" : "player2Hand";
    // filter keeps every card EXCEPT the one with the discarded card's id
    gameState[handField] = gameState[handField].filter((c) => c.id !== card.id);
    // Add the card to the discard pile
    gameState.discardPile = [...gameState.discardPile, card];
    // Calculate the deadwood for the current player (knocking requires <= 10)
    // gameState.canKnock = calculateDeadwood(gameState[handField]) <= 10;
    gameState.canKnock = bestDeadwood(gameState[handField]) <= 10;
    await syncGameState({
      [handField]: gameState[handField],
      discardPile: gameState.discardPile,
      canKnock: gameState.canKnock,
    });
    if (!gameState.canKnock) {
      // Turn ends; switch to the other player
      await switchPlayer();
    }
  }
</script>

<div class="table">
  <header class="topbar">
    <h1>Gin Rummy</h1>
    <p class="status">
      {#if firebaseError}
        <span class="status-dot red"></span>{firebaseError}
      {:else if playerNumber === undefined}
        <span class="status-dot red"></span>Choose a seat to play
      {:else if gameState.currentPlayer === "player1" && playerNumber === 1}
        <span class="status-dot green"></span>Your turn
      {:else if gameState.currentPlayer === "player2" && playerNumber === 2}
        <span class="status-dot green"></span>Your turn
      {:else}
        <span class="status-dot red"></span>Waiting for opponent
      {/if}
    </p>
    <p class="status">
      P1: {gameState.player1Score} &nbsp; P2: {gameState.player2Score}
    </p>
    <button
      class="btn-continue"
      disabled={playerNumber !== 1 && playerNumber !== 2}
      onclick={startNewGame}>New Game</button
    >
    <div class="seat-buttons">
      <button class="btn-continue" onclick={() => claimSeat(1)}
        >Non-Dealer</button
      >
      <button class="btn-continue" onclick={() => claimSeat(2)}>Dealer</button>
    </div>
  </header>

  <!-- Display opponent hand -->
  <section class="opponent-area">
    <span class="hand-label">Player 2</span>
    <div
      class="hand"
      use:dndzone={{
        items: gameState.player2Hand,
        flipDurationMs,
        dragDisabled: playerNumber !== 2,
      }}
      onconsider={(event) => handleDndConsider("player2Hand", event)}
      onfinalize={(event) => handleDndFinalize("player2Hand", event)}
    >
      <!-- We don't need to know anything about actual cards in opponent's hand; just show card backs. -->
      <!-- Use card, index (index) rather than card.id, so rearranging cards in opponent hand doesn't cause -->
      <!-- the card backs to flip unnecessarily. -->
      {#each gameState.player2Hand as card, index (playerNumber === 2 ? player2Keys[index] : index)}
        <div animate:flip={{ duration: flipDurationMs }}>
          <Card
            code={playerNumber === 2 || handsRevealed ? card.code : "BK"}
            onCardClick={playerNumber === 2
              ? () => discardCard(card)
              : doNothing}
          />
        </div>
      {/each}
    </div>

    <!-- Display buttons for opponent player to knock/gin or discard -->
    <div class="action-row">
      {#if gameState.canKnock && gameState.currentPlayer === "player2" && playerNumber === 2}
        <button
          class="btn-knock"
          onclick={() => {
            announceKnock(2);
          }}>Knock ({bestDeadwood(gameState.player2Hand)} pts)</button
        >
        <button
          class="btn-continue"
          onclick={() => {
            switchPlayer();
          }}>Continue</button
        >
      {/if}
    </div>
    <!-- End Display buttons for opponent player to knock/gin or discard -->
  </section>
  <!-- End Display opponent hand -->

  <!-- Display deck and discard piles, next to each other -->
  <section class="center-area">
    <div class="pile-group">
      <div class="pile">
        <!-- Deck pile -->
        <Card code="BK" onCardClick={addCardToHandFromDeck} />
        <span class="pile-label">Deck</span>
      </div>
      <div class="pile">
        <!-- Discard pile -->
        {#if gameState.discardPile.length > 0}
          <!-- Display the top card of the discard pile -->
          <Card
            code={gameState.discardPile[gameState.discardPile.length - 1].code}
            onCardClick={addCardToHandFromDiscardPile}
          />
        {:else}
          <div class="empty-pile"></div>
        {/if}
        <span class="pile-label">Discard</span>
      </div>
    </div>
  </section>
  <!-- End Display deck and discard piles, next to each other -->

  <!-- Display player hand -->
  <section class="player-area">
    <!-- Display buttons for current player to knock/gin or discard -->
    <div class="action-row">
      {#if gameState.canKnock && gameState.currentPlayer === "player1" && playerNumber === 1}
        <button
          class="btn-knock"
          onclick={() => {
            announceKnock(1);
          }}>Knock ({bestDeadwood(gameState.player1Hand)} pts)</button
        >
        <button
          class="btn-continue"
          onclick={() => {
            switchPlayer();
          }}>Continue</button
        >
      {/if}
    </div>
    <!-- End Display buttons for current player to knock/gin or discard -->

    <div
      class="hand"
      use:dndzone={{
        items: gameState.player1Hand,
        flipDurationMs,
        dragDisabled: playerNumber !== 1,
      }}
      onconsider={(event) => handleDndConsider("player1Hand", event)}
      onfinalize={(event) => handleDndFinalize("player1Hand", event)}
    >
      <!-- We don't need to know anything about actual cards in opponent's hand; just show card backs. -->
      <!-- Use card, index (index) rather than card.id, so rearranging cards in opponent hand doesn't cause -->
      <!-- the card backs to flip unnecessarily. -->
      {#each gameState.player1Hand as card, index (playerNumber === 1 ? player1Keys[index] : index)}
        <div animate:flip={{ duration: flipDurationMs }}>
          <Card
            code={playerNumber === 1 || handsRevealed ? card.code : "BK"}
            onCardClick={playerNumber === 1
              ? () => discardCard(card)
              : doNothing}
          />
        </div>
      {/each}
    </div>
    <span class="hand-label">Player 1</span>

    <!-- Display new hand button -->
    <div class="controls">
      <button
        class="btn-primary"
        disabled={playerNumber !== 1 && playerNumber !== 2}
        onclick={startNewHand}>New Hand</button
      >
    </div>
    <!-- End Display hand controls -->
  </section>
  <!-- End Display player hand -->

<dialog
  class="knock-modal"
  bind:this={knockModalRef}
  onclose={() => (showKnockModal = false)}
>
  <article>
    <header>
      <p>
        <strong
          >{layoff.knockerDeadwood === 0
            ? "Gin!"
            : `Knock for ${layoff.knockerDeadwood} points`}</strong
        >
      </p>
    </header>
    <p>
      {#if layoff.laidOff.length > 0}
        Opponent laid off {layoff.laidOff.length}
        {layoff.laidOff.length === 1 ? "card" : "cards"}.
      {/if}
      Opponent has {layoff.deadwood} points in their hand. That's a difference of
      {layoff.deadwood - layoff.knockerDeadwood} points.
      {#if handScore.result === "undercut"}
        The opponent has undercut the knocking player.
      {/if}
    </p>
    <p>
      <strong
        >{handWinner === "player1" ? "Player 1" : "Player 2"} scores {handScore.points}
        points.</strong
      >
    </p>
    <footer>
      <button
        class="btn-primary"
        disabled={playerNumber !== knockingPlayerNumber}
        onclick={scoreAndNewHand}>New Hand</button
      >
      <button class="btn-continue" onclick={cancelKnock}
        >Cancel</button
      >
    </footer>
  </article>
</dialog>
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    height: 100%;
  }

  :global(body) {
    font-family:
      system-ui,
      -apple-system,
      "Segoe UI",
      sans-serif;
  }

  .table {
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: clamp(0.5rem, 2vh, 1.5rem);
    min-height: 100dvh;
    padding: clamp(0.75rem, 2vw, 2rem);
    background: radial-gradient(
      ellipse at center,
      #1f6b3a 0%,
      #145229 55%,
      #0a3018 100%
    );
    color: #f5f0e6;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
    position: relative;
    z-index: 1;
  }

  .topbar h1 {
    margin: 0;
    font-size: clamp(1.1rem, 2.5vw, 1.7rem);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #f5e7b8;
  }

  .status {
    color: white;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    background: rgba(0, 0, 0, 0.28);
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    font-size: clamp(0.8rem, 1.5vw, 0.95rem);
  }

  .status-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .green {
    background-color: #3ddc73;
    box-shadow: 0 0 6px #3ddc73;
  }

  .red {
    background-color: #ff5d5d;
    box-shadow: 0 0 6px #ff5d5d;
  }

  .opponent-area,
  .player-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .hand-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.75;
  }

  .hand {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    width: 100%;
    min-height: clamp(60px, 11vw, 120px);
    padding: 0.5rem;
    border-radius: 12px;
  }

  .action-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.6rem;
    min-height: 2.5rem;
  }

  .center-area {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
  }

  .pile-group {
    display: flex;
    align-items: flex-end;
    gap: clamp(1.5rem, 6vw, 4rem);
  }

  .pile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
  }

  .pile-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    opacity: 0.7;
  }

  .empty-pile {
    width: clamp(48px, 8vw, 110px);
    aspect-ratio: 0.7;
    border: 2px dashed rgba(245, 240, 230, 0.4);
    border-radius: 8%;
  }

  .controls {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.15rem;
  }

  button {
    font: inherit;
    font-weight: 600;
    font-size: 0.9rem;
    color: inherit;
    border: none;
    cursor: pointer;
    border-radius: 999px;
    padding: 0.55rem 1.4rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    transition:
      transform 0.12s ease,
      box-shadow 0.12s ease,
      filter 0.12s ease;
  }

  button:hover {
    transform: translateY(-2px);
    filter: brightness(1.06);
  }

  button:active {
    transform: translateY(0);
  }

  .btn-primary {
    background: linear-gradient(180deg, #f7d774, #d9a721);
    color: #3a2b00;
  }

  .btn-knock {
    background: linear-gradient(180deg, #6fd18a, #2f9e52);
    color: #04220f;
  }

  .btn-continue {
    background: linear-gradient(180deg, #7fb8e0, #3a7fb5);
    color: #04202f;
  }

  .seat-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .knock-modal {
    border: none;
    border-radius: 16px;
    padding: 0;
    /* Pico CSS makes <dialog> a full-screen dark, blurred overlay; undo that */
    width: auto;
    height: auto;
    min-width: 0;
    min-height: 0;
    background: transparent;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    /* Sits in the strip between the two hands, to the right of the piles */
    position: absolute;
    inset: 50% clamp(0.5rem, 3vw, 2rem) auto auto;
    margin: 0;
    transform: translateY(-50%);
    max-width: min(45vw, 300px);
    z-index: 1;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  }

  .knock-modal article {
    margin: 0;
    font-size: 0.85rem;
    padding: 0.75rem 1rem;
    background: #fffaf0;
    color: #2b2b2b;
    border-radius: 16px;
  }

  .knock-modal header {
    margin-bottom: 0.5rem;
  }

  .knock-modal footer {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
    margin: 1rem 0 0;
    padding: 0;
  }

  .knock-modal footer button {
    width: auto;
    margin: 0;
    padding: 0.4rem 0.8rem;
    font-size: 0.8rem;
  }

  @media (min-width: 900px) {
    .table {
      padding: 2rem 3rem;
    }
  }

  @media (max-width: 480px) {
    .topbar h1 {
      font-size: 1rem;
    }

    .pile-group {
      gap: 1.25rem;
    }
  }
</style>
