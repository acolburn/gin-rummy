<script>
  import { dndzone } from "svelte-dnd-action";
  import { flip } from "svelte/animate";
  import Card from "./Card.svelte";
  import { toHandCard } from "./cards.js";
  import { calculateDeadwood } from "./HandEvaluation.svelte";
  let playerHand = $state([]);
  let opponentHand = $state([]);
  let discardPile = $state([]);
  let deckId = $state("");
  let currentPlayer = $state("player"); // "player" or "opponent"
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

  function handleDndConsider(event) {
    isDragging = true; //player started dragging a card, so ignore the click event that will fire when they release the card
    playerHand = event.detail.items;
  }
  function handleDndFinalize(event) {
    playerHand = event.detail.items;

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
    currentPlayer = currentPlayer === "player" ? "opponent" : "player";
  }

  async function makeDeck() {
    // Fetch a new shuffled deck from the API
    // NOTE: testing with unshuffled deck for now, so we can see the same cards each time
    const response = await fetch(
      // "https://deckofcardsapi.com/api/deck/new/shuffle/",
      "https://deckofcardsapi.com/api/deck/new/",
    );
    const data = await response.json();
    deckId = data.deck_id;
  }

  // makes deck, assigns deckId used throughout the JavaScript
  async function newGame() {
    // Reshuffle the deck and reset hands and discard pile
    const reshuffleDeck = await fetch(
      `https://deckofcardsapi.com/api/deck/${deckId}/shuffle/`,
    );
    playerHand = [];
    opponentHand = [];
    discardPile = [];
    canKnock = false;

    // Draw 10 cards from deck, assign to playerHand
    const drawResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${deckId}/draw/?count=10`,
    );
    // Parse the response and update playerHand with the drawn cards
    const drawData = await drawResponse.json();
    playerHand = drawData.cards.map((card) => toHandCard(card));
    // Repeat for opponentHand
    const opponentDrawResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${deckId}/draw/?count=10`,
    );
    const opponentDrawData = await opponentDrawResponse.json();
    opponentHand = opponentDrawData.cards.map((card) => toHandCard(card));
    // Add one card to the discard pile
    const discardResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${deckId}/draw/?count=1`,
    );
    const discardData = await discardResponse.json();
    discardPile = discardData.cards.map((card) => toHandCard(card));
  }

  // draw one card from the deck
  async function drawCard() {
    const drawResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${deckId}/draw/?count=1`,
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
    if (currentPlayer === "player" && playerHand.length > 10) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    if (currentPlayer === "opponent" && opponentHand.length > 10) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    const newCardCode = await drawCard();
    if (newCardCode) {
      if (currentPlayer === "player") {
        playerHand = [...playerHand, newCardCode];
      } else {
        opponentHand = [...opponentHand, newCardCode];
      }
    }
  }

  async function addCardToHandFromDiscardPile() {
    if (currentPlayer === "player" && playerHand.length > 10) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    if (currentPlayer === "opponent" && opponentHand.length > 10) {
      alert("Your hand is full. Cannot draw more cards.");
      return;
    }
    // Add the top card from the discard pile to the current player's hand
    if (discardPile.length > 0) {
      const newCardCode = discardPile[discardPile.length - 1];
      if (currentPlayer === "player") {
        playerHand = [...playerHand, newCardCode];
      } else {
        opponentHand = [...opponentHand, newCardCode];
      }
      // Remove the card from the discard pile
      discardPile = discardPile.slice(0, -1);
    } else {
      alert("No cards in the discard pile.");
    }
  }

  async function discardCard(card) {
    if (currentPlayer === "player" && playerHand.length < 11) {
      alert("You must select a card before discarding.");
      return;
    }
    if (currentPlayer === "opponent" && opponentHand.length < 11) {
      alert("Your must select a card before discarding.");
      return;
    }
    // Ignore the click event if a card is being dragged
    if (isDragging) {
      return;
    }
    // Add the card to the discard pile
    const discardResponse = await fetch(
      `https://deckofcardsapi.com/api/deck/${deckId}/pile/discard/add/?cards=${card.code}`,
    );
    const discardData = await discardResponse.json();
    if (discardData.success) {
      // Remove the card from the player's hand
      if (currentPlayer === "player") {
        playerHand = playerHand.filter((c) => c.id !== card.id);
      } else {
        opponentHand = opponentHand.filter((c) => c.id !== card.id);
      }
      // Add the card to the discard pile
      discardPile = [...discardPile, card];
      // Calculate the deadwood for the current player
      if (currentPlayer === "player" && calculateDeadwood(playerHand) <= 10) {
        canKnock = true;
      } else {
        canKnock = false;
        // Turn ends; switch to the other player
        switchPlayer();
      }
    } else {
      alert(`Failed to discard card ${card.code}.`);
    }
  }
</script>

<!-- Display opponent hand -->
<div class="hand">
  {#each opponentHand as card (card.id)}
    <Card code={card.code} onCardClick={() => discardCard(card)} />
  {/each}
</div>
<!-- Display deck pile + discard pile, next to each other -->
<div class="hand">
  <!-- Deck pile -->
  <Card code="BK" onCardClick={addCardToHandFromDeck} />
  <!-- Discard pile -->
  {#if discardPile.length > 0}
    <!-- Display the top card of the discard pile -->
    <Card
      code={discardPile[discardPile.length - 1].code}
      onCardClick={addCardToHandFromDiscardPile}
    />
  {/if}
</div>

<!-- Display buttons to knock/gin or discard -->
{#if canKnock && currentPlayer === "player"}
  <button
    onclick={() => {
      showKnockModal = true;
    }}>Knock ({calculateDeadwood(playerHand)} pts)</button
  >
  <button
    onclick={() => {
      canKnock = false;
      switchPlayer();
    }}>Continue</button
  >
{/if}

<!-- Display player hand -->
<div
  class="hand"
  use:dndzone={{ items: playerHand, flipDurationMs }}
  onconsider={handleDndConsider}
  onfinalize={handleDndFinalize}
>
  {#each playerHand as card (card.id)}
    <div animate:flip={{ duration: flipDurationMs }}>
      <Card code={card.code} onCardClick={() => discardCard(card)} />
    </div>
  {/each}
</div>
<button onclick={newGame}>New Game</button>
<p>{currentPlayer === "player" ? "Your turn" : "Waiting for opponent"}</p>

<!-- ---------------------------------------------------------------------------- -->
<!-- Knock/Gin modal -->
<!-- ---------------------------------------------------------------------------- -->

<dialog bind:this={knockModalRef} onclose={() => (showKnockModal = false)}>
  <article>
    <header>
      <p><strong>Knock for {calculateDeadwood(playerHand)} points</strong></p>
    </header>
    <p>Well done!</p>
    <footer>
      <button onclick={() => (showKnockModal = false)}>Cancel</button>
      <button onclick={() => (showKnockModal = false)}>Confirm</button>
    </footer>
  </article>
</dialog>

<style>
  .hand {
    display: flex;
    gap: 0.5rem;
  }
</style>
