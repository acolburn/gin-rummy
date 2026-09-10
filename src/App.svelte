<script>
  import { dndzone } from "svelte-dnd-action";
  import { flip } from "svelte/animate";
  import Card from "./Card.svelte";
  import { auth, db } from "./firebase.js";
  import { onMount } from "svelte";
  import { signInAnonymously } from "firebase/auth";
  import { doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
  import { toHandCard } from "./cards.js";
  import { calculateDeadwood } from "./HandEvaluation.svelte";

  let gameSnapshotData = $state();
  let playerNumber = $state();

  // Identify this browser with a simple random id stored locally, instead of
  // relying on Firebase Auth's uid (which was the source of the occasional
  // "stuck as spectator" bugs).
  function getOrCreateMyId() {
    const storageKey = "ginRummyPlayerId";
    let id = localStorage.getItem(storageKey);
    if (!id) {
      id = Math.random().toString(36).slice(2);
      localStorage.setItem(storageKey, id);
    }
    return id;
  }
  const myId = getOrCreateMyId();

  function doNothing() {
    // This function intentionally does nothing
  }

  // onMount means runs this after the component is loaded in the browser/DOM
  // Firebase still needs an authenticated (anonymous) user for Firestore access
  onMount(async () => {
    try {
      await signInAnonymously(auth);

      const gameRef = doc(db, "games", "gin-rummy");

      onSnapshot(gameRef, async (snapshot) => {
        if (snapshot.exists()) {
          gameSnapshotData = snapshot.data();

          // Pull any game-play fields that exist in Firestore into our local gameState
          // Objects.keys(gameState) returns an array of the keys in gameState,
          // e.g., ["player1Hand", "player2Hand", "discardPile", "deckId",
          // "currentPlayer"]
          Object.keys(gameState).forEach((key) => {
            if (gameSnapshotData[key] !== undefined) {
              gameState[key] = gameSnapshotData[key];
            }
          });

          if (gameSnapshotData.player1 === myId) {
            playerNumber = 1;
          } else if (gameSnapshotData.player2 === myId) {
            playerNumber = 2;
          } else {
            playerNumber = undefined;
          }
        } else {
          console.log("There is no current game.");
          gameSnapshotData = undefined;
          await makeDeck();
        }
      });
    } catch (error) {
      console.error("Firebase error:", error);
    }
  });

  // Claim the Dealer (player2) or Non-Dealer (player1) seat by writing our id to
  // Firestore. This is a friendly game, so we don't check who currently holds
  // the seat -- clicking always (re)assigns it.
  async function claimSeat(seatNumber) {
    const field = seatNumber === 1 ? "player1" : "player2";
    const gameRef = doc(db, "games", "gin-rummy");

    try {
      await updateDoc(gameRef, { [field]: myId });
    } catch (error) {
      console.error("Could not claim seat:", error);
    }
  }

  // Sync only the given fields to Firestore (defaults to the full gameState).
  // Scoping updates to just what changed avoids one client's stale local copy
  // of unrelated fields clobbering another client's concurrent changes.
  // Uses setDoc + merge (not updateDoc) so this also works the first time,
  // when the game doc doesn't exist yet (e.g. makeDeck's bootstrap call).
  /** @param {Partial<typeof gameState>} fields */
  async function syncGameState(fields = { ...gameState }) {
    const gameRef = doc(db, "games", "gin-rummy");

    try {
      await setDoc(gameRef, fields, { merge: true });
    } catch (error) {
      console.error("Could not sync game state:", error);
    }
  }

  // Holds all the shared game data in one place, e.g., this can be synced
  // with a shared game state, such as via Firestore, later on
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
  });
  // Am I allowed to act right now? (i.e., is it my turn?)
  let isMyTurn = $derived(
    (playerNumber === 1 && gameState.currentPlayer === "player1") ||
      (playerNumber === 2 && gameState.currentPlayer === "player2"),
  );
  let showKnockModal = $state(false);
  let knockModalRef;

  // Open/close the knock modal when showKnockModal changes
  $effect(() => {
    if (knockModalRef) {
      if (showKnockModal) {
        knockModalRef.showModal();
      } else {
        knockModalRef.close();
      }
    }
  });

  const flipDurationMs = 200; // Duration of the flip animation in milliseconds
  let isDragging = $state(false); // Track whether a card is being dragged

  // current player can drag and drop cards in their hand
  function handleDndConsider(event) {
    isDragging = true; //player started dragging a card, so ignore the click event that will fire when they release the card
    gameState.player1Hand = event.detail.items;
  }
  function handleDndFinalize(event) {
    gameState.player1Hand = event.detail.items;
    syncGameState({ player1Hand: gameState.player1Hand });

    setTimeout(() => {
      isDragging = false; // Brief delay before restting to the click event finishes getting ignored
    }, 50);
  }

  // opponent player can drag and drop cards in their hand
  function handleOpponentDndConsider(event) {
    isDragging = true; //opponent started dragging a card, so ignore the click event that will fire when they release the card
    gameState.player2Hand = event.detail.items;
  }
  function handleOpponentDndFinalize(event) {
    gameState.player2Hand = event.detail.items;
    syncGameState({ player2Hand: gameState.player2Hand });

    setTimeout(() => {
      isDragging = false; // Brief delay before restting to the click event finishes getting ignored
    }, 50);
  }

  async function switchPlayer() {
    gameState.currentPlayer =
      gameState.currentPlayer === "player1" ? "player2" : "player1";
    gameState.canKnock = false;
    await syncGameState({
      currentPlayer: gameState.currentPlayer,
      canKnock: gameState.canKnock,
    });
  }

  async function makeDeck() {
    // Fetch a new shuffled deck from the API
    const response = await fetch(
      // "https://deckofcardsapi.com/api/deck/new/shuffle/",
      "https://deckofcardsapi.com/api/deck/new/",
    );
    const data = await response.json();
    gameState.deckId = data.deck_id;
    await syncGameState({ deckId: gameState.deckId }); // Sync the new deckId with Firestore
  }

  // makes deck, assigns deckId used throughout the JavaScript
  async function newHand() {
    showKnockModal = false;
    // Reshuffle the deck and reset hands and discard pile
    const reshuffleDeck = await fetch(
      `https://deckofcardsapi.com/api/deck/${gameState.deckId}/shuffle/`,
    );
    gameState.player1Hand = [];
    gameState.player2Hand = [];
    gameState.discardPile = [];
    gameState.canKnock = false;

    // Draw 10 cards from deck, assign to playerHand
    const drawResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${gameState.deckId}/draw/?count=10`,
    );
    // Parse the response and update playerHand with the drawn cards
    const drawData = await drawResponse.json();
    gameState.player1Hand = drawData.cards.map((card) => toHandCard(card));
    // Repeat for opponentHand
    const opponentDrawResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${gameState.deckId}/draw/?count=10`,
    );
    const opponentDrawData = await opponentDrawResponse.json();
    gameState.player2Hand = opponentDrawData.cards.map((card) =>
      toHandCard(card),
    );
    // Add one card to the discard pile
    const discardResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${gameState.deckId}/draw/?count=1`,
    );
    const discardData = await discardResponse.json();
    gameState.discardPile = discardData.cards.map((card) => toHandCard(card));
    await syncGameState({
      player1Hand: gameState.player1Hand,
      player2Hand: gameState.player2Hand,
      discardPile: gameState.discardPile,
      canKnock: gameState.canKnock,
    });
  }

  // draw one card from the deck
  async function drawCard() {
    const drawResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${gameState.deckId}/draw/?count=1`,
    );
    const drawData = await drawResponse.json();
    if (drawData.cards.length > 0) {
      return toHandCard(drawData.cards[0]);
    } else {
      alert("No more cards in the deck.");
      return null;
    }
  }

  // Get a card from the deck and add it to the current player's hand
  async function addCardToHandFromDeck() {
    if (!isMyTurn) {
      return; // Ignore the click event if it's not the player's turn
    }
    if (
      gameState.currentPlayer === "player1" &&
      gameState.player1Hand.length > 10
    ) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    if (
      gameState.currentPlayer === "player2" &&
      gameState.player2Hand.length > 10
    ) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    const newCardCode = await drawCard();
    if (newCardCode) {
      if (gameState.currentPlayer === "player1") {
        gameState.player1Hand = [...gameState.player1Hand, newCardCode];
        await syncGameState({ player1Hand: gameState.player1Hand });
      } else {
        gameState.player2Hand = [...gameState.player2Hand, newCardCode];
        await syncGameState({ player2Hand: gameState.player2Hand });
      }
    }
  }

  async function addCardToHandFromDiscardPile() {
    if (!isMyTurn) {
      return; // Ignore the click event if it's not the player's turn
    }
    if (
      gameState.currentPlayer === "player1" &&
      gameState.player1Hand.length > 10
    ) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    if (
      gameState.currentPlayer === "player2" &&
      gameState.player2Hand.length > 10
    ) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    // Add the top card from the discard pile to the current player's hand
    if (gameState.discardPile.length > 0) {
      const newCardCode =
        gameState.discardPile[gameState.discardPile.length - 1];
      // Remove the card from the discard pile
      gameState.discardPile = gameState.discardPile.slice(0, -1);
      if (gameState.currentPlayer === "player1") {
        gameState.player1Hand = [...gameState.player1Hand, newCardCode];
        await syncGameState({
          player1Hand: gameState.player1Hand,
          discardPile: gameState.discardPile,
        });
      } else {
        gameState.player2Hand = [...gameState.player2Hand, newCardCode];
        await syncGameState({
          player2Hand: gameState.player2Hand,
          discardPile: gameState.discardPile,
        });
      }
    } else {
      alert("No cards in the discard pile.");
    }
  }

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
    // regardless of which hand the click event happened to come from
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
    gameState[handField] = gameState[handField].filter((c) => c.id !== card.id);
    // Add the card to the discard pile
    gameState.discardPile = [...gameState.discardPile, card];
    // Calculate the deadwood for the current player
    gameState.canKnock = calculateDeadwood(gameState[handField]) <= 10;
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
      {#if playerNumber === undefined}
        <span class="status-dot red"></span>Choose a seat to play
      {:else if gameState.currentPlayer === "player1" && playerNumber === 1}
        <span class="status-dot green"></span>Your turn
      {:else if gameState.currentPlayer === "player2" && playerNumber === 2}
        <span class="status-dot green"></span>Your turn
      {:else}
        <span class="status-dot red"></span>Waiting for opponent
      {/if}
    </p>
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
      onconsider={handleOpponentDndConsider}
      onfinalize={handleOpponentDndFinalize}
    >
      <!-- We don't need to know anything about actual cards in opponent's hand; just show card backs. -->
      <!-- Use card, index (index) rather than card.id, so rearranging cards in opponent hand doesn't cause -->
      <!-- the card backs to flip unnecessarily. -->
      {#each gameState.player2Hand as card, index (playerNumber === 2 ? card.id : index)}
        <div animate:flip={{ duration: flipDurationMs }}>
          <Card
            code={playerNumber === 2 ? card.code : "BK"}
            onCardClick={playerNumber === 2
              ? () => discardCard(card)
              : doNothing}
          />
        </div>
      {/each}
    </div>

    <!-- Display buttons for opponent player to knock/gin or discard -->
    <div class="action-row">
      {#if gameState.canKnock && gameState.currentPlayer === "player2"}
        <button
          class="btn-knock"
          onclick={() => {
            showKnockModal = true;
          }}>Knock ({calculateDeadwood(gameState.player2Hand)} pts)</button
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
      {#if gameState.canKnock && gameState.currentPlayer === "player1"}
        <button
          class="btn-knock"
          onclick={() => {
            showKnockModal = true;
          }}>Knock ({calculateDeadwood(gameState.player1Hand)} pts)</button
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
      onconsider={handleDndConsider}
      onfinalize={handleDndFinalize}
    >
      <!-- We don't need to know anything about actual cards in opponent's hand; just show card backs. -->
      <!-- Use card, index (index) rather than card.id, so rearranging cards in opponent hand doesn't cause -->
      <!-- the card backs to flip unnecessarily. -->
      {#each gameState.player1Hand as card, index (playerNumber === 1 ? card.id : index)}
        <div animate:flip={{ duration: flipDurationMs }}>
          <Card
            code={playerNumber === 1 ? card.code : "BK"}
            onCardClick={playerNumber === 1
              ? () => discardCard(card)
              : doNothing}
          />
        </div>
      {/each}
    </div>
    <span class="hand-label">Player 1</span>

    <!-- Display new game button -->
    <!-- Only Dealer can shuffle and deal a new hand -->
    <div class="controls">
      <button
        class="btn-primary"
        disabled={playerNumber !== 2}
        onclick={newHand}>New Hand</button
      >
    </div>
    <!-- End Display new game button -->
  </section>
  <!-- End Display player hand -->
</div>

<!-- ---------------------------------------------------------------------------- -->
<!-- Knock/Gin modal -->
<!-- ---------------------------------------------------------------------------- -->

<dialog
  class="knock-modal"
  bind:this={knockModalRef}
  onclose={() => (showKnockModal = false)}
>
  <article>
    <header>
      <p>
        <strong
          >{calculateDeadwood(gameState.player1Hand) === 0
            ? "Gin!"
            : `Knock for ${calculateDeadwood(gameState.player1Hand)} points`}</strong
        >
      </p>
    </header>
    <p>Well done!</p>
    <footer>
      <button class="btn-primary" onclick={newHand}>New Hand</button>
      <button class="btn-continue" onclick={() => (showKnockModal = false)}
        >Cancel</button
      >
    </footer>
  </article>
</dialog>

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
    max-width: min(90vw, 380px);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  }

  .knock-modal::backdrop {
    background: rgba(0, 0, 0, 0.55);
  }

  .knock-modal article {
    margin: 0;
    padding: 1.25rem 1.5rem;
    background: #fffaf0;
    color: #2b2b2b;
    border-radius: 16px;
  }

  .knock-modal header {
    margin-bottom: 0.5rem;
  }

  .knock-modal footer {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
    margin-top: 1.25rem;
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
