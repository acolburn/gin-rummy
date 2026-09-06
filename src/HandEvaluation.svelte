<!-- All melds are at the beginning, runs are ascending, Deadwood is at the end, The player 
 has already chosen the arrangement. We can simply walk through the hand 
 from left to right. As long as the cards form melds, we keep 
 going. Once we reach the  first card that isn't part of a meld, 
 everything after it is  deadwood. -->
<script module>
  export function calculateDeadwood(hand) {
    // hand is array of card objects, each with a code property
    // we want to work with just the coes, e.g., "5H", "JD", etc.
    const handCodes = hand.map((card) => card.code);
    // This will keep track of where the deadwood begins.
    let deadwoodStart = hand.length;
    // ---------------------------------------------------------
    // Look through the hand, starting at the beginning.
    //
    // i marks the card we're currently trying to match to the start of a meld.
    let i = 0;
    // Once i gets to the end of the hand, we're done.
    while (i < handCodes.length) {
      // If fewer than 3 cards remain, no more melds are possible;
      // anything left is deadwood
      if (i + 2 >= handCodes.length) {
        deadwoodStart = i;
        break;
      }
      // setLength counts how many cards starting at i share the same rank.
      // Start at 1 because handCodes[i] itself always counts.
      // 0th element of the code is rank, e.g., 5H has 5 at element 0
      let setLength = 1;
      while (
        i + setLength < handCodes.length &&
        handCodes[i][0] === handCodes[i + setLength][0]
      ) {
        setLength++;
      }
      // A set must contain 3 or 4 cards.
      if (setLength >= 3) {
        // We found a set, so we can skip over these cards.
        i += setLength;
        continue;
      }
      // Not a set, so check if the next cards form a run instead,
      // e.g., 5H, 6H, 7H. runLength counts how many consecutive cards
      // starting at i extend the run; it grows by one each time the
      // next card keeps the same suit and the next-higher value.
      let runLength = 1;
      while (i + runLength < handCodes.length) {
        // Get the previous card
        const prevCard = handCodes[i + runLength - 1];
        // Get the next card
        const nextCard = handCodes[i + runLength];
        // Check they have the same suit
        const sameSuit = prevCard[1] === nextCard[1];
        // Check if they have consecutive values
        const consecutiveValues =
          getCardNumber(nextCard[0]) === getCardNumber(prevCard[0]) + 1;
        // if either condition is false, the run has ended
        if (!sameSuit || !consecutiveValues) {
          break;
        }
        runLength++;
      }
      // A run must contain 3 or more cards.
      if (runLength >= 3) {
        // We found a run, so we can skip over these cards.
        i += runLength;
        continue;
      }
      // -----------------------------------------------------
      // If we got here, card i is neither part of a set nor a run.
      //
      // Because the player has arranged the hand so that
      // deadwood is at the end, everything from here onward
      // is deadwood.
      // -----------------------------------------------------

      deadwoodStart = i;
      break;
    }
    // deadwoodStart is now either hand.length (no deadwood found, i.e.
    // the whole hand melded), or the index of the first deadwood card.

    // ---------------------------------------------------------
    // Now add up the points of all the deadwood cards.
    // ---------------------------------------------------------

    let points = 0;

    for (let j = deadwoodStart; j < handCodes.length; j++) {
      points += getCardPoints(handCodes[j]);
    }

    return points;
  }

  // -------------------------------------------------------------
  // Convert a card value into a number for checking runs.
  //
  // A  = 1
  // 2  = 2
  // ...
  // 9  = 9
  // 0  = 10
  // J  = 11
  // Q  = 12
  // K  = 13
  // -------------------------------------------------------------

  function getCardNumber(value) {
    if (value === "A") return 1;
    if (value === "0") return 10;
    if (value === "J") return 11;
    if (value === "Q") return 12;
    if (value === "K") return 13;

    return Number(value);
  }

  // -------------------------------------------------------------
  // Get the deadwood point value of a card.
  //
  // A  = 1
  // 2-9 = face value
  // 0  = 10
  // J/Q/K = 10
  // -------------------------------------------------------------

  function getCardPoints(card) {
    const value = card[0];

    if (value === "A") {
      return 1;
    }

    if (value === "0" || value === "J" || value === "Q" || value === "K") {
      return 10;
    }

    return Number(value);
  }
</script>
