// EvaluateHand.js
// Pure gin rummy logic (no UI, no network). Everything here takes cards in and
// returns numbers/arrays out, so it's easy to test on its own.
//
// Vocabulary:
//   - A "card" is an object with a `code` string like "3H" (rank char + suit char).
//     Rank chars: A,2-9,0 (the Deck of Cards API uses "0" for 10),J,Q,K.
//     Suit chars: H(earts), D(iamonds), S(pades), C(lubs).
//   - A "meld" is a group of cards that scores nothing against you:
//       * a set: 3-4 cards of the same rank (7H 7D 7S)
//       * a run: 3+ cards of the same suit in a row (3H 4H 5H)
//   - "Deadwood" is the cards NOT in any meld; their point values are added up.
//     The lower the deadwood, the better.

// Read a card's rank from its code, e.g. "3H" -> 3, "KS" -> 13.
// Returns a number so ranks can be compared and sorted (Ace is low = 1).
function rankOf(card) {
  // card.code[0] is the first character of the code, e.g. "3" in "3H"
  const rank = card.code[0];
  // "0" is how the API writes 10 (so every code is exactly 2 characters)
  if (rank === "0") return 10;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  if (rank === "A") return 1;
  // Remaining characters are "2".."9"; parseInt turns the text into a number
  return parseInt(rank);
}

// Read a card's suit from its code, e.g. "3H" -> "H" (the second character).
function suitOf(card) {
  return card.code[1];
}

// How many deadwood points a single card is worth.
function deadwoodValue(card) {
  // Deadwood value is the card's point value; face cards are worth 10 points.
  // Math.min caps J(11), Q(12), K(13) at 10; Ace stays 1.
  return Math.min(rankOf(card), 10);
}

// Finds EVERY possible meld in a hand (including overlapping ones, e.g. both
// 3H-4H-5H and 4H-5H-6H). Choosing which ones to actually use happens later,
// in bestArrangement. Returns an array of melds; each meld is an array of cards.
function findMelds(hand) {
  // This function finds all possible melds in a hand of cards.
  // A meld is either a set (three or four cards of the same rank) or a run (three or more cards of the same suit in sequence).
  const melds = [];

  // Find sets
  // We'll make a map with all the 2's, 3's, etc.
  // Key will be a rank (e.g., 2), value will be an array with cards of that rank (e.g. 2H, 2D, 2S)
  // Any arrays with 3 or 4 cards are melds.
  const cardsByRank = new Map();
  // go through each card in hand
  for (const card of hand) {
    // get the card's rank
    const rank = rankOf(card);
    // if the rank is not in the map, add it with an empty array
    if (!cardsByRank.has(rank)) {
      cardsByRank.set(rank, []);
    }
    // add the card to the array for that rank
    cardsByRank.get(rank).push(card);
  } // end loop

  // Now go through the map and find array with 3-4 cards of same rank
  // .values() gives us the arrays
  // loop through each array (e.g., ["7C", "7D", "7H"])
  for (const cards of cardsByRank.values()) {
    // if there's 3 cards of the same rank, it's a meld
    if (cards.length === 3) {
      melds.push(cards);
    }
    // if there's 4 cards, add each possible 3 card set as a meld (after adding the 4 card set as a meld)
    if (cards.length === 4) {
      melds.push(cards); // Add the 4-card meld first
      for (let i = 0; i < cards.length; i++) {
        // skip the card at 0, add the other 3 as a meld; skp the card at 1, add the other 3 as a meld; etc.
        // filter keeps a card only when the test is true; `_` is the card (unused),
        // `index` is its position, so this drops just the card at position i.
        const temp = cards.filter((_, index) => index !== i);
        melds.push(temp);
      }
    }
  }

  // Now let's find the runs
  const cardsBySuit = new Map();
  // follow same logic as above to group by suit
  for (const card of hand) {
    const suit = suitOf(card);
    if (!cardsBySuit.has(suit)) {
      cardsBySuit.set(suit, []);
    }
    cardsBySuit.get(suit).push(card);
  }
  // loop over suit groups
  // cards is array of cards of the same suit, e.g., ["3H", "5H", "4H"]
  for (const cards of cardsBySuit.values()) {
    // sort the cards by rank, from lowest to highest, so we can find runs
    // sort compares two cards at a time; if result is negative a comes before b, etc. ['3H', '4H', '5H']
    cards.sort((a, b) => rankOf(a) - rankOf(b));
    // run is the current group of cards we're building
    let run = [];
    for (const card of cards) {
      // if the current run is empty, push the first card onto it to start a new run
      if (run.length === 0) {
        run.push(card);
      }
      // or if this card is exactly one higher than the previous one, add it to the run
      else if (rankOf(card) === rankOf(run[run.length - 1]) + 1) {
        run.push(card);
        // otherwise, we add the current run to melds and start a new run with this card
      } else {
        addRunSubsets(run, melds);
        run = [card];
      }
    }
    // the loop ended, so the last run still needs to be recorded
    addRunSubsets(run, melds);
  }
  return melds;
}

