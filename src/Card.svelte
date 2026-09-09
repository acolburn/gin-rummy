<script>
  import { cards } from "./cards.js";
  let { code, onCardClick } = $props();

  function findCardByCode(code) {
    return cards.find((card) => card.code === code);
  }

  function displayCard(code) {
    const card = findCardByCode(code);
    if (card) {
      return card.image;
    }
    return findCardByCode("BK")?.image; // Return the image for the back of the card if not found
  }
</script>

<button
  class="card-button"
  class:face-down={code === "BK"}
  onclick={() => onCardClick(code)}
>
  <img src={displayCard(code)} alt={code} draggable="false" />
</button>

<style>
  .card-button {
    /* clamp so cards stay readable on mobile but don't get huge on wide desktop screens */
    width: clamp(48px, 8vw, 110px);
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 8%;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.3),
      0 3px 6px rgba(0, 0, 0, 0.25);
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease;
    flex-shrink: 0;
  }

  .card-button:hover {
    transform: translateY(-6px);
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.35),
      0 8px 14px rgba(0, 0, 0, 0.3);
  }

  .card-button:active {
    transform: translateY(-2px);
  }

  .card-button.face-down {
    cursor: default;
  }

  /* images default to inline, block removese extra space below the image */
  /* height:auto makes image scale to maintain aspect ratio */
  .card-button img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 8%;
    -webkit-user-drag: none;
  }
</style>
