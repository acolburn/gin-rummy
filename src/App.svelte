<script>
  import { dndzone } from "svelte-dnd-action";
  import { flip } from "svelte/animate";
  import Card from "./Card.svelte";
  import app from "./firebase.js";
  import { toHandCard } from "./cards.js";
  import { calculateDeadwood } from "./HandEvaluation.svelte";
  // Holds all the shared game data in one place, e.g., this can be synced
  // with a shared game state, such as via Firestore, later on
  let gameState = $state({
    /** @type {any[]} */
    playerHand: [],
    /** @type {any[]} */
    opponentHand: [],
    /** @type {any[]} */
    discardPile: [],
    deckId: "",
    currentPlayer: "player", // "player" or "opponent"
  });
  let canKnock = $state(false); // Whether the player can knock (i.e., has 10 or fewer deadwood points)
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
    gameState.playerHand = event.detail.items;
  }
  function handleDndFinalize(event) {
    gameState.playerHand = event.detail.items;

    setTimeout(() => {
      isDragging = false; // Brief delay before restting to the click event finishes getting ignored
    }, 50);
  }

  // opponent player can drag and drop cards in their hand
  function handleOpponentDndConsider(event) {
    isDragging = true; //opponent started dragging a card, so ignore the click event that will fire when they release the card
    gameState.opponentHand = event.detail.items;
  }
  function handleOpponentDndFinalize(event) {
    gameState.opponentHand = event.detail.items;

    setTimeout(() => {
      isDragging = false; // Brief delay before restting to the click event finishes getting ignored
    }, 50);
  }

  // Fetch a new deck from the API when the component is mounted, i.e, when the page is loaded
  // Will only run once; no state variale inside the effect, so no re-run on state change
  $effect(() => {
    makeDeck();
  });

  function switchPlayer() {
    gameState.currentPlayer =
      gameState.currentPlayer === "player" ? "opponent" : "player";
  }

  async function makeDeck() {
    // Fetch a new shuffled deck from the API
    // NOTE: testing with unshuffled deck for now, so we can see the same cards each time
    const response = await fetch(
      // "https://deckofcardsapi.com/api/deck/new/shuffle/",
      "https://deckofcardsapi.com/api/deck/new/",
    );
    const data = await response.json();
    gameState.deckId = data.deck_id;
  }

  // makes deck, assigns deckId used throughout the JavaScript
  async function newHand() {
    showKnockModal = false;
    // Reshuffle the deck and reset hands and discard pile
    const reshuffleDeck = await fetch(
      `https://deckofcardsapi.com/api/deck/${gameState.deckId}/shuffle/`,
    );
    gameState.playerHand = [];
    gameState.opponentHand = [];
    gameState.discardPile = [];
    canKnock = false;

    // Draw 10 cards from deck, assign to playerHand
    const drawResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${gameState.deckId}/draw/?count=10`,
    );
    // Parse the response and update playerHand with the drawn cards
    const drawData = await drawResponse.json();
    gameState.playerHand = drawData.cards.map((card) => toHandCard(card));
    // Repeat for opponentHand
    const opponentDrawResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${gameState.deckId}/draw/?count=10`,
    );
    const opponentDrawData = await opponentDrawResponse.json();
    gameState.opponentHand = opponentDrawData.cards.map((card) =>
      toHandCard(card),
    );
    // Add one card to the discard pile
    const discardResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${gameState.deckId}/draw/?count=1`,
    );
    const discardData = await discardResponse.json();
    gameState.discardPile = discardData.cards.map((card) => toHandCard(card));
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
    if (
      gameState.currentPlayer === "player" &&
      gameState.playerHand.length > 10
    ) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    if (
      gameState.currentPlayer === "opponent" &&
      gameState.opponentHand.length > 10
    ) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    const newCardCode = await drawCard();
    if (newCardCode) {
      if (gameState.currentPlayer === "player") {
        gameState.playerHand = [...gameState.playerHand, newCardCode];
      } else {
        gameState.opponentHand = [...gameState.opponentHand, newCardCode];
      }
    }
  }

  async function addCardToHandFromDiscardPile() {
    if (
      gameState.currentPlayer === "player" &&
      gameState.playerHand.length > 10
    ) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    if (
      gameState.currentPlayer === "opponent" &&
      gameState.opponentHand.length > 10
    ) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    // Add the top card from the discard pile to the current player's hand
    if (gameState.discardPile.length > 0) {
      const newCardCode =
        gameState.discardPile[gameState.discardPile.length - 1];
      if (gameState.currentPlayer === "player") {
        gameState.playerHand = [...gameState.playerHand, newCardCode];
      } else {
        gameState.opponentHand = [...gameState.opponentHand, newCardCode];
      }
      // Remove the card from the discard pile
      gameState.discardPile = gameState.discardPile.slice(0, -1);
    } else {
      alert("No cards in the discard pile.");
    }
  }

  function discardCard(card) {
    if (
      gameState.currentPlayer === "player" &&
      gameState.playerHand.length < 11
    ) {
      alert("You must select a card before discarding.");
      return;
    }
    if (
      gameState.currentPlayer === "opponent" &&
      gameState.opponentHand.length < 11
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
      gameState.currentPlayer === "player"
        ? gameState.playerHand.some((c) => c.id === card.id)
        : gameState.opponentHand.some((c) => c.id === card.id);
    if (!isFromCurrentPlayerHand) {
      return;
    }
    // Remove the card from the current player's hand
    if (gameState.currentPlayer === "player") {
      gameState.playerHand = gameState.playerHand.filter(
        (c) => c.id !== card.id,
      );
    } else {
      gameState.opponentHand = gameState.opponentHand.filter(
        (c) => c.id !== card.id,
      );
    }
    // Add the card to the discard pile
    gameState.discardPile = [...gameState.discardPile, card];
    // Calculate the deadwood for the current player
    if (
      gameState.currentPlayer === "player" &&
      calculateDeadwood(gameState.playerHand) <= 10
    ) {
      canKnock = true;
    } else {
      canKnock = false;
      // Turn ends; switch to the other player
      switchPlayer();
    }
  }
</script>

<!-- Display opponent hand -->
<div
  class="hand"
  use:dndzone={{ items: gameState.opponentHand, flipDurationMs }}
  onconsider={handleOpponentDndConsider}
  onfinalize={handleOpponentDndFinalize}
>
  {#each gameState.opponentHand as card (card.id)}
    <div animate:flip={{ duration: flipDurationMs }}>
      <Card code={card.code} onCardClick={() => discardCard(card)} />
    </div>
  {/each}
</div>
<!-- End Display opponent hand -->

<!-- Display buttons for opponent player to knock/gin or discard -->
{#if canKnock && gameState.currentPlayer === "opponent"}
  <button
    onclick={() => {
      showKnockModal = true;
    }}>Knock ({calculateDeadwood(gameState.opponentHand)} pts)</button
  >
  <button
    onclick={() => {
      canKnock = false;
      switchPlayer();
    }}>Continue</button
  >
{/if}
<!-- End Display buttons for opponent player to knock/gin or discard -->

<!-- Display deck and discard piles, next to each other -->
<div class="hand">
  <!-- Deck pile -->
  <Card code="BK" onCardClick={addCardToHandFromDeck} />
  <!-- Discard pile -->
  {#if gameState.discardPile.length > 0}
    <!-- Display the top card of the discard pile -->
    <Card
      code={gameState.discardPile[gameState.discardPile.length - 1].code}
      onCardClick={addCardToHandFromDiscardPile}
    />
  {/if}
</div>
<!-- End Display deck and discard piles, next to each other -->

<!-- Display buttons for current player to knock/gin or discard -->
{#if canKnock && gameState.currentPlayer === "player"}
  <button
    onclick={() => {
      showKnockModal = true;
    }}>Knock ({calculateDeadwood(gameState.playerHand)} pts)</button
  >
  <button
    onclick={() => {
      canKnock = false;
      switchPlayer();
    }}>Continue</button
  >
{/if}
<!-- End Display buttons for current player to knock/gin or discard -->

<!-- Display player hand -->
<div
  class="hand"
  use:dndzone={{ items: gameState.playerHand, flipDurationMs }}
  onconsider={handleDndConsider}
  onfinalize={handleDndFinalize}
>
  {#each gameState.playerHand as card (card.id)}
    <div animate:flip={{ duration: flipDurationMs }}>
      <Card code={card.code} onCardClick={() => discardCard(card)} />
    </div>
  {/each}
</div>
<!-- End Display player hand -->

<!-- Display new game button and status line-->
<button onclick={newHand}>New Game</button>
<p>
  {gameState.currentPlayer === "player" ? "Your turn" : "Waiting for opponent"}
</p>
<!-- End Display new game button and status line-->

<!-- ---------------------------------------------------------------------------- -->
<!-- Knock/Gin modal -->
<!-- ---------------------------------------------------------------------------- -->

<dialog bind:this={knockModalRef} onclose={() => (showKnockModal = false)}>
  <article>
    <header>
      <p>
        <strong
          >{calculateDeadwood(gameState.playerHand) === 0
            ? "Gin!"
            : `Knock for ${calculateDeadwood(gameState.playerHand)} points`}</strong
        >
      </p>
    </header>
    <p>Well done!</p>
    <footer>
      <button onclick={newHand}>New Hand</button>
      <button onclick={() => (showKnockModal = false)}>Cancel</button>
    </footer>
  </article>
</dialog>

<style>
  .hand {
    display: flex;
    gap: 0.5rem;
  }
</style>
