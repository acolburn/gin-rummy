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

<button class="card-button" onclick={() => onCardClick(code)}>
  <img src={displayCard(code)} alt={code} />
</button>

<style>
  .card-button {
    /* use vw instead of % so sizing isn't tiny inside the un-sized flip-animation wrapper div in playerHand */
    max-width: 7vw;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }

  /* images default to inline, block removese extra space below the image */
  /* height:auto makes image scale to maintain aspect ratio */
  .card-button img {
    display: block;
    width: 100%;
    height: auto;
  }
</style>