// Given a run of consecutive same-suit cards (e.g. 3H 4H 5H 6H), adds every
// sub-run of 3+ cards (3-4-5, 4-5-6, 3-4-5-6) to `melds`. Runs shorter than 3
// add nothing. Note: this changes `melds` directly rather than returning it.
function addRunSubsets(run, melds) {
  // outer loop picks where possible fun starts, inner loop tries endings at least 3 cards later. Slice() makes new array
  // (slice(start, end) copies the cards from index start up to, but not including, end)
  for (let start = 0; start <= run.length - 3; start++) {
    for (let end = start + 3; end <= run.length; end++) {
      melds.push(run.slice(start, end));
    }
  }
}

// Returns just the lowest possible deadwood total (a number) for a hand.
// Used to decide whether a player is allowed to knock (10 or fewer).
export function bestDeadwood(hand) {
  return bestArrangement(hand).deadwood;
}

// Like bestDeadwood, but also returns which melds and leftover cards give that lowest score.
// Returns { melds: [[card, ...], ...], deadwoodCards: [card, ...], deadwood: number }
export function bestArrangement(hand) {
  const melds = findMelds(hand); // all possible melds in the hand
  let lowestScore = Infinity;
  let bestMelds = []; // the melds used in the best arrangement found so far

  // Brute-force search: for each possible meld we try BOTH "skip it" and "use it",
  // which explores every valid combination of non-overlapping melds. This is a
  // recursive function (it calls itself), moving on to the next meld each time.
  // chosenMelds is the list of melds picked so far on this path through the search
  // For example, 3H-4H-5H and 4H-5H-6H are overlapping runs: both are possible
  // melds, but they cannot both be chosen because they share 4H and 5H.
  function search(meldIndex, usedCards, chosenMelds) {
    // meldIndex is index of current meld being considered, usedCards is set of cards already used in previous melds
    if (meldIndex === melds.length) {
      // we've considered all melds
      const deadwood = hand // start with whole hand
        .filter((card) => !usedCards.has(card)) // remove cards that are in melds
        .reduce((total, card) => total + deadwoodValue(card), 0); // sum up values of remaining cards
      // only a strictly lower score replaces the best, so on ties the first arrangement found is kept
      if (deadwood < lowestScore) {
        lowestScore = deadwood;
        bestMelds = chosenMelds;
      }
      return;
    }

    // choice 1:skip the current meld
    search(meldIndex + 1, usedCards, chosenMelds);

    // Choice 2: use this meld, if it doesn't overlap.
    const meld = melds[meldIndex];
    const overlaps = meld.some((card) => usedCards.has(card));

    // A card can only belong to one meld, so skip this choice if any card is taken
    if (!overlaps) {
      // copy the Set so the "skip" path above isn't affected by our additions
      const nextUsedCards = new Set(usedCards);

      for (const card of meld) {
        nextUsedCards.add(card);
      }

      // [...chosenMelds, meld] makes a new array, so other paths aren't affected
      search(meldIndex + 1, nextUsedCards, [...chosenMelds, meld]);
    }
  } // end search
  // Start the search at the first meld with no cards used and no melds chosen
  search(0, new Set(), []);

  // .flat() turns [[a,b,c],[d,e,f]] into [a,b,c,d,e,f]; the Set makes lookups fast
  const meldedCards = new Set(bestMelds.flat());
  // Whatever isn't in a chosen meld is deadwood
  const deadwoodCards = hand.filter((card) => !meldedCards.has(card));
  return { melds: bestMelds, deadwoodCards, deadwood: lowestScore };
} // end bestArrangement

// A meld is a set if all its cards share a rank; otherwise it's a run.
function isSet(meld) {
  // every() is true only if the test passes for ALL cards
  return meld.every((card) => rankOf(card) === rankOf(meld[0]));
}

// Can this card be added to this meld?
function fitsMeld(card, meld) {
  if (isSet(meld)) {
    // a set holds at most 4 cards
    return meld.length < 4 && rankOf(card) === rankOf(meld[0]);
  }
  if (suitOf(card) !== suitOf(meld[0])) return false;
  // map turns the meld's cards into a list of their ranks, e.g. [3, 4, 5]
  const ranks = meld.map(rankOf);
  // (Math.min/max with `...` spread the array out as separate arguments)
  // a run can grow one rank below its lowest card or one above its highest
  return (
    rankOf(card) === Math.min(...ranks) - 1 ||
    rankOf(card) === Math.max(...ranks) + 1
  );
}

// After a knock, the opponent lays off deadwood cards onto the knocker's melds.
// No lay-off is allowed when the knocker has gin (0 deadwood).
// Returns { deadwood: number, laidOff: [card, ...], remaining: [card, ...] }
export function deadwoodAfterLayoff(knockerHand, opponentHand) {
  const knocker = bestArrangement(knockerHand);
  const opponent = bestArrangement(opponentHand);
  // `remaining` = opponent's deadwood cards not (yet) laid off; [...x] copies the array
  let remaining = [...opponent.deadwoodCards];
  // cards that were successfully added to the knocker's melds
  const laidOff = [];

  if (knocker.deadwood > 0) {
    // copy the melds so the knocker's real melds aren't changed
    const melds = knocker.melds.map((meld) => [...meld]);
    let changed = true;
    // a laid-off card can make room for another, so repeat until nothing fits
    while (changed) {
      changed = false;
      for (const card of remaining) {
        // find returns the first meld this card fits, or undefined if none
        const meld = melds.find((m) => fitsMeld(card, m));
        if (meld) {
          meld.push(card); // grow the meld so later cards can build on it
          laidOff.push(card);
          remaining = remaining.filter((c) => c !== card);
          changed = true;
          break; // remaining changed, so start the pass again
        }
      }
    }
  }

  // reduce adds up the point value of every card still left over
  const deadwood = remaining.reduce((t, card) => t + deadwoodValue(card), 0);
  return { deadwood, laidOff, remaining };
}

// Bonus points awarded for going gin (0 deadwood) or for undercutting a knock
const GIN_BONUS = 25;
const UNDERCUT_BONUS = 25;

// Scores a finished hand. Both arguments are deadwood point totals; the
// opponent's should already have lay-offs applied.
// Returns { winner: "knocker" | "opponent", points: number, result: "gin" | "knock" | "undercut" }
export function scoreHand(knockerDeadwood, opponentDeadwood) {
  // Gin: knocker has no deadwood, wins the bonus plus the opponent's deadwood
  if (knockerDeadwood === 0) {
    return {
      winner: "knocker",
      points: GIN_BONUS + opponentDeadwood,
      result: "gin",
    };
  }
  // Undercut: opponent ties or beats the knocker, so the OPPONENT scores
  // the bonus plus the difference
  if (opponentDeadwood <= knockerDeadwood) {
    return {
      winner: "opponent",
      points: UNDERCUT_BONUS + (knockerDeadwood - opponentDeadwood),
      result: "undercut",
    };
  }
  // Normal knock: knocker has fewer deadwood points and wins the difference
  return {
    winner: "knocker",
    points: opponentDeadwood - knockerDeadwood,
    result: "knock",
  };
}
